/** Second step of a sign-in: the code from the authenticator app, or a recovery code. */

import { useState } from "react";
import { ErrorNote, Field, inputCls, submitCls } from "./parts.jsx";

export default function MfaStep({ busy, error, onSubmit, onBack }) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(code.trim());
      }}
      className="animate-in space-y-4"
    >
      <p className="text-[13px] text-slate-400">
        {recovery
          ? "Enter one of your recovery codes. Each works once."
          : "Enter the 6-digit code from your authenticator app."}
      </p>

      <Field label={recovery ? "Recovery code" : "Authenticator code"}>
        <input
          type="text"
          inputMode={recovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          required
          autoFocus
          maxLength={recovery ? 16 : 6}
          value={code}
          onChange={(e) => setCode(recovery ? e.target.value : e.target.value.replace(/\D/g, ""))}
          className={`${inputCls} text-center font-mono text-lg ${recovery ? "tracking-widest" : "tracking-[0.4em]"}`}
          placeholder={recovery ? "xxxxx-xxxxx" : "••••••"}
        />
      </Field>

      <ErrorNote>{error}</ErrorNote>

      <button type="submit" disabled={busy || (!recovery && code.length !== 6)} className={submitCls}>
        {busy ? "Checking…" : "Verify"}
      </button>

      <div className="flex items-center justify-between text-[12px]">
        <button type="button" onClick={onBack} className="text-slate-500 hover:text-slate-300">
          ← back
        </button>
        <button
          type="button"
          onClick={() => { setRecovery((r) => !r); setCode(""); }}
          className="text-slate-500 hover:text-slate-300"
        >
          {recovery ? "Use authenticator app" : "Lost your device? Use a recovery code"}
        </button>
      </div>
    </form>
  );
}
