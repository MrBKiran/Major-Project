/**
 * Owner app — the phone surface, for individual owners only.
 *
 * Same data as the OEM console, opposite job. The console exists so staff can
 * scan a fleet; this exists so one person can decide one thing about one car.
 * The wireframe deck states the rule this file is built on: "One sentence, one
 * number pair. No KPI grid: a healthy vehicle should be a quiet screen." So
 * there is no dashboard here — when nothing is wrong the app says so in a
 * sentence and offers nothing to tap.
 *
 * It is deliberately MORE capable than the head unit, not less. The car is a
 * glanceable surface governed by G6/G7 and can only ever offer the next single
 * action; the phone is where an owner reads the evidence, argues with the
 * agent, changes the slot, and looks at history — none of which belongs on a
 * screen someone might read at 68 km/h.
 *
 * Screens are the ones the backend can genuinely drive today. Nothing here is
 * a mock: the prediction, the sensor ramp, the fault codes, the conversation
 * and the booking are all live.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { color } from "@autosaarthi/tokens";
import { api } from "../api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { NightProvider, useNight, usePageTheme, useSystemNight } from "../night.jsx";
import { drivingLeft, formatDate, formatDays, formatINR, formatSlot as formatSlotTime, signalLabel } from "@autosaarthi/core";
import {
  ACCENT, CostRows, GhostButton, Headline, Meta, MONO, Pill, PhoneFrame,
  PhoneStatusBar, PrimaryButton, SANS, Spark, tokens,
} from "../device.jsx";

// `signalName` is what the owner reads; the raw column name is an engineering
// identifier and "brake fluid pct has been falling" is not a sentence anyone
// says out loud.
const COMPONENT = {
  brake_pads: { label: "brake pads", plural: true, signal: "brake_fluid_pct", signalName: "brake fluid level", unit: "%", dir: "falling" },
  water_pump: { label: "water pump", plural: false, signal: "coolant_temp", signalName: "coolant temperature", unit: "°C", dir: "climbing" },
  battery: { label: "battery", plural: false, signal: "battery_voltage", signalName: "battery voltage", unit: "V", dir: "falling" },
  fuel_injector: { label: "fuel injector", plural: false, signal: "fuel_pressure", signalName: "fuel pressure", unit: "bar", dir: "falling" },
  oil_pump: { label: "oil pump", plural: false, signal: "lub_oil_pressure", signalName: "oil pressure", unit: "bar", dir: "falling" },
};

/** Readings taken with the ignition off are not evidence of wear — the backend's
 *  `latest_reading` filters to engine-running rows before quoting a number, so
 *  the chart the owner is shown has to use the same rows. Otherwise the agent
 *  says one value and the graph under it disagrees. */
function liveRows(series) {
  const running = (series || []).filter((r) => r.drive_state && r.drive_state !== "IGNITION_OFF");
  return running.length ? running : series || [];
}

// Mirrors simulator/vehicles.yaml. The agent speaks the authoritative numbers;
// these render the same pair on screens the agent is not talking on.
const ECONOMICS = {
  water_pump: [2400, 18500], brake_pads: [3100, 22000], battery: [4200, 14000],
  fuel_injector: [5600, 21000], oil_pump: [3800, 26000],
};

const inr = formatINR;
const meta = (c) => COMPONENT[c] || { label: String(c || "").replace(/_/g, " "), plural: false };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * `standalone` is the real-device mode served at /app: the phone itself is the
 * frame, so the drawn body and the painted status bar both go. Everything
 * below the chrome is identical, which is the point — the desktop tab is a
 * preview OF this, not a second implementation of it.
 */
export default function OwnerApp({ standalone = false }) {
  const { logout } = useAuth();
  // The phone follows its own light/dark setting; the console's preview of it
  // stays light, inside the light console the demo slides are taken from.
  const systemNight = useSystemNight();
  const night = standalone && systemNight;
  usePageTheme(standalone ? night : undefined);
  const [vin, setVin] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [screen, setScreen] = useState("home");
  const [booking, setBooking] = useState(null);

  const load = useCallback((v) => {
    api.get(`/api/vehicle/${v}`, { minutes: 1440 })
      .then(setDetail)
      .catch((e) => setError(e.message || String(e)));
  }, []);

  useEffect(() => {
    api.get("/api/fleet", { limit: 20 })
      .then((d) => {
        if (!d.vehicles.length) { setError("No vehicle registered to this account."); return; }
        const v = (d.vehicles.find((x) => x.severity) || d.vehicles[0]).vin;
        setVin(v);
        load(v);
      })
      .catch((e) => setError(e.message || String(e)));
  }, [load]);

  const t = tokens(night);
  const top = (detail?.predictions || []).find((p) => p.severity) || null;

  const body = error ? (
    <div style={{ padding: 24 }}>
      <Meta night={night}>Unavailable</Meta>
      <p style={{ fontFamily: SANS, fontSize: 15, color: t.dim, marginTop: 8 }}>{error}</p>
    </div>
  ) : !detail ? (
    <LoadingPane />
  ) : screen === "home" ? (
    <Home detail={detail} top={top} booking={booking} go={setScreen} />
  ) : screen === "why" ? (
    <WhyThisPart detail={detail} top={top} back={() => setScreen("home")} go={setScreen} />
  ) : screen === "agent" ? (
    <AgentScreen
      vin={vin} back={() => setScreen("home")}
      onBooked={(b) => { setBooking(b); setScreen("booked"); load(vin); }}
    />
  ) : screen === "booked" ? (
    <Booked detail={detail} top={top} booking={booking} back={() => setScreen("home")} />
  ) : (
    <History detail={detail} back={() => setScreen("home")} />
  );

  if (standalone) {
    return (
      <NightProvider value={night}>
      <div
        style={{
          // svh, not vh: mobile browsers shrink the visual viewport when the
          // address bar collapses, and vh would leave the last control under
          // the chrome exactly when someone reaches for it.
          minHeight: "100svh", background: t.page, color: t.ink,
          // Respect the notch and the home indicator; without the bottom inset
          // the send button on the agent screen sits under the gesture bar.
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 14px 0" }}>
          <button
            type="button"
            onClick={logout}
            style={{
              border: "none", background: "transparent", padding: "8px 6px", minHeight: 44,
              fontFamily: SANS, fontSize: 13, color: t.dim, cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </div>
        {body}
      </div>
      </NightProvider>
    );
  }

  return (
    <NightProvider value={false}>
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="flex w-full max-w-md items-baseline justify-between px-1">
        <p className="text-label text-fg-muted">
          Owner app · individual owners only. Same live data as the console, shaped for one decision.
        </p>
      </div>

      <PhoneFrame statusBar={<PhoneStatusBar night={night} time="9:16" right="LTE  84%" />}>
        {body}
      </PhoneFrame>
    </div>
    </NightProvider>
  );
}

/* ── chrome ──────────────────────────────────────────────────────────────── */

function LoadingPane() {
  const night = useNight();
  const t = tokens(night);
  return (
    <div style={{ padding: 24, display: "grid", gap: 12 }}>
      {[64, 200, 120].map((h, i) => (
        <div key={i} style={{ height: h, borderRadius: 14, background: t.hatch }} />
      ))}
    </div>
  );
}

function ScreenHeader({ title, back, right }) {
  const night = useNight();
  const t = tokens(night);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "10px 18px 14px",
      borderBottom: `1px solid ${t.edge}`, background: t.page,
      position: "sticky", top: 0, zIndex: 2,
    }}>
      <button
        onClick={back}
        aria-label="Back"
        style={{
          border: "none", background: "transparent", cursor: "pointer",
          color: t.ink, padding: 4, display: "grid", placeItems: "center",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: t.ink, flex: 1 }}>{title}</span>
      {right}
    </div>
  );
}

/* ── P04 / P05 — home ────────────────────────────────────────────────────── */

function Home({ detail, top, booking, go }) {
  const night = useNight();
  const t = tokens(night);
  const v = detail.vehicle;
  const history = detail.maintenance_history || [];

  return (
    <div style={{ padding: "6px 18px 28px" }}>
      <div style={{ paddingTop: 10, paddingBottom: 18 }}>
        <div style={{ fontFamily: SANS, fontSize: 21, fontWeight: 700, color: t.ink }}>{v.model}</div>
        <Meta night={night} style={{ textTransform: "none", letterSpacing: "0.02em" }}>
          {v.vin} · {Number(v.odometer || 0).toLocaleString("en-IN")} km
        </Meta>
      </div>

      {booking?.booked ? (
        <BookedCard booking={booking} onOpen={() => go("booked")} />
      ) : top ? (
        <NowCard top={top} go={go} />
      ) : (
        <HealthyCard detail={detail} />
      )}

      {/* Timeline rail — the deck's spine. The now-card above is the newest
          node; everything below is what already happened. No tabs. */}
      <div style={{ marginTop: 26 }}>
        <Meta night={night}>Timeline</Meta>
        <div style={{ marginTop: 12, position: "relative", paddingLeft: 18 }}>
          <div style={{
            position: "absolute", left: 4, top: 6, bottom: 6, width: 2,
            background: t.edge, borderRadius: 2,
          }} />
          {history.length === 0 && (
            <TimelineNode
              dot={t.faint} title="Vehicle registered"
              sub="No service visits on record yet."
            />
          )}
          {history.slice(0, 4).map((h, i) => (
            <TimelineNode
              key={i} dot={t.faint}
              title={cap(String(h.service_type || "service").replace(/_/g, " "))}
              sub={[
                h.date ? formatDate(h.date) : null,
                h.km_at_service ? `${Number(h.km_at_service).toLocaleString("en-IN")} km` : null,
                h.cost ? inr(h.cost) : null,
              ].filter(Boolean).join(" · ")}
            />
          ))}
        </div>
        {history.length > 0 && (
          <button
            onClick={() => go("history")}
            style={{
              marginTop: 10, border: "none", background: "transparent", padding: 0,
              fontFamily: SANS, fontSize: 13, color: tokens(night).link, cursor: "pointer", fontWeight: 500,
            }}
          >
            All service history →
          </button>
        )}
      </div>
    </div>
  );
}

function TimelineNode({ title, sub, dot }) {
  const night = useNight();
  const t = tokens(night);
  return (
    <div style={{ position: "relative", paddingBottom: 16 }}>
      <div style={{
        position: "absolute", left: -18, top: 4, width: 10, height: 10,
        borderRadius: 99, background: dot, border: `2px solid ${t.page}`,
      }} />
      <div style={{ fontFamily: SANS, fontSize: 14, color: t.ink, fontWeight: 500 }}>{title}</div>
      {sub && <Meta night={night} style={{ textTransform: "none", letterSpacing: "0.02em" }}>{sub}</Meta>}
    </div>
  );
}

/** The quiet screen. One sentence, one number pair, ten flat sparklines —
 *  visible proof the system is watching without asking anything of the owner. */
export function HealthyCard({ detail }) {
  const night = useNight();
  const t = tokens(night);
  const series = liveRows(detail.series);
  const signals = ["coolant_temp", "lub_oil_pressure", "battery_voltage", "fuel_pressure", "brake_fluid_pct", "speed"];
  return (
    <div style={{ border: `1px solid ${t.edge}`, borderRadius: 18, padding: 20, background: t.card }}>
      <Meta night={night} style={{ color: tokens(night).positive }}>Healthy · agent watching</Meta>
      <div style={{ marginTop: 12 }}>
        <Headline night={night} size={27} title="Everything reads normal"
          body="Signals watched continuously. No trouble codes, no wear trend worth telling you about." />
      </div>
      {series.length < 2 ? (
        // Six empty sparklines read as a page still loading, on the one screen
        // whose message is "nothing is wrong" — say plainly what is missing.
        <p style={{
          fontFamily: SANS, fontSize: 13, color: t.dim, marginTop: 18, marginBottom: 0,
          paddingTop: 16, borderTop: `1px solid ${t.edge}`,
        }}>
          No recent readings from the car — it reports again when the engine is on.
        </p>
      ) : (
        <div style={{
          marginTop: 18, display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12, paddingTop: 16, borderTop: `1px solid ${t.edge}`,
        }}>
          {signals.map((s) => (
            <div key={s}>
              <Spark night={night} w={90} h={22} values={series.map((r) => r[s])} tone={tokens(night).icon} />
              <span style={{ display: "block", fontFamily: SANS, fontSize: 12, color: t.dim, marginTop: 4 }}>
                {signalLabel(s)}
              </span>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontFamily: SANS, fontSize: 13, color: t.faint, marginTop: 16, marginBottom: 0 }}>
        We only contact you when something is actually changing.
      </p>
    </div>
  );
}

/** The alert. Cost framing before technical detail, per strategies.yaml —
 *  and both escape hatches sit above the primary action, because an owner who
 *  feels cornered by a service prompt stops trusting every later one. */
export function NowCard({ top, go }) {
  const night = useNight();
  const t = tokens(night);
  const m = meta(top.component);
  const [repair, breakdown] = ECONOMICS[top.component] || [3000, 20000];
  const days = top.days_to_failure;

  return (
    <div style={{
      border: `1px solid ${t.edge}`, borderRadius: 18, padding: 20, background: t.card,
      boxShadow: "0 8px 30px -14px rgba(216,57,26,0.35)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Pill night={night}>{top.severity}{days != null ? ` · ${formatDays(days)}` : ""}</Pill>
        <Meta night={night}>now</Meta>
      </div>

      <div style={{ marginTop: 14 }}>
        <Headline
          night={night} size={27}
          title={`Your ${m.label} ${m.plural ? "are" : "is"} wearing out`}
          body={days != null
            ? `${drivingLeft(days)}, on current use.`
            : "Wear is progressing on your current usage."}
        />
      </div>

      <div style={{ marginTop: 18 }}>
        <CostRows night={night} rows={[
          { label: "Repair now", value: inr(repair), strong: true },
          { label: "If it fails on road", value: inr(breakdown), tone: "bad", strong: true },
        ]} />
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <GhostButton night={night} grow onClick={() => go("why")}>Why this part</GhostButton>
        <GhostButton night={night} grow onClick={() => go("agent")}>Talk to agent</GhostButton>
      </div>
      <div style={{ marginTop: 10 }}>
        <PrimaryButton night={night} onClick={() => go("agent")} note="nothing is booked without your yes">
          Book a service
        </PrimaryButton>
      </div>
    </div>
  );
}

function BookedCard({ booking, onOpen }) {
  const night = useNight();
  const t = tokens(night);
  return (
    <button
      onClick={onOpen}
      style={{
        width: "100%", textAlign: "left", cursor: "pointer",
        border: `1px solid ${t.edge}`, borderRadius: 18, padding: 20,
        background: tokens(night).okBg,
      }}
    >
      <Meta night={night} style={{ color: tokens(night).positive }}>Confirmed</Meta>
      <div style={{ fontFamily: SANS, fontSize: 21, fontWeight: 700, color: t.ink, marginTop: 8 }}>
        {formatSlot(booking.slot_start)}
      </div>
      <Meta night={night} style={{ textTransform: "none", letterSpacing: "0.02em" }}>
        {booking.center_id} · tap for the receipt
      </Meta>
    </button>
  );
}

function formatSlot(iso) {
  return iso ? formatSlotTime(iso) : "Scheduled";
}

/* ── P08 — why this part ─────────────────────────────────────────────────── */

function WhyThisPart({ detail, top, back, go }) {
  const night = useNight();
  const t = tokens(night);
  if (!top) {
    return (
      <>
        <ScreenHeader title="Why this part" back={back} />
        <div style={{ padding: 22 }}>
          <p style={{ fontFamily: SANS, color: t.dim }}>No active prediction to explain.</p>
        </div>
      </>
    );
  }

  const m = meta(top.component);
  const series = liveRows(detail.series);
  const values = series.map((r) => r[m.signal]).filter((x) => typeof x === "number");
  const latest = values.length ? values[values.length - 1] : null;
  const dtcs = detail.dtc_codes || [];
  const [repair, breakdown] = ECONOMICS[top.component] || [3000, 20000];
  const days = top.days_to_failure != null ? Math.round(top.days_to_failure) : null;

  return (
    <>
      <ScreenHeader
        title={cap(m.label)} back={back}
        right={<Pill night={night}>{top.severity}{days != null ? ` · ${days}d` : ""}</Pill>}
      />
      <div style={{ padding: "20px 18px 28px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: MONO, fontSize: 38, fontWeight: 600, color: t.ink, letterSpacing: "-0.02em" }}>
            {top.failure_prob != null ? top.failure_prob.toFixed(2) : "—"}
          </span>
          <Meta night={night}>model confidence</Meta>
        </div>

        <div style={{ marginTop: 20 }}>
          <Headline
            night={night} size={21} title="Why we think so"
            body={`Your ${m.signalName} has been ${m.dir} on an unchanged route. That pattern is wear, not weather.`}
          />
        </div>

        {/* The evidence, drawn from the same window the Diagnosis Agent scored. */}
        <div style={{
          marginTop: 18, border: `1px solid ${t.edge}`, borderRadius: 14,
          padding: 16, background: t.card,
        }}>
          <Spark night={night} w={340} h={64} values={values} tone={ACCENT} />
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between" }}>
            <Meta night={night} style={{ textTransform: "none" }}>
              {m.signalName} · last 24 h
            </Meta>
            {latest != null && (
              <span style={{ fontFamily: MONO, fontSize: 13, color: t.ink }}>
                {latest.toFixed(1)}{m.unit}
              </span>
            )}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <Meta night={night}>Trouble codes</Meta>
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {dtcs.length ? dtcs.map((c) => (
              <span key={c} style={{
                fontFamily: MONO, fontSize: 12, fontWeight: 600, color: t.pillInk,
                background: t.pillBg, padding: "5px 10px", borderRadius: 6,
              }}>
                {c} active
              </span>
            )) : (
              <span style={{ fontFamily: SANS, fontSize: 13, color: t.dim }}>
                None fired yet — this is a trend, caught before a code sets.
              </span>
            )}
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <CostRows night={night} rows={[
            { label: "Repair now", value: inr(repair), strong: true },
            { label: "If it fails on road", value: inr(breakdown), tone: "bad", strong: true },
          ]} />
        </div>

        <div style={{ marginTop: 18 }}>
          <PrimaryButton night={night} onClick={() => go("agent")}>Show me slots</PrimaryButton>
        </div>
      </div>
    </>
  );
}

/* ── P07 / P09 / P11 — the agent ─────────────────────────────────────────── */

/** The live conversation, and the only path to a booking. Same endpoints the
 *  console's chat uses, so the transcript persists and the agent remembers. */
function AgentScreen({ vin, back, onBooked }) {
  const night = useNight();
  const t = tokens(night);
  const [messages, setMessages] = useState([]);
  const [session, setSession] = useState(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(true);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    api.post("/api/chat/start", { vin })
      .then((res) => {
        if (res.note) { setNote(res.note); setDone(true); return; }
        setMessages(res.turns || []);
        setSession({
          run_id: res.run_id, plan: res.plan,
          offered_slots: res.offered_slots, objections_handled: res.objections_handled,
        });
        if (res.booking?.booked) onBooked(res.booking);
      })
      .catch((e) => setNote(e.message || String(e)))
      .finally(() => setBusy(false));
  }, [vin]);          // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  async function send(text) {
    const body = (text ?? input).trim();
    if (!body || busy || done || !session) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: body }]);
    setBusy(true);
    try {
      const res = await api.post("/api/chat/reply", {
        vin, run_id: session.run_id, plan: session.plan, message: body,
        offered_slots: session.offered_slots, objections_handled: session.objections_handled,
      });
      setMessages((m) => {
        const next = [...m];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === "user") { next[i] = { ...next[i], intent: res.intent }; break; }
        }
        return [...next, ...(res.turns || [])];
      });
      setSession({
        run_id: res.run_id, plan: res.plan,
        offered_slots: res.offered_slots, objections_handled: res.objections_handled,
      });
      if (res.booking?.booked) { onBooked(res.booking); return; }
      if (res.done) setDone(true);
    } catch (e) {
      setMessages((m) => [...m, { role: "system", text: e.message || String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  const slot = session?.offered_slots?.[0];

  return (
    <>
      <ScreenHeader
        title="AutoSaarthi agent" back={back}
        right={<Meta night={night}>{busy ? "thinking" : "live"}</Meta>}
      />

      <div style={{ padding: "16px 16px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
        {note && (
          <p style={{ fontFamily: SANS, fontSize: 14, color: t.dim, textAlign: "center", padding: "20px 8px" }}>
            {note}
          </p>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} m={m} />
        ))}
        {busy && <TypingDots />}
        <div ref={bottomRef} />
      </div>

      {/* Slot shortcut. Shown, never held — a hold is an irreversible tool call
          and needs the Master's declared plan first, which only an explicit
          yes produces. */}
      {slot && !done && (
        <div style={{ padding: "4px 16px 0" }}>
          <Meta night={night}>Soonest slot</Meta>
          <div style={{
            marginTop: 6, border: `1px solid ${t.edge}`, borderRadius: 12,
            padding: "12px 14px", background: t.card, display: "flex",
            justifyContent: "space-between", alignItems: "center", gap: 10,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: t.ink }}>
                {formatSlot(slot.slot_start)}
              </div>
              <Meta night={night} style={{ textTransform: "none", letterSpacing: "0.02em" }}>
                {slot.center_name || slot.center_id}
              </Meta>
            </div>
            <button
              onClick={() => send("yes, book it")}
              disabled={busy}
              style={{
                border: "none", borderRadius: 10, padding: "10px 14px", background: color.accentDeep,
                color: color.onAccent, fontFamily: SANS, fontSize: 13, fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap",
              }}
            >
              Book it
            </button>
          </div>
        </div>
      )}

      <div style={{
        position: "sticky", bottom: 0, padding: "12px 16px 16px",
        background: t.page, borderTop: `1px solid ${t.edge}`, marginTop: 10,
      }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={done || busy}
            placeholder={done ? "Conversation ended" : "Ask anything about your car…"}
            style={{
              flex: 1, borderRadius: 12, border: `1px solid ${t.edge}`, background: t.card,
              padding: "12px 14px", fontFamily: SANS, fontSize: 14, color: t.ink, outline: "none",
            }}
          />
          <button
            onClick={() => send()}
            disabled={done || busy || !input.trim()}
            aria-label="Send"
            style={{
              border: "none", borderRadius: 12, width: 46, background: color.accentDeep, color: color.onAccent,
              cursor: done || busy ? "not-allowed" : "pointer", opacity: input.trim() ? 1 : 0.5,
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto" }}>
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}

function Bubble({ m }) {
  const night = useNight();
  const t = tokens(night);
  const mine = m.role === "user";
  const bad = m.role === "system";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth: "84%", borderRadius: 16,
        borderBottomRightRadius: mine ? 5 : 16, borderBottomLeftRadius: mine ? 16 : 5,
        padding: "11px 14px", fontFamily: SANS, fontSize: 14, lineHeight: 1.5,
        background: mine ? color.accentDeep : bad ? t.pillBg : t.card,
        color: mine ? color.onAccent : bad ? t.pillInk : t.ink,
        border: mine || bad ? "none" : `1px solid ${t.edge}`,
      }}>
        {m.grounded_in > 0 && (
          <div style={{ marginBottom: 5 }}>
            <Meta night={night} style={{ fontSize: 11, color: tokens(night).positive }}>
              from {m.grounded_in} facts about your car
            </Meta>
          </div>
        )}
        {m.text}
      </div>
    </div>
  );
}

function TypingDots() {
  const night = useNight();
  const t = tokens(night);
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div style={{
        display: "flex", gap: 5, alignItems: "center", padding: "13px 16px",
        background: t.card, border: `1px solid ${t.edge}`, borderRadius: 16, borderBottomLeftRadius: 5,
      }}>
        {[0, 150, 300].map((d) => (
          <span key={d} className="pulse-soft" style={{
            width: 6, height: 6, borderRadius: 99, background: t.faint, animationDelay: `${d}ms`,
          }} />
        ))}
      </div>
    </div>
  );
}

/* ── P12 — receipt ───────────────────────────────────────────────────────── */

function Booked({ detail, top, booking, back }) {
  const night = useNight();
  const t = tokens(night);
  const m = top ? meta(top.component) : null;
  const [repair] = top ? (ECONOMICS[top.component] || [3000]) : [null];

  return (
    <>
      <ScreenHeader title="Booking" back={back} />
      <div style={{ padding: "22px 18px 28px" }}>
        <div style={{
          borderRadius: 18, padding: 22, background: tokens(night).okBg, border: `1px solid ${tokens(night).okBorder}`,
        }}>
          <Meta night={night} style={{ color: tokens(night).positive }}>Confirmed</Meta>
          <div style={{ fontFamily: SANS, fontSize: 27, fontWeight: 700, color: t.ink, marginTop: 8, lineHeight: 1.2 }}>
            {formatSlot(booking?.slot_start)}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <CostRows night={night} rows={[
            { label: "Service centre", value: booking?.center_id || "—" },
            ...(m ? [{ label: "Work", value: cap(m.label) }] : []),
            ...(repair ? [{ label: "Estimate", value: inr(repair), strong: true }] : []),
            { label: "Reference", value: booking?.appointment_id || "—" },
            { label: "Vehicle", value: detail.vehicle.vin },
          ]} />
        </div>

        <p style={{ fontFamily: SANS, fontSize: 13, color: t.dim, marginTop: 18, lineHeight: 1.55 }}>
          The centre has the slot held against your vehicle. You'll get a reminder the day
          before, and the car will show it on the dash when you next park.
        </p>

        <div style={{ marginTop: 18 }}>
          <GhostButton night={night} onClick={back}>Back to my car</GhostButton>
        </div>
      </div>
    </>
  );
}

/* ── P19 — history ───────────────────────────────────────────────────────── */

function History({ detail, back }) {
  const night = useNight();
  const t = tokens(night);
  const rows = detail.maintenance_history || [];
  return (
    <>
      <ScreenHeader title="Service history" back={back} />
      <div style={{ padding: "18px 18px 28px" }}>
        {rows.length === 0 ? (
          <p style={{ fontFamily: SANS, fontSize: 14, color: t.dim }}>
            No service visits on record for this vehicle yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((h, i) => (
              <div key={i} style={{
                border: `1px solid ${t.edge}`, borderRadius: 14, padding: 15, background: t.card,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: t.ink }}>
                    {cap(String(h.service_type || "service").replace(/_/g, " "))}
                  </span>
                  {h.cost != null && (
                    <span style={{ fontFamily: MONO, fontSize: 14, color: t.ink }}>{inr(h.cost)}</span>
                  )}
                </div>
                <Meta night={night} style={{ textTransform: "none", letterSpacing: "0.02em" }}>
                  {formatDate(h.date)}
                  {h.km_at_service ? ` · ${Number(h.km_at_service).toLocaleString("en-IN")} km` : ""}
                </Meta>
                {Array.isArray(h.components_replaced) && h.components_replaced.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {h.components_replaced.map((c) => (
                      <span key={c} style={{
                        fontFamily: MONO, fontSize: 11, color: t.dim,
                        background: t.hatch, padding: "3px 8px", borderRadius: 5,
                      }}>
                        {String(c).replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
