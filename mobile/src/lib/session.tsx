/**
 * The signed-in state the screens see, over the API client (./api.ts).
 *
 *   restoring    on launch, while a stored session is resumed
 *   signedIn     a session the server accepted
 *   signedOut    none — or the server ended it
 *   unreachable  a stored session that could not be checked (offline, or the
 *                server not answering): still signed in, waiting to retry
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, createClient, type ApiClient, type Principal, type SignIn } from './api';
import { API_URL } from './config';
import { tokenStore } from './store';

export type Status = 'restoring' | 'signedIn' | 'signedOut' | 'unreachable';

interface SessionValue {
  status: Status;
  principal: Principal | null;
  api: ApiClient;
  login(email: string, password: string): Promise<SignIn>;
  requestCode(phone: string): Promise<void>;
  verifyCode(phone: string, code: string): Promise<SignIn>;
  verifyMfa(mfaToken: string, code: string): Promise<SignIn>;
  signOut(): Promise<void>;
  retry(): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export type ClientFactory = (onSignedOut: () => void) => ApiClient;

const defaultFactory: ClientFactory = (onSignedOut) =>
  createClient({ baseUrl: API_URL, store: tokenStore, onSignedOut });

export function SessionProvider({ children, createApi = defaultFactory }: { children: ReactNode; createApi?: ClientFactory }) {
  const [status, setStatus] = useState<Status>('restoring');
  const [principal, setPrincipal] = useState<Principal | null>(null);

  const signedOut = useCallback(() => {
    setPrincipal(null);
    setStatus('signedOut');
  }, []);

  const [api] = useState(() => createApi(signedOut));

  const check = useCallback(() => {
    api.restore().then(
      (resumed) => {
        if (resumed) { setPrincipal(resumed.principal); setStatus('signedIn'); }
        else signedOut();
      },
      (e) => {
        if (e instanceof ApiError && (e.offline || e.status >= 500)) setStatus('unreachable');
        else signedOut();
      },
    );
  }, [api, signedOut]);

  useEffect(check, [check]);

  const retry = useCallback(() => {
    setStatus('restoring');
    check();
  }, [check]);

  const adopt = useCallback((result: SignIn): SignIn => {
    if ('principal' in result) {
      setPrincipal(result.principal);
      setStatus('signedIn');
    }
    return result;
  }, []);

  const value = useMemo<SessionValue>(() => ({
    status, principal, api,
    login: (email, password) => api.login(email, password).then(adopt),
    requestCode: (phone) => api.requestCode(phone),
    verifyCode: (phone, code) => api.verifyCode(phone, code).then(adopt),
    verifyMfa: (token, code) => api.verifyMfa(token, code).then(adopt),
    signOut: async () => { await api.logout(); signedOut(); },
    retry,
  }), [status, principal, api, adopt, signedOut, retry]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
