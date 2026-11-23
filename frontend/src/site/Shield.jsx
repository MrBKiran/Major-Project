import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "../fx/gsap.js";
import { ATTACKS } from "./content.js";
import { DetailToggle, useDetail } from "./detail.jsx";

/**
 * The security guard, hands-on: try any of the five practice attacks and watch
 * it get stopped and written down. These replay the suite the backend tests run
 * (verify_policy_nodeps.py). Each log entry carries a fingerprint (hash) of the
 * entry before it, the same shape as the real AuditLog — so quietly deleting or
 * editing one entry would break every entry after it. Plain mode says that in
 * words; technical mode shows the fingerprints themselves.
 */

// FNV-1a, twice: enough to show a chain that changes when its input does.
function fnv(s, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
const chainHash = (prev, text) => fnv(prev + text) + fnv(text + prev, 0x9747b28c);
const short = (h) => `${h.slice(0, 4)}…${h.slice(-3)}`;

const GENESIS = "81be4d0c11a9cf04";

/**
 * The guard as a picture: one segment of the ring per attack, each lighting up as it is stopped, a
 * shield in the middle that fills when all are. Rings ping outwards all the time, red while an attack is
 * being checked. Decoration: the count beside it says the same in words.
 */
function Guard({ total, done, busy }) {
  const step = 360 / total;
  const at = (deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(60 + 52 * Math.cos(a)).toFixed(2)} ${(60 + 52 * Math.sin(a)).toFixed(2)}`;
  };
  return (
    <svg className="s-guard" viewBox="0 0 120 120" aria-hidden="true" data-busy={busy ? "true" : undefined} data-all={done >= total ? "true" : undefined}>
      <circle className="s-guard-ring" cx="60" cy="60" r="40" />
      <circle className="s-guard-ring s-guard-ring-2" cx="60" cy="60" r="40" />
      {Array.from({ length: total }, (_, i) => (
        <path
          key={i}
          className="s-guard-seg"
          d={`M ${at(i * step + 7)} A 52 52 0 0 1 ${at((i + 1) * step - 7)}`}
          data-on={i < done ? "true" : undefined}
        />
      ))}
      <path className="s-guard-shield" d="M60 32 L82 40 V60 C82 74 72 84 60 90 C48 84 38 74 38 60 V40 Z" />
      <path className="s-guard-tick" d="M49 60 L57 68 L72 51" />
    </svg>
  );
}

export default function Shield() {
  const { on: tech } = useDetail();
  const [log, setLog] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [busy, setBusy] = useState(null);
  const tail = useRef(GENESIS);
  const count = useRef(0);
  const timers = useRef([]);
  const list = useRef(null);
  const reduce = reducedMotion();

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const fire = (attack) => {
    if (busy) return;
    setBusy(attack.id);
    const prev = tail.current;
    const hash = chainHash(prev, attack.id + attack.attempt);
    tail.current = hash;
    count.current += 1;
    const entry = count.current;
    const lines = [
      { kind: "try", attack, entry },
      { kind: "block", attack, entry },
      { kind: "chain", attack, entry, hash, prev },
    ];
    const gap = reduce ? 0 : 600;
    lines.forEach((line, i) => {
      timers.current.push(window.setTimeout(() => {
        setLog((l) => [...l, { ...line, key: `${attack.id}-${l.length}` }]);
        if (i === lines.length - 1) {
          setBlocked((b) => (b.includes(attack.id) ? b : [...b, attack.id]));
          setBusy(null);
        }
      }, gap * i));
    });
  };

  const reset = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    tail.current = GENESIS;
    count.current = 0;
    setLog([]);
    setBlocked([]);
    setBusy(null);
  };

  const say = (l) => {
    const a = l.attack;
    if (l.kind === "try") return tech ? `${a.id} · ${a.tech.attempt}` : a.attempt;
    if (l.kind === "block") return <><b>Stopped.</b> {tech ? a.tech.verdict : a.verdict}</>;
    return tech
      ? `audit entry ${short(l.hash)} ← ${short(l.prev)}`
      : `Written to the log as entry ${l.entry}, sealed to the one before it.`;
  };

  return (
    <section id="security" className="s-section s-shield" aria-labelledby="shield-title">
      <div className="s-wrap s-shield-grid">
        <div className="s-shield-copy">
          <p className="s-eyebrow">Safety</p>
          <h2 id="shield-title" className="s-h2">Every action is checked first.</h2>
          <p className="s-lead">
            Before any helper does anything, a security guard checks it against that helper&apos;s rules and its
            usual behaviour. Anything out of place is stopped and written to a log that nobody can quietly change.
            Try it: pick an attack.
          </p>
          <div className="s-shield-status">
            <Guard total={ATTACKS.length} done={blocked.length} busy={Boolean(busy)} />
            <p className="s-shield-count" aria-live="polite">
              <b>{blocked.length}</b><span> of {ATTACKS.length} attacks stopped</span>
            </p>
          </div>
          <DetailToggle dark />
        </div>

        <div className="s-console">
          <div className="s-console-bar">
            <span className="s-console-lights" aria-hidden="true"><i /><i /><i /></span>
            <span>{tech ? "ueba · guard · audit log" : "Security log"}</span>
            <button type="button" onClick={reset} disabled={!log.length || Boolean(busy)}>Clear</button>
          </div>
          <div className="s-console-attacks" role="group" aria-label="Attacks to try">
            {ATTACKS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => fire(a)}
                disabled={Boolean(busy)}
                data-done={blocked.includes(a.id) ? "true" : undefined}
              >
                <b>{a.name}</b>
                {tech && <span>{a.id} · {a.tech.name}</span>}
                <em>{blocked.includes(a.id) ? "Stopped ✓" : "Try it →"}</em>
              </button>
            ))}
          </div>
          <ol ref={list} className="s-console-log" aria-label="Security log" aria-live="polite">
            {!log.length && (
              <li className="s-console-empty">
                Pick an attack above to see what happens. These attacks are simulated — no real cars or customers
                are involved.
              </li>
            )}
            {log.map((l) => (
              <li key={l.key} data-kind={l.kind}>
                <span aria-hidden="true">{l.kind === "try" ? "→" : l.kind === "block" ? "✕" : "▣"}</span>
                <p>{say(l)}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
