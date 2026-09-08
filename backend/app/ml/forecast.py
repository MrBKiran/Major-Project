"""
M3 — Service Demand Forecaster (PROJECT_PLAN §4).

Two signals, blended:

  1. SARIMAX over the centre's own daily job history. Captures weekly
     seasonality and trend — i.e. what normally happens.
  2. A bottom-up count of predicted failures already due to land in the
     window, routed to each owner's preferred centre.

Signal 2 is the part a conventional forecaster cannot have: those jobs do not
exist in any history yet, because the vehicles have not failed. A purely
statistical forecast is structurally blind to the demand the predictive system
is itself about to create — which is exactly the "agentic forward-looking
signal" the plan asks for.

The blend is additive, not averaged: baseline demand and predicted-failure
demand are different jobs arriving at the same bays, so they sum.
"""

from __future__ import annotations

import datetime as dt
import warnings

import pandas as pd
from sqlalchemy import text
from statsmodels.tsa.statespace.sarimax import SARIMAX

from app.db.session import engine

# Weekly seasonality on daily data.
SARIMAX_ORDER = (1, 1, 1)
SARIMAX_SEASONAL = (1, 1, 1, 7)

MIN_HISTORY_DAYS = 30
OVERLOAD_THRESHOLD = 0.90     # forecast/capacity above this flags the day


def _history(center_id: str) -> pd.Series:
    sql = text("SELECT date, jobs FROM service_demand_daily "
               "WHERE center_id = :cid ORDER BY date ASC")
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"cid": center_id})
    if df.empty:
        return pd.Series(dtype=float)
    s = pd.Series(df["jobs"].values, index=pd.DatetimeIndex(df["date"]), dtype=float)
    return s.asfreq("D", fill_value=0.0)


def _capacity(center_id: str) -> int:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT daily_capacity FROM service_centers WHERE id = :cid"),
            {"cid": center_id},
        ).first()
    return int(row[0]) if row else 0


def _predicted_failure_load(center_id: str, horizon_days: int) -> dict[str, int]:
    """Jobs the predictive system expects to generate, by due date.

    Routed via each customer's preferred centre — the same centre the
    Scheduling Agent will try first, so the forecast anticipates its own
    booking behaviour.
    """
    sql = text("""
        SELECT p.days_to_failure
        FROM predictions p
        JOIN vehicles v   ON v.vin = p.vin
        JOIN customers c  ON c.id = v.owner_id
        WHERE c.pref_center_id = :cid
          AND p.days_to_failure IS NOT NULL
          AND p.days_to_failure <= :horizon
          AND p.severity IS NOT NULL
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql, {"cid": center_id, "horizon": horizon_days}).all()

    today = dt.date.today()
    load: dict[str, int] = {}
    for (days,) in rows:
        due = today + dt.timedelta(days=int(days))
        load[due.isoformat()] = load.get(due.isoformat(), 0) + 1
    return load


def forecast_center(center_id: str, horizon_days: int = 14) -> dict:
    history = _history(center_id)
    capacity = _capacity(center_id)

    if len(history) < MIN_HISTORY_DAYS:
        return {"center_id": center_id, "error": "insufficient history to forecast",
                "history_days": len(history)}

    with warnings.catch_warnings():
        # statsmodels is noisy about convergence on short seasonal series; the
        # fit is still usable and the caller sees the numbers either way.
        warnings.simplefilter("ignore")
        fitted = SARIMAX(history, order=SARIMAX_ORDER, seasonal_order=SARIMAX_SEASONAL,
                          enforce_stationarity=False, enforce_invertibility=False).fit(disp=False)
        pred = fitted.get_forecast(steps=horizon_days)
        mean = pred.predicted_mean
        conf = pred.conf_int(alpha=0.20)

    failure_load = _predicted_failure_load(center_id, horizon_days)

    series = []
    for i, (ts, baseline) in enumerate(mean.items()):
        day = ts.date()
        closed = day.weekday() == 6
        base = 0.0 if closed else max(0.0, float(baseline))
        extra = failure_load.get(day.isoformat(), 0)
        total = base + extra
        util = (total / capacity) if capacity else 0.0
        series.append({
            "date": day.isoformat(),
            "weekday": day.strftime("%a"),
            "baseline_forecast": round(base, 1),
            "predicted_failure_jobs": extra,
            "total_forecast": round(total, 1),
            "capacity": capacity,
            "utilisation": round(util, 3),
            "overloaded": bool(util > OVERLOAD_THRESHOLD),
            "lo80": round(max(0.0, float(conf.iloc[i, 0])), 1) if not closed else 0.0,
            "hi80": round(max(0.0, float(conf.iloc[i, 1])), 1) if not closed else 0.0,
        })

    open_days = [d for d in series if d["capacity"] and d["weekday"] != "Sun"]
    return {
        "center_id": center_id,
        "horizon_days": horizon_days,
        "capacity": capacity,
        "series": series,
        "overloaded_days": [d["date"] for d in series if d["overloaded"]],
        "mean_utilisation": round(
            sum(d["utilisation"] for d in open_days) / len(open_days), 3
        ) if open_days else 0.0,
        "model": f"SARIMAX{SARIMAX_ORDER}x{SARIMAX_SEASONAL} + bottom-up failure load",
    }


def forecast_fleet(horizon_days: int = 14) -> dict:
    """Every centre, plus redistribution suggestions for overloaded ones."""
    with engine.connect() as conn:
        centres = [r[0] for r in conn.execute(
            text("SELECT id FROM service_centers ORDER BY id")).all()]

    results = [forecast_center(c, horizon_days) for c in centres]
    ok = [r for r in results if "error" not in r]

    # Same-city centres are the only realistic relief valve — sending an owner
    # to another city to save a bay is not a real recommendation.
    with engine.connect() as conn:
        city_of = dict(conn.execute(text("SELECT id, city FROM service_centers")).all())

    suggestions = []
    for r in ok:
        for day in r["series"]:
            if not day["overloaded"]:
                continue
            spare = [
                (o["center_id"], round(o["capacity"] * (1 - d2["utilisation"]), 1))
                for o in ok if o["center_id"] != r["center_id"]
                and city_of.get(o["center_id"]) == city_of.get(r["center_id"])
                for d2 in o["series"] if d2["date"] == day["date"] and not d2["overloaded"]
            ]
            if spare:
                spare.sort(key=lambda t: -t[1])
                suggestions.append({
                    "date": day["date"], "from_center": r["center_id"],
                    "overflow_jobs": round(day["total_forecast"] - day["capacity"] * OVERLOAD_THRESHOLD, 1),
                    "to_center": spare[0][0], "spare_capacity": spare[0][1],
                })

    return {
        "horizon_days": horizon_days,
        "centers": results,
        "overloaded_center_days": sum(len(r["overloaded_days"]) for r in ok),
        "redistribution": suggestions[:20],
    }
