/**
 * API client. One place that knows how to talk to the backend, so every page
 * gets auth headers, 401 handling, and error shape for free instead of
 * re-implementing fetch() plumbing five times.
 */

const TOKEN_KEY = "autosaarthi.token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Thrown for any non-2xx response. Carries status so callers can special-case
 * 401/403/404 without parsing strings. */
export class ApiError extends Error {
  constructor(status, detail, body) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.status = status;
    this.body = body;
  }
}

/** Fires when a request comes back 401 — i.e. the token is gone, expired, or
 * revoked server-side (see backend's token_version). One listener, set by
 * AuthContext, so every page's fetch failing the same way lands in the same
 * "you were logged out" flow instead of each page inventing its own. */
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, { method = "GET", body, params } = {}) {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }

  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const requestId = res.headers.get("X-Request-ID");
  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    // FastAPI always wraps error bodies as {"detail": ...}. `detail` unwraps
    // that once here so every caller works with the actual error value
    // (a string, OR — as with the multi-membership 400 — a structured object
    // with its own extra fields) instead of each needing to know about the
    // wrapper convention and re-unwrap it themselves.
    const detail = payload && typeof payload === "object" ? payload.detail : payload;
    const err = new ApiError(res.status, detail ?? res.statusText, detail ?? payload);
    err.requestId = requestId;
    // Seconds to wait, on a 429 — the OTP and sign-in screens show a countdown
    // instead of a bare "too many requests".
    const retryAfter = Number(res.headers.get("Retry-After"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfter = retryAfter;
    throw err;
  }
  return payload;
}

/** Fetch a binary endpoint and hand it to the browser as a file.
 *
 *  Separate from `request` because that one always parses JSON and would choke
 *  on a PDF body. The filename comes from the server's Content-Disposition so
 *  the report keeps the CAPA id it was rendered under rather than a name the
 *  client invents. The object URL is revoked after the click — without that,
 *  every download leaks the whole file until the tab closes.
 */
async function download(path, fallbackName) {
  const token = getToken();
  const res = await fetch(new URL(path, window.location.origin), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* a non-JSON error body is fine — keep the status text */
    }
    throw new ApiError(res.status, detail, null);
  }

  const match = /filename="?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") || "");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: (path, params) => request(path, { params }),
  post: (path, body) => request(path, { method: "POST", body }),
  download,
};
