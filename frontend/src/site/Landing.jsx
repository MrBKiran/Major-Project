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
import SectionDock from "./SectionDock.jsx";
import Shield from "./Shield.jsx";
import "./site.css";

// id, label, and the colour the dock takes while that section is being read.
const LINKS = [
  ["journey", "How it works", "blue"],
  ["cost", "Savings", "amber"],
  ["helpers", "AI helpers", "violet"],
  ["security", "Safety", "rose"],
  ["screens", "Apps", "teal"],
];

// Where a visitor goes next, in the footer: the same sections, then the way in.
const FOOTER_COLUMNS = [
  ["Product", [["journey", "How it works"], ["cost", "What waiting costs"], ["helpers", "AI helpers"], ["screens", "Apps"]]],
  ["Trust", [["security", "How it stays safe"], ["demo", "See it working"]]],
];

const days = (v) => `${Math.round(v)} days`;
const rupees = (v) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const whole = (v) => String(Math.round(v));
const ofFive = (v) => `${Math.round(v)} of 5`;

const FACTS = [
  [9, days, "of warning, before a dashboard light would come on"],
  [2400, rupees, "to fix a worn water pump early — not ₹18,500 after a breakdown"],
  [7, whole, "AI helpers, each allowed to do only its own job"],
  [5, ofFive, "misuse attempts stopped by the security guard"],
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
  const [footerShown, setFooterShown] = useState(false);
  const [tech, setTech] = useState(false);
  const bar = useRef(null);
  const detail = useMemo(() => ({ on: tech, set: setTech }), [tech]);
  const reduce = reducedMotion();
  const hero = useRef(null);

  useEffect(() => {
    const before = document.title;
    document.title = "AutoSaarthi — Fix it before it breaks";
    return () => { document.title = before; };
  }, []);

  // The dock follows the reader: whichever section crosses the middle of the screen. The hero and the
  // closing call are watched too, so the marker lets go when the reader is on neither of its sections.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }),
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const id of [...LINKS.map(([l]) => l), "top", "start"]) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    // The dock steps aside once any of the footer is on screen.
    const foot = document.getElementById("footer");
    const fo = new IntersectionObserver(([e]) => setFooterShown(e.isIntersecting), { threshold: 0 });
    if (foot) fo.observe(foot);
    return () => { io.disconnect(); fo.disconnect(); };
  }, []);

  // A hairline under the top bar fills as the page is read. Written to a CSS variable, not state,
  // so scrolling never re-renders the page.
  useEffect(() => {
    const el = bar.current;
    if (!el) return undefined;
    let raf = 0;
    const paint = () => {
      raf = 0;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      el.style.setProperty("--read", room > 0 ? String(Math.min(1, window.scrollY / room)) : "0");
      el.toggleAttribute("data-scrolled", window.scrollY > 24);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(paint); };
    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const go = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 8, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <DetailContext.Provider value={detail}>
      <div className="site">
        <a href="#main" className="s-skip" onClick={(e) => { e.preventDefault(); const m = document.getElementById("main"); m?.focus(); go("top"); }}>Skip to content</a>
        <header className="s-nav" ref={bar}>
          <a href="/" onClick={(e) => { e.preventDefault(); go("top"); }} className="s-brand" aria-label="AutoSaarthi, back to the top">
            <BrandMark className="h-8 w-8 rounded-[10px]" />
            <span>AutoSaarthi</span>
          </a>
          <button type="button" onClick={() => navigate("/login")} className="s-btn s-btn-brand s-btn-sm s-nav-signin">
            Sign in <span aria-hidden="true">→</span>
          </button>
          <i className="s-nav-read" aria-hidden="true" />
        </header>

        <SectionDock links={LINKS} active={active} hidden={footerShown} reduce={reduce} onGo={go} />

        <main id="main" tabIndex={-1}>
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

          <section id="start" className="s-section s-cta" aria-labelledby="cta-title">
            <div className="s-wrap">
              <div className="s-cta-card">
                <i className="s-cta-orb s-cta-orb-a" aria-hidden="true" />
                <i className="s-cta-orb s-cta-orb-b" aria-hidden="true" />
                <i className="s-cta-orb s-cta-orb-c" aria-hidden="true" />
                <p className="s-eyebrow">Get started</p>
                <h2 id="cta-title" className="s-h2">Keep every car on the road.</h2>
                <p className="s-lead">
                  Sign in to see each car&apos;s health, every warning and every repair in one place — while the AI
                  helpers do the watching.
                </p>
                <div className="s-cta-actions">
                  <button type="button" onClick={() => navigate("/login")} className="s-btn s-btn-light s-btn-shine">
                    Sign in to AutoSaarthi <span aria-hidden="true">→</span>
                  </button>
                  <button type="button" onClick={() => go("journey")} className="s-btn s-btn-outline-light">See how it works</button>
                </div>
                <ul className="s-cta-points">
                  <li>Every action is checked first</li>
                  <li>You approve every repair</li>
                  <li>On your phone and your dashboard</li>
                </ul>
              </div>
            </div>
          </section>
        </main>

        <footer id="footer" className="s-footer">
          <div className="s-wrap">
            <div className="s-footer-grid">
              <div className="s-footer-about">
                <a href="/" onClick={(e) => { e.preventDefault(); go("top"); }} className="s-brand" aria-label="AutoSaarthi, back to the top">
                  <BrandMark className="h-8 w-8 rounded-[10px]" />
                  <span>AutoSaarthi</span>
                </a>
                <p>AI that looks after your car and fixes it before it breaks.</p>
              </div>
              {FOOTER_COLUMNS.map(([title, items]) => (
                <nav key={title} aria-label={title} className="s-footer-col">
                  <p className="s-footer-title">{title}</p>
                  <ul>
                    {items.map(([id, label]) => (
                      <li key={id}><a href={`#${id}`} onClick={(e) => { e.preventDefault(); go(id); }}>{label}</a></li>
                    ))}
                  </ul>
                </nav>
              ))}
              <nav aria-label="Account" className="s-footer-col">
                <p className="s-footer-title">Account</p>
                <ul>
                  <li><a href="/login" onClick={(e) => { e.preventDefault(); navigate("/login"); }}>Sign in</a></li>
                </ul>
              </nav>
            </div>
            <div className="s-footer-base">
              <span>© {new Date().getFullYear()} AutoSaarthi</span>
              <a href="#top" onClick={(e) => { e.preventDefault(); go("top"); }}>Back to top <span aria-hidden="true">↑</span></a>
            </div>
          </div>
        </footer>
      </div>
    </DetailContext.Provider>
  );
}
