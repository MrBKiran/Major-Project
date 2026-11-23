import { ApiError, type Principal } from '@/lib/api';
import { NOT_UNDERSTOOD } from '@/lib/schemas';

import { CarController, POLL_MS, STALE_AFTER_FAILURES, WATCH_MS } from './controller';
import { booked, drivingCar, FakeCar, parkedCar, VIN } from './fixtures';
import type { CarScreen } from './schema';

const VIN2 = 'MH12AB1002';
const OFFLINE = () => new ApiError(0, 'You are offline — this will work again when you have a connection.', undefined, true);

/** The server, as far as the car's screen can tell: scripted answers, and a record of what was asked. */
class FakeApi {
  calls: string[] = [];
  bodies: unknown[] = [];
  me: Principal = { scope_kind: 'owned', role: 'vehicle_owner' };
  signedIn = true;
  stored = false;
  restoreError: Error | null = null;
  routes = new Map<string, (body?: unknown) => unknown>();

  principal = () => (this.signedIn ? this.me : null);

  restore = async () => {
    this.calls.push('restore');
    if (this.restoreError) throw this.restoreError;
    if (this.stored) this.signedIn = true;
    return this.signedIn ? { principal: this.me } : null;
  };

  get = async <T = unknown>(path: string): Promise<T> => this.answer<T>(`GET ${path}`);

  post = async <T = unknown>(path: string, body?: unknown): Promise<T> => {
    this.bodies.push(body);
    return this.answer<T>(`POST ${path}`, body);
  };

  route(key: string, answer: (body?: unknown) => unknown): void { this.routes.set(key, answer); }

  private async answer<T>(key: string, body?: unknown): Promise<T> {
    this.calls.push(key);
    const handler = this.routes.get(key);
    if (!handler) throw new ApiError(404, `no route for ${key}`);
    return (await handler(body)) as T;
  }

  count(prefix: string): number { return this.calls.filter((c) => c.startsWith(prefix)).length; }
}

const FLEET = 'GET /api/fleet?limit=20';
const screenOf = (vin: string) => `GET /api/car/${vin}/screen`;
const book = (vin: string) => `POST /api/car/${vin}/book`;

function setup() {
  const car = new FakeCar();
  const api = new FakeApi();
  api.route(FLEET, () => ({ vehicles: [{ vin: VIN, model: 'Bolero', severity: 'P1' }] }));
  api.route(screenOf(VIN), () => parkedCar());
  const signedOut = new Set<() => void>();
  const controller = new CarController({
    native: car,
    api,
    onSignedOut: (listener) => { signedOut.add(listener); return () => { signedOut.delete(listener); }; },
    pollMs: POLL_MS,
    watchMs: WATCH_MS,
  });
  const stop = controller.start();
  return { car, api, stop, serverEndsSession: () => signedOut.forEach((l) => l()) };
}

/** Lets every promise that is ready run, and the timers due in `ms` fire. */
const advance = (ms = 0) => jest.advanceTimersByTimeAsync(ms);

/** A car connects and the first screen arrives. */
async function drive(setupResult = setup()) {
  setupResult.car.connect();
  await advance();
  return setupResult;
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('connecting', () => {
  it('asks the server nothing until a car is there', async () => {
    const { car, api } = setup();
    await advance(POLL_MS * 3);
    expect(api.calls).toEqual([]);
    expect(car.calls).toEqual([]);
  });

  it('shows a spinner at once, and then the car', async () => {
    const { car } = setup();
    car.connect();
    expect(car.first).toMatchObject({ id: 'status', kind: 'pane', loading: true });
    await advance();
    expect(car.first).toMatchObject({ id: 'status', kind: 'pane', title: 'Bolero · MH12AB1001' });
    expect(car.first?.loading).toBeFalsy();
    expect(car.stack).toEqual(['status']);
  });

  it('begins at once when a car is already connected as it starts', async () => {
    const car = new FakeCar();
    car.connected = true;
    const api = new FakeApi();
    api.route(FLEET, () => ({ vehicles: [{ vin: VIN, severity: null }] }));
    api.route(screenOf(VIN), () => parkedCar());
    new CarController({ native: car, api, onSignedOut: () => () => undefined }).start();
    await advance();
    expect(car.first?.kind).toBe('pane');
  });

  it('does not start twice if it is told twice', async () => {
    const { car, api } = setup();
    car.connect();
    car.emit('onConnected');
    await advance();
    expect(api.count(FLEET)).toBe(1);
  });

  it('stops listening when stopped', async () => {
    const { car, api, stop } = setup();
    stop();
    car.connect();
    await advance();
    expect(api.calls).toEqual([]);
  });
});

describe('signing in', () => {
  it('uses the session the phone already has, without renewing it', async () => {
    const { api } = await drive();
    expect(api.count('restore')).toBe(0);
  });

  it('resumes a stored session when the app was never opened', async () => {
    const s = setup();
    s.api.signedIn = false;
    s.api.stored = true;
    await drive(s);
    expect(s.api.count('restore')).toBe(1);
    expect(s.car.first?.kind).toBe('pane');
  });

  it('says to sign in on the phone, then follows when the owner does', async () => {
    const s = setup();
    s.api.signedIn = false;
    await drive(s);
    expect(s.car.first?.message).toMatch(/sign in/i);
    expect(s.api.count('GET')).toBe(0);

    s.api.signedIn = true;
    await advance(WATCH_MS);
    expect(s.car.first?.kind).toBe('pane');
  });

  it('is for owners only', async () => {
    const s = setup();
    s.api.me = { scope_kind: 'all', role: 'platform_admin' };
    await drive(s);
    expect(s.car.first?.message).toMatch(/vehicle owners/);
    expect(s.api.count('GET')).toBe(0);
    await advance(POLL_MS * 2);
    expect(s.api.count('GET')).toBe(0);
  });

  it('says so, and keeps trying, when it cannot reach the server', async () => {
    const s = setup();
    s.api.signedIn = false;
    s.api.restoreError = OFFLINE();
    await drive(s);
    expect(s.car.first?.message).toMatch(/No connection/);
    expect(s.car.first?.actions?.[0]).toMatchObject({ id: 'retry' });

    s.api.restoreError = null;
    s.api.signedIn = true;
    await advance(POLL_MS);
    expect(s.car.first?.kind).toBe('pane');
  });

  it('shows the sign-in message when the server ends the session', async () => {
    const s = await drive();
    // The real client forgets the session first, then says so (src/lib/api.ts).
    s.api.signedIn = false;
    s.serverEndsSession();
    expect(s.car.first?.message).toMatch(/sign in/i);
    const asked = s.api.count('GET');
    await advance(POLL_MS * 3);
    expect(s.api.count('GET')).toBe(asked);
  });

  it('has no car to show when the owner has none', async () => {
    const s = setup();
    s.api.route(FLEET, () => ({ vehicles: [] }));
    await drive(s);
    expect(s.car.first?.message).toMatch(/No car is registered/);
    expect(s.api.count(screenOf(VIN))).toBe(0);
  });
});

describe('keeping the screen right', () => {
  it('asks again every ten seconds, and draws nothing again when nothing changed', async () => {
    const s = await drive();
    const drawn = s.car.calls.length;
    await advance(POLL_MS);
    expect(s.api.count(screenOf(VIN))).toBe(2);
    await advance(POLL_MS);
    expect(s.api.count(screenOf(VIN))).toBe(3);
    expect(s.car.calls.length).toBe(drawn);
  });

  it('changes the words in place when the car says something new', async () => {
    const s = await drive();
    s.api.route(screenOf(VIN), () => parkedCar({ alert: { component: 'water_pump', severity: 'P1', days_to_failure: 2 } }));
    await advance(POLL_MS);
    expect(s.car.first?.rows?.[0].text?.[1]).toBe('About 2 days of driving left, on current use.');
    expect(s.car.count('root')).toBe(1); // the spinner; every later change was an update to it
  });

  it('takes the buttons away, and closes the time picker, as soon as the server stops allowing touch', async () => {
    const s = await drive();
    s.car.tap('status', 'book');
    await advance();
    expect(s.car.stack).toEqual(['status', 'slots']);

    s.api.route(screenOf(VIN), () => drivingCar());
    await advance(POLL_MS);
    expect(s.car.stack).toEqual(['status']);
    expect(s.car.first?.actions).toEqual([]);
    expect(s.car.first?.rows).toHaveLength(1);
  });

  it('refreshes the times while the picker is open', async () => {
    const s = await drive();
    s.car.tap('status', 'book');
    await advance();
    const [first, ...rest] = parkedCar().slots;
    s.api.route(screenOf(VIN), () => parkedCar({ slots: rest }));
    await advance(POLL_MS);
    expect(s.car.top?.rows).toHaveLength(2);
    expect(s.car.top?.rows?.[0].title).not.toContain(first.slot_start);
  });

  it('keeps what it knows through a moment of trouble, but not through a run of it', async () => {
    const s = await drive();
    s.api.route(screenOf(VIN), () => { throw OFFLINE(); });
    for (let i = 1; i < STALE_AFTER_FAILURES; i += 1) {
      await advance(POLL_MS);
      expect(s.car.first?.kind).toBe('pane');
    }
    await advance(POLL_MS);
    expect(s.car.first?.message).toMatch(/No connection/);

    s.api.route(screenOf(VIN), () => parkedCar());
    await advance(POLL_MS);
    expect(s.car.first?.kind).toBe('pane');
  });

  it('counts a good answer as the end of the trouble', async () => {
    const s = await drive();
    const flaky = jest.fn()
      .mockImplementationOnce(() => { throw OFFLINE(); })
      .mockImplementationOnce(() => { throw OFFLINE(); })
      .mockImplementationOnce(() => parkedCar())
      .mockImplementationOnce(() => { throw OFFLINE(); })
      .mockImplementationOnce(() => { throw OFFLINE(); });
    s.api.route(screenOf(VIN), flaky);
    await advance(POLL_MS * 5);
    expect(s.car.first?.kind).toBe('pane');
  });

  it('stops asking when the car goes, and drops an answer that arrives late', async () => {
    const s = setup();
    let answer: (screen: CarScreen) => void = () => undefined;
    s.api.route(screenOf(VIN), () => new Promise<CarScreen>((resolve) => { answer = resolve; }));
    s.car.connect();
    await advance();
    s.car.disconnect();
    const drawn = s.car.calls.length;
    answer(parkedCar());
    await advance(POLL_MS * 3);
    expect(s.car.calls.length).toBe(drawn);
    expect(s.api.count(screenOf(VIN))).toBe(1);
  });

  it('starts afresh when the car connects again', async () => {
    const s = await drive();
    s.car.disconnect();
    s.car.connect();
    expect(s.car.first).toMatchObject({ kind: 'pane', loading: true });
    await advance();
    expect(s.car.first?.loading).toBeFalsy();
    expect(s.car.first?.rows?.length).toBeGreaterThan(0);
  });

  it('says what it could not understand instead of showing less', async () => {
    const s = setup();
    s.api.route(screenOf(VIN), () => ({ vin: VIN }));
    await drive(s);
    expect(s.car.first?.message).toBe(NOT_UNDERSTOOD);

    s.api.route(screenOf(VIN), () => parkedCar());
    s.car.tap('status', 'retry');
    await advance();
    expect(s.car.first?.kind).toBe('pane');
  });

  it('refreshes on request', async () => {
    const s = await drive();
    s.car.tap('status', 'refresh');
    await advance();
    expect(s.api.count(screenOf(VIN))).toBe(2);
    expect(s.api.count(FLEET)).toBe(2);
  });
});

describe('booking', () => {
  async function opened() {
    const s = await drive();
    s.api.route(book(VIN), () => ({ booked: true, already_booked: false }));
    s.car.tap('status', 'book');
    await advance();
    return s;
  }

  it('opens the times the server sent', async () => {
    const s = await opened();
    expect(s.car.stack).toEqual(['status', 'slots']);
    expect(s.car.top?.rows).toHaveLength(3);
  });

  it('leaves the card underneath alone while the times are open, and draws it again when they close', async () => {
    const s = await opened();
    const before = s.car.first;
    s.api.route(screenOf(VIN), () => parkedCar({ alert: { component: 'water_pump', severity: 'P1', days_to_failure: 2 } }));
    const callsBefore = s.car.calls.length;

    await advance(POLL_MS);
    expect(s.car.first).toBe(before);
    // Whatever was sent to the car meanwhile, none of it was the card.
    const sent = s.car.calls.slice(callsBefore).map(([, arg]) => (arg as { id?: string } | null)?.id);
    expect(sent).not.toContain('status');

    s.car.pop();
    await advance();
    expect(s.car.first?.rows?.[0].text?.[1]).toBe('About 2 days of driving left, on current use.');
  });

  it('books the time that was tapped, shows it, and puts the booking on the first screen', async () => {
    const s = await opened();
    const chosen = parkedCar().slots[1];
    s.api.route(screenOf(VIN), () => parkedCar({ booking: { ...booked, slot_start: chosen.slot_start }, slots: [] }));

    s.car.tap('slots', 'slot:1');
    await advance();

    expect(s.api.count(book(VIN))).toBe(1);
    expect(s.api.bodies.at(-1)).toEqual({ center_id: chosen.center_id, slot_start: chosen.slot_start });
    expect(s.car.stack).toEqual(['status', 'slots', 'booking']);
    expect(s.car.top).toMatchObject({ id: 'booking', kind: 'pane', title: 'Booked' });
    // The card underneath is not touched while the flow is open ...
    expect(s.car.first?.rows?.some((row) => row.title.startsWith('Booked · '))).toBe(false);

    // ... and says what is booked as soon as the flow closes.
    s.car.tap('booking', 'done');
    await advance();
    expect(s.car.stack).toEqual(['status']);
    expect(s.car.first?.rows?.some((row) => row.title.startsWith('Booked · '))).toBe(true);
    expect(s.car.first?.actions?.map((a) => a.id)).toEqual(['refresh']);
  });

  it('shows a spinner while the booking is made', async () => {
    const s = await opened();
    let finish: (value: unknown) => void = () => undefined;
    s.api.route(book(VIN), () => new Promise((resolve) => { finish = resolve; }));
    s.car.tap('slots', 'slot:0');
    await advance();
    expect(s.car.top).toMatchObject({ id: 'booking', kind: 'pane', loading: true });
    finish({ booked: true });
    await advance();
    expect(s.car.top?.title).toBe('Booked');
    expect(s.car.top?.loading).toBeFalsy();
  });

  it('books once however many times it is tapped', async () => {
    const s = await opened();
    let finish: (value: unknown) => void = () => undefined;
    s.api.route(book(VIN), () => new Promise((resolve) => { finish = resolve; }));
    s.car.tap('slots', 'slot:0');
    s.car.tap('slots', 'slot:0');
    s.car.tap('slots', 'slot:1');
    await advance();
    finish({ booked: true });
    await advance();
    expect(s.api.count(book(VIN))).toBe(1);
  });

  it('shows the server\'s reason when it refuses, and goes back on request', async () => {
    const s = await opened();
    s.api.route(book(VIN), () => { throw new ApiError(409, 'that slot is no longer free'); });
    s.car.tap('slots', 'slot:0');
    await advance();
    expect(s.car.top).toMatchObject({ id: 'booking', title: 'Not booked' });
    expect(s.car.top?.rows).toEqual([{ title: 'that slot is no longer free' }]);

    s.car.tap('booking', 'back');
    await advance();
    expect(s.car.stack).toEqual(['status']);
  });

  it('says plainly when the booking could not be made for want of a connection', async () => {
    const s = await opened();
    s.api.route(book(VIN), () => { throw OFFLINE(); });
    s.car.tap('slots', 'slot:0');
    await advance();
    expect(s.car.top?.rows).toEqual([{ title: 'No connection. The booking was not made.' }]);
  });

  it('never books a time the server did not offer', async () => {
    const s = await opened();
    s.car.tap('slots', 'slot:9');
    s.car.tap('slots', 'slot:-1');
    s.car.tap('slots', 'slot:abc');
    await advance();
    expect(s.api.count(book(VIN))).toBe(0);
  });

  it('never books, or even opens the times, while the server says the car is not parked', async () => {
    const s = await drive();
    s.api.route(screenOf(VIN), () => drivingCar());
    await advance(POLL_MS);
    s.api.route(book(VIN), () => ({ booked: true }));

    s.car.tap('status', 'book');
    s.car.tap('slots', 'slot:0');
    await advance();
    expect(s.car.stack).toEqual(['status']);
    expect(s.api.count(book(VIN))).toBe(0);
  });

  it('does not open the times when there are none to offer', async () => {
    const s = await drive();
    s.api.route(screenOf(VIN), () => parkedCar({ slots: [] }));
    await advance(POLL_MS);
    s.car.tap('status', 'book');
    await advance();
    expect(s.car.stack).toEqual(['status']);
  });

  it('closes the confirmation, and says what is booked in one line, if the car has started to move', async () => {
    const s = await opened();
    s.car.tap('slots', 'slot:0');
    await advance();
    expect(s.car.top?.title).toBe('Booked');

    s.api.route(screenOf(VIN), () => drivingCar({ booking: booked }));
    await advance(POLL_MS);
    expect(s.car.stack).toEqual(['status']);
    expect(s.car.first?.rows?.[0].title).toMatch(/service booked for/);
    expect(s.car.first?.actions).toEqual([]);
  });
});

describe('more than one car', () => {
  function two() {
    const s = setup();
    s.api.route(FLEET, () => ({
      vehicles: [{ vin: VIN, model: 'Bolero', severity: 'P1' }, { vin: VIN2, model: 'Thar', severity: null }],
    }));
    s.api.route(screenOf(VIN2), () => parkedCar({ vin: VIN2, model: 'Thar', alert: null, economics: null, slots: [] }));
    return s;
  }

  it('starts with the car that has something to say, and offers the others', async () => {
    const s = two();
    s.api.route(FLEET, () => ({
      vehicles: [{ vin: VIN2, model: 'Thar', severity: null }, { vin: VIN, model: 'Bolero', severity: 'P1' }],
    }));
    await drive(s);
    expect(s.car.first?.title).toBe('Bolero · MH12AB1001');
    expect(s.car.first?.actions?.map((a) => a.id)).toEqual(['book', 'cars']);
  });

  it('switches car, and stays on it', async () => {
    const s = two();
    await drive(s);
    s.car.tap('status', 'cars');
    await advance();
    expect(s.car.top).toMatchObject({ id: 'cars', title: 'Choose a car' });

    s.car.tap('cars', `car:${VIN2}`);
    await advance();
    expect(s.car.stack).toEqual(['status']);
    expect(s.car.first?.title).toBe('Thar · MH12AB1002');

    await advance(POLL_MS);
    expect(s.api.count(screenOf(VIN2))).toBeGreaterThan(1);
    expect(s.car.first?.title).toBe('Thar · MH12AB1002');
  });

  it('does not let a slow answer about the old car land on the new one', async () => {
    const s = two();
    await drive(s);
    s.car.tap('status', 'cars');
    await advance();

    let late: (screen: CarScreen) => void = () => undefined;
    s.api.route(screenOf(VIN), () => new Promise<CarScreen>((resolve) => { late = resolve; }));
    await advance(POLL_MS); // a poll for the old car is now waiting
    s.car.tap('cars', `car:${VIN2}`);
    await advance();
    late(parkedCar());
    await advance();
    expect(s.car.first?.title).toBe('Thar · MH12AB1002');
  });

  it('ignores a car that is not the owner\'s', async () => {
    const s = two();
    await drive(s);
    s.car.tap('cars', 'car:MH99ZZ9999');
    await advance();
    expect(s.api.count('GET /api/car/MH99ZZ9999')).toBe(0);
    expect(s.car.first?.title).toBe('Bolero · MH12AB1001');
  });
});
