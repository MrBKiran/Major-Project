/**
 * Account & security — change your password, manage two-step verification.
 *
 * Available to every signed-in user; what it offers follows what the server says about
 * their account (GET /api/auth/mfa) rather than guessing from the role. Two rules worth
 * knowing when reading it:
 *
 *   * Changing the password signs every OTHER session out (the usual reason to change it
 *     is "someone else may have it") and hands back a fresh token for this one — so a
 *     successful change replaces the session instead of ending it.
 *   * A role that requires two-step verification cannot switch it off; the button is not
 *     offered, and the server refuses if it is asked anyway.
 */

import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { Badge, Card } from "../ui.jsx";
import EnrollFlow from "./login/EnrollFlow.jsx";
import { ErrorNote, Field, InfoNote, ghostCls, inputCls, submitCls } from "./login/parts.jsx";

export default function Account() {
  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <PasswordCard />
      <TwoStepCard />
    </div>
  );
}

function PasswordCard() {
  const { completeSession } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState([]);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setReasons([]);
    setDone(false);
    if (next !== again) return setError("The two new passwords do not match.");
    setBusy(true);
    try {
      completeSession(await api.post("/api/auth/password/change", { current_password: current, new_password: next }));
      setCurrent("");
      setNext("");
      setAgain("");
      setDone(true);
    } catch (err) {
      if (err.status === 422 && err.body?.reasons) {
        setError("That password is not acceptable:");
        setReasons(err.body.reasons);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Password" subtitle="Changing it signs you out everywhere else.">
      <form onSubmit={submit} className="space-y-4 px-5 py-4">
        <Field label="Current password">
          <input type="password" required autoComplete="current-password" value={current}
            onChange={(e) => setCurrent(e.target.value)} className={inputCls} />
        </Field>
        <Field label="New password" hint="At least 10 characters. A few random words is stronger than symbols.">
          <input type="password" required autoComplete="new-password" value={next}
            onChange={(e) => setNext(e.target.value)} className={inputCls} />
        </Field>
        <Field label="New password again">
          <input type="password" required autoComplete="new-password" value={again}
            onChange={(e) => setAgain(e.target.value)} className={inputCls} />
        </Field>

        <ErrorNote>
          {error}
          {reasons.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {reasons.map((r) => <li key={r}>It {r}.</li>)}
            </ul>
          )}
        </ErrorNote>
        {done && <InfoNote>Password changed. Your other sessions have been signed out.</InfoNote>}

        <button type="submit" disabled={busy} className={`${submitCls} sm:w-auto sm:px-6`}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </Card>
  );
}

function TwoStepCard() {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState("view"); // view | confirm | enroll | disable | codes | show
  const [code, setCode] = useState("");
  const [password, setPassword] = useState(""); // re-entered before enrolling; never stored
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fresh, setFresh] = useState(null); // regenerated recovery codes

  const load = () => api.get("/api/auth/mfa").then(setStatus).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function withCode(path, then) {
    setBusy(true);
    setError(null);
    try {
      then(await api.post(path, { code }));
      setCode("");
    } catch (err) {
      setError(err.status === 403 ? "That code is not right." : err.message);
    } finally {
      setBusy(false);
    }
  }

  const done = () => { setMode("view"); setCode(""); setPassword(""); setError(null); load(); };

  if (!status) {
    return <Card title="Two-step verification"><p className="px-5 py-4 text-[13px] text-slate-500">{error || "Loading…"}</p></Card>;
  }

  return (
    <Card
      title="Two-step verification"
      subtitle="A code from an authenticator app, asked for after your password."
      right={<Badge tone={status.enrolled ? "good" : "slate"}>{status.enrolled ? "on" : "off"}</Badge>}
    >
      <div className="space-y-4 px-5 py-4">
        {mode === "confirm" && (
          <form onSubmit={(e) => { e.preventDefault(); setMode("enroll"); }} className="space-y-3">
            <p className="text-[13px] text-slate-400">
              Confirm your password to continue — setting this up changes how your account is protected.
            </p>
            <Field label="Password">
              <input type="password" required autoFocus autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            </Field>
            <div className="flex gap-2">
              <button type="submit" className={`${submitCls} sm:w-auto sm:px-6`}>Continue</button>
              <button type="button" className={ghostCls} onClick={done}>Cancel</button>
            </div>
          </form>
        )}

        {mode === "enroll" && (
          <EnrollFlow currentPassword={password || undefined} onCancel={done} onDone={done} />
        )}

        {mode === "view" && !status.enrolled && (
          <>
            <p className="text-[13px] text-slate-400">
              {status.required
                ? "Your role requires two-step verification."
                : "Adds a second check to your sign-in, so a stolen password is not enough."}
            </p>
            <button
              onClick={() => setMode(status.has_password ? "confirm" : "enroll")}
              className={`${submitCls} sm:w-auto sm:px-6`}
            >
              Set up
            </button>
          </>
        )}

        {mode === "view" && status.enrolled && (
          <>
            <p className="text-[13px] text-slate-400">
              You have {status.recovery_codes_remaining} recovery code{status.recovery_codes_remaining === 1 ? "" : "s"} left.
              {status.recovery_codes_remaining <= 3 && " Consider generating new ones."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button className={ghostCls} onClick={() => setMode("codes")}>New recovery codes</button>
              {!status.required && <button className={ghostCls} onClick={() => setMode("disable")}>Turn off</button>}
            </div>
          </>
        )}

        {(mode === "disable" || mode === "codes") && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === "disable") withCode("/api/auth/mfa/disable", done);
              else withCode("/api/auth/mfa/recovery-codes", (r) => { setFresh(r.recovery_codes); setMode("show"); load(); });
            }}
            className="space-y-3"
          >
            <Field label="Code from your authenticator app">
              <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className={`${inputCls} max-w-[12rem] text-center font-mono text-lg tracking-[0.4em]`} />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <div className="flex gap-2">
              <button type="submit" disabled={busy || code.length !== 6} className={`${submitCls} sm:w-auto sm:px-6`}>
                {mode === "disable" ? "Turn off" : "Generate"}
              </button>
              <button type="button" className={ghostCls} onClick={done}>Cancel</button>
            </div>
          </form>
        )}

        {mode === "show" && fresh && (
          <div className="space-y-3">
            <p className="text-[13px] text-slate-300">Your new recovery codes. The old ones no longer work, and these will not be shown again.</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-edge bg-ink-900 p-3 font-mono text-[13px] text-slate-200">
              {fresh.map((c) => <span key={c}>{c}</span>)}
            </div>
            <div className="flex gap-2">
              <button className={ghostCls} onClick={() => navigator.clipboard?.writeText(fresh.join("\n"))}>Copy</button>
              <button className={ghostCls} onClick={() => { setFresh(null); done(); }}>Done</button>
            </div>
          </div>
        )}

        {mode === "view" && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Card>
  );
}
