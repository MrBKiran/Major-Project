/**
 * In-Car Console — the head unit itself, not a control panel for one.
 *
 * The previous version was a form that reported what the guard decided. This
 * one renders what the driver would actually see, and lets the guard's verdict
 * decide it: `console.show_slots` and `console.request_touch` are the tools
 * UEBA rule G6 blocks in motion, so when they come back BLOCK the screen has
 * no slot list and no tap target — because the agent was refused, not because
 * this file has an `if (driving)` in it. G7's one-element cap is why DRIVING
 * collapses to a single banner line.
 *
 * That is the whole point of building it this way: the safety rule is visible
 * as an interface, and you can watch it change the screen by changing the
 * drive state. A client-side mirror of the rule would look identical and prove
 * nothing.
 *
 * Night mode follows the deck's screen 9. It is not a theme toggle for taste —
 * a head unit that throws a white panel at a driver at 21:34 is the same class
 * of hazard G6 exists to prevent.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { drivingLeft, formatDays, formatINR as inr, serviceDue } from "@autosaarthi/core";
import { Empty, Skeleton } from "../ui.jsx";
import {
  CarDock, CarFrame, CarStatusBar, CostRows, GhostButton, Headline, MapPane,
  Meta, MONO, Pill, PrimaryButton, SANS, tokens,
} from "../device.jsx";

const DRIVE_STATES = [
  { id: "PARKED", label: "Parked", speed: 0, sub: "full card, booking allowed" },
  { id: "STOPPED_BRIEF", label: "Stopped briefly", speed: 0, sub: "G6 — deferred to park" },
  { id: "DRIVING", label: "Driving", speed: 68, sub: "G6 + G7 — one line, voice only" },
];

// Plural matters: the headline reads "Your brake pads ARE wearing out" but
// "Your water pump IS wearing out". Getting this wrong is small and extremely
// visible — it is the first line the owner reads.
const COMPONENT_LABEL = {
  brake_pads: ["brake pads", true], water_pump: ["water pump", false],
  battery: ["battery", false], fuel_injector: ["fuel injector", false],
  oil_pump: ["oil pump", false],
};

function label(component) {
  return (COMPONENT_LABEL[component] || [])[0] || String(component || "").replace(/_/g, " ");
}

function isPlural(component) {
  return Boolean((COMPONENT_LABEL[component] || [])[1]);
}

function sentenceCase(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Economics mirror simulator/vehicles.yaml. Shown only as the pair the deck
 *  frames the decision with; the authoritative numbers live server-side and
 *  reach the owner's phone through the agent. */
const ECONOMICS = {
  water_pump: [2400, 18500], brake_pads: [3100, 22000], battery: [4200, 14000],
  fuel_injector: [5600, 21000], oil_pump: [3800, 26000],
};


export default function InCarConsole() {
  const [fleet, setFleet] = useState(null);
  const [vin, setVin] = useState(null);
  const [driveState, setDriveState] = useState("PARKED");
  const [night, setNight] = useState(false);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    api.get("/api/fleet", { limit: 100 })
      .then((d) => {
        setFleet(d.vehicles);
        // Default to a vehicle that actually has something to say — an empty
        // head unit demonstrates nothing about the rules.
        const withIssue = d.vehicles.find((v) => v.severity);
        if (d.vehicles.length) setVin((withIssue || d.vehicles[0]).vin);
      })
      .catch((e) => setError(e.message || String(e)));
  }, []);

  const run = useCallback(async (v, ds) => {
    if (!v) return;
    setRunning(true);
    setBooked(false);
    try {
      const speed = DRIVE_STATES.find((s) => s.id === ds).speed;
      setResult(await api.post("/api/console/demo", { vin: v, drive_state: ds, speed_kmph: speed }));
    } catch (e) {
      setResult({ error: e.message || String(e) });
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => { run(vin, driveState); }, [vin, driveState, run]);

  if (error) return <Empty icon="search">Could not load fleet — {error}</Empty>;
  if (!fleet) return <Skeleton className="h-[520px] w-full" />;
  if (!fleet.length) return <Empty icon="inbox">No vehicle in scope to demo the console with.</Empty>;

  const vehicle = fleet.find((v) => v.vin === vin);
  const t = tokens(night);
  const decisionOf = (tool) => result?.steps?.find((s) => s.tool === tool)?.decision;
  // Absent means never attempted (the alert itself was refused), which for
  // these two is the same outcome for the driver as an explicit block.
  const slotsAllowed = decisionOf("console.show_slots") === "ALLOW";
  const touchAllowed = decisionOf("console.request_touch") === "ALLOW";
  const blocked = (result?.steps || []).filter((s) => s.decision === "BLOCK");
  // Say why it is actually blocked. Assuming "in motion" is wrong whenever the
  // agent was stopped for some other reason — a quarantine from an earlier
  // block, say — and a safety UI that misreports its own reason is worse than
  // one that says nothing.
  const blockReason = blocked[0]?.reasons?.[0]?.detail || null;

  return (
    <div className="space-y-4">
      {/* Simulator rail — deliberately outside the device frame. The console
          never asserts its own drive state; the server does. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-ink-800/60 px-3 py-2.5">
        <select
          value={vin || ""}
          onChange={(e) => setVin(e.target.value)}
          className="rounded-lg border border-edge bg-ink-700/60 px-2.5 py-1.5 text-[12px] text-slate-200 outline-none focus:border-accent"
        >
          {fleet.map((v) => (
            <option key={v.vin} value={v.vin}>
              {v.model} · {v.vin}{v.severity ? ` · ${v.severity}` : " · healthy"}
            </option>
          ))}
        </select>

        <div className="flex gap-1.5">
          {DRIVE_STATES.map((s) => (
            <button
              key={s.id}
              onClick={() => setDriveState(s.id)}
              title={s.sub}
              className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition ${
                driveState === s.id
                  ? "border-accent/50 bg-accent/10 text-accent-ink"
                  : "border-edge bg-ink-700/40 text-slate-400 hover:border-slate-600"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setNight((n) => !n)}
          className="rounded-lg border border-edge bg-ink-700/40 px-2.5 py-1.5 text-[12px] text-slate-400 transition hover:border-slate-600"
        >
          {night ? "Night" : "Day"}
        </button>

        <span className="ml-auto text-[11px] text-slate-500">
          {running ? "asking the guard…" : "rendered from the live UEBA verdict"}
        </span>
      </div>

      <CarFrame
        night={night}
        status={
          <CarStatusBar
            night={night}
            left={
              <>
                <span style={{ fontFamily: MONO, fontSize: 13, color: t.ink }}>
                  {night ? "21:34" : driveState === "PARKED" ? "9:41" : "7:44"}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: t.dim }}>
                  {driveState === "PARKED" ? "P" : "D"}
                </span>
                {driveState !== "PARKED" && (
                  <span style={{ fontFamily: SANS, fontSize: 19, fontWeight: 700, color: t.ink }}>
                    {DRIVE_STATES.find((s) => s.id === driveState).speed}
                    <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 400, color: t.dim, marginLeft: 6 }}>km/h</span>
                  </span>
                )}
              </>
            }
            center={
              driveState === "STOPPED_BRIEF"
                ? "stopped 6 s · brake held"
                : `${vin}${vehicle?.odometer ? ` · ${vehicle.odometer.toLocaleString("en-IN")} km` : ""}`
            }
            right="LTE   fuel 46%"
          />
        }
        dock={<CarDock night={night} right={driveState === "PARKED" ? "rear camera" : "nav audio active"} />}
      >
        <ConsoleBody
          night={night} driveState={driveState} result={result} vin={vin}
          slotsAllowed={slotsAllowed} touchAllowed={touchAllowed} blockReason={blockReason}
          booked={booked} onBook={() => setBooked(true)}
        />
      </CarFrame>

      {/* The receipt. Same verdicts the screen above was built from. */}
      <div className="rounded-xl border border-edge bg-ink-800/60 px-4 py-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          What the guard decided
        </div>
        {!result?.steps?.length ? (
          <p className="text-[12.5px] text-slate-500">
            {result?.prediction === null
              ? "No active prediction for this vehicle — the agent had nothing to raise."
              : "…"}
          </p>
        ) : (
          <div className="space-y-1.5">
            {result.steps.map((s, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold ${
                  s.decision === "ALLOW" ? "bg-ok/10 text-ok-ink" : "bg-p1/10 text-p1-ink"
                }`}>
                  {s.decision}
                </span>
                <span className="font-mono text-slate-300">{s.tool}</span>
                {s.risk != null && <span className="text-slate-500">risk {s.risk}</span>}
                {s.reasons?.[0]?.detail && (
                  <span className="text-slate-500">— {s.reasons[0].detail}</span>
                )}
              </div>
            ))}
            {blocked.length > 0 && (
              <p className="pt-1 text-[12px] text-slate-500">
                The screen above has no slot list and no tap target because these calls were
                refused — not because this page checks the speed itself.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── the three states ────────────────────────────────────────────────────── */

export function ConsoleBody({ night, driveState, result, vin, slotsAllowed, touchAllowed, blockReason, booked, onBook }) {
  const t = tokens(night);
  const pred = result?.prediction;

  if (result?.error) {
    return <MapPane night={night} lines={["console unavailable", result.error]} />;
  }

  // No verdict yet. Not the healthy screen: that would tell the driver of a
  // car with a P1 fault that everything is fine for the length of a request.
  if (!result) {
    return <MapPane night={night} lines={["checking with the service agent…"]} />;
  }

  // Healthy: the deck's quiet screen. No card, no dock intrusion, nothing to do.
  if (!pred) {
    return (
      <>
        <MapPane
          night={night}
          chip={driveState === "PARKED" ? "Parked" : "Route active"}
          lines={["map placeholder", "no active prediction — nothing raised"]}
        />
        <div style={{
          width: 300, flexShrink: 0, background: t.panel, borderLeft: `1px solid ${t.edge}`,
          display: "grid", placeItems: "center", padding: 28, textAlign: "center",
        }}>
          <div>
            <Meta night={night}>All systems nominal</Meta>
            <p style={{ fontFamily: SANS, fontSize: 15, color: t.dim, marginTop: 10, lineHeight: 1.5 }}>
              We only interrupt you when something is actually changing.
            </p>
          </div>
        </div>
      </>
    );
  }

  const days = pred.days_to_failure;
  const [repair, breakdown] = ECONOMICS[pred.component] || [3000, 20000];

  // DRIVING — G7 caps the alert at one element, G6 blocks anything tappable.
  if (driveState === "DRIVING") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 18, padding: "16px 22px",
          background: night ? "#241512" : "#fdeae5",
          borderBottom: `2px solid ${t.pillInk}`, flexShrink: 0,
        }}>
          <Pill night={night}>{pred.severity}</Pill>
          <span style={{ fontFamily: SANS, fontSize: 21, fontWeight: 500, color: t.ink, flex: 1 }}>
            {sentenceCase(label(pred.component))} service needed
            {days != null ? ` ${serviceDue(days)}` : ""}. I'll call you about it.
          </span>
          <Meta night={night}>voice · hands-free</Meta>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <MapPane night={night} chip="SH-25 · 11 km to Gondal"
                   lines={["map placeholder", "route active, full width retained"]} />
          <div style={{
            width: 320, flexShrink: 0, background: t.panel, borderLeft: `1px solid ${t.edge}`,
            padding: 26, display: "flex", flexDirection: "column", justifyContent: "center",
            alignItems: "center", textAlign: "center", gap: 14,
          }}>
            <Waveform night={night} />
            <div style={{ fontFamily: SANS, fontSize: 17, fontWeight: 600, color: t.ink }}>Agent speaking</div>
            <p style={{ fontFamily: SANS, fontSize: 13.5, color: t.dim, lineHeight: 1.55, margin: 0 }}>
              Booking is locked while the vehicle is in motion. Say “book it” and I'll
              confirm when you stop.
            </p>
            <div style={{ width: "100%", marginTop: 4 }}>
              <PrimaryButton night={night} disabled>
                Book service
              </PrimaryButton>
            </div>
            <Meta night={night} style={{
              background: night ? "#1c2026" : "#e3e6ea", padding: "5px 10px", borderRadius: 6,
            }}>
              disabled · in motion
            </Meta>
          </div>
        </div>
      </div>
    );
  }

  // STOPPED_BRIEF — G6 defers the detail; two large targets, nothing to read.
  if (driveState === "STOPPED_BRIEF") {
    return (
      <>
        <MapPane night={night} chip="Kalawad Road · 4.2 km to office"
                 lines={["map placeholder", "route active, next turn in 600 m"]} />
        <div style={{
          width: 380, flexShrink: 0, background: t.panel, borderLeft: `1px solid ${t.edge}`,
          padding: 26, display: "flex", flexDirection: "column",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Pill night={night}>{pred.severity}</Pill>
            <Meta night={night}>brief stop</Meta>
          </div>
          <div style={{ marginTop: 18 }}>
            <Headline
              night={night} size={27}
              title={`${sentenceCase(label(pred.component))} ${isPlural(pred.component) ? "need" : "needs"} service${days != null ? ` ${serviceDue(days)}` : ""}`}
              body="Details when you park."
            />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <PrimaryButton night={night}>Remind me when parked</PrimaryButton>
            <GhostButton night={night}>Call me about it</GhostButton>
          </div>
        </div>
      </>
    );
  }

  // PARKED — the full case. Slots and the tap target appear only because the
  // guard allowed the tools that produce them.
  return (
    <>
      <MapPane night={night} chip="Parked · engine off"
               lines={["map placeholder", "current location, no route active"]} />
      <div style={{
        width: 440, flexShrink: 0, background: t.panel, borderLeft: `1px solid ${t.edge}`,
        padding: 26, display: "flex", flexDirection: "column", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Pill night={night}>{pred.severity}{days != null ? ` · ${formatDays(days)}` : ""}</Pill>
          <Meta night={night}>service agent</Meta>
        </div>

        <div style={{ marginTop: 18 }}>
          <Headline
            night={night} size={31}
            title={`Your ${label(pred.component)} ${isPlural(pred.component) ? "are" : "is"} wearing out`}
            body={
              days != null
                ? `${drivingLeft(days)}, on current use.`
                : "Wear is progressing on your current usage."
            }
          />
        </div>

        <div style={{ marginTop: 20 }}>
          <CostRows
            night={night}
            rows={[
              { label: "Repair now", value: inr(repair), strong: true },
              { label: "If it fails on road", value: inr(breakdown), tone: "bad", strong: true },
              ...(slotsAllowed ? [{ label: "Nearest slot", value: "Tue 09:30 · Rajkot" }] : []),
            ]}
          />
        </div>

        <div style={{ flex: 1, minHeight: 18 }} />

        {booked ? (
          <div style={{
            border: `1px solid ${t.edge}`, borderRadius: 14, padding: 18,
            background: night ? "#12251a" : "#eaf7ee", textAlign: "center",
          }}>
            <Meta night={night} style={{ color: "#1f9d55" }}>Confirmed</Meta>
            <div style={{ fontFamily: SANS, fontSize: 17, fontWeight: 600, color: t.ink, marginTop: 6 }}>
              Tuesday 09:30 · Rajkot
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <PrimaryButton
              night={night}
              disabled={!touchAllowed}
              onClick={onBook}
              note={touchAllowed ? null : `blocked · ${blockReason || "refused by the guard"}`}
            >
              {slotsAllowed ? "Book Tuesday 09:30" : "Book service"}
            </PrimaryButton>
            <div style={{ display: "flex", gap: 10 }}>
              <GhostButton night={night} grow disabled={!slotsAllowed}>Other times</GhostButton>
              <GhostButton night={night} grow>Explain why</GhostButton>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Static bars — an amplitude animation on a screen a driver may glance at is
 *  exactly the motion G7 exists to limit, so it stays still. */
function Waveform({ night }) {
  const bars = [10, 20, 32, 22, 40, 28, 44, 26, 34, 18, 26, 12];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 46 }}>
      {bars.map((h, i) => (
        <div key={i} style={{
          width: 3, height: h, borderRadius: 2,
          background: night ? "#5aa9e6" : "#7ab8e8",
        }} />
      ))}
    </div>
  );
}
