/**
 * The public site: AutoSaarthi shown working, in plain words.
 *
 * Signed-out visitors land here (App.jsx); sign-in is a button away at /login.
 * The first screen says what the product does for a driver, then shows it
 * doing that (LiveRun). The page goes on to walk one warning sign to a repair
 * (Journey), introduce the helpers and what each may not do (Agents), let the
 * visitor try to misuse it (Shield) and end on the screens it runs on (Screens).
 *
 * Everything is written for someone with no background in cars or AI; "Show
 * technical details" (detail.jsx) adds the engineering names for those who want
 * them. The 3D car is decoration with a drawn fallback. The page keeps its own
 * palette and type scale (site.css) whatever the app's theme.
 */

import "@fontsource/space-grotesk/300.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Ticker } from "../fx";
import { reducedMotion } from "../fx/gsap.js";
import { navigate } from "../route.js";
import { BrandMark } from "../ui.jsx";
import Agents from "./Agents.jsx";
import Calculator from "./Calculator.jsx";
import { DetailContext, DetailToggle } from "./detail.jsx";
import FloatingCards from "./FloatingCards.jsx";
import Journey from "./Journey.jsx";
import LiveRun from "./LiveRun.jsx";
import Screens from "./Screens.jsx";
import Shield from "./Shield.jsx";
import "./site.css";

const LINKS = [
  ["journey", "How it works"],
  ["helpers", "AI helpers"],
  ["security", "Safety"],
  ["screens", "Apps"],
];

const days = (v) => `${Math.round(v)} days`;
const rupees = (v) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const whole = (v) => String(Math.round(v));
const ofFive = (v) => `${Math.round(v)} of 5`;

const FACTS = [
  [9, days, "of warning, before a dashboard light would come on"],
  [2400, rupees, "to fix a worn water pump early — not ₹18,500 after a breakdown"],
  [7, whole, "AI helpers, each allowed to do only its own job"],
  [5, ofFive, "practice attacks stopped by the security guard"],
];

/** A figure that counts up the first time it is on screen, and is simply there where that cannot be seen. */
function CountOnView({ to, format }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.6 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return <span ref={ref}><Ticker value={seen ? to : 0} format={format} duration={1.2} /></span>;
}

export default function Landing() {
  const [active, setActive] = useState(null);
  const [tech, setTech] = useState(false);
  const detail = useMemo(() => ({ on: tech, set: setTech }), [tech]);
  const reduce = reducedMotion();
  const hero = useRef(null);

  useEffect(() => {
    const before = document.title;
    document.title = "AutoSaarthi — Fix it before it breaks";
    return () => { document.title = before; };
  }, []);

  // The nav follows the reader: whichever section crosses the middle of the screen.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }),
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const id of [...LINKS.map(([l]) => l), "top", "demo"]) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  const go = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 8, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <DetailContext.Provider value={detail}>
      <div className="site">
        <header className="s-nav">
          <a href="/" onClick={(e) => { e.preventDefault(); go("top"); }} className="s-brand" aria-label="AutoSaarthi, back to the top">
            <BrandMark className="h-8 w-8 rounded-[10px]" />
            <span>AutoSaarthi</span>
          </a>
          <nav aria-label="Sections" className="s-nav-links">
            {LINKS.map(([id, label]) => (
              <button key={id} type="button" onClick={() => go(id)} aria-current={active === id ? "true" : undefined}>
                {label}
              </button>
            ))}
          </nav>
          <div className="s-nav-cta">
            <a href="/app" className="s-nav-ghost">Owner app</a>
            <button type="button" onClick={() => navigate("/login")} className="s-btn s-btn-brand s-btn-sm">
              Sign in <span aria-hidden="true">→</span>
            </button>
          </div>
        </header>

        <main>
          <section id="top" ref={hero} className="s-hero" aria-labelledby="hero-title">
            <FloatingCards bounds={hero} />
            <div className="s-wrap">
              <p className="s-chip"><i className="s-dot" data-tone="green" />AI that looks after your car</p>
              <h1 id="hero-title" className="s-h1">
                <span className="s-h1-line" style={{ "--i": 0 }}>Fix it before</span>
                <span className="s-h1-line s-h1-soft" style={{ "--i": 1 }}>it breaks.</span>
              </h1>
              <div className="s-hero-row">
                <p className="s-lead s-hero-lead">
                  AutoSaarthi keeps an eye on your car&apos;s health in the background. When a part starts to wear
                  out, it tells you what is wrong, what it costs to fix now rather than later, and books a repair at a
                  time that suits you — before you are stuck at the side of the road.
                </p>
                <div className="s-hero-cta">
                  <button type="button" onClick={() => go("demo")} className="s-btn s-btn-ink">See it in action</button>
                  <button type="button" onClick={() => go("journey")} className="s-btn s-btn-line">How it works</button>
                </div>
              </div>
            </div>

            <div id="demo" className="s-wrap s-wrap-wide s-demo">
              <div className="s-demo-head">
                <div>
                  <h2 className="s-h3">See it in action</h2>
                  <p className="s-demo-sub">
                    Pick a situation. Each step is one AI helper doing its part, from the first warning sign to the
                    finished job.
                  </p>
                </div>
                <DetailToggle />
              </div>
              <LiveRun />
            </div>

            <div className="s-wrap">
              <ul className="s-facts">
                {FACTS.map(([to, format, text]) => <li key={text}><b><CountOnView to={to} format={format} /></b><span>{text}</span></li>)}
              </ul>
            </div>
          </section>

          <Journey />
          <Calculator />
          <Agents />
          <Shield />
          <Screens />

          <section className="s-section s-cta" aria-labelledby="cta-title">
            <div className="s-wrap">
              <div className="s-cta-card">
                <p className="s-eyebrow">Try it yourself</p>
                <h2 id="cta-title" className="s-h2">See it on real data.</h2>
                <p className="s-lead">
                  Sign in to the dashboard to watch every car being looked after, or open the owner app to see what a
                  driver sees.
                </p>
                <div className="s-cta-actions">
                  <button type="button" onClick={() => navigate("/login")} className="s-btn s-btn-light">Sign in to the dashboard</button>
                  <a href="/app" className="s-btn s-btn-outline-light">Open the owner app</a>
                </div>
              </div>
            </div>
          </section>
        </main>

        <footer className="s-footer">
          <div className="s-wrap">
            <span className="s-brand"><BrandMark className="h-6 w-6 rounded-md" /><span>AutoSaarthi</span></span>
            <span>Built for Techathon 6.0 · Challenge III, Automotive</span>
          </div>
        </footer>
      </div>
    </DetailContext.Provider>
  );
}
