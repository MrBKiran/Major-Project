import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect, useRef, useState } from "react";
import { gsap, reducedMotion } from "../fx/gsap.js";
import { CALL, JOURNEY, SLOTS } from "./content.js";

gsap.registerPlugin(ScrollTrigger);

/**
 * How a reading becomes a repair, told in one pinned scene. The stage holds
 * still while the scroll plays it: sensor lines draw and one drifts, the phone
 * rings and the call is transcribed line by line, a slot is picked and a ticket
 * slides up, a production batch lights up the seven cars that lost the part.
 *
 * Each visual is driven by `p` (0 → 1 through its own stage), so scrolling back
 * plays it backwards. Without scroll-linking (tests, reduced motion) every stage
 * shows its finished state.
 */

const N = JOURNEY.length;

// A day of readings, shaped like the real thing: steady, with a slow drift at the end.
function series(seed, drift) {
  return Array.from({ length: 64 }, (_, i) => {
    const t = i / 63;
    const noise = Math.sin(i * 1.7 + seed) * 0.6 + Math.sin(i * 0.37 + seed * 2) * 0.9;
    const rise = drift && t > 0.55 ? ((t - 0.55) / 0.45) ** 1.6 * drift : 0;
    return noise + rise;
  });
}
function toPath(values, w = 300, h = 56) {
  const min = Math.min(...values) - 1;
  const max = Math.max(...values) + 1;
  return values
    .map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)} ${(h - ((v - min) / (max - min)) * h).toFixed(1)}`)
    .join(" ");
}

const SENSORS = [
  { name: "Coolant temperature", unit: "°C", value: "97.2", values: series(1, 9), drift: true, tone: "amber" },
  { name: "Oil pressure", unit: "bar", value: "3.9", values: series(4, 0), tone: "teal" },
  { name: "Battery voltage", unit: "V", value: "14.3", values: series(7, 0), tone: "teal" },
];

function SensorBoard({ p }) {
  return (
    <div className="s-board">
      <div className="s-board-head">
        <span><i className="s-live" />Live telemetry</span>
        <b>MH12AB1001 · Bolero · Pune</b>
      </div>
      {SENSORS.map((s) => (
        <div key={s.name} className="s-sensor" data-tone={s.tone}>
          <div className="s-sensor-top">
            <span>{s.name}</span>
            <b>{s.value}<small> {s.unit}</small>{s.drift && p > 0.55 ? " ↑" : ""}</b>
          </div>
          <svg viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden="true">
            {s.drift && <rect x="168" y="0" width="132" height="56" className="s-sensor-band" style={{ opacity: p > 0.5 ? 1 : 0 }} />}
            <path d={toPath(s.values)} pathLength="1" className="s-sensor-line" style={{ strokeDashoffset: 1 - Math.min(1, p * 1.15) }} />
          </svg>
        </div>
      ))}
      <p className="s-board-flag" data-on={p > 0.72}>
        <i className="s-dot" data-tone="amber" />
        Drift found nine days before a warning light would come on
      </p>
    </div>
  );
}

function Phone({ children, label }) {
  return (
    <div className="s-phone" role="img" aria-label={label}>
      <div className="s-phone-screen">
        <div className="s-phone-status"><span>9:41</span><i className="s-phone-island" /><span>5G ▮▮▮</span></div>
        {children}
      </div>
    </div>
  );
}

function PhoneCall({ p }) {
  const shown = Math.max(1, Math.ceil(p * CALL.length));
  const secs = Math.round(p * 46);
  return (
    <Phone label="A phone call from AutoSaarthi to the owner, transcribed">
      <div className="s-call-head">
        <span className="s-call-avatar" aria-hidden="true">A</span>
        <div>
          <b>AutoSaarthi</b>
          <span>On a call with Ramesh · 0:{String(secs).padStart(2, "0")}</span>
        </div>
      </div>
      <div className="s-wave" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 7) * 90}ms` }} />)}</div>
      <ol className="s-chat">
        {CALL.slice(0, shown).map((line, i) => (
          <li key={i} data-who={line.who}>{line.text}</li>
        ))}
      </ol>
    </Phone>
  );
}

function PhoneBook({ p }) {
  const picked = p > 0.3;
  const booked = p > 0.68;
  return (
    <Phone label="Booking a service slot in the owner app">
      <div className="s-book">
        <p className="s-book-k">Book a service</p>
        <b className="s-book-centre">Hero-M&amp;M Service, Kothrud</b>
        <span className="s-book-meta">2.1 km · bay free · water pump in stock</span>
        {SLOTS.map((d) => (
          <div key={d.day} className="s-book-day">
            <span>{d.day}</span>
            <div>
              {d.times.map((t) => (
                <i key={t} data-picked={picked && d.day === "Mon 23" && t === "9:00" ? "true" : undefined}>{t}</i>
              ))}
            </div>
          </div>
        ))}
        <div className="s-ticket" data-on={booked}>
          <span className="s-ticket-k">Confirmed</span>
          <b>Mon 23 Nov, 9:00 am</b>
          <span>Hero-M&amp;M Service, Kothrud</span>
          <span className="s-ticket-ref">Ref APT-c1db7de7c0 · reminder the day before</span>
        </div>
      </div>
    </Phone>
  );
}

// Which of the 46 cars lost the part. Fixed, so the picture is the same every time.
const FAILED = [3, 9, 14, 22, 27, 35, 41];

function PlantReport({ p }) {
  const lit = Math.round(Math.min(1, p * 1.3) * FAILED.length);
  return (
    <div className="s-board s-plant">
      <div className="s-board-head">
        <span><i className="s-live" data-tone="violet" />Defect cluster</span>
        <b>Nashik · BATCH-2024-Q3-WP</b>
      </div>
      <p className="s-plant-q">Water pump replacements, car by car</p>
      <div className="s-batch" aria-label={`${lit} of 46 cars in the batch had the water pump replaced`} role="img">
        {Array.from({ length: 46 }, (_, i) => (
          <i key={i} data-hit={FAILED.slice(0, lit).includes(i) ? "true" : undefined} />
        ))}
      </div>
      <dl className="s-plant-stats">
        <div><dt>Units affected</dt><dd>{lit}/46</dd></div>
        <div><dt>Lift vs baseline</dt><dd>{p > 0.45 ? "8.41×" : "—"}</dd></div>
        <div><dt>FDR q-value</dt><dd>{p > 0.55 ? "0.007" : "—"}</dd></div>
      </dl>
      <p className="s-board-flag" data-on={p > 0.75}>
        <i className="s-dot" data-tone="violet" />
        CAPA draft ready · ₹7.2 lakh avoidable · waiting for a manager&apos;s yes
      </p>
    </div>
  );
}

const VISUALS = [SensorBoard, PhoneCall, PhoneBook, PlantReport];

export default function Journey() {
  const root = useRef(null);
  const reduce = reducedMotion();
  const [stage, setStage] = useState(0);
  const [sub, setSub] = useState(1);
  const [linked, setLinked] = useState(false);

  useLayoutEffect(() => {
    if (!root.current || /jsdom/i.test(navigator.userAgent)) return undefined;
    setLinked(true);
    const st = ScrollTrigger.create({
      trigger: root.current, start: "top top", end: "bottom bottom",
      onUpdate: (self) => {
        const at = self.progress * N;
        const s = Math.min(N - 1, Math.floor(at));
        setStage(s);
        setSub(reduce ? 1 : Math.round(Math.min(1, at - s) * 60) / 60);
      },
    });
    return () => st.kill();
  }, [reduce]);

  const jump = (i) => {
    const el = root.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const run = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + (run * (i + 0.5)) / N, behavior: reduce ? "auto" : "smooth" });
  };

  const tone = JOURNEY[stage].tone;
  const progressOf = (i) => (!linked ? 1 : i < stage ? 1 : i === stage ? sub : 0);

  return (
    <section id="journey" ref={root} className="s-journey" style={{ height: `${N * 85 + 100}svh` }} aria-labelledby="journey-title">
      <div className="s-journey-pin" data-tone={tone}>
        <div className="s-wrap s-journey-grid">
          <div className="s-journey-copy">
            <p className="s-eyebrow">How it works</p>
            <h2 id="journey-title" className="s-h2">From a reading to a repair.</h2>
            <ol className="s-jr-steps">
              {JOURNEY.map((j, i) => (
                <li key={j.id} data-tone={j.tone} data-state={i < stage ? "done" : i === stage ? "active" : "next"}>
                  <button type="button" onClick={() => jump(i)} aria-current={i === stage ? "step" : undefined}>
                    <span className="s-jr-bar"><i style={{ transform: `scaleX(${progressOf(i)})` }} /></span>
                    <span className="s-jr-label">{String(i + 1).padStart(2, "0")} {j.eyebrow}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="s-jr-text">
              {JOURNEY.map((j, i) => (
                <div key={j.id} data-on={i === stage} data-tone={j.tone}>
                  <h3 className="s-h3">{j.title}</h3>
                  <p className="s-lead">{j.body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="s-journey-stage">
            {VISUALS.map((V, i) => (
              <div key={JOURNEY[i].id} className="s-jr-visual" data-on={i === stage} data-past={i < stage}>
                <V p={progressOf(i)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
