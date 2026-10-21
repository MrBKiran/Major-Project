/**
 * The app's API client: how a phone holds a session.
 *
 * Sign-in asks for the refresh token in the response body (`X-Client: mobile`)
 * and keeps it in secure storage; the access token lives only in memory and
 * lasts 15 minutes. When a request finds it expired the client renews it once
 * — however many requests are waiting, because two refreshes with one token
 * is a replay the server treats as theft — and retries.
 *
 * Only a refresh the server *refuses* ends the session. One that could not
 * happen (no signal, the server restarting) leaves it intact: an owner in a
 * basement car park is not signed out, just offline.
 *
 * See docs/authentication.md, "The mobile app".
 */

/** As the server sends it (app/auth/principal.py). */
export type Principal = Record<string, unknown> & { user_id?: string; email?: string; full_name?: string; role?: string };

export interface TokenStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

/** For tests and the browser preview, where there is no secure storage. */
export function memoryStore(initial: string | null = null): TokenStore {
  let value = initial;
  return {
    get: async () => value,
    set: async (v) => { value = v; },
    clear: async () => { value = null; },
  };
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly detail?: unknown,
              readonly offline = false) {
    super(message);
    this.name = 'ApiError';
  }
}

function offline(): ApiError {
  return new ApiError(0, 'You are offline — this will work again when you have a connection.',
                      undefined, true);
}

/** FastAPI puts the reason in `detail`: a string, or an object with `error`. */
function messageOf(status: number, body: unknown): { message: string; detail: unknown } {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return { message: detail, detail };
  const error = (detail as { error?: unknown } | null)?.error;
  if (typeof error === 'string') return { message: error, detail };
  return { message: `The server answered ${status}.`, detail };
}

interface Session {
  access_token: string;
  refresh_token?: string | null;
  principal: Principal;
  next_step?: string | null;
}

export type SignIn = { principal: Principal } | { mfaToken: string };

export interface ClientOptions {
  baseUrl: string;
  store: TokenStore;
  fetch?: typeof fetch;
  /** Called when the server has ended the session (not when it is unreachable). */
  onSignedOut?: () => void;
}

type Outcome = 'ok' | 'refused' | 'offline' | 'busy';

export function createClient({ baseUrl, store, fetch: fetchImpl = fetch, onSignedOut }: ClientOptions) {
  let access: string | null = null;
  let principal: Principal | null = null;
  let renewing: Promise<Outcome> | null = null;

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Client': 'mobile',
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...extra,
    };
  }

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw offline();
    }
  }

  async function read<T>(res: Response): Promise<T> {
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const { message, detail } = messageOf(res.status, body);
      throw new ApiError(res.status, message, detail);
    }
    return body as T;
  }

  async function adopt(session: Session): Promise<{ principal: Principal }> {
    if (!session.refresh_token) {
      // An enrolment-only session: the server gives it no refresh token.
      throw new ApiError(403, 'This account needs a second factor set up first. Do that on the web console, then sign in here.');
    }
    await store.set(session.refresh_token);
    access = session.access_token;
    principal = session.principal;
    return { principal };
  }

  async function forget(): Promise<void> {
    access = null;
    principal = null;
    await store.clear();
  }

  function renew(): Promise<Outcome> {
    renewing ??= (async (): Promise<Outcome> => {
      const token = await store.get();
      if (!token) return 'refused';
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile' },
          body: JSON.stringify({ refresh_token: token }),
        });
      } catch {
        return 'offline';
      }
      if (res.ok) {
        await adopt(await res.json());
        return 'ok';
      }
      // 401/403/400: the server has ended this session. Anything else (a 409
      // race, a 5xx) says nothing about the session itself.
      if (res.status === 401 || res.status === 403 || res.status === 400) {
        await forget();
        onSignedOut?.();
        return 'refused';
      }
      return 'busy';
    })().finally(() => { renewing = null; });
    return renewing;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res = await send(method, path, body);
    if (res.status === 401) {
      const outcome = await renew();
      if (outcome === 'ok') res = await send(method, path, body);
      else if (outcome === 'offline') throw offline();
      else if (outcome === 'busy') throw new ApiError(503, 'AutoSaarthi is not answering just now. Try again in a moment.');
    }
    return read<T>(res);
  }

  async function signIn(path: string, body: unknown): Promise<SignIn> {
    const res = await send('POST', path, body);
    const data = await read<Session & { mfa_required?: boolean; mfa_token?: string }>(res);
    if (data.mfa_required && data.mfa_token) return { mfaToken: data.mfa_token };
    return adopt(data);
  }

  return {
    get: <T = unknown>(path: string) => request<T>('GET', path),
    post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
    del: <T = unknown>(path: string) => request<T>('DELETE', path),

    principal: () => principal,

    login: (email: string, password: string) => signIn('/api/auth/login', { email, password }),
    requestCode: async (phone: string) => { await read(await send('POST', '/api/auth/otp/request', { phone })); },
    verifyCode: (phone: string, code: string) => signIn('/api/auth/otp/verify', { phone, code }),
    verifyMfa: (mfaToken: string, code: string) => signIn('/api/auth/mfa/verify', { mfa_token: mfaToken, code }),

    /** On launch: resume a stored session. Null when there is none (or it was refused). */
    async restore(): Promise<{ principal: Principal } | null> {
      const outcome = await renew();
      if (outcome === 'ok' && principal) return { principal };
      if (outcome === 'offline') throw offline();
      if (outcome === 'busy') throw new ApiError(503, 'AutoSaarthi is not answering just now. Try again in a moment.');
      return null;
    },

    /** Ends every session for the account on the server, then here — even offline. */
    async logout(): Promise<void> {
      try {
        await send('POST', '/api/auth/logout', {});
      } catch {
        // Unreachable: the token still goes from this phone, and expires on the server.
      }
      await forget();
    },
  };
}

export type ApiClient = ReturnType<typeof createClient>;
