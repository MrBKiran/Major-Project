/**
 * Booking from the phone: choose a slot and book it; with a booking, move it
 * or cancel it. The server keeps one booking per car and moves it in one step
 * (POST /api/vehicles/{vin}/service/...); this screen says what happened.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { formatSlot } from '@autosaarthi/core';

import { GarageProvider } from '@/lib/garage';
import { reply, renderWithSession, SESSION } from '@/test/harness';

import Book from './Book';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));

const VIN = 'MH12AB1001';
const SOON = { center_id: 'SC-PUN-01', center_name: 'Kothrud', city: 'Pune', slot_start: '2026-10-22T09:30:00+05:30' };
const LATER = { center_id: 'SC-PUN-02', center_name: 'Hadapsar', city: 'Pune', slot_start: '2026-10-23T11:00:00+05:30' };
const BOOKED = { appointment_id: 'APT1', center_id: SOON.center_id, center_name: SOON.center_name, city: 'Pune',
                 slot_start: SOON.slot_start, status: 'booked' };

const service = (over = {}) => ({
  vin: VIN, model: 'Bolero', odometer: 128400, city: 'Pune',
  alert: { component: 'battery', severity: 'P2', days_to_failure: 6 },
  economics: { repair_inr: 5200, breakdown_inr: 9000 }, booking: null, slots: [SOON, LATER], ...over,
});

async function open(first: object, routes: Record<string, any> = {}) {
  let current = first;
  const utils = await renderWithSession(<GarageProvider><Book /></GarageProvider>, {
    stored: 'refresh-token-1-xxxxxxxxxxxx',
    routes: {
      'POST /api/auth/refresh': () => SESSION(),
      'GET /api/fleet': () => ({ vehicles: [{ vin: VIN, severity: 'P2' }] }),
      'GET /api/vehicle/*': () => ({ vehicle: { vin: 'MH12AB1001', model: 'Bolero' }, series: [], predictions: [], maintenance_history: [], dtc_codes: [] }),
      'GET /api/vehicles/*/service': () => current,
      ...routes,
    },
  });
  return { ...utils, setService: (s: object) => { current = s; } };
}

const label = (slot: { slot_start: string; center_name: string }) => `${formatSlot(slot.slot_start)}, ${slot.center_name}`;

beforeEach(() => { mockPush.mockClear(); mockBack.mockClear(); });

it('books the first offered slot unless another is chosen', async () => {
  const { server, setService } = await open(service(), {
    'POST /api/vehicles/*/service/book': () => { setService(service({ booking: BOOKED })); return { booking: BOOKED }; },
  });
  expect(await screen.findByRole('radio', { name: label(SOON) })).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: /^Book/ }));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(server.calls.find((c) => c.path.endsWith('/book'))!.body)
    .toEqual({ center_id: SOON.center_id, slot_start: SOON.slot_start });
});

it('books the slot the owner picks', async () => {
  const { server } = await open(service(), {
    'POST /api/vehicles/*/service/book': () => ({ booking: BOOKED }),
  });
  await fireEvent.press(await screen.findByRole('radio', { name: label(LATER) }));
  expect(screen.getByRole('radio', { name: label(LATER) })).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: /^Book/ }));
  await waitFor(() => expect(server.calls.some((c) => c.path.endsWith('/book'))).toBe(true));
  expect(server.calls.find((c) => c.path.endsWith('/book'))!.body.center_id).toBe(LATER.center_id);
});

it('moves an existing booking instead of making a second one', async () => {
  const { server } = await open(service({ booking: BOOKED, slots: [LATER] }), {
    'POST /api/vehicles/*/service/reschedule': () => ({ booking: { ...BOOKED, center_id: LATER.center_id } }),
  });
  expect(await screen.findByText(`Booked for ${formatSlot(SOON.slot_start)} at ${SOON.center_name}`)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: /^Move to/ }));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(server.calls.some((c) => c.path.endsWith('/book'))).toBe(false);
  expect(server.calls.find((c) => c.path.endsWith('/reschedule'))!.body.center_id).toBe(LATER.center_id);
});

it('asks before cancelling, and cancels only when told to', async () => {
  const { server } = await open(service({ booking: BOOKED, slots: [LATER] }), {
    'POST /api/vehicles/*/service/cancel': () => ({ cancelled: true }),
  });
  await fireEvent.press(await screen.findByRole('button', { name: 'Cancel this booking' }));
  expect(server.calls.some((c) => c.path.endsWith('/cancel'))).toBe(false);
  await fireEvent.press(screen.getByRole('button', { name: 'Keep it' }));
  expect(screen.queryByRole('button', { name: 'Yes, cancel it' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel this booking' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Yes, cancel it' }));
  await waitFor(() => expect(server.calls.some((c) => c.path.endsWith('/cancel'))).toBe(true));
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
});

it('when the slot went in the meantime, says so and shows what is left', async () => {
  const { setService } = await open(service(), {
    'POST /api/vehicles/*/service/book': () => {
      setService(service({ slots: [LATER] }));
      return reply(409, { detail: { error: 'no open slot at that time' } });
    },
  });
  await fireEvent.press(await screen.findByRole('button', { name: /^Book/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no open slot at that time');
  expect(await screen.findByRole('radio', { name: label(LATER) })).toBeChecked();
  expect(screen.queryByRole('radio', { name: label(SOON) })).toBeNull();
  expect(mockBack).not.toHaveBeenCalled();
});

it('leaves the screen title to the header, instead of repeating it', async () => {
  await open(service());
  await screen.findByRole('radio', { name: label(SOON) });
  expect(screen.queryByText('Book a service')).toBeNull();
});

it('with nothing open, offers the agent instead', async () => {
  await open(service({ slots: [] }));
  expect(await screen.findByText(/no open slots in pune/i)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Talk to the agent' }));
  expect(mockPush).toHaveBeenCalledWith('/agent');
});

it('offline, keeps the choice and says why nothing happened', async () => {
  await open(service(), {
    'POST /api/vehicles/*/service/book': () => { throw new TypeError('Network request failed'); },
  });
  await fireEvent.press(await screen.findByRole('button', { name: /^Book/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i);
  expect(screen.getByRole('radio', { name: label(SOON) })).toBeChecked();
});
