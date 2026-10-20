/**
 * Slide 2 — Service Ops: demand forecast + capacity.
 *
 * /api/forecast blends two signals per centre — a SARIMAX fit over the
 * centre's own job history, plus a bottom-up count of failures the
 * predictive system already expects to land in the window (jobs that don't
 * exist in any history yet). This page's whole point is showing that second
 * signal changing which days go over capacity, not just plotting a forecast.
 */

import { useEffect, useState } from "react";
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { formatDate, formatSlot, humanize, pluralize } from "@autosaarthi/core";
import { Badge, Card, CHART, Empty, Skeleton, SkeletonStatRow, Stat } from "../ui.jsx";

export default function ServiceOps() {
  const { can } = useAuth();
  const canForecast = can("forecast:read");
  const canAppointments = can("appointment:read");

  return (
    <div className="space-y-5">
      {canForecast && <DemandForecast />}
      {canAppointments && <Appointments />}
    </div>
  );
}

/** Capacity planning: SARIMAX-per-centre forecast, redistribution suggestions.
 * Split out from the page shell so a role with only appointment:read (a
 * service advisor books slots but doesn't plan centre capacity) still gets a
 * working page instead of being blocked on a call it has no permission for. */
function DemandForecast() {
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.get("/api/forecast")
      .then((d) => {
        setForecast(d);
        const ok = d.centers.filter((c) => !c.error);
        if (ok.length) setSelected(ok.slice().sort((a, b) => b.mean_utilisation - a.mean_utilisation)[0].center_id);
      })
      .catch((e) => setError(e.message || String(e)));
  }, []);

  if (error) return <Empty icon="search">Could not load forecast — {error}</Empty>;
  if (!forecast) {
    return (
      <div className="space-y-5">
        <SkeletonStatRow />
        <Card title="Centres">
          <p className="mb-3 flex items-center gap-2 text-label text-fg-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-soft" />
            Fitting a real SARIMAX per centre — a few seconds…
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        </Card>
      </div>
    );
  }

  const centers = forecast.centers.filter((c) => !c.error);
  const fleetUtil = centers.length
    ? centers.reduce((s, c) => s + c.mean_utilisation, 0) / centers.length
    : 0;
  const active = centers.find((c) => c.center_id === selected);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={centers.length} label="centres forecast" sub={`${forecast.horizon_days}-day horizon`} />
        <Stat
          value={forecast.overloaded_center_days}
          label="overloaded centre-days"
          tone={forecast.overloaded_center_days ? "danger" : "good"}
        />
        <Stat value={`${(fleetUtil * 100).toFixed(0)}%`} label="mean utilisation" tone="warn" />
        <Stat value={forecast.redistribution.length} label="redistribution suggestions" tone="accent" />
      </div>

      <Card title="Centres" subtitle="Sorted by mean utilisation over the horizon — click one to inspect">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {centers
            .slice()
            .sort((a, b) => b.mean_utilisation - a.mean_utilisation)
            .map((c) => (
              <button
                key={c.center_id}
                onClick={() => setSelected(c.center_id)}
                className={`rounded-lg border px-3 py-2.5 text-left transition duration-150 active:scale-[0.97] ${
                  selected === c.center_id
                    ? "border-accent/60 bg-surface-inset"
                    : "border-border bg-surface-inset/40 hover:-translate-y-0.5 hover:border-fg-subtle"
                }`}
              >
                <div className="font-mono text-caption text-fg-muted">{c.center_id}</div>
                <div className={`num mt-0.5 text-title-sm font-semibold ${
                  c.mean_utilisation > 0.9 ? "text-p1" : c.mean_utilisation > 0.8 ? "text-p2" : "text-fg"
                }`}>
                  {(c.mean_utilisation * 100).toFixed(0)}%
                </div>
                <div className="text-caption text-fg-muted">
                  cap {c.capacity}/day
                  {c.overloaded_days.length > 0 && (
                    <span className="ml-1.5 text-p1">· {c.overloaded_days.length} over</span>
                  )}
                </div>
              </button>
            ))}
        </div>
      </Card>

      {active && (
        <Card
          title={active.center_id}
          subtitle={`Forecast vs. capacity — ${active.model}`}
          right={active.overloaded_days.length > 0 && <Badge tone="danger">{pluralize(active.overloaded_days.length, "day")} over capacity</Badge>}
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={active.series}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="weekday" stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} width={28} />
                <Tooltip
                  contentStyle={CHART.tooltip}
                  labelFormatter={(_, p) => p?.[0]?.payload?.date}
                />
                <Bar dataKey="baseline_forecast" stackId="a" fill={CHART.series.baseline} name="Baseline (SARIMAX)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="predicted_failure_jobs" stackId="a" fill={CHART.series.predicted} name="Predicted failures" radius={[3, 3, 0, 0]} />
                <Line dataKey="capacity" stroke={CHART.series.capacity} strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="Capacity" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-caption text-fg-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-chart-baseline" /> baseline demand ·{" "}
            <span className="inline-block h-2 w-2 rounded-full bg-chart-predicted" /> jobs the predictive system already expects ·{" "}
            <span className="inline-block h-2 w-2 rounded-full bg-chart-capacity" /> bay capacity
          </p>
        </Card>
      )}

      {forecast.redistribution.length > 0 && (
        <Card title="Redistribution suggestions" subtitle="Same-city centres with spare capacity on an overloaded day">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-caption uppercase tracking-wider text-fg-muted">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Overloaded centre</th>
                <th className="pb-2 text-right font-medium">Overflow</th>
                <th className="pb-2 pl-4 font-medium">Send to</th>
                <th className="pb-2 text-right font-medium">Spare</th>
              </tr>
            </thead>
            <tbody>
              {forecast.redistribution.map((r, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="py-2 text-fg-tertiary">{formatDate(r.date)}</td>
                  <td className="py-2 font-mono text-label text-fg-secondary">{r.from_center}</td>
                  <td className="num py-2 text-right text-p2">+{r.overflow_jobs}</td>
                  <td className="py-2 pl-4 font-mono text-label text-fg-secondary">{r.to_center}</td>
                  <td className="num py-2 text-right text-ok">{r.spare_capacity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Appointments() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/api/appointments", { limit: 50 })
      .then(setData)
      .catch((e) => setError(e.message || String(e)));
  }, []);

  if (error) return <Card title="Appointments"><Empty>{error}</Empty></Card>;
  if (!data) return <Card title="Appointments"><Empty>Loading…</Empty></Card>;

  return (
    <Card title="Appointments" subtitle={`${data.page.total ?? data.appointments.length} in scope`}>
      {data.appointments.length === 0 ? (
        <Empty>No appointments booked yet.</Empty>
      ) : (
        <table className="w-full text-body-sm">
          <thead>
            <tr className="border-b border-border text-left text-caption uppercase tracking-wider text-fg-muted">
              <th className="pb-2 font-medium">Vehicle</th>
              <th className="pb-2 font-medium">Centre</th>
              <th className="pb-2 font-medium">Slot</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 text-right font-medium">Booked by</th>
            </tr>
          </thead>
          <tbody>
            {data.appointments.map((a) => <AppointmentRow key={a.id} appointment={a} />)}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// The scheduler's statuses (app/db/scheduling.py): held | booked | cancelled | completed.
const STATUS_TONE = { booked: "good", held: "warn", cancelled: "danger" };

export function AppointmentRow({ appointment: a }) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-2.5">
        <div className="text-fg">{a.model}</div>
        <div className="font-mono text-caption text-fg-muted">{a.vin}</div>
      </td>
      <td className="py-2.5 text-fg-tertiary">{a.center_name}</td>
      <td className="py-2.5 text-fg-tertiary">{formatSlot(a.slot_start)}</td>
      <td className="py-2.5">
        <Badge tone={STATUS_TONE[a.status] ?? "slate"}>{humanize(a.status)}</Badge>
      </td>
      <td className="py-2.5 text-right text-label text-fg-muted">
        {a.created_by_agent ? humanize(a.created_by_agent) : "Manual"}
      </td>
    </tr>
  );
}
