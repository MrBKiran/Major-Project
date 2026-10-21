/**
 * The car's data, beyond what the screens show: pull-to-refresh says it is
 * working; coming back to the app fetches again (a booking made on the web or
 * by the agent meanwhile should show); and a response the app does not
 * understand is a clear error, not a blank screen.
 */

import { act, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState, Text } from 'react-native';

import { renderWithSession, SESSION } from '@/test/harness';

import { GarageProvider, useGarage } from './garage';

const VIN = 'MH12AB1001';
const SERVICE = { vin: VIN, model: 'Bolero', odometer: 128400, city: 'Pune', alert: null, economics: null, booking: null, slots: [] };
const DETAIL = { vehicle: { vin: VIN, model: 'Bolero', odometer: 128400, city: 'Pune' }, series: [], predictions: [],
                 maintenance_history: [], dtc_codes: [] };

let reloadNow: () => Promise<void> = async () => {};
const handOver = (reload: () => Promise<void>) => { reloadNow = reload; };

function Probe() {
  const { state, reload, refreshing } = useGarage();
  useEffect(() => handOver(reload), [reload]);
  return (
    <>
      <Text testID="kind">{state.kind}</Text>
      <Text testID="refreshing">{String(refreshing)}</Text>
      {state.kind === 'failed' && <Text>{state.message}</Text>}
    </>
  );
}

async function open(service: () => unknown = () => SERVICE) {
  return renderWithSession(<GarageProvider><Probe /></GarageProvider>, {
    stored: 'refresh-token-1-xxxxxxxxxxxx',
    routes: {
      'POST /api/auth/refresh': () => SESSION(),
      'GET /api/fleet': () => ({ vehicles: [{ vin: VIN, severity: null }] }),
      'GET /api/vehicle/*': () => DETAIL,
      'GET /api/vehicles/*/service': service,
    },
  });
}

const fleetLoads = (server: { calls: { path: string }[] }) => server.calls.filter((c) => c.path.startsWith('/api/fleet')).length;

it('says it is refreshing while a pull-to-refresh runs', async () => {
  let release: () => void = () => {};
  let first = true;
  await open(() => (first ? (first = false, SERVICE) : new Promise((r) => { release = () => r(SERVICE); })));
  await waitFor(() => expect(screen.getByTestId('kind').props.children).toBe('ready'));
  let done: Promise<void> = Promise.resolve();
  await act(async () => { done = reloadNow(); });
  expect(screen.getByTestId('refreshing').props.children).toBe('true');
  await act(async () => { release(); await done; });
  expect(screen.getByTestId('refreshing').props.children).toBe('false');
});

it('fetches again when the app comes back to the foreground', async () => {
  const listeners: ((s: string) => void)[] = [];
  jest.mocked(AppState.addEventListener).mockImplementation((_type, fn) => {
    listeners.push(fn as (s: string) => void);
    return { remove: jest.fn() } as never;
  });
  const { server } = await open();
  await waitFor(() => expect(screen.getByTestId('kind').props.children).toBe('ready'));
  const before = fleetLoads(server);
  await act(async () => { listeners.forEach((fn) => fn('background')); });
  expect(fleetLoads(server)).toBe(before);
  await act(async () => { listeners.forEach((fn) => fn('active')); });
  await waitFor(() => expect(fleetLoads(server)).toBe(before + 1));
  jest.mocked(AppState.addEventListener).mockImplementation(() => ({ remove: () => {} }) as never);
});

it('treats a response it does not understand as an error, not as a car', async () => {
  // A renamed field once left a screen silently blank (`name` vs `full_name`).
  await open(() => ({ vin: VIN, model: 'Bolero', alert: 'battery' }));
  expect(await screen.findByText(/did not understand/i)).toBeOnTheScreen();
  expect(screen.getByTestId('kind').props.children).toBe('failed');
});
