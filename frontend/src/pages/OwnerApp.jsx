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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { color } from "@autosaarthi/tokens";
import { api } from "../api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { NightProvider, useNight, usePageTheme } from "../night.jsx";
import { useThemeMode } from "../theme.jsx";
import {
  alertBadge, componentLabel, componentSignal, confidence, drivingLeft, formatDate, formatINR,
  formatSlot as formatSlotTime, OWNER, SIGNALS, signalLabel, trendSentence, wearingOut,
} from "@autosaarthi/core";
import {
  ACCENT, CostRows, GhostButton, Headline, Meta, MONO, Pill,
  PrimaryButton, SANS, Spark, tokens,
} from "../device.jsx";
import { gsap, reducedMotion } from "../fx";
import { micAvailable, speak, speechAvailable, stopSpeaking, useRecorder } from "../voice.js";
import { HealthRing, OwnerStage } from "./owner/Stage.jsx";

/** Readings taken with the ignition off are not evidence of wear — the backend's
 *  `latest_reading` filters to engine-running rows before quoting a number, so
 *  the chart the owner is shown has to use the same rows. Otherwise the agent
 *  says one value and the graph under it disagrees. */
function liveRows(series) {
  const running = (series || []).filter((r) => r.drive_state && r.drive_state !== "IGNITION_OFF");
  return running.length ? running : series || [];
}

const inr = formatINR;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The repair-vs-breakdown pair as the server sends it — the one the agent
 *  speaks. Callers show nothing when the server has no pair; there is no
 *  stand-in figure, because an invented price on a screen arguing for a
 *  repair is worse than none. */
function costRows(economics) {
  return [
    { label: OWNER.repairNow, value: inr(economics.repair_inr), strong: true },
    { label: OWNER.failsOnRoad, value: inr(economics.breakdown_inr), tone: "bad", strong: true },
  ];
}

/**
 * `standalone` is the real-device mode served at /app: the phone itself is the
 * frame, so the drawn body and the painted status bar both go. Everything
 * below the chrome is identical, which is the point — the desktop tab is a
 * preview OF this, not a second implementation of it.
 */
export default function OwnerApp({ standalone = false }) {
  const { logout } = useAuth();
  // Light or dark is the app's one theme choice (theme.jsx), on a phone and in
  // the browser alike. The console's preview used to be pinned light, so an owner
  // who chose dark got a dark page around a white card.
  const { night } = useThemeMode();
  usePageTheme(standalone ? night : undefined);
  const [vin, setVin] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [screen, setScreen] = useState("home");
  // A first message for the assistant to send on arrival. On the web the assistant is the only way
  // to book, so "Book a service" opens it already asking for one.
  const [ask, setAsk] = useState(null);
  const go = useCallback((to) => {
    setAsk(to === "book" ? "Book me a service" : null);
    setScreen(to === "book" ? "agent" : to);
  }, []);
  const [booking, setBooking] = useState(null);
  const [service, setService] = useState(null);

  const load = useCallback((v) => {
    // The service view is read only for its costs, so a failed read leaves the
    // screen without rupee figures — the same as a part with none on file —
    // rather than without the alert.
    Promise.all([
      api.get(`/api/vehicle/${v}`, { minutes: 1440 }),
      api.get(`/api/vehicles/${v}/service`).catch(() => null),
    ])
      .then(([d, s]) => { setDetail(d); setService(s); })
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
  // The two reads are separate queries; quote the pair only when they agree on
  // the part, or a battery's price could sit under a water-pump headline.
  const economics = top && service?.alert?.component === top.component ? service.economics : null;
  // The server's booking, made here before a reload, in the car or on the
  // mobile app. Only a confirmed one: a hold is the first half of booking, not
  // a service the owner has got. One the agent made in this visit shows at
  // once; the server's copy of that same appointment replaces it when the view
  // is read again, since only the server's carries the centre's name.
  const upcoming = service?.booking?.status === "booked" ? { ...service.booking, booked: true } : null;
  const shownBooking = upcoming && upcoming.appointment_id === booking?.appointment_id
    ? upcoming
    : booking || upcoming;

  const content = error ? (
    <div style={{ padding: 24 }}>
      <Meta night={night}>Unavailable</Meta>
      <p style={{ fontFamily: SANS, fontSize: 15, color: t.dim, marginTop: 8 }}>{error}</p>
    </div>
  ) : !detail ? (
    <LoadingPane />
  ) : screen === "home" ? (
    standalone ? (
      <Home detail={detail} top={top} economics={economics} booking={shownBooking} go={go} ring />
    ) : (
      <HomeWeb
        detail={detail} top={top} economics={economics} booking={shownBooking} go={go}
        onOpenWhy={() => top && setScreen("why")}
      />
    )
  ) : screen === "why" ? (
    <WhyThisPart detail={detail} top={top} economics={economics} back={() => setScreen("home")} go={go} />
  ) : screen === "agent" ? (
    <AssistantScreen
      vin={vin} ask={ask} back={() => setScreen("home")}
      onBooked={(b) => { setBooking(b); setScreen("booked"); }}
      onChanged={() => load(vin)}
    />
  ) : screen === "booked" ? (
    <Booked detail={detail} top={top} economics={economics} booking={shownBooking} back={() => setScreen("home")} />
  ) : (
    <History detail={detail} back={() => setScreen("home")} />
  );

  // Each screen swings in from the side it came from (and back out the way it
  // came): forward moves in from the right, "back" from the left.
  const body = <ScreenFlip key={screen} back={screen === "home"}>{content}</ScreenFlip>;

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
    <NightProvider value={night}>
    <div className="mx-auto max-w-[1280px]">
      {!detail || error ? (
        <WebPanel>{body}</WebPanel>
      ) : screen === "home" ? (
        // The dashboard: the car, the decision, the readings, the history.
        body
      ) : (
        // A detail view keeps the car in sight: twin on the left, the work on the right.
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
          <OwnerStage
            detail={detail} top={top} booked={Boolean(shownBooking?.booked)}
            onOpenWhy={() => top && setScreen("why")}
          />
          <div className="space-y-3">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 px-1 text-label text-fg-muted">
              <button type="button" onClick={() => setScreen("home")} className="rounded transition-colors hover:text-fg-secondary">
                My car
              </button>
              <span aria-hidden>/</span>
              <span aria-current="page" className="font-medium text-fg-strong">{CRUMBS[screen]}</span>
            </nav>
            <WebPanel>{body}</WebPanel>
          </div>
        </div>
      )}
    </div>
    </NightProvider>
  );
}

/* ── chrome ──────────────────────────────────────────────────────────────── */

/** What each detail view is called in the breadcrumb. */
const CRUMBS = { why: "Evidence", agent: "Assistant", booked: "Receipt", history: "All visits" };

/** A screen's entrance: it swings in on its hinge, in perspective. GSAP removes
 *  its inline transform when it lands, so nothing stays rotated or becomes a
 *  containing block for the sticky headers inside. */
function ScreenFlip({ back = false, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!ref.current || reducedMotion()) return undefined;
    const dir = back ? -1 : 1;
    const tween = gsap.from(ref.current, {
      opacity: 0, x: dir * 38, rotationY: dir * -13, transformPerspective: 1000,
      transformOrigin: back ? "100% 50%" : "0% 50%", duration: 0.55, ease: "power3.out",
      clearProps: "opacity,transform,transformPerspective,transformOrigin",
    });
    return () => tween.kill();
  }, [back]);
  return <div ref={ref}>{children}</div>;
}

/** Reveals its content with a left-to-right wipe, so an evidence chart looks
 *  drawn rather than dropped in. A wrapper of its own because the screen that
 *  uses it returns early, and an effect cannot sit after that. */
function Wipe({ children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!ref.current || reducedMotion()) return undefined;
    const tween = gsap.from(ref.current, {
      clipPath: "inset(0 100% 0 0)", duration: 1.3, delay: 0.25, ease: "power2.out", clearProps: "clipPath",
    });
    return () => tween.kill();
  }, []);
  return <div ref={ref}>{children}</div>;
}

/** A pulse that runs along a line: "the agent is watching", as a heartbeat. */
function Heartbeat() {
  const path = useRef(null);
  useLayoutEffect(() => {
    if (!path.current || reducedMotion()) return undefined;
    const len = path.current.getTotalLength?.() ?? 300;
    path.current.style.strokeDasharray = `${len * 0.3} ${len}`;
    const tween = gsap.fromTo(path.current, { strokeDashoffset: len * 0.3 },
      { strokeDashoffset: -len, duration: 2.8, ease: "none", repeat: -1 });
    return () => tween.kill();
  }, []);
  return (
    <svg aria-hidden="true" viewBox="0 0 240 36" width="100%" height="36" preserveAspectRatio="none" style={{ display: "block" }}>
      <path d="M0 18 H70 L78 18 L84 4 L92 32 L100 18 H150 L156 18 L162 10 L168 26 L174 18 H240"
            fill="none" stroke={color.ok} strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path ref={path} d="M0 18 H70 L78 18 L84 4 L92 32 L100 18 H150 L156 18 L162 10 L168 26 L174 18 H240"
            fill="none" stroke={color.ok} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
            style={{ filter: `drop-shadow(0 0 4px ${color.ok})` }} />
    </svg>
  );
}

function LoadingPane() {
  const night = useNight();
  const t = tokens(night);
  // The blocks say "loading" only to someone who can see them.
  return (
    <div role="status" style={{ padding: 24, display: "grid", gap: 12 }}>
      <span className="sr-only">Loading your car…</span>
      {[64, 200, 120].map((h, i) => (
        <div key={i} aria-hidden="true" style={{ height: h, borderRadius: 14, background: t.hatch }} />
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

function Home({ detail, top, economics, booking, go, ring = false }) {
  const night = useNight();
  const t = tokens(night);
  const v = detail.vehicle;
  const history = detail.maintenance_history || [];

  return (
    <div style={{ padding: "6px 18px 28px" }}>
      <div style={{ paddingTop: 10, paddingBottom: 18 }}>
        <div style={{ fontFamily: SANS, fontSize: 21, fontWeight: 700, color: t.ink }}>{v.model}</div>
        <Meta night={night} mono>
          {v.vin} · {Number(v.odometer || 0).toLocaleString("en-IN")} km
        </Meta>
      </div>

      {booking?.booked ? (
        <BookedCard booking={booking} onOpen={() => go("booked")} />
      ) : top ? (
        <NowCard top={top} economics={economics} go={go} ring={ring} />
      ) : (
        <HealthyCard detail={detail} />
      )}

      {(booking?.booked || !top) && <AskLink go={go} />}

      {/* Timeline rail — the deck's spine. The now-card above is the newest
          node; everything below is what already happened. No tabs. */}
      <div style={{ marginTop: 26 }}>
        <Timeline history={history} go={go} heading />
      </div>
    </div>
  );
}

/** A quiet way into the assistant when no warning is showing (the warning card has its own buttons).
 *  The assistant answers anything about the owner's cars, so a healthy screen should not be a dead end. */
function AskLink({ go }) {
  const night = useNight();
  return (
    <div style={{ marginTop: 12 }}>
      <GhostButton night={night} onClick={() => go("agent")}>Ask the assistant</GhostButton>
    </div>
  );
}

/** The visits so far, on a rail that draws itself: the rail grows down, then
 *  each visit slides in. Shared by the phone's Home and the web dashboard. */
function Timeline({ history, go, heading = false }) {
  const night = useNight();
  const t = tokens(night);
  const root = useRef(null);

  useLayoutEffect(() => {
    if (!root.current || reducedMotion()) return undefined;
    const ctx = gsap.context(() => {
      gsap.from(".tl-rail", { scaleY: 0, transformOrigin: "top", duration: 0.9, ease: "power3.out" });
      gsap.from(".tl-node", {
        opacity: 0, x: -14, stagger: 0.12, duration: 0.6, delay: 0.2, ease: "power3.out",
        clearProps: "opacity,transform",
      });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={root}>
      {heading && <Meta night={night}>Timeline</Meta>}
      <div style={{ marginTop: heading ? 12 : 0, position: "relative", paddingLeft: 18 }}>
        <div className="tl-rail" style={{
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
  );
}

/* ── the web dashboard ───────────────────────────────────────────────────── */

/** A titled panel on the dashboard — a card on a web page, not a phone screen. */
function WebPanel({ title, children, className = "" }) {
  return (
    <section className={`spot tilt-soft overflow-hidden rounded-2xl border border-border bg-surface-card ${className}`}>
      {title && (
        <header className="border-b border-border px-5 py-3.5">
          <h2 className="text-body font-semibold text-fg-strong">{title}</h2>
        </header>
      )}
      <div>{children}</div>
    </section>
  );
}

const fmtReading = (v) => (typeof v === "number" ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) : "—");

/** The six readings the agent watches, each with its latest value and a trace. */
function SignalsGrid({ detail }) {
  const night = useNight();
  const t = tokens(night);
  const series = liveRows(detail.series);
  const signals = ["coolant_temp", "lub_oil_pressure", "battery_voltage", "fuel_pressure", "brake_fluid_pct", "speed"];
  if (series.length < 2) {
    return (
      <p style={{ fontFamily: SANS, fontSize: 13, color: t.dim, margin: 0, padding: 20 }}>
        No recent readings from the car — it reports again when the engine is on.
      </p>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18, padding: 20 }}>
      {signals.map((s) => {
        const values = series.map((r) => r[s]);
        const latest = [...values].reverse().find((x) => typeof x === "number");
        return (
          <div key={s}>
            <Meta night={night}>{signalLabel(s)}</Meta>
            <div style={{ fontFamily: MONO, fontSize: 15, color: t.ink, margin: "2px 0 6px" }}>
              {fmtReading(latest)}{SIGNALS[s]?.unit ?? ""}
            </div>
            <Spark night={night} w={120} h={30} values={values} tone={tokens(night).icon} />
          </div>
        );
      })}
    </div>
  );
}

/** Home as a web dashboard: the 3D twin and the decision side by side, the live
 *  readings and the history below. Uses the same cards as the phone, so a
 *  sentence or a figure is never worded two ways. */
function HomeWeb({ detail, top, economics, booking, go, onOpenWhy }) {
  const night = useNight();
  const t = tokens(night);
  const v = detail.vehicle;
  const history = detail.maintenance_history || [];
  const booked = Boolean(booking?.booked);

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(380px,1fr)]">
        <OwnerStage detail={detail} top={top} booked={booked} onOpenWhy={onOpenWhy} />
        <WebPanel>
          <div style={{ padding: "20px 20px 22px" }}>
            <div style={{ paddingBottom: 16 }}>
              <div style={{ fontFamily: SANS, fontSize: 21, fontWeight: 700, color: t.ink }}>{v.model}</div>
              <Meta night={night} mono>
                {v.vin} · {Number(v.odometer || 0).toLocaleString("en-IN")} km
              </Meta>
            </div>
            {booked ? (
              <BookedCard booking={booking} onOpen={() => go("booked")} />
            ) : top ? (
              <NowCard top={top} economics={economics} go={go} />
            ) : (
              <HealthyCard detail={detail} signals={false} />
            )}
            {(booked || !top) && <AskLink go={go} />}
          </div>
        </WebPanel>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <WebPanel title="Live readings"><SignalsGrid detail={detail} /></WebPanel>
        <WebPanel title="Service history">
          <div style={{ padding: 20 }}><Timeline history={history} go={go} /></div>
        </WebPanel>
      </div>
    </div>
  );
}

function TimelineNode({ title, sub, dot }) {
  const night = useNight();
  const t = tokens(night);
  return (
    <div className="tl-node" style={{ position: "relative", paddingBottom: 16 }}>
      <div style={{
        position: "absolute", left: -18, top: 4, width: 10, height: 10,
        borderRadius: 99, background: dot, border: `2px solid ${t.page}`,
      }} />
      <div style={{ fontFamily: SANS, fontSize: 14, color: t.ink, fontWeight: 500 }}>{title}</div>
      {sub && <Meta night={night} mono>{sub}</Meta>}
    </div>
  );
}

/** The quiet screen. One sentence, one number pair, ten flat sparklines —
 *  visible proof the system is watching without asking anything of the owner. */
export function HealthyCard({ detail, signals: showSignals = true }) {
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
      <div style={{ marginTop: 14 }}><Heartbeat /></div>
      {!showSignals ? null : series.length < 2 ? (
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
export function NowCard({ top, economics = null, go, ring = false }) {
  const night = useNight();
  const t = tokens(night);
  const days = top.days_to_failure;

  return (
    <div style={{
      border: `1px solid ${t.edge}`, borderRadius: 18, padding: 20, background: t.card,
      // The alert's glow, from the token: `59` is 35% opacity.
      boxShadow: `0 8px 30px -14px ${color.p1}59`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Pill night={night}>{alertBadge(top)}</Pill>
        <Meta night={night}>Now</Meta>
      </div>

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Headline
            night={night} size={27}
            title={wearingOut(top.component)}
            body={days != null
              ? `${drivingLeft(days)}, on current use.`
              : "Wear is progressing on your current usage."}
          />
        </div>
        {/* On a real phone there is no 3D stage beside this card, so the
            countdown ring lives here instead. */}
        {ring && <HealthRing days={days} severity={top.severity} diameter={84} />}
      </div>

      {economics && (
        <div style={{ marginTop: 18 }}>
          <CostRows night={night} rows={costRows(economics)} />
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <GhostButton night={night} grow onClick={() => go("why")}>{OWNER.whyThisPart}</GhostButton>
        <GhostButton night={night} grow onClick={() => go("agent")}>{OWNER.talkToAgent}</GhostButton>
      </div>
      <div style={{ marginTop: 10 }}>
        <PrimaryButton night={night} onClick={() => go("book")} note={OWNER.nothingBooked}>
          {OWNER.book}
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
      <Meta night={night}>
        {centreName(booking)} · tap for the receipt
      </Meta>
    </button>
  );
}

function formatSlot(iso) {
  return iso ? formatSlotTime(iso) : "Scheduled";
}

/** The centre as the owner knows it — "Hero-M&M Service, Kothrud", the name the
 *  car and the mobile app show — not its id. The agent's own confirmation
 *  carries only the id, so that stands in until the server's view has the name. */
function centreName(booking) {
  return booking?.center_name || booking?.center_id;
}

/* ── P08 — why this part ─────────────────────────────────────────────────── */

function WhyThisPart({ detail, top, economics, back, go }) {
  const night = useNight();
  const t = tokens(night);
  if (!top) {
    return (
      <>
        <ScreenHeader title={OWNER.whyThisPart} back={back} />
        <div style={{ padding: 22 }}>
          <p style={{ fontFamily: SANS, color: t.dim }}>No active prediction to explain.</p>
        </div>
      </>
    );
  }

  // The reading that shows this part's wear, in the owner's words — "brake
  // fluid level has been falling", not the column name. A part with no such
  // reading gets no evidence block rather than a sentence about nothing.
  const signal = componentSignal(top.component);
  const evidence = signal && {
    name: signalLabel(signal.key).toLowerCase(),
    unit: SIGNALS[signal.key].unit,
    drift: signal.direction === "up" ? "climbing" : "falling",
  };
  const series = liveRows(detail.series);
  const values = signal ? series.map((r) => r[signal.key]).filter((x) => typeof x === "number") : [];
  const latest = values.length ? values[values.length - 1] : null;
  const dtcs = detail.dtc_codes || [];
  const sure = confidence(top.failure_prob);

  return (
    <>
      <ScreenHeader
        title={cap(componentLabel(top.component))} back={back}
        right={<Pill night={night}>{alertBadge(top)}</Pill>}
      />
      <div style={{ padding: "20px 18px 28px" }}>
        {sure && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, fontSize: 38, fontWeight: 600, color: t.ink, letterSpacing: "-0.02em" }}>
              {sure.percent}
            </span>
            <span style={{ fontFamily: SANS, fontSize: 14, color: t.dim }}>{`${sure.words} — how sure the model is`}</span>
          </div>
        )}

        {evidence && (
          <>
            <div style={{ marginTop: 20 }}>
              <Headline
                night={night} size={21} title="Why we think so"
                // Only as strong as the readings (packages/core trendSentence).
                body={trendSentence(top.component, values) ?? "The model flagged this from your car's earlier readings."}
              />
            </div>

            {/* The evidence, drawn from the same window the Diagnosis Agent scored. */}
            <div style={{
              marginTop: 18, border: `1px solid ${t.edge}`, borderRadius: 14,
              padding: 16, background: t.card,
            }}>
              <Wipe><Spark night={night} w={340} h={64} values={values} tone={ACCENT} /></Wipe>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between" }}>
                <Meta night={night}>
                  {cap(evidence.name)} · last 24 h
                </Meta>
                {latest != null && (
                  <span style={{ fontFamily: MONO, fontSize: 13, color: t.ink }}>
                    {latest.toFixed(1)}{evidence.unit}
                  </span>
                )}
              </div>
            </div>
          </>
        )}

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

        {economics && (
          <div style={{ marginTop: 22 }}>
            <CostRows night={night} rows={costRows(economics)} />
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <PrimaryButton night={night} onClick={() => go("book")}>Show me slots</PrimaryButton>
        </div>
      </div>
    </>
  );
}

/* ── P07 / P09 / P11 — the assistant ─────────────────────────────────────── */

const SUGGESTIONS = [
  "How is my car doing?",
  "What will it cost if I wait?",
  "Book me a service",
  "What does my warning mean?",
];

let localCount = 0;
const localId = () => `local-${++localCount}`;

/** One conversation about every car the owner has, typed or spoken, and the only way to book on the
 *  web. The server (/api/assistant/*) keeps the thread and a longer memory, so it resumes where it
 *  left off. The assistant cannot book anything itself: it PROPOSES, and the owner's click on
 *  "Yes, do it" (or saying yes) is what runs it. `ask` is a first message to send on arrival, so
 *  "Book a service" lands in a conversation that is already asking for one. */
function AssistantScreen({ vin, ask, back, onBooked, onChanged }) {
  const night = useNight();
  const t = tokens(night);
  const [turns, setTurns] = useState([]);
  const [pending, setPending] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [readAloud, setReadAloud] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const bottomRef = useRef(null);
  const alive = useRef(true);
  const asked = useRef(false);
  const clipHandler = useRef(() => {});
  // At the length limit the recorder cuts itself off; what was said so far is still sent.
  const recorder = useRecorder((clip) => clipHandler.current(clip));

  // Set true on mount as well as false on leaving: React's development double-mount runs the cleanup
  // once, and the flag must not stay false after it or speech could never finish.
  useEffect(() => { alive.current = true; return () => { alive.current = false; stopSpeaking(); }; }, []);

  useEffect(() => {
    api.get("/api/assistant/thread")
      .then((res) => {
        setTurns((res.turns || []).map((m) => ({ id: `t-${m.id}`, role: m.role === "user" ? "user" : "assistant", text: m.text })));
        setPending(res.pending_action || null);
      })
      .catch((e) => setProblem(e.message || String(e)))
      .finally(() => {
        setLoading(false);
        if (ask && !asked.current) { asked.current = true; send(ask); }
      });
  }, []);          // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy, pending]);

  function say(text) {
    setSpeaking(true);
    speak(text, () => { if (alive.current) setSpeaking(false); });
  }

  /** A booking was made or moved: the owner can open its receipt, and Home must read it afresh. */
  function took(done) {
    if ((done.kind === "book" || done.kind === "reschedule") && done.booking) {
      setReceipt({ ...done.booking, booked: true });
    }
    onChanged();
  }

  async function send(text, channel = "text") {
    const message = (text || "").trim();
    if (!message || busy) return;
    stopSpeaking();
    setSpeaking(false);
    setInput("");
    setProblem(null);
    setTurns((m) => [...m, { id: localId(), role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await api.post("/api/assistant/message", { message, channel, vin });
      setTurns((m) => [...m, { id: localId(), role: "assistant", text: res.reply }]);
      setPending(res.pending_action || null);
      if (res.done?.ok) took(res.done);
      if (channel === "voice" || readAloud) say(res.reply);
    } catch (e) {
      setProblem(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function decide(kind) {
    if (!pending || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await api.post(`/api/assistant/actions/${pending.id}/${kind}`);
      // Mirrors what the server records: the owner's yes or no only when it took effect, never a
      // "Yes" for something that had expired or already happened.
      const said = kind === "confirm" ? "Yes, go ahead." : "No, leave it.";
      setTurns((m) => [...m, ...(res.ok ? [{ id: localId(), role: "user", text: said }] : []),
        { id: localId(), role: "assistant", text: res.message }]);
      setPending(null);
      if (res.ok && kind === "confirm") took(res);
      if (readAloud) say(res.message);
    } catch (e) {
      setProblem(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleMic() {
    if (busy) return;
    setProblem(null);
    if (!recorder.recording) {
      stopSpeaking();
      setSpeaking(false);
      const result = await recorder.start();
      if (result === "denied") setProblem("Allow the microphone to talk to the assistant, or type your question instead.");
      else if (result === "unsupported") setProblem("This browser cannot record. Type your question instead.");
      else if (result === "error") setProblem("The microphone could not start. Type your question instead.");
      return;
    }
    await sendClip(await recorder.stop());
  }

  /** Transcribe a finished clip and ask what it says: for a click on stop, and for the cut-off at the length limit. */
  async function sendClip(clip) {
    setBusy(true);
    let heard = null;
    try {
      if (clip) {
        const form = new FormData();
        form.append("audio", clip.blob, clip.name);
        const { text } = await api.upload("/api/assistant/transcribe", form);
        if ((text || "").trim()) heard = text;
        else setProblem("I did not catch that. Try again, a little closer to the microphone.");
      }
    } catch (e) {
      setProblem(e.message || "I could not hear that. Type your question instead.");
    } finally {
      setBusy(false);
    }
    if (heard) await send(heard, "voice");
  }

  // Kept current each render, so the recorder's cut-off always reaches this render's sendClip.
  useEffect(() => { clipHandler.current = (clip) => { void sendClip(clip); }; });

  async function startOver() {
    stopSpeaking();
    setSpeaking(false);
    try {
      await api.del("/api/assistant/thread");
      setTurns([]);
      setPending(null);
      setReceipt(null);
      setProblem(null);
    } catch (e) {
      setProblem(e.message || String(e));
    }
  }

  const empty = !loading && turns.length === 0;
  const canSend = !busy && !recorder.recording && input.trim().length > 0;
  const mic = micAvailable();
  const small = {
    border: "none", background: "transparent", cursor: "pointer", fontFamily: SANS, fontSize: 12,
    color: t.dim, padding: "8px 6px", minHeight: 36,
  };

  return (
    <>
      <ScreenHeader
        title="Assistant" back={back}
        right={<Meta night={night}>{busy ? "Thinking" : recorder.recording ? "Listening" : "Live"}</Meta>}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px 0" }}>
        {speechAvailable() && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, fontFamily: SANS, fontSize: 12, color: t.dim, cursor: "pointer" }}>
            <input
              type="checkbox" checked={readAloud}
              onChange={(e) => { setReadAloud(e.target.checked); if (!e.target.checked) { stopSpeaking(); setSpeaking(false); } }}
            />
            Read replies aloud
          </label>
        )}
        <span style={{ flex: 1 }} />
        {speaking && <button type="button" style={small} onClick={() => { stopSpeaking(); setSpeaking(false); }}>Stop</button>}
        {turns.length > 0 && <button type="button" style={small} onClick={startOver}>Start over</button>}
      </div>

      <div style={{ padding: "12px 16px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
        {empty && (
          <div style={{ display: "grid", gap: 10, padding: "12px 0" }}>
            <h2 style={{ margin: 0, fontFamily: SANS, fontSize: 17, fontWeight: 600, color: t.ink }}>Ask me about your cars</h2>
            <p style={{ margin: 0, fontFamily: SANS, fontSize: 14, color: t.dim, lineHeight: 1.5 }}>
              I can see all your cars, their warnings, costs, bookings and service history.
              {mic ? " Type, or press the microphone and talk — in English or Hindi." : " Type your question below."}
            </p>
            <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
              {SUGGESTIONS.map((s) => <GhostButton key={s} night={night} onClick={() => send(s)}>{s}</GhostButton>)}
            </div>
          </div>
        )}
        {turns.map((m) => <Bubble key={m.id} m={m} />)}
        {busy && <TypingDots />}
        {problem && <Bubble m={{ role: "system", text: problem }} />}
        {pending && (
          <div role="group" aria-label="Waiting for your yes" style={{
            border: `1px solid ${t.edge}`, borderRadius: 14, padding: "14px 16px", background: t.card,
          }}>
            <Meta night={night} style={{ color: t.positive }}>Waiting for your yes</Meta>
            <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: t.ink, marginTop: 6 }}>{pending.summary}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button" onClick={() => decide("confirm")} disabled={busy}
                style={{
                  flex: 1, border: "none", borderRadius: 10, padding: "11px 14px", background: color.accentDeep,
                  color: color.onAccent, fontFamily: SANS, fontSize: 14, fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
                }}
              >
                Yes, do it
              </button>
              <GhostButton night={night} grow disabled={busy} onClick={() => decide("cancel")}>No</GhostButton>
            </div>
          </div>
        )}
        {receipt && (
          <div style={{ border: `1px solid ${t.edge}`, borderRadius: 14, padding: "14px 16px", background: t.card }}>
            <Meta night={night} style={{ color: t.positive }}>Confirmed</Meta>
            <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: t.ink, marginTop: 6 }}>
              {formatSlot(receipt.slot_start)}
            </div>
            <div style={{ marginTop: 10 }}>
              <GhostButton night={night} onClick={() => onBooked(receipt)}>View receipt</GhostButton>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{
        position: "sticky", bottom: 0, padding: "12px 16px 16px",
        background: t.page, borderTop: `1px solid ${t.edge}`, marginTop: 10,
      }}>
        <div style={{ display: "flex", gap: 8 }}>
          {mic && (
            <button
              type="button" onClick={toggleMic}
              disabled={busy && !recorder.recording}
              aria-label={recorder.recording ? "Stop and send" : "Talk to the assistant"}
              style={{
                width: 46, borderRadius: 12, cursor: busy && !recorder.recording ? "not-allowed" : "pointer",
                border: `1px solid ${recorder.recording ? color.accentDeep : t.edgeStrong}`,
                background: recorder.recording ? color.accentDeep : t.card,
                color: recorder.recording ? color.onAccent : t.ink,
              }}
            >
              {recorder.recording ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ margin: "0 auto" }}><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto" }}>
                  <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              )}
            </button>
          )}
          <input
            value={input}
            aria-label="Message"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            disabled={busy || recorder.recording}
            placeholder={recorder.recording ? "Listening…" : "Ask anything about your cars…"}
            style={{
              flex: 1, borderRadius: 12, border: `1px solid ${t.edgeStrong}`, background: t.card,
              padding: "12px 14px", fontFamily: SANS, fontSize: 14, color: t.ink, outline: "none",
            }}
          />
          <button
            type="button" onClick={() => send(input)} disabled={!canSend} aria-label="Send"
            style={{
              border: "none", borderRadius: 12, width: 46, background: color.accentDeep, color: color.onAccent,
              cursor: canSend ? "pointer" : "not-allowed", opacity: canSend ? 1 : 0.5,
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
    <div className="pop-in" style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
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
              From {m.grounded_in} facts about your car
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

function Booked({ detail, top, economics, booking, back }) {
  const night = useNight();
  const t = tokens(night);
  const card = useRef(null);

  // Done. The receipt drops in like a ticket and a handful of confetti bursts
  // from it — the one moment in the app that is allowed to celebrate, because
  // it is the moment the owner actually decided something.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || reducedMotion()) return undefined;
    const hues = [color.accent, color.ok, color.p3, color.amber];
    const bits = [];
    const ctx = gsap.context(() => {
      gsap.from(el, {
        opacity: 0, y: -30, rotationX: -70, transformPerspective: 900, transformOrigin: "50% 0%",
        duration: 0.9, ease: "back.out(1.4)", clearProps: "opacity,transform,transformPerspective,transformOrigin",
      });
      for (let i = 0; i < 30; i++) {
        const bit = document.createElement("span");
        bit.setAttribute("aria-hidden", "true");
        Object.assign(bit.style, {
          position: "absolute", left: "50%", top: "40%", width: "7px", height: "11px", borderRadius: "2px",
          background: hues[i % hues.length], pointerEvents: "none", zIndex: "3",
        });
        el.appendChild(bit);
        bits.push(bit);
        gsap.fromTo(bit,
          { x: 0, y: 0, rotation: 0, opacity: 1, scale: 1 },
          {
            x: (Math.random() - 0.5) * 320, y: -60 - Math.random() * 120, rotation: Math.random() * 720 - 360,
            duration: 0.5 + Math.random() * 0.2, ease: "power2.out",
            onComplete: () => gsap.to(bit, { y: "+=240", opacity: 0, rotation: "+=180", duration: 0.9 + Math.random() * 0.4, ease: "power1.in" }),
          });
      }
    }, el);
    return () => { ctx.revert(); bits.forEach((b) => b.remove()); };
  }, []);

  return (
    <>
      <ScreenHeader title="Booking" back={back} />
      <div style={{ padding: "22px 18px 28px" }}>
        <div ref={card} style={{
          position: "relative", borderRadius: 18, padding: 22, background: tokens(night).okBg, border: `1px solid ${tokens(night).okBorder}`,
        }}>
          <Meta night={night} style={{ color: tokens(night).positive }}>Confirmed</Meta>
          <div style={{ fontFamily: SANS, fontSize: 27, fontWeight: 700, color: t.ink, marginTop: 8, lineHeight: 1.2 }}>
            {formatSlot(booking?.slot_start)}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <CostRows night={night} rows={[
            { label: "Service centre", value: centreName(booking) || "—" },
            ...(top ? [{ label: "Work", value: cap(componentLabel(top.component)) }] : []),
            ...(economics ? [{ label: "Estimate", value: inr(economics.repair_inr), strong: true }] : []),
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
  const root = useRef(null);

  // Visits rise in one after another, newest first.
  useLayoutEffect(() => {
    if (!root.current || reducedMotion()) return undefined;
    const ctx = gsap.context(() => {
      gsap.from(".hist-row", {
        opacity: 0, y: 22, rotationX: 12, transformPerspective: 800, stagger: 0.09, duration: 0.6,
        ease: "power3.out", clearProps: "opacity,transform,transformPerspective",
      });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <>
      <ScreenHeader title="Service history" back={back} />
      <div ref={root} style={{ padding: "18px 18px 28px" }}>
        {rows.length === 0 ? (
          <p style={{ fontFamily: SANS, fontSize: 14, color: t.dim }}>
            No service visits on record for this vehicle yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((h, i) => (
              <div key={i} className="hist-row" style={{
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
                <Meta night={night} mono>
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
