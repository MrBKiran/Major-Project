/**
 * Auth state for the whole app. One source of truth for "who is logged in,
 * what may they do" — pages read `principal.permissions` to decide what to
 * show rather than hardcoding role names, so a new role or permission on the
 * backend doesn't require finding every place the frontend guessed at it.
 *
 * Every way of signing in (password, Google, phone code) ends in the same place on
 * the backend, and so ends in the same place here: `handleSignIn` turns whatever the
 * server answered into one of four outcomes —
 *
 *   { ok: true }                    signed in
 *   { needsChoice, memberships }    the account holds several roles; pick one
 *   { mfa: { token } }              a second factor is owed (HTTP 202)
 *   { enroll: true }                the role requires a second factor that is not set
 *                                   up yet; the token held is enrolment-only
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, getToken, setToken, setUnauthorizedHandler } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // "loading" | "authed" | "anon" — distinct from a boolean so the app can
  // show a blank screen instead of a login-flash while the token is verified.
  const [status, setStatus] = useState("loading");
  const [principal, setPrincipal] = useState(null);
  const [error, setError] = useState(null);

  const loadMe = useCallback(async () => {
    try {
      const me = await api.get("/api/auth/me");
      setPrincipal(me);
      setStatus("authed");
    } catch {
      setToken(null);
      setPrincipal(null);
      setStatus("anon");
    }
  }, []);

  useEffect(() => {
    // A 401 from ANY page's fetch means the same thing: the session is gone
    // (expired, or revoked via logout/admin action on another device). Route
    // it through the same path a manual logout would take, rather than
    // leaving stale principal state around while individual pages show
    // separate "please log in" errors.
    setUnauthorizedHandler(() => {
      setToken(null);
      setPrincipal(null);
      setStatus("anon");
    });
    if (getToken()) loadMe();
    else setStatus("anon");
  }, [loadMe]);

  /** Adopt a finished session (a TokenResponse). */
  const completeSession = useCallback((res) => {
    setToken(res.access_token);
    setPrincipal(res.principal);
    setStatus("authed");
  }, []);

  /** Turn a sign-in response into one of the outcomes described above. */
  const handleSignIn = useCallback(
    (res) => {
      if (res.mfa_required) return { ok: false, mfa: { token: res.mfa_token } };
      if (res.next_step === "mfa_enroll") {
        // Held so the enrolment calls carry it — but NOT adopted as a session: it can
        // do nothing else, and a page reload should not resurrect a half sign-in.
        setToken(res.access_token);
        return { ok: false, enroll: true };
      }
      completeSession(res);
      return { ok: true };
    },
    [completeSession],
  );

  /** Wrap a sign-in call: the 400 that means "pick a role" is a step, not an error. */
  const attempt = useCallback(
    async (call) => {
      setError(null);
      try {
        return handleSignIn(await call());
      } catch (e) {
        if (e instanceof ApiError && e.status === 400 && e.body?.memberships) {
          // e.body is the unwrapped `detail` value (see api.js), so this is
          // {"error": "...", "memberships": [...]} — the shape the backend's
          // 400 actually sends, not the outer {"detail": ...} envelope.
          return { ok: false, needsChoice: true, memberships: e.body.memberships };
        }
        const message = e.message || "sign-in failed";
        setError(message);
        return { ok: false, error: message, retryAfter: e.retryAfter };
      }
    },
    [handleSignIn],
  );

  const login = useCallback(
    (email, password, orgId, role) =>
      attempt(() => api.post("/api/auth/login", { email, password, org_id: orgId, role })),
    [attempt],
  );

  const loginWithGoogle = useCallback(
    (credential, orgId, role) =>
      attempt(() => api.post("/api/auth/google", { credential, org_id: orgId, role })),
    [attempt],
  );

  const verifyPhoneCode = useCallback(
    (phone, code, orgId, role) =>
      attempt(() => api.post("/api/auth/otp/verify", { phone, code, org_id: orgId, role })),
    [attempt],
  );

  /** Step two of a sign-in that owes a second factor. `code` is an authenticator or recovery code. */
  const verifyMfa = useCallback(
    (mfaToken, code) =>
      attempt(() => api.post("/api/auth/mfa/verify", { mfa_token: mfaToken, code })),
    [attempt],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Even if the network call fails, the token is discarded locally —
      // the user asked to log out, and a dead backend shouldn't trap them
      // in an authed-looking UI that can't actually do anything.
    }
    setToken(null);
    setPrincipal(null);
    setStatus("anon");
  }, []);

  const switchMembership = useCallback(async (orgId, role) => {
    // /api/auth/switch, not another call to /login: it re-issues a token for
    // one of the caller's OWN memberships without asking for the password
    // again — the backend verifies the membership actually belongs to them,
    // so this can't be used to step into someone else's org.
    try {
      const res = await api.post("/api/auth/switch", { org_id: orgId, role });
      setToken(res.access_token);
      setPrincipal(res.principal);
      return { ok: true };
    } catch (e) {
      setError(e.message || "could not switch membership");
      return { ok: false, error: e.message };
    }
  }, []);

  const can = useCallback(
    (permission) => principal?.permissions?.includes(permission) ?? false,
    [principal],
  );

  const value = useMemo(
    () => ({
      status, principal, error, can,
      login, loginWithGoogle, verifyPhoneCode, verifyMfa, completeSession,
      logout, switchMembership, refresh: loadMe,
    }),
    [status, principal, error, can, login, loginWithGoogle, verifyPhoneCode, verifyMfa,
     completeSession, logout, switchMembership, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used inside <AuthProvider>");
  return ctx;
}
