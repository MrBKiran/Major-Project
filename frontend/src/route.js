/**
 * The smallest router that does the job: the app has a handful of top-level
 * places (the public site at /, sign-in at /login, the owner's phone app at
 * /app) and no nested routes, so a path check plus pushState is all it needs —
 * adding a routing dependency to say that would be more moving parts than the
 * problem has (the same call App.jsx made for /app).
 */

import { useEffect, useState } from "react";

const CHANGE = "autosaarthi:navigate";

export function currentPath() {
  return typeof window === "undefined" ? "/" : window.location.pathname.replace(/\/+$/, "") || "/";
}

/** Go to a path without reloading. `replace` swaps the history entry instead of adding one. */
export function navigate(path, { replace = false } = {}) {
  if (typeof window === "undefined") return;
  if (currentPath() !== path) {
    window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  }
  window.dispatchEvent(new Event(CHANGE));
}

/** The current path, kept up to date on navigate() and on the back/forward buttons. */
export function useRoute() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const sync = () => setPath(currentPath());
    window.addEventListener("popstate", sync);
    window.addEventListener(CHANGE, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(CHANGE, sync);
    };
  }, []);
  return path;
}
