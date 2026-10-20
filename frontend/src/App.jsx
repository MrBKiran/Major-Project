/**
 * Shell. Navigation is built FROM the logged-in principal's permissions
 * (api/auth/me), not hardcoded per role — a tab exists in TABS below, but
 * whether it's rendered for this user is a `can(permission)` check. That is
 * the actual point of the RBAC work: a service advisor and an OEM quality
 * engineer looking at this app should not see the same set of tabs, and
 * neither should have to be special-cased here by name.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { AuthProvider, useAuth } from "./auth/AuthContext.jsx";
import Login from "./pages/Login.jsx";
import PlantDashboard from "./pages/PlantDashboard.jsx";
import FleetMonitoring from "./pages/FleetMonitoring.jsx";
import ServiceOps from "./pages/ServiceOps.jsx";
import SecurityConsole from "./pages/SecurityConsole.jsx";
import InCarConsole from "./pages/InCarConsole.jsx";
import OwnerApp from "./pages/OwnerApp.jsx";
import Account from "./pages/Account.jsx";
import MobileApp from "./MobileApp.jsx";

const ICONS = {
  fleet: (
    <>
      <path d="M3 17V9l3-4h8l3 4h2a2 2 0 0 1 2 2v6h-2" />
      <path d="M3 17h1" /><path d="M14 17H9" /><path d="M19 17h2" />
      <circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" />
    </>
  ),
  ops: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" />
      <path d="M8 14h2" /><path d="M14 14h2" /><path d="M8 17.5h2" />
    </>
  ),
  console: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v3.2" /><path d="M12 16.8V20" /><path d="M4 12h3.2" /><path d="M16.8 12H20" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  plant: (
    <>
      <path d="M3 21V11l5 3v-3l5 3v-3l5 3v7z" />
      <path d="M3 21h18" /><path d="M7 21v-4" /><path d="M13 21v-4" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  security: (
    <>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9.2 12.2l1.9 1.9 3.7-3.9" />
    </>
  ),
};

const TABS = [
  // The owner app is scope-gated rather than permission-gated: every role that
  // can read a vehicle could technically render it, but it is written for a
  // person looking at their own car. Showing a fleet manager a single-vehicle
  // phone app would be a worse version of Fleet Monitoring, so `ownerOnly`
  // keys it to scope_kind === "owned" instead.
  { id: "owner", slide: 0, label: "My Car", permission: "vehicle:read", ownerOnly: true },
  { id: "fleet", slide: 1, label: "Fleet Monitoring", permission: "vehicle:read" },
  // Either grant earns the tab: forecast:read gets capacity planning, appointment:read
  // gets the booking list — a service advisor has only the latter and still needs a
  // page to see what they booked.
  { id: "ops", slide: 2, label: "Service Ops", permission: ["forecast:read", "appointment:read"] },
  { id: "console", slide: 3, label: "In-Car Console", permission: null }, // separate device surface, not RBAC-gated
  { id: "plant", slide: 4, label: "Plant Quality", permission: "quality:read" },
  { id: "security", slide: 5, label: "Security Console", permission: "ueba:read" },
];

const PAGES = {
  owner: OwnerApp, fleet: FleetMonitoring, ops: ServiceOps, console: InCarConsole,
  plant: PlantDashboard, security: SecurityConsole,
};

/** A tab's `permission` is null (always visible), one permission string, or a
 * list — any one of which is enough (each grant unlocks a different section
 * of that tab's page, so the tab itself just needs someone who can use it). */
function tabVisible(tab, granted, principal) {
  if (tab.ownerOnly && principal?.scope_kind !== "owned") return false;
  if (!tab.permission) return true;
  const required = Array.isArray(tab.permission) ? tab.permission : [tab.permission];
  return required.some((p) => granted.includes(p));
}

function Icon({ id }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[id]}
    </svg>
  );
}

function Shell() {
  const { principal } = useAuth();
  const visibleTabs = TABS.filter((t) => tabVisible(t, principal.permissions, principal));
  const [tab, setTab] = useState(visibleTabs[0]?.id ?? null);
  // "account" is opened from the account menu, not from the tab bar, so it is not in TABS.
  const active = tab === "account" ? { id: "account" } : TABS.find((t) => t.id === tab);
  const Page = tab === "account" ? Account : tab ? PAGES[tab] : null;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-border bg-surface-page/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-body-sm font-bold text-accent-ink">
              A
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-lead font-bold tracking-tight text-fg-strong">AutoSaarthi</span>
              <span className="text-caption text-fg-muted">OEM Console</span>
            </div>
          </div>

          <SectionNav tabs={visibleTabs} active={tab} onSelect={setTab} />

          <AccountMenu onAccount={() => setTab("account")} />
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        {!active ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center">
            <p className="text-body text-fg-tertiary">No page available for this role.</p>
          </div>
        ) : Page ? (
          <div key={tab} className="animate-in">
            <Page />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center">
            <p className="text-body text-fg-tertiary">
              Slide {active.slide} — {active.label}
            </p>
            <p className="mt-1 text-label text-fg-subtle">Not built yet.</p>
          </div>
        )}
      </main>
    </div>
  );
}

/** The console's sections. The current one is marked with aria-current, not
 *  only by colour — colour alone tells a screen-reader user nothing. */
export function SectionNav({ tabs, active, onSelect }) {
  const btnRefs = useRef({});
  const [indicator, setIndicator] = useState(null);

  useLayoutEffect(() => {
    const el = btnRefs.current[active];
    if (!el) return setIndicator(null);
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [active, tabs.length]);

  return (
    <nav aria-label="Console sections" className="relative flex flex-1 gap-1">
      {tabs.length === 0 ? (
        <span className="px-3 py-1.5 text-body-sm text-fg-subtle">
          Your role has no console pages assigned.
        </span>
      ) : (
        <>
          {indicator && (
            <span
              aria-hidden
              className="absolute top-0 h-full rounded-lg bg-surface-inset transition-[left,width] duration-300 ease-out"
              style={{ left: indicator.left, width: indicator.width }}
            />
          )}
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              ref={(el) => { btnRefs.current[t.id] = el; }}
              onClick={() => onSelect(t.id)}
              aria-current={active === t.id ? "page" : undefined}
              className={`relative z-[1] flex items-center gap-2 rounded-lg px-3 py-1.5 text-body-sm font-medium transition-colors duration-200 ${
                active === t.id ? "text-fg-strong" : "text-fg-muted hover:text-fg-secondary"
              }`}
            >
              <span aria-hidden className={active === t.id ? "text-accent-ink" : "text-fg-subtle"}>
                <Icon id={t.id} />
              </span>
              {t.label}
              {!PAGES[t.id] && <span className="ml-0.5 text-caption text-fg-subtle">·</span>}
            </button>
          ))}
        </>
      )}
    </nav>
  );
}

export function AccountMenu({ onAccount }) {
  const { principal, logout, switchMembership } = useAuth();
  const [open, setOpen] = useState(false);
  const [memberships, setMemberships] = useState(null);
  const [busy, setBusy] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const menuId = useId();

  // A click anywhere else closes it, as every menu on the platform does.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onKeyDown(e) {
    if (e.key === "Escape" && open) {
      setOpen(false);
      trigger.current?.focus();
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && memberships === null) {
      const res = await api.get("/api/auth/memberships");
      setMemberships(res.memberships);
    }
  }

  async function pick(m) {
    if (m.active) return setOpen(false);
    setBusy(true);
    await switchMembership(m.org_id, m.role);
    setBusy(false);
    setOpen(false);
    setMemberships(null); // re-fetched next open, so `active` reflects the new choice
  }

  return (
    <div className="relative" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={menuId}
        className={`flex items-center gap-2.5 rounded-lg border px-3 py-1.5 text-left transition-colors duration-200 ${
          open ? "border-fg-muted bg-surface-inset" : "border-border bg-surface-card hover:border-fg-subtle"
        }`}
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-caption font-bold text-accent-ink">
          {principal.full_name?.[0]?.toUpperCase() ?? "?"}
        </div>
        {/* min-w-0 + truncate: the org/role line is user data of unbounded
            length, and without a bound it pushed the caret out of the header
            and clipped mid-word ("vehicle owne") instead of eliding. */}
        <div className="min-w-0 leading-tight">
          <div className="truncate text-label font-medium text-fg">{principal.full_name}</div>
          <div className="truncate text-caption text-fg-muted">
            {principal.org.name} · {principal.role.replace(/_/g, " ")}
          </div>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`ml-0.5 text-fg-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div id={menuId} className="animate-in absolute right-0 top-[calc(100%+6px)] w-64 origin-top-right rounded-lg border border-border bg-surface-card py-1.5 shadow-xl">
          {memberships === null ? (
            <div className="space-y-1.5 px-3 py-2">
              <div className="skeleton h-3 w-32" />
              <div className="skeleton h-3 w-40" />
            </div>
          ) : (
            <>
              <div className="px-3 pb-1.5 pt-1 text-caption font-medium uppercase tracking-wider text-fg-muted">
                Switch role
              </div>
              {memberships.map((m) => (
                <button
                  key={`${m.org_id}:${m.role}`}
                  disabled={busy}
                  onClick={() => pick(m)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-label transition-colors duration-150 hover:bg-surface-inset disabled:opacity-50 ${
                    m.active ? "text-accent-ink" : "text-fg-secondary"
                  }`}
                >
                  <span>
                    {m.org_name}
                    <span className="ml-1.5 text-fg-muted">— {m.role.replace(/_/g, " ")}</span>
                  </span>
                  {m.active && <span>✓</span>}
                </button>
              ))}
              <div className="my-1.5 border-t border-border" />
              <button
                onClick={() => { setOpen(false); onAccount(); }}
                className="w-full px-3 py-2 text-left text-label text-fg-secondary transition-colors duration-150 hover:bg-surface-inset"
              >
                Account &amp; security
              </button>
              <button
                onClick={logout}
                className="w-full px-3 py-2 text-left text-label text-p1 transition-colors duration-150 hover:bg-p1/10"
              >
                Log out (all sessions)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { status } = useAuth();
  if (status === "loading") {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="flex items-center gap-2.5 text-body-sm text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-soft" />
          Loading…
        </div>
      </div>
    );
  }
  return status === "authed" ? <Shell /> : <Login />;
}

/** `/app` is the owner app on a real phone; everything else is the console.
 *  A path check rather than a router: there are two entries, and adding a
 *  routing dependency to express that would be more moving parts than the
 *  problem has. Read once at module scope — this app has no client-side
 *  navigation between the two, and switching means loading the other URL. */
const IS_MOBILE_ROUTE = typeof window !== "undefined"
  && /^\/app\/?$/.test(window.location.pathname);

export default function App() {
  return (
    <AuthProvider>
      {IS_MOBILE_ROUTE ? <MobileApp /> : <Gate />}
    </AuthProvider>
  );
}
