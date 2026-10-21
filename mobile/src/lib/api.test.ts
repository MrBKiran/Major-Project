/**
 * The app's API client: how a phone holds a session.
 *
 * The phone gets its refresh token in the response body (X-Client: mobile) and
 * keeps it in the platform's secure storage; the access token lives only in
 * memory. What these tests pin down is the part that is easy to get wrong:
 * an expired access token is renewed once, quietly, however many requests hit
 * it together; a refresh the server *refuses* ends the session; and a refresh
 * that merely *could not happen* — no signal in a car park — does not.
 */

import { ApiError, createClient, memoryStore, type TokenStore } from './api';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

const session = (n: number) => ({
  access_token: `access-${n}`, token_type: 'bearer', expires_in: 900,
  principal: { email: 'ramesh.pawar@example.in', role: 'vehicle_owner' }, refresh_token: `refresh-token-${n}-xxxxxxxxxxxx`,
});

function setup(routes: Record<string, (call: Call) => Promise<Response>>, stored: string | null = null) {
  const calls: Call[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url, method: init.method ?? 'GET',
      headers: Object.fromEntries(Object.entries(init.headers ?? {})),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const path = url.replace('http://api.test', '');
    const handler = routes[`${call.method} ${path}`];
    if (!handler) throw new Error(`no route for ${call.method} ${path}`);
    return handler(call);
  });
  const store: TokenStore = memoryStore(stored);
  const onSignedOut = jest.fn();
  const client = createClient({ baseUrl: 'http://api.test', store, fetch: fetchImpl as unknown as typeof fetch, onSignedOut });
  return { client, calls, store, onSignedOut };
}

describe('signing in', () => {
  it('asks for the token in the body and keeps it in secure storage', async () => {
    const { client, calls, store } = setup({ 'POST /api/auth/login': () => json(200, session(1)) });
    const result = await client.login('ramesh.pawar@example.in', 'autosaarthi');
    expect(result).toEqual({ principal: session(1).principal });
    expect(calls[0].headers['X-Client']).toBe('mobile');
    expect(await store.get()).toBe(session(1).refresh_token);
  });

  it('hands back a second-factor challenge without starting a session', async () => {
    const { client, store } = setup({
      'POST /api/auth/login': () => json(202, { mfa_required: true, mfa_token: 'challenge', expires_in: 300 }),
    });
    expect(await client.login('a@b.in', 'pw')).toEqual({ mfaToken: 'challenge' });
    expect(await store.get()).toBeNull();
  });

  it('finishes with the second factor', async () => {
    const { client, calls, store } = setup({ 'POST /api/auth/mfa/verify': () => json(200, session(2)) });
    await client.verifyMfa('challenge', '123456');
    expect(calls[0].body).toEqual({ mfa_token: 'challenge', code: '123456' });
    expect(await store.get()).toBe(session(2).refresh_token);
  });

  it('signs in with a phone code', async () => {
    const { client, calls } = setup({
      'POST /api/auth/otp/request': () => json(202, { sent: true }),
      'POST /api/auth/otp/verify': () => json(200, session(3)),
    });
    await client.requestCode('+919876543210');
    await client.verifyCode('+919876543210', '123456');
    expect(calls.map((c) => c.body)).toEqual([
      { phone: '+919876543210' }, { phone: '+919876543210', code: '123456' },
    ]);
  });

  it('refuses a session it could not keep', async () => {
    // An enrolment-only session comes without a refresh token: half signed in.
    const { client, store } = setup({
      'POST /api/auth/login': () => json(200, { ...session(1), refresh_token: null, next_step: 'mfa_enroll' }),
    });
    await expect(client.login('staff@oem.in', 'pw')).rejects.toThrow(/second factor/i);
    expect(await store.get()).toBeNull();
  });

  it('reports the server’s reason for a refusal', async () => {
    const { client, calls, onSignedOut } = setup({ 'POST /api/auth/login': () => json(401, { detail: 'invalid email or password' }) }, 'refresh-token-0-xxxxxxxxxxxx');
    await expect(client.login('a@b.in', 'wrong')).rejects.toMatchObject({ status: 401, message: 'invalid email or password' });
    // A wrong password is not an expired session: nothing is refreshed or ended.
    expect(calls).toHaveLength(1);
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});

describe('requests', () => {
  it('carry the access token and say they come from the app', async () => {
    const { client, calls } = setup({
      'POST /api/auth/login': () => json(200, session(1)),
      'GET /api/fleet': () => json(200, { vehicles: [] }),
    });
    await client.login('a@b.in', 'pw');
    await client.get('/api/fleet');
    expect(calls[1].headers.Authorization).toBe('Bearer access-1');
    expect(calls[1].headers['X-Client']).toBe('mobile');
  });

  it('turn a structured refusal into its message', async () => {
    const { client } = setup({
      'POST /api/vehicles/V1/service/book': () => json(409, { detail: { error: 'that slot is no longer free' } }),
    });
    await expect(client.post('/api/vehicles/V1/service/book', {})).rejects.toMatchObject({
      status: 409, message: 'that slot is no longer free', detail: { error: 'that slot is no longer free' },
    });
  });
});

describe('an expired access token', () => {
  it('is renewed with the stored token, and the request goes through', async () => {
    let fleetCalls = 0;
    const { client, calls, store } = setup({
      'GET /api/fleet': () => json(++fleetCalls === 1 ? 401 : 200, { vehicles: [] }),
      'POST /api/auth/refresh': () => json(200, session(2)),
    }, 'refresh-token-1-xxxxxxxxxxxx');
    await expect(client.get('/api/fleet')).resolves.toEqual({ vehicles: [] });
    const refresh = calls.find((c) => c.url.endsWith('/refresh'))!;
    expect(refresh.body).toEqual({ refresh_token: 'refresh-token-1-xxxxxxxxxxxx' });
    expect(calls[2].headers.Authorization).toBe('Bearer access-2');
    expect(await store.get()).toBe(session(2).refresh_token);     // rotated
  });

  it('is renewed once however many requests find it expired', async () => {
    // Two refreshes with one token is a replay, which the server treats as theft.
    let refreshes = 0;
    const seen = new Set<string>();
    const { client } = setup({
      'GET /api/a': (c) => json(c.headers.Authorization === 'Bearer access-2' ? 200 : 401, {}),
      'GET /api/b': (c) => json(c.headers.Authorization === 'Bearer access-2' ? 200 : 401, {}),
      'POST /api/auth/refresh': async (c) => {
        refreshes += 1;
        seen.add((c.body as { refresh_token: string }).refresh_token);
        await new Promise((r) => setTimeout(r, 10));
        return json(200, session(2));
      },
    }, 'refresh-token-1-xxxxxxxxxxxx');
    await Promise.all([client.get('/api/a'), client.get('/api/b')]);
    expect(refreshes).toBe(1);
  });

  it('ends the session when the server refuses the refresh', async () => {
    const { client, store, onSignedOut } = setup({
      'GET /api/fleet': () => json(401, { detail: 'expired' }),
      'POST /api/auth/refresh': () => json(401, { detail: 'refresh token revoked' }),
    }, 'refresh-token-1-xxxxxxxxxxxx');
    await expect(client.get('/api/fleet')).rejects.toMatchObject({ status: 401 });
    expect(await store.get()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the refresh could not reach the server', async () => {
    const { client, store, onSignedOut } = setup({
      'GET /api/fleet': () => json(401, { detail: 'expired' }),
      'POST /api/auth/refresh': () => Promise.reject(new TypeError('Network request failed')),
    }, 'refresh-token-1-xxxxxxxxxxxx');
    await expect(client.get('/api/fleet')).rejects.toMatchObject({ offline: true });
    expect(await store.get()).toBe('refresh-token-1-xxxxxxxxxxxx');
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('keeps the session when the server is having a bad moment', async () => {
    const { client, store, onSignedOut } = setup({
      'GET /api/fleet': () => json(401, {}),
      'POST /api/auth/refresh': () => json(503, { detail: 'down' }),
    }, 'refresh-token-1-xxxxxxxxxxxx');
    await expect(client.get('/api/fleet')).rejects.toBeInstanceOf(ApiError);
    expect(await store.get()).toBe('refresh-token-1-xxxxxxxxxxxx');
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});

describe('starting the app', () => {
  it('resumes a stored session', async () => {
    const { client } = setup({ 'POST /api/auth/refresh': () => json(200, session(5)) }, 'refresh-token-1-xxxxxxxxxxxx');
    await expect(client.restore()).resolves.toEqual({ principal: session(5).principal });
  });

  it('with nothing stored, is signed out without asking the server', async () => {
    const { client, calls } = setup({}, null);
    await expect(client.restore()).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it('offline, stays signed in and says it could not check', async () => {
    const { client, store } = setup({
      'POST /api/auth/refresh': () => Promise.reject(new TypeError('Network request failed')),
    }, 'refresh-token-1-xxxxxxxxxxxx');
    await expect(client.restore()).rejects.toMatchObject({ offline: true });
    expect(await store.get()).toBe('refresh-token-1-xxxxxxxxxxxx');
  });
});

describe('signing out', () => {
  it('ends the session on the server and forgets it here', async () => {
    const { client, calls, store } = setup({
      'POST /api/auth/login': () => json(200, session(1)),
      'POST /api/auth/logout': () => json(200, { revoked: true }),
    });
    await client.login('a@b.in', 'pw');
    await client.logout();
    expect(calls[1].headers.Authorization).toBe('Bearer access-1');
    expect(await store.get()).toBeNull();
  });

  it('forgets it here even when the server cannot be reached', async () => {
    const { client, store } = setup({
      'POST /api/auth/login': () => json(200, session(1)),
      'POST /api/auth/logout': () => Promise.reject(new TypeError('Network request failed')),
    });
    await client.login('a@b.in', 'pw');
    await client.logout();
    expect(await store.get()).toBeNull();
  });
});
