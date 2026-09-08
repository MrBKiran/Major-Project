/**
 * Login. Handles the one wrinkle the backend has that a typical login form
 * doesn't: an account can hold more than one membership (see
 * ops@ramanlogistics.example — fleet manager AND a personal vehicle owner),
 * and /api/auth/login returns 400 + the list of choices rather than picking
 * one for you. That response becomes a second step in this same form instead
 * of a separate page, since the user has already authenticated by that point
 * — only which hat they're wearing is still open.
 */

import { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

export default function Login() {
  const { login, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [memberships, setMemberships] = useState(null); // set once disambiguation is needed
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    const res = await login(email, password);
    setBusy(false);
    if (res.needsChoice) {
      setMemberships(res.memberships);
    } else if (!res.ok) {
      setLocalError(res.error || "Login failed");
    }
  }

  async function chooseMembership(m) {
    setBusy(true);
    setLocalError(null);
    const res = await login(email, password, m.org_id, m.role);
    setBusy(false);
    if (!res.ok) setLocalError(res.error || "Login failed");
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07] blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--color-accent), transparent)" }}
      />

      <div className="animate-in relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-lg font-bold text-accent-ink shadow-[0_0_0_1px_rgba(255,74,35,0.22)]">
            A
          </div>
          <h1 className="text-lg font-semibold text-slate-100">AutoSaarthi</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Agentic predictive maintenance — OEM console
          </p>
        </div>

        <div className="rounded-xl border border-edge bg-ink-800/90 p-6 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.25)] backdrop-blur">
          {!memberships ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Email">
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  placeholder="••••••••"
                />
              </Field>

              {(localError || error) && (
                <p className="rounded-lg border border-p1/30 bg-p1/10 px-3 py-2 text-[12px] text-p1">
                  {localError || error}
                </p>
              )}

              <button type="submit" disabled={busy} className={submitCls}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <div className="animate-in space-y-3">
              <p className="text-[13px] text-slate-400">
                This account holds more than one role. Continue as:
              </p>
              {memberships.map((m, i) => (
                <button
                  key={`${m.org_id}:${m.role}`}
                  disabled={busy}
                  onClick={() => chooseMembership(m)}
                  style={{ animationDelay: `${i * 50}ms` }}
                  className="animate-in w-full rounded-lg border border-edge bg-ink-700/60 px-4 py-3 text-left transition duration-150 hover:-translate-y-0.5 hover:border-accent/50 hover:bg-ink-700 active:translate-y-0 disabled:opacity-50"
                >
                  <div className="text-[13px] font-medium text-slate-100">{m.org_name}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-500">
                    {m.role.replace(/_/g, " ")}
                  </div>
                </button>
              ))}
              {(localError || error) && (
                <p className="rounded-lg border border-p1/30 bg-p1/10 px-3 py-2 text-[12px] text-p1">
                  {localError || error}
                </p>
              )}
              <button
                onClick={() => setMemberships(null)}
                className="text-[12px] text-slate-500 hover:text-slate-300"
              >
                ← back
              </button>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] text-slate-600">
          Local demo — every seeded account uses password{" "}
          <code className="rounded bg-ink-800 px-1 py-0.5 font-mono text-slate-400">
            autosaarthi
          </code>
        </p>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-edge bg-ink-900 px-3 py-2 text-[13px] text-slate-100 " +
  "placeholder:text-slate-600 outline-none transition focus:border-accent/60 focus:ring-1 focus:ring-accent/30";

const submitCls =
  "w-full rounded-lg bg-accent-deep px-4 py-2.5 text-sm font-semibold text-white transition duration-150 " +
  "hover:bg-accent/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100";

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}
