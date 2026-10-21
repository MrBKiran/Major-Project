/**
 * Talking to the agent: the same conversation the web owner app and the
 * console use (POST /api/chat/start, /api/chat/reply), so it resumes where it
 * left off. The agent's plan and offered slots come back with every reply and
 * go out with the next — the server is stateless about them by design.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { formatSlot } from '@autosaarthi/core';

import { GarageProvider } from '@/lib/garage';
import { reply, renderWithSession, SESSION } from '@/test/harness';

import Agent from './Agent';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: jest.fn() }) }));

const VIN = 'MH12AB1001';
const SLOT = { center_id: 'SC-PUN-01', center_name: 'Kothrud', slot_start: '2026-10-22T09:30:00+05:30' };
const START = {
  run_id: 'run-1', plan: ['explain', 'offer'], offered_slots: [SLOT], objections_handled: 0,
  turns: [{ role: 'agent', text: 'Your battery voltage has been falling. Shall I book a check?' }],
};

async function open(routes: Record<string, any> = {}) {
  return renderWithSession(<GarageProvider><Agent /></GarageProvider>, {
    stored: 'refresh-token-1-xxxxxxxxxxxx',
    routes: {
      'POST /api/auth/refresh': () => SESSION(),
      'GET /api/fleet': () => ({ vehicles: [{ vin: VIN, severity: 'P2' }] }),
      'GET /api/vehicle/*': () => ({ vehicle: { vin: 'MH12AB1001', model: 'Bolero' }, series: [], predictions: [], dtc_codes: [], maintenance_history: [] }),
      'GET /api/vehicles/*/service': () => ({ vin: VIN, model: 'Bolero', alert: null, economics: null, booking: null, slots: [] }),
      'POST /api/chat/start': () => START,
      ...routes,
    },
  });
}

beforeEach(() => mockBack.mockClear());

it('opens the car’s conversation', async () => {
  const { server } = await open();
  expect(await screen.findByText(/shall i book a check/i)).toBeOnTheScreen();
  expect(server.calls.find((c) => c.path === '/api/chat/start')!.body).toEqual({ vin: VIN });
});

it('sends a message with the agent’s plan, and shows the answer', async () => {
  const { server } = await open({
    'POST /api/chat/reply': () => ({
      run_id: 'run-1', plan: ['explain', 'offer', 'answer'], offered_slots: [SLOT], objections_handled: 1,
      turns: [{ role: 'agent', text: 'About ₹5,200, and roughly 90 minutes.' }], done: false,
    }),
  });
  await fireEvent.changeText(await screen.findByLabelText('Message'), 'How much will it cost?');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText(/roughly 90 minutes/)).toBeOnTheScreen();
  expect(screen.getByText('How much will it cost?')).toBeOnTheScreen();
  expect(server.calls.find((c) => c.path === '/api/chat/reply')!.body).toEqual({
    vin: VIN, run_id: 'run-1', plan: ['explain', 'offer'], message: 'How much will it cost?',
    offered_slots: [SLOT], objections_handled: 0,
  });
});

it('does not send an empty message', async () => {
  await open();
  await screen.findByText(/shall i book/i);
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

it('offers the soonest slot as one tap, said to the agent as a yes', async () => {
  const { server } = await open({
    'POST /api/chat/reply': () => ({ ...START, turns: [], done: false }),
  });
  expect(await screen.findByText(`${formatSlot(SLOT.slot_start)} · Kothrud`)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Book it' }));
  await waitFor(() => expect(server.calls.some((c) => c.path === '/api/chat/reply')).toBe(true));
  expect(server.calls.find((c) => c.path === '/api/chat/reply')!.body.message).toBe('yes, book it');
});

it('when the agent books, says so and refreshes the car', async () => {
  const { server } = await open({
    'POST /api/chat/reply': () => ({
      ...START, turns: [{ role: 'agent', text: 'Done — booked.' }], done: true,
      booking: { booked: true, appointment_id: 'APT1', center_id: SLOT.center_id, slot_start: SLOT.slot_start },
    }),
  });
  await fireEvent.press(await screen.findByRole('button', { name: 'Book it' }));
  expect(await screen.findByText(`Booked for ${formatSlot(SLOT.slot_start)}`)).toBeOnTheScreen();
  const serviceLoads = server.calls.filter((c) => c.path.endsWith('/service')).length;
  expect(serviceLoads).toBeGreaterThanOrEqual(2);
  await fireEvent.press(screen.getByRole('button', { name: 'Back to my car' }));
  expect(mockBack).toHaveBeenCalled();
});

it('when the conversation is over, stops taking messages', async () => {
  await open({ 'POST /api/chat/reply': () => ({ ...START, offered_slots: [], turns: [{ role: 'agent', text: 'Take care.' }], done: true }) });
  await fireEvent.changeText(await screen.findByLabelText('Message'), 'no thanks');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Take care.');
  expect(screen.getByLabelText('Message').props.editable).toBe(false);
});

it('says when there is nothing to talk about', async () => {
  await open({ 'POST /api/chat/start': () => ({ note: 'No active prediction for this vehicle.' }) });
  expect(await screen.findByText(/no active prediction/i)).toBeOnTheScreen();
  expect(screen.queryByLabelText('Message')).toBeNull();
});

it('keeps the conversation when a message fails, and says why', async () => {
  await open({ 'POST /api/chat/reply': () => reply(503, { detail: 'the agent is busy' }) });
  await fireEvent.changeText(await screen.findByLabelText('Message'), 'hello?');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('the agent is busy');
  expect(screen.getByText(/shall i book/i)).toBeOnTheScreen();
  expect(screen.getByLabelText('Message').props.editable).not.toBe(false);
});
