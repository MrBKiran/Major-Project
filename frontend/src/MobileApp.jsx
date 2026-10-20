/**
 * Mobile entry — the owner app as an actual app on an actual phone.
 *
 * `/app` renders OwnerApp against the device's own viewport: no desktop nav,
 * no drawn phone body, and no painted status bar. That last one matters — on a
 * real handset the system status bar and keyboard render on top of the page,
 * so a drawn "9:16 · LTE · 84%" strip appears twice and immediately reads as a
 * mockup. The frame in the My Car tab exists so the layout can be judged on a
 * desktop; here the frame IS the phone.
 *
 * Auth is the same session and the same tokens as the console. An owner who
 * has never signed in on this device gets the normal login, which is why this
 * mounts inside AuthProvider rather than beside it.
 */

import { useAuth } from "./auth/AuthContext.jsx";
import Login from "./pages/Login.jsx";
import OwnerApp from "./pages/OwnerApp.jsx";
import { tokens, SANS } from "./device.jsx";
import { usePageTheme, useSystemNight } from "./night.jsx";

export default function MobileApp() {
  const { status, principal, logout } = useAuth();
  // The whole of /app — sign-in included — follows the phone's light/dark setting.
  const night = useSystemNight();
  usePageTheme(night);
  const t = tokens(night);

  if (status === "loading") {
    return (
      <div style={{
        minHeight: "100svh", display: "grid", placeItems: "center",
        background: t.page, fontFamily: SANS, color: t.dim, fontSize: 14,
      }}>
        Loading…
      </div>
    );
  }

  if (status !== "authed") return <Login defaultMethod="phone_otp" surface="owner" />;

  // The console gates this tab on scope_kind; the standalone route has to make
  // the same call rather than trusting the URL. Staff reaching /app get told
  // where their screens are instead of a broken single-vehicle view.
  if (principal?.scope_kind !== "owned") {
    return (
      <div style={{
        minHeight: "100svh", display: "grid", placeItems: "center",
        background: t.page, padding: 28, textAlign: "center", fontFamily: SANS,
      }}>
        <div style={{ maxWidth: 340 }}>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: t.ink, margin: 0 }}>
            This app is for vehicle owners
          </h1>
          <p style={{ fontSize: 14, color: t.dim, lineHeight: 1.55, marginTop: 10 }}>
            You're signed in as {principal?.full_name} ({String(principal?.role || "").replace(/_/g, " ")}).
            The fleet, service and quality screens live in the console on a larger screen.
          </p>
          <button
            onClick={logout}
            style={{
              marginTop: 18, border: `1px solid ${t.edge}`, background: "transparent",
              borderRadius: 12, padding: "12px 18px", fontFamily: SANS, fontSize: 14,
              color: t.ink, cursor: "pointer",
            }}
          >
            Sign in as someone else
          </button>
        </div>
      </div>
    );
  }

  return <OwnerApp standalone />;
}
