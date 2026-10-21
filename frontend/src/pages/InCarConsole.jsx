/**
 * In-Car Console — the head unit itself, not a control panel for one.
 *
 * Everything on it comes from the server's car screen (GET /api/car/{vin}/screen,
 * backend app/car.py): the drive state, read from the car's own telemetry; what
 * that state allows, read from the same G6/G7 rules the guard enforces; the
 * alert, its costs, and the slots — which the server does not even send while
 * the car moves. This page has no `if (driving)` of its own: when touch is not
 * allowed there is simply nothing to tap, and missing or stale telemetry comes
 * back as "moving" because that is the direction in which a wrong guess costs a
 * delay rather than a crash.
 *
 * Booking goes through POST /api/car/{vin}/book, where the drive state is
 * checked again and scheduler.confirm passes the guard. The demo's drive-state
 * control changes what the car *reports* (POST /simulate — red-team permission,
 * demo mode only, and shown only when the server offers it), never what the
 * page claims. The old version sent its own
 * drive state with every request; the guard blocking a tap at speed is still
 * demonstrated, by red-team ATTACK-5.
 *
 * Night mode follows the deck's screen 9. It is not a theme toggle for taste —
 * a head unit that throws a white panel at a driver at 21:34 is the same class
 * of hazard G6 exists to prevent.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import {
  alertBadge, COMPONENTS, componentLabel, drivingLeft, formatClock, formatINR as inr, formatSlot, OWNER,
  serviceDue, severityWord, wearingOut,
} from "@autosaarthi/core";
import { Empty, Skeleton } from "../ui.jsx";
import {
  CarDock, CarFrame, CarStatusBar, CostRows, GhostButton, Headline, MapPane,
  Meta, MONO, Pill, PrimaryButton, SANS, tokens,
} from "../device.jsx";

/** How often the head unit asks again. A reading older than two minutes
 *  counts as no reading at all, so the screen has to notice it ageing. */
export const POLL_MS = 10_000;

/** The time now, to the minute — a head unit's clock is real, not a mock-up's 9:41. */
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return formatClock(now);
}

const DRIVE_STATES = [
  { id: "PARKED", label: "Parked", sub: "the car reports parked" },
  { id: "STOPPED_BRIEF", label: "Stopped briefly", sub: "the car reports a brief stop" },
  { id: "DRIVING", label: "Driving", sub: "the car reports 68 km/h" },
];

function sentenceCase(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Why the server treats the car as it does, in the driver's terms. */
const BASIS = {
  none: "no reading from the car — treated as moving",
  stale: "no fresh reading from the car — treated as moving",
  contradiction: "the car reports parked while moving — treated as moving",
};

function basisText(drive) {
  if (BASIS[drive.basis]) return BASIS[drive.basis];
  return `from the car's telemetry${drive.speed_kmph != null ? `, ${Math.round(drive.speed_kmph)} km/h` : ""}`;
}


export default function InCarConsole() {
  const [fleet, setFleet] = useState(null);
  const [vin, setVin] = useState(null);
  const [night, setNight] = useState(false);
  const clock = useClock();
  const [carScreen, setCarScreen] = useState(null);
  const [screenError, setScreenError] = useState(null);
  const [error, setError] = useState(null);
  const [choice, setChoice] = useState(0);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [controlError, setControlError] = useState(null);
  // A slow answer about the previous car must not land on this one's screen.
  const current = useRef(null);

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

  const load = useCallback(async (v) => {
    try {
      const s = await api.get(`/api/car/${v}/screen`);
      if (current.current !== v) return;
      setCarScreen(s);
      setScreenError(null);
    } catch (e) {
      if (current.current === v) setScreenError(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (!vin) return undefined;
    current.current = vin;
    setCarScreen(null);
    setChoice(0);
    setRefusal(null);
    setControlError(null);
    load(vin);
    const timer = setInterval(() => load(vin), POLL_MS);
    return () => clearInterval(timer);
  }, [vin, load]);

  const book = async (slot) => {
    setPending(true);
    setRefusal(null);
    try {
      await api.post(`/api/car/${vin}/book`, { center_id: slot.center_id, slot_start: slot.slot_start });
      await load(vin);
    } catch (e) {
      setRefusal(e.message || String(e));
    } finally {
      setPending(false);
    }
  };

  const report = async (state) => {
    setControlError(null);
    try {
      await api.post(`/api/car/${vin}/simulate`, { drive_state: state });
      await load(vin);
    } catch (e) {
      setControlError(e.status === 404 ? "the drive-state control is off outside demo mode"
                                       : e.message || String(e));
    }
  };

  if (error) return <Empty icon="search">Could not load fleet — {error}</Empty>;
  if (!fleet) return <Skeleton className="h-[520px] w-full" />;
  if (!fleet.length) return <Empty icon="inbox">No vehicle in scope to demo the console with.</Empty>;

  const t = tokens(night);
  const state = carScreen?.drive.state;
  const slots = carScreen?.slots || [];
  const slot = slots.length ? slots[choice % slots.length] : null;

  return (
    <div className="space-y-4">
      {/* Simulator rail — deliberately outside the device frame. */}
      <div role="group" aria-label="Simulator"
           className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-card/60 px-3 py-2.5">
        <select
          aria-label="Vehicle"
          value={vin || ""}
          onChange={(e) => setVin(e.target.value)}
          className="rounded-lg border border-border-strong bg-surface-inset/60 px-2.5 py-1.5 text-label text-fg outline-none focus:border-accent"
        >
          {fleet.map((v) => (
            <option key={v.vin} value={v.vin}>
              {v.model} · {v.vin}{v.severity ? ` · ${v.severity}` : " · healthy"}
            </option>
          ))}
        </select>

        {/* Offered by the server only when /simulate would accept it. */}
        {carScreen?.controls?.drive_state ? (
          <div className="flex gap-1.5">
            {DRIVE_STATES.map((s) => (
              <button
                key={s.id}
                onClick={() => report(s.id)}
                title={s.sub}
                aria-pressed={state === s.id}
                className={`rounded-lg border px-2.5 py-1.5 text-label font-medium transition ${
                  state === s.id
                    ? "border-accent/50 bg-accent/10 text-accent-ink"
                    : "border-border bg-surface-inset/40 text-fg-tertiary hover:border-fg-subtle"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-caption text-fg-muted">Drive state as reported by the car</span>
        )}

        <button
          onClick={() => setNight((n) => !n)}
          aria-pressed={night}
          className="rounded-lg border border-border bg-surface-inset/40 px-2.5 py-1.5 text-label text-fg-tertiary transition hover:border-fg-subtle"
        >
          {night ? "Night" : "Day"}
        </button>

        <span className="ml-auto text-caption text-fg-muted" role="status">
          {controlError || (carScreen ? "drawn from the server's car screen" : "asking the server…")}
        </span>
      </div>

      <CarFrame
        night={night}
        status={
          <CarStatusBar
            night={night}
            left={
              <>
                <span data-testid="head-unit-clock" style={{ fontFamily: MONO, fontSize: 13, color: t.ink }}>
                  {clock}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: t.dim }}>
                  {state === "PARKED" ? "P" : "D"}
                </span>
                {/* Only a live reading has a speed worth showing: a stale one's
                    "0 km/h" beside a locked screen reads as a contradiction. */}
                {state && state !== "PARKED" && carScreen.drive.basis === "telemetry"
                  && carScreen.drive.speed_kmph != null && (
                  <span style={{ fontFamily: SANS, fontSize: 21, fontWeight: 700, color: t.ink }}>
                    {Math.round(carScreen.drive.speed_kmph)}
                    <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 400, color: t.dim, marginLeft: 6 }}>km/h</span>
                  </span>
                )}
              </>
            }
            center={
              state === "STOPPED_BRIEF"
                ? "brief stop · brake held"
                : `${vin}${carScreen?.odometer ? ` · ${carScreen.odometer.toLocaleString("en-IN")} km` : ""}`
            }
            right={carScreen?.city ?? ""}
          />
        }
        dock={<CarDock night={night} right={state === "PARKED" ? "rear camera" : "nav audio active"} />}
      >
        <ConsoleBody
          night={night} screen={carScreen} error={screenError} slot={slot}
          onBook={book} onOtherTime={() => setChoice((c) => c + 1)}
          pending={pending} refusal={refusal}
        />
      </CarFrame>

      {carScreen && <Verdict screen={carScreen} />}
    </div>
  );
}

/* ── the receipt ─────────────────────────────────────────────────────────── */

/** What the server decided, and so what the screen above could show. */
export function Verdict({ screen: s }) {
  const { allowed } = s;
  const slotList = !allowed.slots ? "not sent — G6"
    : s.booking ? "not needed — already booked"
    : s.slots.length ? `sent (${s.slots.length})` : "none to send";
  const rows = [
    ["Drive state", `${sentenceCase(s.drive.state.replace(/_/g, " ").toLowerCase())} — ${basisText(s.drive)}`],
    ["Tap targets", allowed.touch ? "allowed" : "blocked — G6"],
    ["Slot list", slotList],
    ["Elements on screen", allowed.max_elements == null ? "no limit while parked"
                                                        : `at most ${allowed.max_elements} — G7`],
  ];
  return (
    <div className="rounded-xl border border-border bg-surface-card/60 px-4 py-3">
      <div className="mb-2 text-caption font-medium uppercase tracking-wider text-fg-muted">
        What the server decided
      </div>
      <div className="space-y-1.5">
        {rows.map(([name, value]) => (
          <div key={name} className="flex flex-wrap items-baseline gap-2 text-label">
            <span className="w-40 shrink-0 text-fg-muted">{name}</span>
            <span className="text-fg-secondary">{value}</span>
          </div>
        ))}
      </div>
      <p className="pt-2 text-label text-fg-muted">
        The screen above is built from these. The page never decides the drive state itself,
        and a booking is checked again by the guard.
      </p>
    </div>
  );
}

/* ── the three states ────────────────────────────────────────────────────── */

export function ConsoleBody({ night, screen: s, error, slot, onBook, onOtherTime, pending, refusal }) {
  const t = tokens(night);

  if (error && !s) {
    return <MapPane night={night} lines={["console unavailable", error]} />;
  }

  // No answer yet. Not the healthy screen: that would tell the driver of a
  // car with a P1 fault that everything is fine for the length of a request.
  if (!s) {
    return <MapPane night={night} lines={["checking with the service agent…"]} />;
  }

  const state = s.drive.state;
  const alert = s.alert;

  // Healthy: the deck's quiet screen. No card, no dock intrusion, nothing to do.
  if (!alert) {
    return (
      <>
        <MapPane
          night={night}
          chip={state === "PARKED" ? "Parked" : "Route active"}
          lines={["map placeholder", "no active prediction — nothing raised"]}
        />
        <div style={{
          width: 300, flexShrink: 0, background: t.panel, borderLeft: `1px solid ${t.edge}`,
          display: "grid", placeItems: "center", padding: 28, textAlign: "center",
        }}>
          <div>
            <Meta night={night}>{OWNER.healthyTitle}</Meta>
            <p style={{ fontFamily: SANS, fontSize: 15, color: t.dim, marginTop: 10, lineHeight: 1.5 }}>
              We only interrupt you when something is actually changing.
            </p>
          </div>
        </div>
      </>
    );
  }

  const days = alert.days_to_failure;
  const booking = s.booking;
  const touch = s.allowed.touch;

  // DRIVING — G7 caps the alert at one element, G6 blocks anything tappable.
  if (state === "DRIVING") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 18, padding: "16px 22px",
          background: t.alertBg,
          borderBottom: `2px solid ${t.pillInk}`, flexShrink: 0,
        }}>
          <Pill night={night}>{severityWord(alert.severity)}</Pill>
          <span style={{ fontFamily: SANS, fontSize: 21, fontWeight: 500, color: t.ink, flex: 1 }}>
            {booking
              ? `${sentenceCase(componentLabel(alert.component))} service booked for ${formatSlot(booking.slot_start)}.`
              : `${sentenceCase(componentLabel(alert.component))} service needed${days != null ? ` ${serviceDue(days)}` : ""}. I'll call you about it.`}
          </span>
          <Meta night={night}>voice · hands-free</Meta>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <MapPane night={night} chip={`${s.city ? `${s.city} · ` : ""}route active`}
                   lines={["map placeholder", "route active, full width retained"]} />
          <div style={{
            width: 320, flexShrink: 0, background: t.panel, borderLeft: `1px solid ${t.edge}`,
            padding: 26, display: "flex", flexDirection: "column", justifyContent: "center",
            alignItems: "center", textAlign: "center", gap: 14,
          }}>
            <Waveform night={night} />
            <div style={{ fontFamily: SANS, fontSize: 17, fontWeight: 600, color: t.ink }}>Agent speaking</div>
            <p style={{ fontFamily: SANS, fontSize: 13, color: t.dim, lineHeight: 1.55, margin: 0 }}>
              {s.drive.basis === "telemetry"
                ? "Booking is locked while the vehicle is in motion. Say “book it” and I'll confirm when you stop."
                : "Booking is locked until the car reports that it is parked."}
            </p>
            <div style={{ width: "100%", marginTop: 4 }}>
              <PrimaryButton night={night} disabled>
                Book service
              </PrimaryButton>
            </div>
            <Meta night={night} style={{
              background: t.control, padding: "5px 10px", borderRadius: 6,
            }}>
              {s.drive.basis === "telemetry" ? "disabled · in motion" : "disabled · no fresh reading"}
            </Meta>
          </div>
        </div>
      </div>
    );
  }

  // STOPPED_BRIEF — G6 defers the detail. Nothing to read at length, and
  // nothing to tap unless the server says touch is allowed.
  if (state === "STOPPED_BRIEF") {
    return (
      <>
        <MapPane night={night} chip="Brief stop · route active"
                 lines={["map placeholder", "route active"]} />
        <div style={{
          width: 380, flexShrink: 0, background: t.panel, borderLeft: `1px solid ${t.edge}`,
          padding: 26, display: "flex", flexDirection: "column",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Pill night={night}>{severityWord(alert.severity)}</Pill>
            <Meta night={night}>brief stop</Meta>
          </div>
          <div style={{ marginTop: 18 }}>
            {/* "Brake pads need" but "Water pump needs" — the first line read. */}
            <Headline
              night={night} size={27}
              title={`${sentenceCase(componentLabel(alert.component))} ${COMPONENTS[alert.component]?.plural ? "need" : "needs"} service${days != null ? ` ${serviceDue(days)}` : ""}`}
              body="Details when you park."
            />
          </div>
        </div>
      </>
    );
  }

  // PARKED — the full case. The costs, the slot and the tap target appear only
  // because the server sent them and allowed them.
  const rows = [
    ...(s.economics ? [
      { label: OWNER.repairNow, value: inr(s.economics.repair_inr), strong: true },
      { label: OWNER.failsOnRoad, value: inr(s.economics.breakdown_inr), tone: "bad", strong: true },
    ] : []),
    ...(slot && !booking ? [{ label: "Slot", value: `${formatSlot(slot.slot_start)} · ${slot.city}` }] : []),
  ];

  return (
    <>
      <MapPane night={night} chip="Parked · engine off"
               lines={["map placeholder", "current location, no route active"]} />
      <div style={{
        width: 440, flexShrink: 0, background: t.panel, borderLeft: `1px solid ${t.edge}`,
        padding: 26, display: "flex", flexDirection: "column", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Pill night={night}>{alertBadge(alert)}</Pill>
          <Meta night={night}>service agent</Meta>
        </div>

        <div style={{ marginTop: 18 }}>
          <Headline
            night={night} size={31}
            title={wearingOut(alert.component)}
            body={
              days != null
                ? `${drivingLeft(days)}, on current use.`
                : "Wear is progressing on your current usage."
            }
          />
        </div>

        {rows.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <CostRows night={night} rows={rows} />
          </div>
        )}

        <div style={{ flex: 1, minHeight: 18 }} />

        {booking ? (
          <div style={{
            border: `1px solid ${t.edge}`, borderRadius: 14, padding: 18,
            background: t.okBg, textAlign: "center",
          }}>
            <Meta night={night} style={{ color: t.positive }}>
              {booking.status === "booked" ? "Confirmed" : "Held"}
            </Meta>
            <div style={{ fontFamily: SANS, fontSize: 17, fontWeight: 600, color: t.ink, marginTop: 6 }}>
              {`${formatSlot(booking.slot_start)} · ${booking.center_name}`}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <PrimaryButton
              night={night}
              disabled={!touch || !slot || pending}
              onClick={() => onBook(slot)}
              note={touch ? null : `blocked · ${basisText(s.drive)}`}
            >
              {pending ? "Booking…" : slot ? `Book ${formatSlot(slot.slot_start)}` : "Book service"}
            </PrimaryButton>
            {refusal && (
              <p role="alert" style={{
                fontFamily: SANS, fontSize: 14, color: t.pillInk, textAlign: "center", margin: 0,
              }}>
                {refusal}
              </p>
            )}
            <GhostButton night={night} disabled={!touch || s.slots.length < 2} onClick={onOtherTime}>
              Other times
            </GhostButton>
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
          background: tokens(night).marker,
        }} />
      ))}
    </div>
  );
}
