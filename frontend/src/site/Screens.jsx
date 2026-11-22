import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect, useRef } from "react";
import { gsap, reducedMotion } from "../fx/gsap.js";

gsap.registerPlugin(ScrollTrigger);

/**
 * One system, three screens — the real surfaces, drawn small: the owner's
 * phone, the car's head unit, and the console the service and plant teams use.
 * They arrive stacked like a deck and fan out as the section scrolls in.
 */

function OwnerPhone() {
  return (
    <div className="s-mini-phone">
      <div className="s-mini-status"><span>9:41</span><i /></div>
      <p className="s-mini-k">My car</p>
      <b className="s-mini-title">Bolero · MH12AB1001</b>
      <div className="s-mini-alert">
        <span className="s-mini-pill" data-tone="amber">Soon · 10 days</span>
        <b>Your water pump is wearing out</b>
        <dl>
          <div><dt>Repair now</dt><dd>₹2,400</dd></div>
          <div><dt>If it fails on the road</dt><dd data-tone="rose">₹18,500</dd></div>
        </dl>
        <span className="s-mini-btn">Book a service</span>
      </div>
      <div className="s-mini-ok"><i className="s-dot" data-tone="green" />Oil, battery, brakes read normal</div>
    </div>
  );
}

function HeadUnit() {
  return (
    <div className="s-mini-dash">
      <div className="s-mini-dash-bar"><span>5:18</span><span>MH12AB1001 · 1,28,400 km</span><span>Pune</span></div>
      <div className="s-mini-dash-banner"><span className="s-mini-pill" data-tone="amber">Soon</span>Water pump service booked for Mon 23 Nov, 9:00 am</div>
      <div className="s-mini-dash-body">
        <div className="s-mini-map" aria-hidden="true"><i /><i /><i /></div>
        <div className="s-mini-voice">
          <span className="s-wave s-wave-sm" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 6) * 110}ms` }} />)}</span>
          <b>Agent speaking</b>
          <span>Booking waits until the car is parked</span>
        </div>
      </div>
    </div>
  );
}

// The demo fleet's own predictions, soonest first.
const ROWS = [
  ["Thar", "KA03KL1008", "Oil pump", "1.6 d", "P1", "rose"],
  ["Thar Roxx", "KA05XY1009", "Brake pads", "7.3 d", "P2", "amber"],
  ["Scorpio Classic", "GJ01EF1005", "Water pump", "9.4 d", "P2", "amber"],
  ["Bolero", "MH12AB1001", "Water pump", "10.3 d", "P2", "amber"],
  ["XUV300", "TS09IJ1007", "Battery", "14.5 d", "P2", "amber"],
];

function Console() {
  return (
    <div className="s-mini-console">
      <div className="s-mini-console-side" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="s-mini-console-main">
        <b className="s-mini-title">Fleet monitoring</b>
        <div className="s-mini-kpis">
          <div><span>In scope</span><b>10</b></div>
          <div data-tone="rose"><span>Urgent</span><b>1</b></div>
          <div data-tone="amber"><span>To watch</span><b>7</b></div>
          <div data-tone="green"><span>Healthy</span><b>2</b></div>
        </div>
        <table>
          <tbody>
            {ROWS.map(([model, vin, part, eta, sev, tone]) => (
              <tr key={vin}>
                <td><b>{model}</b><span>{vin}</span></td>
                <td>{part}</td>
                <td>{eta}</td>
                <td><span className="s-mini-pill" data-tone={tone}>{sev}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CARDS = [
  { id: "owner", tone: "teal", title: "Owner app", sub: "For drivers. What's wrong, what it costs, one tap to book.", Screen: OwnerPhone },
  { id: "car", tone: "amber", title: "In-car console", sub: "Speaks while you drive; shows nothing to tap until you park.", Screen: HeadUnit },
  { id: "console", tone: "blue", title: "Fleet & OEM console", sub: "For service centres and the plant: every car, most urgent first.", Screen: Console },
];

export default function Screens() {
  const root = useRef(null);

  useLayoutEffect(() => {
    // The fan only reads when the three sit side by side; stacked, they just arrive.
    const sideBySide = window.matchMedia?.("(min-width: 1021px)").matches ?? false;
    if (!root.current || /jsdom/i.test(navigator.userAgent) || reducedMotion() || !sideBySide) return undefined;
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray(".s-screen");
      const mid = (cards.length - 1) / 2;
      gsap.from(cards, {
        xPercent: (i) => (mid - i) * 100,
        rotation: (i) => (i - mid) * -7,
        y: 80,
        ease: "none",
        scrollTrigger: { trigger: root.current, start: "top 85%", end: "top 25%", scrub: 0.6 },
      });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section id="screens" ref={root} className="s-section s-screens" aria-labelledby="screens-title">
      <div className="s-wrap">
        <div className="s-head s-head-center">
          <p className="s-eyebrow">One system</p>
          <h2 id="screens-title" className="s-h2">Three screens. One story.</h2>
          <p className="s-lead">The same run, seen by the driver, the car and the people who fix it.</p>
        </div>
        <div className="s-screens-row">
          {CARDS.map(({ id, tone, title, sub, Screen }) => (
            <figure key={id} className="s-screen" data-tone={tone}>
              <div className="s-screen-stage"><Screen /></div>
              <figcaption><b>{title}</b><span>{sub}</span></figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
