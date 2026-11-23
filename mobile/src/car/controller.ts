/**
 * Runs the car's screen: when the car connects it signs in (as the phone already is), asks the
 * server about the owner's car, sends the screens to the car, keeps them fresh, and carries out
 * what the driver taps — including the one irreversible thing, booking a service.
 *
 * It decides nothing about safety. The server reads the car's own telemetry and says what state the
 * car is in and what a screen may offer (backend app/car.py); this controller only shows what it is
 * told it may, polls so a reading that goes stale is noticed, and takes the tap targets away the
 * moment the server stops allowing them. A booking is checked again on the server, and by the car's
 * own host (`parkedOnly`).
 *
 * Two rules come from the car's host, which allows five templates in a task and closes the app on a
 * sixth (modules/autosaarthi-car, Refresh.kt):
 *   - only the screen the driver is looking at is ever changed. A flow that is open (the times, a
 *     booking, the list of cars) leaves the card underneath alone, and the card is drawn again when
 *     the flow closes — so a screen is never changed while hidden, which the host punishes.
 *   - flows are short: card, times, booking — three templates.
 *
 * It owns no UI and no timers of its own beyond one poll, and everything it touches is passed in, so
 * the whole thing runs in tests without a phone or a car.
 */

import { ZodError } from 'zod';

import { ApiError, type ApiClient } from '@/lib/api';
import { NOT_UNDERSTOOD } from '@/lib/schemas';

import type { CarNative, CarScreenModel } from './model';
import { BookedSchema, CarScreenSchema, OwnedCarsSchema, type CarScreen, type OwnedCar } from './schema';
import * as view from './view';

/**
 * How often the car asks again. A reading older than two minutes counts as no reading at all (the
 * server then treats the car as moving), so the screen has to notice it ageing — the web head unit
 * polls at the same rate.
 */
export const POLL_MS = 10_000;

/** Failed polls in a row before the car stops showing what it last knew: a stale "Book" is worse than none. */
export const STALE_AFTER_FAILURES = 3;

/** How often a car waiting for the owner to sign in on the phone checks whether they have. */
export const WATCH_MS = 5_000;

type Api = Pick<ApiClient, 'get' | 'post' | 'restore' | 'principal'>;

export interface CarControllerOptions {
  native: CarNative;
  api: Api;
  /** Called when the server ends the session. Returns how to stop listening. */
  onSignedOut(listener: () => void): () => void;
  pollMs?: number;
  watchMs?: number;
}

type Timer = ReturnType<typeof setInterval>;

function describe(error: unknown): string {
  if (error instanceof ZodError) return NOT_UNDERSTOOD;
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Try again.';
}

export class CarController {
  private readonly native: CarNative;
  private readonly api: Api;
  private readonly pollMs: number;
  private readonly watchMs: number;
  private readonly onSignedOut: CarControllerOptions['onSignedOut'];

  private connected = false;
  /** Bumped whenever the car connects, leaves or the sign-in changes: an answer that arrives for an older one is dropped. */
  private generation = 0;
  private vin: string | null = null;
  private cars: OwnedCar[] = [];
  private screen: CarScreen | null = null;
  /** The ids of the screens open on the car, first screen first — as the car reports them. */
  private stack: string[] = [];
  private booking = false;
  private root: CarScreenModel | null = null;
  private failures = 0;
  private poller: Timer | null = null;
  private watcher: Timer | null = null;
  private subscriptions: (() => void)[] = [];
  /** The load now under way and which car and sign-in it is for, so a second request for the same does not ask twice. */
  private inFlight: { key: string; promise: Promise<void> } | null = null;

  constructor(options: CarControllerOptions) {
    this.native = options.native;
    this.api = options.api;
    this.onSignedOut = options.onSignedOut;
    this.pollMs = options.pollMs ?? POLL_MS;
    this.watchMs = options.watchMs ?? WATCH_MS;
  }

  /** Starts listening to the car. If one is already connected, begins at once. Returns how to stop. */
  start(): () => void {
    this.subscriptions = [
      this.native.on('onConnected', () => this.connect()),
      this.native.on('onDisconnected', () => this.disconnect()),
      this.native.on('onAction', ({ screen, action }) => { void this.act(screen, action); }),
      this.native.on('onStack', ({ ids }) => this.stackChanged(ids)),
      this.onSignedOut(() => { if (this.connected) this.signedOut(); }),
    ];
    if (this.native.isConnected()) this.connect();
    return () => this.stop();
  }

  stop(): void {
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.subscriptions = [];
    this.disconnect();
  }

  // ── the car comes and goes ────────────────────────────────────────────────────────────────────

  private connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.failures = 0;
    this.stack = [];
    this.root = null;
    this.showRoot(view.loadingScreen());
    void this.boot(++this.generation);
  }

  private disconnect(): void {
    this.connected = false;
    this.generation += 1;
    this.stopPolling();
    this.stopWatching();
    this.screen = null;
    this.stack = [];
    this.root = null;
    this.booking = false;
    this.inFlight = null;
  }

  /**
   * The car says which screens are open. When a flow closes — Done, a back press, or the picker closed
   * because the car started to move — the card underneath, which was left alone meanwhile, is drawn again.
   */
  private stackChanged(ids: string[]): void {
    const closed = this.stack.length > 1 && ids.length <= 1;
    this.stack = ids;
    if (closed && this.connected && this.screen) void this.reload(this.generation, false);
  }

  // ── signing in and loading ────────────────────────────────────────────────────────────────────

  private async boot(gen: number): Promise<void> {
    try {
      let principal = this.api.principal();
      if (!principal) principal = (await this.api.restore())?.principal ?? null;
      if (gen !== this.generation) return;
      if (!principal) { this.signedOut(); return; }
    } catch (error) {
      if (gen === this.generation) { this.fail(error); this.startPolling(gen); }
      return;
    }
    if (!this.ownerOnly()) return;
    await this.reload(gen, true);
    if (gen === this.generation) this.startPolling(gen);
  }

  /** The car's screen is for owners, as the phone app is. Anyone else is turned away, quietly. */
  private ownerOnly(): boolean {
    const principal = this.api.principal();
    if (principal && principal.scope_kind !== 'owned') {
      this.stopPolling();
      this.screen = null;
      this.showRoot(view.notAnOwnerScreen());
      return false;
    }
    return true;
  }

  private signedOut(): void {
    this.generation += 1;
    this.stopPolling();
    this.screen = null;
    this.cars = [];
    this.vin = null;
    this.inFlight = null;
    this.showRoot(view.signedOutScreen());
    this.watchForSignIn();
  }

  /** The owner may sign in on the phone while the car is connected; the car picks it up without being asked. */
  private watchForSignIn(): void {
    this.stopWatching();
    this.watcher = setInterval(() => {
      if (!this.connected || !this.api.principal()) return;
      this.stopWatching();
      void this.boot(++this.generation);
    }, this.watchMs);
  }

  private stopWatching(): void {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = null;
  }

  private async fetchCars(): Promise<OwnedCar[]> {
    return OwnedCarsSchema.parse(await this.api.get('/api/fleet?limit=20')).vehicles;
  }

  /** The car with something to say, if the owner has several: the same rule as the phone's home screen. */
  private chooseVin(cars: OwnedCar[]): string | null {
    if (this.vin && cars.some((car) => car.vin === this.vin)) return this.vin;
    return (cars.find((car) => car.severity) ?? cars[0])?.vin ?? null;
  }

  /**
   * Fetches (the cars, if asked, and) the screen for the car shown, and draws it. A request for what is
   * already being fetched — the card refreshing as a flow closes while the poll is under way — shares it.
   */
  private reload(gen: number, withCars: boolean): Promise<void> {
    const key = `${gen}:${this.vin ?? ''}`;
    if (!withCars && this.inFlight?.key === key) return this.inFlight.promise;
    const promise = this.load(gen, withCars).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    });
    this.inFlight = { key, promise };
    return promise;
  }

  private async load(gen: number, withCars: boolean): Promise<void> {
    try {
      if (!this.ownerOnly()) return;
      if (withCars || !this.vin) {
        const cars = await this.fetchCars();
        if (gen !== this.generation) return;
        this.cars = cars;
        this.vin = this.chooseVin(cars);
      }
      if (!this.vin) {
        this.screen = null;
        this.showRoot(view.noCarScreen());
        return;
      }
      const vin = this.vin;
      const screen = CarScreenSchema.parse(await this.api.get(`/api/car/${vin}/screen`));
      // A slow answer about the car that was showing a moment ago must not land on this one's screen.
      if (gen !== this.generation || vin !== this.vin) return;
      if (!this.ownerOnly()) return;
      this.failures = 0;
      this.screen = screen;
      this.render();
    } catch (error) {
      if (gen === this.generation) this.fail(error);
    }
  }

  private fail(error: unknown): void {
    this.failures += 1;
    // A moment's trouble keeps what is on screen; a run of it does not (see STALE_AFTER_FAILURES).
    if (this.screen && this.failures < STALE_AFTER_FAILURES) return;
    this.screen = null;
    this.showRoot(error instanceof ApiError && error.offline ? view.offlineScreen() : view.errorScreen(describe(error)));
  }

  private startPolling(gen: number): void {
    this.stopPolling();
    this.poller = setInterval(() => {
      if (gen === this.generation && !this.booking) void this.reload(gen, false);
    }, this.pollMs);
  }

  private stopPolling(): void {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  // ── drawing ───────────────────────────────────────────────────────────────────────────────────

  /**
   * The first screen. What is drawn is the same words, or new ones; whether the car's host counts the
   * change against its quota, and so whether it is drawn in place or on a new screen, is for the native
   * side to decide (Refresh.kt). The first call, or one the native side has no screen for, sets it up.
   */
  private showRoot(next: CarScreenModel): void {
    const previous = this.root;
    this.root = next;
    if (previous && previous.id === next.id) {
      if (JSON.stringify(previous) === JSON.stringify(next)) return;
      if (this.native.update(next)) return;
    }
    this.native.root(next);
  }

  private render(): void {
    const s = this.screen;
    if (!s) return;

    if (this.stack.length > 1) {
      if (s.allowed.touch) {
        // A flow is open. Leave the card underneath alone — it is drawn again when the flow closes —
        // and keep the times fresh if they are what is showing.
        if (this.stack[this.stack.length - 1] === view.SLOTS) this.native.update(view.slotsScreen(s));
        return;
      }
      // Nothing to tap while the server does not allow it: close whatever was open for tapping.
      this.native.pop(view.STATUS);
    }
    this.showRoot(view.statusScreen(s, { cars: this.cars.length }));
  }

  // ── what the driver taps ──────────────────────────────────────────────────────────────────────

  private async act(_screen: string, action: string): Promise<void> {
    if (!this.connected) return;
    const gen = this.generation;
    if (action === 'retry' || action === 'refresh') {
      await this.reload(gen, true);
    } else if (action === 'book') {
      this.openSlots();
    } else if (action === 'cars') {
      await this.openCars(gen);
    } else if (action.startsWith('car:')) {
      await this.chooseCar(gen, action.slice('car:'.length));
    } else if (action.startsWith('slot:')) {
      await this.book(gen, Number(action.slice('slot:'.length)));
    } else if (action === 'done' || action === 'back') {
      // The card is drawn again when the car reports the screens have closed (stackChanged).
      this.native.pop(view.STATUS);
    }
  }

  /** Only when the server has said touch is allowed and sent times; otherwise there was nothing to tap. */
  private openSlots(): void {
    const s = this.screen;
    if (!s || !s.allowed.touch || s.drive.state !== 'PARKED' || s.slots.length === 0) return;
    this.native.push(view.slotsScreen(s));
  }

  private async openCars(gen: number): Promise<void> {
    try {
      const cars = await this.fetchCars();
      if (gen !== this.generation) return;
      this.cars = cars;
      this.native.push(view.carsScreen(cars, this.vin));
    } catch (error) {
      if (gen === this.generation) this.fail(error);
    }
  }

  private async chooseCar(gen: number, vin: string): Promise<void> {
    if (!this.cars.some((car) => car.vin === vin)) return;
    this.vin = vin;
    this.screen = null;
    this.inFlight = null;
    this.native.pop(view.STATUS);
    this.showRoot(view.loadingScreen());
    await this.reload(gen, false);
  }

  private async book(gen: number, index: number): Promise<void> {
    const s = this.screen;
    const slot = s?.slots[index];
    // One booking at a time, only a time the server offered, and only while the server says parked.
    if (!s || !slot || this.booking || !s.allowed.touch || s.drive.state !== 'PARKED') return;

    this.booking = true;
    this.native.push(view.bookingScreen(slot));
    try {
      BookedSchema.parse(await this.api.post(`/api/car/${s.vin}/book`, {
        center_id: slot.center_id,
        slot_start: slot.slot_start,
      }));
      if (gen !== this.generation) return;
      this.native.update(view.bookedScreen(slot));
    } catch (error) {
      if (gen !== this.generation) return;
      this.native.update(view.refusedScreen(error instanceof ApiError && error.offline
        ? 'No connection. The booking was not made.'
        : describe(error)));
    } finally {
      this.booking = false;
    }
    // The card says what is booked once the flow closes (stackChanged); the next refresh updates what is known.
  }
}
