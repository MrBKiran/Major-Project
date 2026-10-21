/**
 * The owner's car, loaded once and shared by Home, the evidence, history and
 * booking screens: which car (the one with something to say, if there are
 * several), its readings and history, and its service — alert, costs, booking
 * and the slots on offer (GET /api/vehicles/{vin}/service).
 *
 * It fetches again when the app returns to the foreground — a booking made on
 * the web or by the agent in the meantime should be there — and every response
 * is checked against ./schemas.ts before a screen sees it.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { ZodError } from 'zod';

import { ApiError } from './api';
import { DetailSchema, FleetSchema, NOT_UNDERSTOOD, ServiceSchema, type Detail, type Service } from './schemas';
import { useSession } from './session';

export type { Alert, Booking, Detail, Reading, Service, Slot } from './schemas';

type State =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'ready'; vin: string; detail: Detail; service: Service }
  | { kind: 'failed'; message: string; offline: boolean };

interface GarageValue {
  state: State;
  /** True while a pull-to-refresh is running. */
  refreshing: boolean;
  reload(): Promise<void>;
  /** After a booking change: fetch just the service again. */
  refreshService(): Promise<void>;
}

const GarageContext = createContext<GarageValue | null>(null);

function failed(e: unknown): State {
  if (e instanceof ZodError) return { kind: 'failed', message: NOT_UNDERSTOOD, offline: false };
  return {
    kind: 'failed',
    message: e instanceof ApiError ? e.message : 'Something went wrong. Try again.',
    offline: e instanceof ApiError && e.offline,
  };
}

export function GarageProvider({ children }: { children: ReactNode }) {
  const { api } = useSession();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const fetchCar = useCallback(async (): Promise<State> => {
    try {
      const { vehicles } = FleetSchema.parse(await api.get('/api/fleet?limit=20'));
      if (!vehicles.length) return { kind: 'none' };
      const vin = (vehicles.find((v) => v.severity) ?? vehicles[0]).vin;
      const [detail, service] = await Promise.all([
        api.get(`/api/vehicle/${vin}?minutes=1440`).then((d) => DetailSchema.parse(d)),
        api.get(`/api/vehicles/${vin}/service`).then((s) => ServiceSchema.parse(s)),
      ]);
      return { kind: 'ready', vin, detail, service };
    } catch (e) {
      return failed(e);
    }
  }, [api]);

  useEffect(() => {
    let live = true;
    fetchCar().then((next) => { if (live) setState(next); });
    // Back from the background: quietly fetch again. If that fails (no signal),
    // keep what is on screen — the offline banner says why it may be old.
    const sub = AppState.addEventListener('change', (appState) => {
      if (appState !== 'active') return;
      fetchCar().then((next) => {
        if (live) setState((prev) => (next.kind === 'failed' && prev.kind === 'ready' ? prev : next));
      });
    });
    return () => { live = false; sub.remove(); };
  }, [fetchCar]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    try {
      setState(await fetchCar());
    } finally {
      setRefreshing(false);
    }
  }, [fetchCar]);

  const refreshService = useCallback(async () => {
    if (state.kind !== 'ready') return reload();
    try {
      const service = ServiceSchema.parse(await api.get(`/api/vehicles/${state.vin}/service`));
      setState({ ...state, service });
    } catch (e) {
      setState(failed(e));
    }
  }, [api, state, reload]);

  const value = useMemo(() => ({ state, refreshing, reload, refreshService }),
                        [state, refreshing, reload, refreshService]);
  return <GarageContext.Provider value={value}>{children}</GarageContext.Provider>;
}

export function useGarage(): GarageValue {
  const value = useContext(GarageContext);
  if (!value) throw new Error('useGarage must be used inside <GarageProvider>');
  return value;
}
