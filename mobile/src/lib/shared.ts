/**
 * The one API client for the whole app.
 *
 * The screens on the phone and the screen in the car both talk to the server as the same signed-in
 * owner, and the refresh token rotates every time it is used: two clients each renewing from the
 * stored token would look, to the server, like a stolen token being replayed. So there is one
 * client per JavaScript runtime, and whoever needs the session — the phone's session provider, the
 * car's controller — asks for it here. See docs/authentication.md, "The mobile app".
 */

import { createClient, type ApiClient } from './api';
import { API_URL } from './config';
import { tokenStore } from './store';

let client: ApiClient | null = null;
const signedOutListeners = new Set<() => void>();

export function sharedApi(): ApiClient {
  client ??= createClient({
    baseUrl: API_URL,
    store: tokenStore,
    onSignedOut: () => signedOutListeners.forEach((listener) => listener()),
  });
  return client;
}

/** Called when the server ends the session (not when it is merely unreachable). Returns how to stop listening. */
export function onSharedSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => { signedOutListeners.delete(listener); };
}
