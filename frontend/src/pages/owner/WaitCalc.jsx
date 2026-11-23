import { color } from "@autosaarthi/tokens";
import { formatDays } from "@autosaarthi/core";
import { useId, useState } from "react";
import { Meta, MONO, SANS, tokens } from "../../device.jsx";
import { Ticker } from "../../fx";
import { useNight } from "../../night.jsx";
import { Segmented } from "./Segmented.jsx";

/**
 * "What if I wait?": the owner's decision, played out with their own numbers.
 *
 * The warning card states the repair and the breakdown figures. This lets the owner move along the
 * days between them and watch the bill change: before the predicted failure the repair costs what it
 * costs (but the car is a gamble); past it, the breakdown price is what is waiting. They reach the
 * conclusion themselves instead of being told it. Every figure is the server's pair and its predicted
 * days; nothing here is invented, and it is plain about being a prediction, not a promise.
 */
export function WaitCalc({ economics, days }) {
  const night = useNight();
  const t = tokens(night);
  const id = useId();
  const failsIn = Math.max(1, Math.round(days));
  // Room beyond the predicted day, so "too late" is somewhere to drag to.
  const span = Math.min(60, Math.max(7, Math.ceil(failsIn * 1.6)));
  const [mode, setMode] = useState("wait");
  const [waitDays, setWaitDays] = useState(failsIn);

  const { repair_inr: repair, breakdown_inr: breakdown } = economics;
  const late = mode === "wait" && waitDays >= failsIn;
  const total = mode === "now" || !late ? repair : breakdown;
  const extra = breakdown - repair;
  const at = (n) => `${(n / span) * 100}%`;

  return (
    <div style={{ border: `1px solid ${t.edge}`, borderRadius: 14, padding: 16, background: t.card }}>
      <Meta night={night}>What if I wait?</Meta>
      <div style={{ marginTop: 10 }}>
        <Segmented
          label="When to fix it"
          value={mode}
          onChange={setMode}
          options={[{ value: "now", label: "Fix it now" }, { value: "wait", label: "Wait" }]}
        />
      </div>

      {mode === "wait" && (
        <div style={{ marginTop: 16 }}>
          <label htmlFor={id} style={{ display: "flex", justifyContent: "space-between", fontFamily: SANS, fontSize: 13, color: t.dim }}>
            <span>If I put it off for</span>
            <span style={{ color: t.ink, fontWeight: 600 }}>{waitDays === 0 ? "no time" : formatDays(waitDays)}</span>
          </label>
          <div style={{ position: "relative", marginTop: 10 }}>
            {/* The track is the days ahead: safe up to the predicted day, a breakdown after it. */}
            <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 9, height: 6, borderRadius: 99, overflow: "hidden", display: "flex" }}>
              <span style={{ width: at(failsIn), background: t.okBorder }} />
              <span style={{ flex: 1, background: t.pillBg }} />
            </div>
            <span
              aria-hidden="true"
              style={{ position: "absolute", top: 4, left: at(failsIn), width: 2, height: 16, background: color.p1, borderRadius: 2 }}
            />
            <input
              id={id}
              type="range"
              min={0}
              max={span}
              step={1}
              value={waitDays}
              onChange={(e) => setWaitDays(Number(e.target.value))}
              aria-valuetext={`${waitDays === 0 ? "no time" : formatDays(waitDays)} from now`}
              className="wait-range"
              style={{ position: "relative", width: "100%", margin: 0, height: 24 }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: SANS, fontSize: 11, color: t.faint }}>
            <span>today</span>
            <span>expected to fail in {formatDays(failsIn)}</span>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontFamily: SANS, fontSize: 14, color: t.dim }}>{late ? "You would pay" : "You pay"}</span>
        <Ticker
          value={total}
          style={{ fontFamily: MONO, fontSize: 27, fontWeight: 600, color: late ? t.pillInk : t.ink }}
        />
      </div>

      <p aria-live="polite" style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.5, color: t.dim, margin: "8px 0 0" }}>
        {mode === "now" && "Once, at a time that suits you, and the car stays on the road."}
        {mode === "wait" && !late && "The repair price does not change, but the part is wearing: every day is a bet that it holds."}
        {late && (
          <>
            Past the day it is expected to fail, a breakdown is what is waiting: that is{" "}
            <strong style={{ color: t.ink }}><Ticker value={extra} /></strong> more than fixing it now.
          </>
        )}
      </p>
      <p style={{ fontFamily: SANS, fontSize: 11, color: t.faint, margin: "10px 0 0" }}>
        A prediction from your car's readings, not a promise. It could be sooner.
      </p>
    </div>
  );
}
