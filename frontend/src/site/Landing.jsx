/**
 * The public site: AutoSaarthi shown working, in daylight.
 *
 * Signed-out visitors land here (App.jsx); sign-in is a button away at /login.
 * The first screen is the product itself — a live run of the agents on a real
 * car (LiveRun) — and the page then walks one reading to a repair (Journey),
 * shows who is allowed to do what (Agents), lets the visitor attack it (Shield)
 * and ends on the three screens it runs on (Screens).
 *
 * Everything that matters is real HTML; the 3D car is decoration with a drawn
 * fallback. The page keeps its own palette (site.css) whatever the app's theme.
 */

import "@fontsource/space-grotesk/300.css";
import { useEffect, useState } from "react";
import { reducedMotion } from "../fx/gsap.js";
import { navigate } from "../route.js";
import { BrandMark } from "../ui.jsx";
import Agents from "./Agents.jsx";
import Journey from "./Journey.jsx";
import LiveRun from "./LiveRun.jsx";
import Screens from "./Screens.jsx";
import Shield from "./Shield.jsx";
import "./site.css";

const LINKS = [
  ["journey", "How it works"],
  ["agents", "Agents"],
  ["security", "Security"],
  ["screens", "Screens"],
];

const FACTS = [
  ["9 days", "before a warning light would come on"],
  ["6", "worker agents under one planner"],
  ["38", "tools, each behind a policy check"],
  ["5 of 5", "red-team attacks blocked"],
];

export default function Landing() {
  const [active, setActive] = useState(null);
  const reduce = reducedMotion();

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
    for (const [id] of LINKS) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    const top = document.getElementById("top");
    if (top) io.observe(top);
    return () => io.disconnect();
  }, []);

  const go = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 8, behavior: reduce ? "auto" : "smooth" });
  };

  return (
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
        <section id="top" className="s-hero" aria-labelledby="hero-title">
          <div className="s-wrap">
            <p className="s-chip"><i className="s-dot" data-tone="green" />Agentic predictive maintenance for cars</p>
            <h1 id="hero-title" className="s-h1">
              <span className="s-h1-line" style={{ "--i": 0 }}>Fix it before</span>
              <span className="s-h1-line s-h1-soft" style={{ "--i": 1 }}>it breaks.</span>
            </h1>
            <div className="s-hero-row">
              <p className="s-lead s-hero-lead">
                AutoSaarthi listens to every car&apos;s sensors, works out which part is failing and when, calls the
                owner, books a real slot — and tells the plant what to fix. Below, it is doing exactly that.
              </p>
              <div className="s-hero-cta">
                <button type="button" onClick={() => go("journey")} className="s-btn s-btn-ink">See how it works</button>
                <button type="button" onClick={() => navigate("/login")} className="s-btn s-btn-line">Sign in to the console</button>
              </div>
            </div>
          </div>
          <div className="s-wrap s-wrap-wide">
            <LiveRun />
          </div>
          <div className="s-wrap">
            <ul className="s-facts">
              {FACTS.map(([k, v]) => <li key={k}><b>{k}</b><span>{v}</span></li>)}
            </ul>
          </div>
        </section>

        <Journey />
        <Agents />
        <Shield />
        <Screens />

        <section className="s-section s-cta" aria-labelledby="cta-title">
          <div className="s-wrap">
            <div className="s-cta-card">
              <p className="s-eyebrow">Ready when your fleet is</p>
              <h2 id="cta-title" className="s-h2">Watch it work on live data.</h2>
              <p className="s-lead">
                Sign in to the console to follow the agents across the whole fleet, or open the owner app the way a
                driver would.
              </p>
              <div className="s-cta-actions">
                <button type="button" onClick={() => navigate("/login")} className="s-btn s-btn-light">Sign in to the console</button>
                <a href="/app" className="s-btn s-btn-outline-light">Open the owner app</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="s-footer">
        <div className="s-wrap">
          <span className="s-brand"><BrandMark className="h-6 w-6 rounded-md" /><span>AutoSaarthi</span></span>
          <span>Techathon 6.0 · Challenge III, Automotive</span>
        </div>
      </footer>
    </div>
  );
}
