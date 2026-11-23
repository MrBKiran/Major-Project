/** Test fixtures for the car's screen: a car screen as the server sends it, and a fake car to draw on. */

import type { CarNative, CarScreenModel } from './model';
import type { CarScreen } from './schema';

export const VIN = 'MH12AB1001';

const slot = (n: number) => ({
  center_id: 'SC-PUN-01',
  center_name: 'Pune Central',
  city: 'Pune',
  slot_start: `2026-11-${23 + n}T09:00:00+05:30`,
  slot_end: `2026-11-${23 + n}T10:00:00+05:30`,
});

/** A parked car with a worn water pump and three times on offer — the whole screen, as the server allows it. */
export function parkedCar(overrides: Partial<CarScreen> = {}): CarScreen {
  return {
    vin: VIN,
    model: 'Bolero',
    odometer: 128_400,
    city: 'Pune',
    drive: { state: 'PARKED', basis: 'telemetry', speed_kmph: 0, observed_at: '2026-11-23T09:00:00+05:30' },
    allowed: { touch: true, slots: true, max_elements: null },
    alert: { component: 'water_pump', severity: 'P1', days_to_failure: 5 },
    economics: { repair_inr: 2400, breakdown_inr: 18500 },
    booking: null,
    slots: [slot(0), slot(1), slot(2)],
    ...overrides,
  };
}

/** The same car while it moves: the server sends no times, allows no touch and caps an alert at one element. */
export function drivingCar(overrides: Partial<CarScreen> = {}): CarScreen {
  return parkedCar({
    drive: { state: 'DRIVING', basis: 'telemetry', speed_kmph: 68, observed_at: '2026-11-23T09:00:00+05:30' },
    allowed: { touch: false, slots: false, max_elements: 1 },
    slots: [],
    ...overrides,
  });
}

export const booked = {
  appointment_id: 'APT-1',
  center_id: 'SC-PUN-01',
  center_name: 'Pune Central',
  city: 'Pune',
  slot_start: '2026-11-23T09:00:00+05:30',
  status: 'booked',
};

type Handler = (payload: never) => void;

/** A car that remembers what it was shown, with a stack like the real one and a way to tap. */
export class FakeCar implements CarNative {
  connected = false;
  models = new Map<string, CarScreenModel>();
  stack: string[] = [];
  calls: [string, unknown][] = [];
  private handlers = new Map<string, Set<Handler>>();

  isConnected = () => this.connected;

  root(screen: CarScreenModel): boolean {
    this.calls.push(['root', screen]);
    this.models = new Map([[screen.id, screen]]);
    this.stack = [screen.id];
    this.emit('onStack', { ids: [...this.stack] });
    return true;
  }

  push(screen: CarScreenModel): boolean {
    this.calls.push(['push', screen]);
    this.models.set(screen.id, screen);
    if (this.stack[this.stack.length - 1] !== screen.id) this.stack.push(screen.id);
    this.emit('onStack', { ids: [...this.stack] });
    return true;
  }

  update(screen: CarScreenModel): boolean {
    this.calls.push(['update', screen]);
    if (!this.models.has(screen.id)) return false;
    this.models.set(screen.id, screen);
    return true;
  }

  pop(toId?: string | null): boolean {
    this.calls.push(['pop', toId ?? null]);
    if (!toId) {
      if (this.stack.length > 1) this.stack.pop();
    } else if (this.stack.includes(toId)) {
      this.stack = this.stack.slice(0, this.stack.indexOf(toId) + 1);
    }
    this.models = new Map([...this.models].filter(([id]) => this.stack.includes(id)));
    this.emit('onStack', { ids: [...this.stack] });
    return true;
  }

  on(event: string, handler: Handler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => { this.handlers.get(event)!.delete(handler); };
  }

  emit(event: string, payload?: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload as never));
  }

  // ── what a test does and asks ────────────────────────────────────────────────────────────────

  connect(): void { this.connected = true; this.emit('onConnected'); }
  disconnect(): void { this.connected = false; this.emit('onDisconnected'); }
  tap(screen: string, action: string): void { this.emit('onAction', { screen, action }); }

  /** The screen on top, as drawn. */
  get top(): CarScreenModel | undefined { return this.models.get(this.stack[this.stack.length - 1]); }
  get first(): CarScreenModel | undefined { return this.models.get(this.stack[0]); }
  count(kind: string): number { return this.calls.filter(([name]) => name === kind).length; }
}
