/**
 * Sign in with a phone number and a six-digit code.
 *
 * The server answers a code request the same way for every number — registered or not —
 * so the wording here is "if this number is registered" and never "we sent a code". That
 * is deliberate, not evasiveness: a screen that said otherwise would tell anyone who typed
 * a number whether it belongs to a customer.
 */

import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { ErrorNote, Field, InfoNote, ghostCls, inputCls, submitCls } from "./parts.jsx";

export default function PhoneSignIn({ busy, error, onVerify }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState(false);
  const [sending, setSending] = useState(false);
  const [wait, setWait] = useState(0); // seconds until another code may be requested
  const [localError, setLocalError] = useState(null);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function requestCode(e) {
    e?.preventDefault();
    setSending(true);
    setLocalError(null);
    try {
      const res = await api.post("/api/auth/otp/request", { phone });
      setRequested(true);
      setWait(res.resend_after ?? 30);
    } catch (err) {
      if (err.status === 429 && err.retryAfter) setWait(err.retryAfter);
      setLocalError(err.status === 422 ? "Enter a mobile number that can receive an SMS." : err.message);
    } finally {
      setSending(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    onVerify(phone, code);
  }

  return (
    <form onSubmit={requested ? submit : requestCode} className="space-y-4">
      <Field label="Mobile number" hint="The number your dealer has on file, e.g. 98765 43210">
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          autoFocus
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={requested}
          className={inputCls}
          placeholder="+91 98765 43210"
        />
      </Field>

      {requested && (
        <>
          <InfoNote>
            If this number is registered, a 6-digit code is on its way. It stays valid for a few minutes.
          </InfoNote>
          <Field label="Code">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className={`${inputCls} text-center font-mono text-title-sm tracking-[0.4em]`}
              placeholder="••••••"
            />
          </Field>
        </>
      )}

      <ErrorNote>{localError || error}</ErrorNote>

      <button type="submit" disabled={busy || sending || (requested && code.length !== 6)} className={submitCls}>
        {requested ? (busy ? "Checking…" : "Sign in") : sending ? "Sending…" : "Send code"}
      </button>

      {requested && (
        <div className="flex items-center justify-between text-label">
          <button type="button" onClick={() => { setRequested(false); setCode(""); }} className="text-fg-muted hover:text-fg-secondary">
            ← different number
          </button>
          <button type="button" disabled={wait > 0 || sending} onClick={requestCode} className={ghostCls}>
            {wait > 0 ? `Resend in ${wait}s` : "Resend code"}
          </button>
        </div>
      )}
    </form>
  );
}
