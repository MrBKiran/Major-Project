import { signalLabel, SIGNALS } from "@autosaarthi/core";
import { GhostButton, Meta, MONO, SANS, tokens } from "../../device.jsx";
import { useNight } from "../../night.jsx";
import { ScrubChart } from "./ScrubChart.jsx";

const num = (v) => typeof v === "number" && Number.isFinite(v);
const show = (v, unit) => `${v.toFixed(1)}${unit}`;

/**
 * One reading, opened: what it is now, its low, average and high over the window the car reported,
 * and a chart to scrub. Only what the car actually reported is stated. There is no "normal range"
 * here, because the app does not hold one it could stand behind; the way to ask whether a figure is
 * normal is the assistant, which a button below opens with the question already written.
 */
export function ReadingDetail({ signal, rows, onClose, onAsk }) {
  const night = useNight();
  const t = tokens(night);
  const label = signalLabel(signal);
  const unit = SIGNALS[signal]?.unit ?? "";
  const values = rows.map((r) => r[signal]);
  const nums = values.filter(num);
  if (nums.length < 2) return null;

  const low = Math.min(...nums);
  const high = Math.max(...nums);
  const average = nums.reduce((a, b) => a + b, 0) / nums.length;
  const change = nums[nums.length - 1] - nums[0];

  return (
    <div className="pop-in" style={{ marginTop: 14, border: `1px solid ${t.edge}`, borderRadius: 14, padding: 16, background: t.card }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: t.ink }}>{label}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${label.toLowerCase()}`}
          style={{ border: "none", background: "transparent", cursor: "pointer", color: t.dim, fontFamily: SANS, fontSize: 14, padding: "4px 8px", minHeight: 32 }}
        >
          Close
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        <ScrubChart values={values} times={rows.map((r) => r.ts)} unit={unit} label={`${label} over the last 24 hours`} h={72} />
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, margin: "14px 0 0" }}>
        {[["Lowest", low], ["Average", average], ["Highest", high]].map(([name, v]) => (
          <div key={name}>
            <dt><Meta night={night}>{name}</Meta></dt>
            <dd style={{ margin: "2px 0 0", fontFamily: MONO, fontSize: 14, color: t.ink }}>{show(v, unit)}</dd>
          </div>
        ))}
      </dl>
      <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.5, color: t.dim, margin: "12px 0 0" }}>
        {Math.abs(change) < 0.05
          ? `Your ${label.toLowerCase()} has held steady over the window.`
          : `Your ${label.toLowerCase()} is ${change > 0 ? "up" : "down"} ${show(Math.abs(change), unit)} since the window began.`}
      </p>

      {onAsk && (
        <div style={{ marginTop: 12 }}>
          <GhostButton night={night} onClick={() => onAsk(`Is my ${label.toLowerCase()} normal?`)}>Ask about this reading</GhostButton>
        </div>
      )}
    </div>
  );
}
