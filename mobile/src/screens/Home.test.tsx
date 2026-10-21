/**
 * Home: one car, one sentence. A healthy car is a quiet screen with nothing to
 * tap; an alert says what is wearing, how long is left, and what each choice
 * costs — from the server, not a table in the app; a booking says when.
 */

import { fireEvent, screen } from '@testing-library/react-native';
import { formatSlot } from '@autosaarthi/core';

import { GarageProvider } from '@/lib/garage';
import { reply, renderWithSession, SESSION } from '@/test/harness';

import Home from './Home';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const VIN = 'MH12AB1001';
const SLOT = { center_id: 'SC-PUN-01', center_name: 'Hero-M&M Service, Kothrud', city: 'Pune',
               slot_start: '2026-10-22T09:30:00+05:30', slot_end: '2026-10-22T10:30:00+05:30' };
const VEHICLE = { vin: VIN, model: 'Bolero', odometer: 128400, city: 'Pune' };

const service = (over = {}) => ({ ...VEHICLE, alert: null, economics: null, booking: null, slots: [], ...over });
const detail = (over = {}) => ({
  vehicle: VEHICLE, series: [], predictions: [], dtc_codes: [],
  maintenance_history: [{ date: '2026-02-18', service_type: 'brake_pad_replace', cost: 3100, km_at_service: 124900 }],
  ...over,
});

type Car = { vin: string; severity: string | null };

async function open(svc: object, { vehicles = [{ vin: VIN, severity: null }] as Car[], det = detail(), routes = {} } = {}) {
  return renderWithSession(<GarageProvider><Home /></GarageProvider>, {
    stored: 'refresh-token-1-xxxxxxxxxxxx',
    routes: {
      'POST /api/auth/refresh': () => SESSION(),
      'GET /api/fleet': () => ({ vehicles }),
      'GET /api/vehicle/*': () => det,
      'GET /api/vehicles/*/service': () => svc,
      ...routes,
    },
  });
}

beforeEach(() => mockPush.mockClear());

it('is a quiet screen when the car is healthy', async () => {
  await open(service());
  expect(await screen.findByText('Everything reads normal')).toBeOnTheScreen();
  expect(screen.queryByText(/nominal/i)).toBeNull();
  expect(screen.getByText(/last service · 18 feb 2026/i)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /book/i })).toBeNull();
});

it('says what is wearing, how long is left, and what each choice costs', async () => {
  await open(service({
    alert: { component: 'battery', severity: 'P2', days_to_failure: 6 },
    economics: { repair_inr: 5200, breakdown_inr: 9000 }, slots: [SLOT],
  }));
  expect(await screen.findByText('Your battery is wearing out')).toBeOnTheScreen();
  expect(screen.getByText('About 6 days of driving left, on current use.')).toBeOnTheScreen();
  expect(screen.getByText('₹5,200')).toBeOnTheScreen();
  expect(screen.getByText('₹9,000')).toBeOnTheScreen();
  expect(screen.getByText('Nothing is booked without your yes')).toBeOnTheScreen();
});

it('says how urgent it is in an owner’s words, not the staff code', async () => {
  await open(service({ alert: { component: 'water_pump', severity: 'P1', days_to_failure: 5 } }));
  expect(await screen.findByText('Urgent · 5 days')).toBeOnTheScreen();
  expect(screen.queryByText(/P1/)).toBeNull();
  expect(screen.getByLabelText('Urgent: about 5 days of driving left')).toBeOnTheScreen();
});

it('invents no costs the server did not send', async () => {
  await open(service({ alert: { component: 'battery', severity: 'P2', days_to_failure: 6 } }));
  await screen.findByText('Your battery is wearing out');
  expect(screen.queryByText(/₹/)).toBeNull();
});

it('leads from an alert to booking, the agent, and the evidence', async () => {
  await open(service({ alert: { component: 'water_pump', severity: 'P1', days_to_failure: 1 }, slots: [SLOT] }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Book a service' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Talk to the agent' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Why this part?' }));
  expect(mockPush.mock.calls.map((c) => c[0])).toEqual(['/book', '/agent', '/evidence']);
});

it('shows a booking instead of offering another', async () => {
  await open(service({
    alert: { component: 'battery', severity: 'P2', days_to_failure: 6 },
    booking: { appointment_id: 'APT1', center_id: SLOT.center_id, center_name: SLOT.center_name, city: 'Pune',
               slot_start: SLOT.slot_start, status: 'booked' },
  }));
  expect(await screen.findByText('Service booked')).toBeOnTheScreen();
  expect(screen.getByText(`${formatSlot(SLOT.slot_start)} · ${SLOT.center_name}`)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Book a service' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Change or cancel' }));
  expect(mockPush).toHaveBeenCalledWith('/book');
});

it('picks the car that has something to say', async () => {
  const { server } = await open(service(), {
    vehicles: [{ vin: 'OTHER1', severity: null }, { vin: VIN, severity: 'P2' }],
  });
  await screen.findByText('Everything reads normal');
  expect(server.calls.some((c) => c.path === `/api/vehicles/${VIN}/service`)).toBe(true);
});

it('says so when no car is registered', async () => {
  await open(service(), { vehicles: [] });
  expect(await screen.findByText(/no car is registered/i)).toBeOnTheScreen();
});

it('offline, says so and tries again on request', async () => {
  let online = false;
  await open(service(), {
    routes: {
      'GET /api/fleet': () => {
        if (!online) throw new TypeError('Network request failed');
        return { vehicles: [{ vin: VIN, severity: null }] };
      },
    },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i);
  online = true;
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Everything reads normal')).toBeOnTheScreen();
});

it('says what went wrong when the server refuses', async () => {
  await open(service(), { routes: { 'GET /api/fleet': () => reply(500, { detail: 'database unavailable' }) } });
  expect(await screen.findByRole('alert')).toHaveTextContent('database unavailable');
});
