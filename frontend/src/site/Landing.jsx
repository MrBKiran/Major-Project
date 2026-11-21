/**
 * The public site: what AutoSaarthi is, told as a flight through one 3D world.
 *
 * Signed-out visitors land here (App.jsx); sign-in is a button away at /login.
 * The page is a stack of full-height sections — the hero, six chapters of the
 * story, a finale — and behind them a single WebGL world (site/World.jsx) whose
 * camera is flown by the scroll position. Each chapter has something to touch in
 * the world, and a line of hint text says what. What the visitor does there is
 * reported back as a short message in the HUD at the bottom.
 *
 * The words are all real HTML on top of the canvas, so the page reads, searches
 * and is navigable without the 3D; where WebGL is missing it falls back to a
 * still backdrop and the same story. The canvas itself is decoration and is
 * hidden from assistive technology.
 */

import { ScrollTrigger } from "gsap/ScrollTrigger";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BlurText, Magnetic, RoadScene } from "../fx";
import { gsap, reducedMotion } from "../fx/gsap.js";
import { webglAvailable } from "../fx/Scene.jsx";
import { usePageTheme } from "../night.jsx";
import { navigate } from "../route.js";
import { BrandMark } from "../ui.jsx";
import { Cursor } from "./Cursor.jsx";
import "./site.css";

gsap.registerPlugin(ScrollTrigger);

// The world is its own chunk: three.js is the heaviest thing in the app.
const World = lazy(() => import("./World.jsx"));

// One section per camera stop. Kept in step with STOPS in World.jsx — importing
// it from there would pull three.js into the main bundle and defeat the lazy load.
const STOPS = 8;

const CHAPTERS = [
  {
    id: "listen", n: "01", eyebrow: "Listen", side: "left",
    title: "It hears the car before the driver does.",
    body: "Coolant temperature, oil pressure, battery voltage, fuel pressure and brake fluid stream in from every vehicle. When a reading starts to drift — long before a warning light — the agent notices.",
    hint: "Drag the car to turn it · tap a glowing marker",
  },
  {
    id: "call", n: "02", eyebrow: "Call", side: "right",
    title: "Then it calls, the way a person would.",
    body: "A voice agent rings the owner, leads with what it will cost rather than how it works, and listens. If they say no, it asks why and offers a better time. Nothing is booked without a yes.",
    hint: "Click the voice · move your cursor near it",
  },
  {
    id: "book", n: "03", eyebrow: "Book", side: "left",
    title: "One tap to a slot that actually exists.",
    body: "Open slots in the owner's own city, held and booked in a single step — or moved, or cancelled — with no phone tree and no double-booked bay.",
    hint: "Hover a card · click to book it",
  },
  {
    id: "coordinate", n: "04", eyebrow: "Coordinate", side: "right",
    title: "Seven agents. One orchestra.",
    body: "A Master Agent plans; six workers analyse, diagnose, talk, schedule, follow up and report to the plant. The Master is deliberately weak: it cannot book, read personal data or write records, so compromising the conductor never compromises the fleet.",
    hint: "Hover a node · click to send a signal · drag to turn",
  },
  {
    id: "learn", n: "05", eyebrow: "Learn", side: "left",
    title: "The plant hears it too.",
    body: "Every completed service feeds back. When seven of forty-six vehicles from one batch lose the same part, the agent finds the cluster, runs the statistics and drafts the root-cause report for manufacturing.",
    hint: "Click the cloud: cluster or coincidence?",
  },
  {
    id: "protect", n: "06", eyebrow: "Protect", side: "right",
    title: "Every move is policed.",
    body: "A security layer checks each tool call against policy, behaviour and intent, and writes it to a tamper-evident log. Five scripted attacks, five blocked.",
    hint: "Click the shield to fire attacks at it",
  },
];

const FACTS = ["6 worker agents", "30 guarded tools", "5 of 5 attacks blocked"];

export default function Landing() {
  usePageTheme(true); // the site is always dark, whatever the app's theme is
  const root = useRef(null);
  const progress = useRef(0);
  const hudTimer = useRef(0);
  const [active, setActive] = useState(0);
  const [hud, setHud] = useState(null);
  const [world, setWorld] = useState(webglAvailable);
  const reduce = reducedMotion();

  useEffect(() => {
    const before = document.title;
    document.title = "AutoSaarthi — Fix it before it breaks";
    return () => { document.title = before; };
  }, []);

  const onHud = useCallback((message) => {
    setHud(message);
    window.clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => setHud(null), 4800);
  }, []);
  useEffect(() => () => window.clearTimeout(hudTimer.current), []);

  // The scroll engine: one number, 0 … STOPS-1, fed to the world; and a reveal
  // for the words of each section as it arrives.
  useLayoutEffect(() => {
    if (!root.current || /jsdom/i.test(navigator.userAgent)) return undefined;
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: root.current, start: "top top", end: "bottom bottom",
        onUpdate: (self) => {
          const p = self.progress * (STOPS - 1);
          progress.current = p;
          const near = Math.round(p);
          setActive((cur) => (cur === near ? cur : near));
        },
      });
      if (reducedMotion()) return;
      gsap.utils.toArray(".site-section").forEach((section) => {
        const items = section.querySelectorAll("[data-reveal]");
        if (!items.length) return;
        gsap.from(items, {
          y: 56, opacity: 0, rotationX: -16, transformPerspective: 800, stagger: 0.1, duration: 1.1, ease: "expo.out",
          clearProps: "transform,opacity",
          scrollTrigger: { trigger: section, start: "top 62%", toggleActions: "play none none reverse" },
        });
      });
    }, root);
    return () => ctx.revert();
  }, []);

  const go = (i) => window.scrollTo({ top: i * window.innerHeight, behavior: reduce ? "auto" : "smooth" });
  const hint = active === 0 ? "Scroll to fly through the product" : CHAPTERS[active - 1]?.hint;

  return (
    <div ref={root} className="site" style={{ height: `${STOPS * 100}svh` }}>
      <div aria-hidden="true" className="site-world">
        {world ? (
          <Suspense fallback={null}>
            <World progressRef={progress} onHud={onHud} reduce={reduce} className="h-full w-full" onUnsupported={() => setWorld(false)} />
          </Suspense>
        ) : (
          <div className="relative h-full w-full bg-gradient-to-b from-surface-page via-surface-panel to-surface-page">
            <RoadScene className="absolute inset-x-0 bottom-0 h-[70%]" />
          </div>
        )}
      </div>
      <div aria-hidden="true" className="site-vignette" />
      <Cursor />

      <header className="site-nav">
        <a href="/" onClick={(e) => { e.preventDefault(); go(0); }} className="flex items-center gap-2.5" aria-label="AutoSaarthi, back to the top">
          <BrandMark className="h-9 w-9 rounded-xl" />
          <span className="text-lead font-bold tracking-tight text-fg-strong">AutoSaarthi</span>
        </a>
        <button type="button" onClick={() => navigate("/login")} className="site-btn" style={{ padding: "10px 20px" }}>
          Sign in
        </button>
      </header>

      <nav aria-label="Story" className="site-rail">
        {Array.from({ length: STOPS }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={i === 0 ? "Start" : i === STOPS - 1 ? "Sign in" : CHAPTERS[i - 1].eyebrow}
            aria-current={active === i ? "step" : undefined}
            onClick={() => go(i)}
          />
        ))}
      </nav>

      <main className="site-main">
        <section className="site-section" aria-label="Introduction">
          <div className="site-panel" style={{ maxWidth: 860 }}>
            <p className="site-eyebrow" data-reveal>Agentic predictive maintenance · Techathon 6.0</p>
            <BlurText
              as="h1"
              className="site-h1 mt-4 block text-fg-strong"
              parts={["Fix it before it", { text: "breaks.", className: "text-link" }]}
            />
            <p className="site-lead mt-6 max-w-xl" data-reveal>
              AutoSaarthi watches every vehicle&apos;s telemetry, predicts the part that is failing, calls the owner,
              books the service and tells the plant what to fix — with every step policed by a security layer.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3" data-reveal>
              <Magnetic strength={0.15}>
                <button type="button" onClick={() => go(1)} className="site-btn site-btn-primary">Take the tour ↓</button>
              </Magnetic>
              <button type="button" onClick={() => navigate("/login")} className="site-btn">Sign in →</button>
            </div>
            <ul className="mt-9 flex flex-wrap gap-2" data-reveal>
              {FACTS.map((f) => <li key={f} className="site-pill">{f}</li>)}
            </ul>
          </div>
        </section>

        {CHAPTERS.map((c) => (
          <section key={c.id} className="site-section" data-side={c.side} aria-labelledby={`ch-${c.id}`}>
            <div className="site-panel site-glass p-7 md:p-9">
              <p className="site-num" data-reveal>{c.n} / 06</p>
              <p className="site-eyebrow mt-1" data-reveal>{c.eyebrow}</p>
              <h2 id={`ch-${c.id}`} className="site-h2 mt-3" data-reveal>{c.title}</h2>
              <p className="site-lead mt-5" data-reveal>{c.body}</p>
            </div>
          </section>
        ))}

        <section className="site-section" style={{ justifyContent: "center", textAlign: "center" }} aria-labelledby="ch-finale">
          <div className="site-panel site-glass px-7 py-10 md:px-12" style={{ maxWidth: 760 }}>
            <p className="site-eyebrow" data-reveal>Ready when your fleet is</p>
            <h2 id="ch-finale" className="site-h2 mt-3" data-reveal>Step through.</h2>
            <p className="site-lead mx-auto mt-5 max-w-xl" data-reveal>
              Sign in to the console to watch the agents work on live data, or open the owner app the way a driver
              would.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3" data-reveal>
              <Magnetic strength={0.15}>
                <button type="button" onClick={() => navigate("/login")} className="site-btn site-btn-primary">Sign in to the console</button>
              </Magnetic>
              <a href="/app" className="site-btn">Open the owner app</a>
            </div>
            <p className="mt-12 text-label text-fg-subtle" data-reveal>
              AutoSaarthi · Techathon 6.0 · Challenge III, Automotive
            </p>
          </div>
        </section>
      </main>

      {active === 0 && (
        <div className="site-hint" aria-hidden="true">
          <span className="site-scroll-cue"><span>{hint}</span><i /></span>
        </div>
      )}
      {active > 0 && !hud && hint && <p className="site-hint">{hint}</p>}
      <div role="status" aria-live="polite" className="site-hud">
        {hud && <div key={hud.at} className="site-glass pop-in px-5 py-3.5">{hud.text}</div>}
      </div>
    </div>
  );
}
