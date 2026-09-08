from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from utils.db import get_db
from utils.models import Prediction

router = APIRouter()


@router.get("/{vin}/latest")
async def get_latest_prediction(vin: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Prediction)
        .where(Prediction.vin == vin)
        .order_by(desc(Prediction.timestamp))
        .limit(1)
    )
    pred = result.scalar_one_or_none()
    if not pred:
        return {"message": "No predictions yet"}
    return {
        "vin": pred.vin,
        "timestamp": pred.timestamp,
        "health_label": pred.health_label,
        "health_probabilities": pred.health_probabilities,
        "component": pred.component,
        "failure_probability": pred.failure_probability,
        "days_to_failure": pred.days_to_failure,
        "severity": pred.severity,
        "shap_top_features": pred.shap_top_features,
    }


@router.get("/fleet/summary")
async def fleet_summary(db: AsyncSession = Depends(get_db)):
    """Returns one latest prediction per vehicle for fleet overview."""
    from sqlalchemy import func
    subq = (
        select(Prediction.vin, func.max(Prediction.timestamp).label("max_ts"))
        .group_by(Prediction.vin)
        .subquery()
    )
    stmt = select(Prediction).join(
        subq, (Prediction.vin == subq.c.vin) & (Prediction.timestamp == subq.c.max_ts)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [
        {
            "vin": r.vin,
            "health_label": r.health_label,
            "failure_probability": r.failure_probability,
            "days_to_failure": r.days_to_failure,
            "severity": r.severity,
        }
        for r in rows
    ]
