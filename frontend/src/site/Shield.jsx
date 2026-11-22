import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "../fx/gsap.js";
import { ATTACKS } from "./content.js";

/**
 * The security layer, hands-on: fire any of the five red-team attacks and watch
 * the guard refuse it and chain it into the log. It replays the suite the
 * backend tests run (verify_policy_nodeps.py); the hashes here are computed in
 * the page — each one covers the one before, the same shape as the real
 * AuditLog — so tampering with any line would break every line after it.
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

export default function Shield() {
  const [log, setLog] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [busy, setBusy] = useState(null);
  const tail = useRef(GENESIS);
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
    const lines = [
      { kind: "try", text: attack.attempt, id: attack.id },
      { kind: "block", text: attack.verdict, id: attack.id },
      { kind: "chain", text: `chained ${short(hash)} ← ${short(prev)}`, id: attack.id },
    ];
    const gap = reduce ? 0 : 520;
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
    setLog([]);
    setBlocked([]);
    setBusy(null);
  };

  return (
    <section id="security" className="s-section s-shield" aria-labelledby="shield-title">
      <div className="s-wrap s-shield-grid">
        <div className="s-shield-copy">
          <p className="s-eyebrow">Protect</p>
          <h2 id="shield-title" className="s-h2">Every move is policed.</h2>
          <p className="s-lead">
            Each tool call is checked against policy, behaviour and intent before it runs, then written to a
            hash-chained log that cannot be quietly edited. Try to break it.
          </p>
          <p className="s-shield-count" aria-live="polite">
            <b>{blocked.length}</b><span> of {ATTACKS.length} attacks blocked</span>
          </p>
        </div>

        <div className="s-console">
          <div className="s-console-bar">
            <span className="s-console-lights" aria-hidden="true"><i /><i /><i /></span>
            <span>ueba · guard · audit log</span>
            <button type="button" onClick={reset} disabled={!log.length || Boolean(busy)}>Reset</button>
          </div>
          <div className="s-console-attacks" role="group" aria-label="Red-team attacks">
            {ATTACKS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => fire(a)}
                disabled={Boolean(busy)}
                data-done={blocked.includes(a.id) ? "true" : undefined}
              >
                <span>{a.id}</span>
                <b>{a.name}</b>
                <em>{blocked.includes(a.id) ? "Blocked" : "Fire"}</em>
              </button>
            ))}
          </div>
          <ol ref={list} className="s-console-log" aria-label="Audit log" aria-live="polite">
            {!log.length && <li className="s-console-empty">Pick an attack above. Nothing here is real traffic — it replays the red-team suite.</li>}
            {log.map((l) => (
              <li key={l.key} data-kind={l.kind}>
                <span>{l.kind === "try" ? "→" : l.kind === "block" ? "✕" : "⛓"}</span>
                <p>{l.kind === "block" ? <><b>Blocked</b> · {l.text}</> : l.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
