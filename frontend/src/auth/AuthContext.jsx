/**
 * Auth state for the whole app. One source of truth for "who is logged in,
 * what may they do" — pages read `principal.permissions` to decide what to
 * show rather than hardcoding role names, so a new role or permission on the
 * backend doesn't require finding every place the frontend guessed at it.
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

  const login = useCallback(async (email, password, orgId, role) => {
    setError(null);
    try {
      const res = await api.post("/api/auth/login", {
        email,
        password,
        org_id: orgId,
        role,
      });
      setToken(res.access_token);
      setPrincipal(res.principal);
      setStatus("authed");
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && e.body?.memberships) {
        // e.body is the unwrapped `detail` value (see api.js), so this is
        // {"error": "...", "memberships": [...]} — the shape the backend's
        // 400 actually sends, not the outer {"detail": ...} envelope.
        // Not a failure — the account holds several roles and login needs a
        // choice. Surfaced to the caller rather than treated as an error so
        // the login form can render an org picker.
        return { ok: false, needsChoice: true, memberships: e.body.memberships };
      }
      setError(e.message || "login failed");
      return { ok: false, error: e.message };
    }
  }, []);

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
    () => ({ status, principal, error, login, logout, switchMembership, can, refresh: loadMe }),
    [status, principal, error, login, logout, switchMembership, can, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used inside <AuthProvider>");
  return ctx;
}
