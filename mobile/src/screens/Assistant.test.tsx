/**
 * The assistant: one conversation about every car, by typing or by voice. The server
 * is faked; the microphone and the phone's voice are stood in for by `@/lib/voice`, so
 * what is checked is what the owner sees and what the app sends.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { GarageProvider } from '@/lib/garage';
import { reply, renderWithSession, SESSION } from '@/test/harness';

import Assistant from './Assistant';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));

jest.mock('@/lib/voice', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const api = {
    start: jest.fn(async () => true),
    stop: jest.fn(async () => ({ uri: 'file:///clip.m4a', name: 'voice.m4a', type: 'audio/mp4' })),
    speak: jest.fn(),
    stopSpeaking: jest.fn(),
  };
  return {
    __api: api,
    useRecorder: () => {
      const [recording, setRecording] = React.useState(false);
      return {
        recording,
        start: async () => { const ok = await api.start(); setRecording(ok); return ok; },
        stop: async () => { setRecording(false); return api.stop(); },
      };
    },
    speak: (...args: unknown[]) => api.speak(...args),
    stopSpeaking: () => api.stopSpeaking(),
  };
});
const voice = (jest.requireMock('@/lib/voice') as { __api: Record<string, jest.Mock> }).__api;

const VIN = 'MH12AB1001';
const PENDING = { id: 'act-1', kind: 'book', summary: 'Book the Bolero at Kothrud on Mon 23 Nov, 9:00 am' };

async function open(routes: Record<string, any> = {}) {
  return renderWithSession(<GarageProvider><Assistant /></GarageProvider>, {
    stored: 'refresh-token-1-xxxxxxxxxxxx',
    routes: {
      'POST /api/auth/refresh': () => SESSION(),
      'GET /api/fleet': () => ({ vehicles: [{ vin: VIN, severity: 'P2' }] }),
      'GET /api/vehicle/*': () => ({ vehicle: { vin: VIN, model: 'Bolero' }, series: [], predictions: [], dtc_codes: [], maintenance_history: [] }),
      'GET /api/vehicles/*/service': () => ({ vin: VIN, model: 'Bolero', alert: null, economics: null, booking: null, slots: [] }),
      'GET /api/assistant/thread': () => ({ turns: [], pending_action: null }),
      ...routes,
    },
  });
}

const ask = async (text: string) => {
  await fireEvent.changeText(await screen.findByLabelText('Message'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
};

beforeEach(() => Object.values(voice).forEach((m) => m.mockClear()));

it('opens with what it can do and a few things to ask', async () => {
  await open();
  expect(await screen.findByText('Ask me about your cars')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'How are my cars doing?' })).toBeOnTheScreen();
});

it('resumes the conversation, and anything still waiting for a yes', async () => {
  await open({
    'GET /api/assistant/thread': () => ({
      turns: [{ id: 1, role: 'user', text: 'Book me a service' }, { id: 2, role: 'assistant', text: 'I can book Mon 23 Nov at 9:00 am. Shall I?' }],
      pending_action: PENDING,
    }),
  });
  expect(await screen.findByText(/Shall I\?/)).toBeOnTheScreen();
  expect(screen.getByText('Book me a service')).toBeOnTheScreen();
  expect(screen.getByText(PENDING.summary)).toBeOnTheScreen();
  expect(screen.queryByText('Ask me about your cars')).toBeNull();
});

it('sends a typed message, with the car being looked at, and shows the answer in writing', async () => {
  const { server } = await open({
    'POST /api/assistant/message': () => ({ reply: 'Your Bolero’s water pump is wearing out.', pending_action: null, done: null }),
  });
  await ask('How are my cars?');
  expect(await screen.findByText(/water pump is wearing out/)).toBeOnTheScreen();
  expect(screen.getByText('How are my cars?')).toBeOnTheScreen();
  expect(server.calls.find((c) => c.path === '/api/assistant/message')!.body)
    .toEqual({ message: 'How are my cars?', channel: 'text', vin: VIN });
  expect(voice.speak).not.toHaveBeenCalled();
});

it('does not send an empty message', async () => {
  await open();
  await screen.findByText('Ask me about your cars');
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

it('sends a suggestion as if it were typed', async () => {
  const { server } = await open({
    'POST /api/assistant/message': () => ({ reply: 'All fine.', pending_action: null, done: null }),
  });
  await fireEvent.press(await screen.findByRole('button', { name: 'What will it cost if I wait?' }));
  await waitFor(() => expect(server.calls.some((c) => c.path === '/api/assistant/message')).toBe(true));
  expect(server.calls.find((c) => c.path === '/api/assistant/message')!.body.message).toBe('What will it cost if I wait?');
});

it('shows a proposal as something waiting for a yes, and books only when told to', async () => {
  const { server } = await open({
    'POST /api/assistant/message': () => ({ reply: 'I can book that. Shall I?', pending_action: PENDING, done: null }),
    'POST /api/assistant/actions/*/confirm': () => ({ ok: true, message: 'Done — your Bolero is booked for Mon 23 Nov, 9:00 am at Kothrud.' }),
  });
  await ask('Book me a service');
  expect(await screen.findByText('Waiting for your yes')).toBeOnTheScreen();
  expect(server.calls.some((c) => c.path.includes('/actions/'))).toBe(false);

  await fireEvent.press(screen.getByRole('button', { name: 'Yes, do it' }));
  expect(await screen.findByText(/is booked for Mon 23 Nov/)).toBeOnTheScreen();
  expect(server.calls.some((c) => c.path === '/api/assistant/actions/act-1/confirm')).toBe(true);
  expect(screen.queryByText('Waiting for your yes')).toBeNull();
  // The Home screen must show the booking next time it looks.
  await waitFor(() => expect(server.calls.filter((c) => c.path === `/api/vehicles/${VIN}/service`).length).toBeGreaterThan(1));
});

it('drops a proposal on No, and says so', async () => {
  const { server } = await open({
    'GET /api/assistant/thread': () => ({ turns: [], pending_action: PENDING }),
    'POST /api/assistant/actions/*/cancel': () => ({ ok: true, message: 'Okay, I won’t do that.' }),
  });
  await fireEvent.press(await screen.findByRole('button', { name: 'No' }));
  expect(await screen.findByText(/I won’t do that/)).toBeOnTheScreen();
  expect(server.calls.some((c) => c.path === '/api/assistant/actions/act-1/cancel')).toBe(true);
  expect(screen.queryByText('Waiting for your yes')).toBeNull();
});

it('reads the reply aloud when the owner has asked for that', async () => {
  await open({ 'POST /api/assistant/message': () => ({ reply: 'All fine.', pending_action: null, done: null }) });
  await fireEvent(await screen.findByLabelText('Read replies aloud'), 'valueChange', true);
  await ask('How are things?');
  await screen.findByText('All fine.');
  expect(voice.speak).toHaveBeenCalledWith('All fine.', expect.any(Function));
});

describe('by voice', () => {
  it('records, sends the clip to be transcribed, asks the question, and speaks the answer', async () => {
    const { server } = await open({
      'POST /api/assistant/transcribe': () => ({ text: 'mera brake kab tak chalega' }),
      'POST /api/assistant/message': () => ({ reply: 'Lagbhag saat din.', pending_action: null, done: null }),
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Talk to the assistant' }));
    expect(voice.start).toHaveBeenCalled();
    expect(await screen.findByText(/Listening — tap the microphone/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Stop and send' }));
    expect(await screen.findByText('Lagbhag saat din.')).toBeOnTheScreen();
    expect(screen.getByText('mera brake kab tak chalega')).toBeOnTheScreen();

    const upload = server.calls.find((c) => c.path === '/api/assistant/transcribe')!;
    expect(upload.method).toBe('POST');
    expect(upload.headers['Content-Type']).toBeUndefined();            // the multipart boundary is set by fetch
    expect(server.calls.find((c) => c.path === '/api/assistant/message')!.body)
      .toEqual({ message: 'mera brake kab tak chalega', channel: 'voice', vin: VIN });
    expect(voice.speak).toHaveBeenCalledWith('Lagbhag saat din.', expect.any(Function));
  });

  it('asks the owner to type instead when the microphone is not allowed', async () => {
    voice.start.mockResolvedValueOnce(false);
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Talk to the assistant' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Allow the microphone/);
    expect(screen.getByRole('button', { name: 'Talk to the assistant' })).toBeOnTheScreen();
  });

  it('says so, and asks nothing, when no words were heard', async () => {
    const { server } = await open({ 'POST /api/assistant/transcribe': () => ({ text: '   ' }) });
    await fireEvent.press(await screen.findByRole('button', { name: 'Talk to the assistant' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Stop and send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not catch that/i);
    expect(server.calls.some((c) => c.path === '/api/assistant/message')).toBe(false);
  });

  it('explains a speech service that is down, in the server’s words', async () => {
    await open({ 'POST /api/assistant/transcribe': () => reply(503, { detail: 'voice is not set up on this server' }) });
    await fireEvent.press(await screen.findByRole('button', { name: 'Talk to the assistant' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Stop and send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('voice is not set up on this server');
  });
});

it('clears the conversation on Start over', async () => {
  const { server } = await open({
    'GET /api/assistant/thread': () => ({ turns: [{ id: 1, role: 'user', text: 'hello' }], pending_action: null }),
    'DELETE /api/assistant/thread': () => ({ cleared: true }),
  });
  await fireEvent.press(await screen.findByRole('button', { name: 'Start over' }));
  expect(await screen.findByText('Ask me about your cars')).toBeOnTheScreen();
  expect(server.calls.some((c) => c.method === 'DELETE' && c.path === '/api/assistant/thread')).toBe(true);
});

it('shows why a message did not go through', async () => {
  await open({ 'POST /api/assistant/message': () => reply(429, { detail: 'slow down a little, try again in 5s' }) });
  await ask('hello');
  expect(await screen.findByRole('alert')).toHaveTextContent('slow down a little, try again in 5s');
});
