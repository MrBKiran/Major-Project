/**
 * Renders a screen inside a real SessionProvider whose API client talks to a
 * fake server — so screen tests exercise the same client and session code the
 * app runs, with only the network replaced.
 */

import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { createClient, memoryStore } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';

export type Call = { method: string; path: string; headers: Record<string, string>; body: any };
export type Route = (call: Call) => unknown | Promise<unknown>;

/** A reply with a status other than 200. */
export const reply = (status: number, body: unknown = {}) => ({ __status: status, body });

export function fakeServer(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('http://api.test', '');
    const call: Call = {
      method: init.method ?? 'GET', path,
      headers: Object.fromEntries(Object.entries(init.headers ?? {})),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const key = Object.keys(routes).find((k) => {
      const [method, pattern] = k.split(' ');
      return method === call.method && new RegExp(`^${pattern.replace(/\*/g, '[^/?]+')}(\\?.*)?$`).test(path);
    });
    if (!key) throw new TypeError(`Network request failed (no route for ${call.method} ${path})`);
    const out: any = await routes[key](call);
    const [status, body] = out && typeof out === 'object' && '__status' in out ? [out.__status, out.body] : [200, out];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return { fetch, calls, routes };
}

export const SESSION = (n = 1, principal: object = { user_id: 'USR-rameshpawa-29ae33', email: 'ramesh.pawar@example.in', full_name: 'Ramesh Pawar', role: 'vehicle_owner', scope_kind: 'owned' }) => ({
  access_token: `access-${n}`, token_type: 'bearer', expires_in: 900, principal,
  refresh_token: `refresh-token-${n}-xxxxxxxxxxxx`,
});

/** Shows the session status so tests can assert sign-in and sign-out. */
export function StatusProbe() {
  const { status } = useSession();
  return <Text testID="status">{status}</Text>;
}

export async function renderWithSession(ui: ReactElement, { routes = {}, stored = null as string | null } = {}) {
  const server = fakeServer(routes);
  const store = memoryStore(stored);
  const utils = await render(
    <SessionProvider createApi={(onSignedOut) =>
      createClient({ baseUrl: 'http://api.test', store, fetch: server.fetch as unknown as typeof fetch, onSignedOut })}>
      {ui}
      <StatusProbe />
    </SessionProvider>,
  );
  return { ...utils, server, store };
}
