/**
 * Sign in.
 *
 * Three ways in — email + password, Google, phone number + code — that all end in the same
 * place on the backend, and so share the same follow-on steps here:
 *
 *   choose   the account holds more than one role (ops@ramanlogistics.example is a fleet
 *            manager AND a personal vehicle owner) and the server returns the list instead
 *            of picking one. The user has already authenticated by then; only which hat
 *            they are wearing is open.
 *   mfa      a second factor is owed: the 6-digit code from an authenticator app, or a
 *            recovery code.
 *   enroll   the role REQUIRES a second factor that is not set up yet. The server has
 *            issued an enrolment-only session; the user sets one up, and finishing that
 *            signs them in.
 *
 * Which methods are offered comes from GET /api/auth/config, so a button never appears for
 * something the deployment cannot do.
 */

import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import GoogleButton from "../auth/GoogleButton.jsx";
import EnrollFlow from "./login/EnrollFlow.jsx";
import MfaStep from "./login/MfaStep.jsx";
import PhoneSignIn from "./login/PhoneSignIn.jsx";
import { ErrorNote, Field, inputCls, submitCls } from "./login/parts.jsx";

const METHOD_LABELS = { password: "Email", phone_otp: "Phone" };

const SUBTITLES = {
  console: "Agentic predictive maintenance — OEM console",
  owner: "Your car's health, and when it needs service",
};

export default function Login({ defaultMethod = "password", surface = "console" }) {
  const auth = useAuth();
  const [config, setConfig] = useState(null);
  const [method, setMethod] = useState(defaultMethod);
  const [stage, setStage] = useState({ name: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get("/api/auth/config")
      .then(setConfig)
      .catch(() => setConfig({ methods: ["password"], google_client_id: null }));
  }, []);

  const methods = config?.methods ?? ["password"];
  const tabs = methods.filter((m) => m !== "google");
  // A default that this deployment does not offer falls back to the first one it does.
  const active = tabs.includes(method) ? method : tabs[0];

  /**
   * Run a sign-in call and route its outcome. `again(membership)` is how the same
   * credential is presented once the user has picked a role.
   */
  async function run(call, again) {
    setBusy(true);
    setError(null);
    const res = await call();
    setBusy(false);
    if (res.ok) return; // AuthContext has moved the app on to the console
    if (res.needsChoice) return setStage({ name: "choose", memberships: res.memberships, again });
    if (res.mfa) return setStage({ name: "mfa", token: res.mfa.token });
    if (res.enroll) return setStage({ name: "enroll" });
    setError(res.error || "Sign-in failed");
  }

  const submitPassword = (e) => {
    e.preventDefault();
    run(
      () => auth.login(email, password),
      (m) => auth.login(email, password, m.org_id, m.role),
    );
  };

  const submitGoogle = (credential) =>
    run(
      () => auth.loginWithGoogle(credential),
      (m) => auth.loginWithGoogle(credential, m.org_id, m.role),
    );

  const submitPhone = (phone, code) =>
    run(
      () => auth.verifyPhoneCode(phone, code),
      (m) => auth.verifyPhoneCode(phone, code, m.org_id, m.role),
    );

  const reset = () => {
    setStage({ name: "credentials" });
    setError(null);
  };

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
          <p className="mt-1 text-[13px] text-slate-500">{SUBTITLES[surface]}</p>
        </div>

        <div className="rounded-xl border border-edge bg-ink-800/90 p-6 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.25)] backdrop-blur">
          {stage.name === "credentials" && (
            <div className="space-y-4">
              {tabs.length > 1 && (
                <div role="tablist" className="grid grid-flow-col gap-1 rounded-lg bg-ink-900 p-1">
                  {tabs.map((m) => (
                    <button
                      key={m}
                      role="tab"
                      aria-selected={active === m}
                      onClick={() => { setMethod(m); setError(null); }}
                      className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                        active === m ? "bg-ink-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {METHOD_LABELS[m] ?? m}
                    </button>
                  ))}
                </div>
              )}

              {active === "phone_otp" ? (
                <PhoneSignIn busy={busy} error={error} onVerify={submitPhone} />
              ) : (
                <form onSubmit={submitPassword} className="space-y-4">
                  <Field label="Email">
                    <input
                      type="email"
                      required
                      autoFocus
                      autoComplete="username"
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
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={inputCls}
                      placeholder="••••••••"
                    />
                  </Field>
                  <ErrorNote>{error}</ErrorNote>
                  <button type="submit" disabled={busy} className={submitCls}>
                    {busy ? "Signing in…" : "Sign in"}
                  </button>
                </form>
              )}

              {methods.includes("google") && config?.google_client_id && (
                <>
                  <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-600">
                    <span className="h-px flex-1 bg-edge" />
                    or
                    <span className="h-px flex-1 bg-edge" />
                  </div>
                  <GoogleButton
                    clientId={config.google_client_id}
                    onCredential={submitGoogle}
                    onError={setError}
                  />
                </>
              )}
            </div>
          )}

          {stage.name === "choose" && (
            <div className="animate-in space-y-3">
              <p className="text-[13px] text-slate-400">This account holds more than one role. Continue as:</p>
              {stage.memberships.map((m, i) => (
                <button
                  key={`${m.org_id}:${m.role}`}
                  disabled={busy}
                  onClick={() => run(() => stage.again(m), stage.again)}
                  style={{ animationDelay: `${i * 50}ms` }}
                  className="animate-in w-full rounded-lg border border-edge bg-ink-700/60 px-4 py-3 text-left transition duration-150 hover:-translate-y-0.5 hover:border-accent/50 hover:bg-ink-700 active:translate-y-0 disabled:opacity-50"
                >
                  <div className="text-[13px] font-medium text-slate-100">{m.org_name}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-500">
                    {m.role.replace(/_/g, " ")}
                  </div>
                </button>
              ))}
              <ErrorNote>{error}</ErrorNote>
              <button onClick={reset} className="text-[12px] text-slate-500 hover:text-slate-300">
                ← back
              </button>
            </div>
          )}

          {stage.name === "mfa" && (
            <MfaStep
              busy={busy}
              error={error}
              onBack={reset}
              onSubmit={(code) => run(() => auth.verifyMfa(stage.token, code))}
            />
          )}

          {stage.name === "enroll" && (
            <div className="space-y-4">
              <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-[12px] text-slate-300">
                Your role requires two-step verification. Set it up to finish signing in.
              </p>
              <EnrollFlow
                onCancel={async () => { await auth.logout(); reset(); }}
                onDone={(session) => (session ? auth.completeSession(session) : reset())}
              />
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] text-slate-600">
          Local demo — every seeded account uses password{" "}
          <code className="rounded bg-ink-800 px-1 py-0.5 font-mono text-slate-400">autosaarthi</code>
        </p>
      </div>
    </div>
  );
}
