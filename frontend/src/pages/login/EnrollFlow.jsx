/**
 * Setting up an authenticator app: scan a QR (or type the key), prove it works with one
 * code, then keep the recovery codes.
 *
 * Used in two places: at sign-in, by someone whose role requires a second factor and holds
 * an enrolment-only session, and from the account page. Both go through the same three
 * endpoints, and `onDone` receives the full session the server hands back in the first case
 * (null in the second — that user is already signed in).
 *
 * From the account page the server also wants the account's password before it will start:
 * enrolling changes how the account is protected, and a stolen session alone must not be
 * able to bind someone else's authenticator to it. `currentPassword` carries that. At
 * sign-in there is nothing to pass — the user has just typed it.
 */

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { ErrorNote, Field, ghostCls, inputCls, submitCls } from "./parts.jsx";

export default function EnrollFlow({ onDone, onCancel, currentPassword }) {
  const [stage, setStage] = useState("loading"); // loading | scan | codes
  const [setup, setSetup] = useState(null); // { secret, otpauth_uri }
  const [qr, setQr] = useState(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null); // { recovery_codes, session }
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    api
      .post("/api/auth/mfa/enroll", currentPassword ? { current_password: currentPassword } : undefined)
      .then((res) => live && (setSetup(res), setStage("scan")))
      .catch((e) => live && setError(e.status === 403 ? "That password is not right." : e.message));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!setup) return;
    QRCode.toDataURL(setup.otpauth_uri, { margin: 1, width: 176 }).then(setQr).catch(() => setQr(null));
  }, [setup]);

  async function confirm(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post("/api/auth/mfa/confirm", { code }));
      setStage("codes");
    } catch (err) {
      setError(err.status === 403 ? "That code is not right. Check the time on your phone and try the next one." : err.message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  const codesText = () => (result?.recovery_codes ?? []).join("\n");

  function download() {
    const url = URL.createObjectURL(new Blob([`AutoSaarthi recovery codes\n\n${codesText()}\n`], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "autosaarthi-recovery-codes.txt" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (stage === "loading") {
    return (
      <div className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        {!error && <p className="text-[13px] text-slate-500">Preparing…</p>}
        {onCancel && <button onClick={onCancel} className="text-[12px] text-slate-500 hover:text-slate-300">← back</button>}
      </div>
    );
  }

  if (stage === "codes") {
    return (
      <div className="animate-in space-y-4">
        <p className="text-[13px] text-slate-300">
          Two-step verification is on. Keep these recovery codes somewhere safe — each one signs you in once if you lose your
          phone, and they will not be shown again.
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-edge bg-ink-900 p-3 font-mono text-[13px] text-slate-200">
          {result.recovery_codes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className={ghostCls} onClick={() => navigator.clipboard?.writeText(codesText())}>Copy</button>
          <button type="button" className={ghostCls} onClick={download}>Download</button>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-slate-400">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I have saved these codes
        </label>
        <button disabled={!saved} onClick={() => onDone(result.session)} className={submitCls}>
          Continue
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="animate-in space-y-4">
      <p className="text-[13px] text-slate-400">
        Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the
        6-digit code it shows.
      </p>
      <div className="flex justify-center">
        {qr ? (
          <img src={qr} alt="QR code for your authenticator app" width={176} height={176} className="rounded-lg bg-white p-1" />
        ) : (
          <div className="h-[176px] w-[176px] rounded-lg bg-ink-900" />
        )}
      </div>
      <Field label="Or type this key">
        <code className="block select-all break-all rounded-lg border border-edge bg-ink-900 px-3 py-2 font-mono text-[12px] tracking-wider text-slate-300">
          {setup.secret.match(/.{1,4}/g).join(" ")}
        </code>
      </Field>
      <Field label="Code from the app">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className={`${inputCls} text-center font-mono text-lg tracking-[0.4em]`}
          placeholder="••••••"
        />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <button type="submit" disabled={busy || code.length !== 6} className={submitCls}>
        {busy ? "Checking…" : "Turn on"}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="text-[12px] text-slate-500 hover:text-slate-300">
          ← back
        </button>
      )}
    </form>
  );
}
