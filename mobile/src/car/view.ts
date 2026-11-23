/**
 * What is on the car's screen, from what the server said about the car.
 *
 * Pure functions: a server reply in, a screen out. They mirror the web head unit
 * (frontend/src/pages/InCarConsole.jsx) and use the same owner words (@autosaarthi/core), so the
 * phone, the web and the car say the same thing in the same way.
 *
 * There is no "if the car is moving" of its own in here. The server decides the drive state and
 * what it allows (`allowed.touch`, `allowed.slots`, `allowed.max_elements` — the G6 and G7 rules in
 * config/agent_policy.yaml); this file offers a button only when touch is allowed, sends the slot
 * list only when slots are, and never shows more rows than G7 permits. A car that is moving, or
 * whose reading is missing or stale (the server counts both as moving), gets one line and nothing
 * to tap.
 */

import {
  componentLabel, drivingLeft, formatINR, formatSlot, OWNER, serviceDue, severityWord, wearingOut,
} from '@autosaarthi/core';

import type { Slot } from '@/lib/schemas';

import type { CarAction, CarRow, CarScreenModel } from './model';
import type { CarScreen, OwnedCar } from './schema';

/**
 * Screen ids: what the controller updates and pops to.
 *
 * The car's host allows five templates in a task and closes the app on a sixth, and only a change that
 * keeps a screen's title and its rows' titles counts as a refresh that costs nothing (Refresh.kt). So
 * the words that change as the car does — how many days are left, which time is free — are the *text*
 * under a title, and a screen whose titles must change is replaced by a new one natively. What these
 * builders must keep is that each screen holds its kind of template for as long as it lives.
 */
export const STATUS = 'status';
export const SLOTS = 'slots';
export const CARS = 'cars';
export const BOOKING = 'booking';

/** The most times offered at once; the server sends no more, and a car's list is short. */
const MAX_SLOTS = 3;

const sentence = (text: string): string => (text ? text[0].toUpperCase() + text.slice(1) : text);

// ── things that are not about the car ───────────────────────────────────────────────────────────

function notice(message: string, actions: CarAction[] = [], loading = false): CarScreenModel {
  return { id: STATUS, kind: 'message', title: 'AutoSaarthi', message, actions, loading };
}

/** A loading *pane*: the first card is also a pane, and the host counts a pane that follows a loading one as free. */
export const loadingScreen = (): CarScreenModel => ({ id: STATUS, kind: 'pane', title: 'AutoSaarthi', loading: true });

export const signedOutScreen = (): CarScreenModel =>
  notice('Open AutoSaarthi on your phone and sign in. This screen updates by itself.');

export const notAnOwnerScreen = (): CarScreenModel =>
  notice('AutoSaarthi in the car is for vehicle owners. Sign in on your phone with the owner account.');

export const noCarScreen = (): CarScreenModel =>
  notice('No car is registered to this account yet. Your service centre adds it when they register you.');

export const offlineScreen = (): CarScreenModel =>
  notice('No connection right now. AutoSaarthi keeps trying.', [{ id: 'retry', title: 'Try again', primary: true }]);

export const errorScreen = (message: string): CarScreenModel =>
  notice(message, [{ id: 'retry', title: 'Try again', primary: true }]);

// ── the car ─────────────────────────────────────────────────────────────────────────────────────

/** The root screen: how the car is, and what can be done about it right now. */
export function statusScreen(s: CarScreen, { cars = 1 }: { cars?: number } = {}): CarScreenModel {
  const { alert, booking, economics } = s;
  const days = alert?.days_to_failure ?? null;
  const rows: CarRow[] = [];

  if (!alert) {
    rows.push({ title: OWNER.healthyTitle, text: ['We only interrupt you when something is actually changing.'] });
  } else if (s.drive.state !== 'PARKED') {
    // Moving, or stopped for a moment: one line, voice-first, and the same line for both — a car that
    // stops at every traffic light must not change what it says at every one. G7 allows one element;
    // the two lines under the title are part of it.
    const part = sentence(componentLabel(alert.component));
    rows.push(booking
      ? { title: `${part} service booked for ${formatSlot(booking.slot_start)}.` }
      : {
        title: `${part} service needed${days !== null ? ` ${serviceDue(days)}` : ''}.`,
        text: ["I'll call you about it.", 'Booking opens when you park.'],
      });
  } else {
    // Parked: the whole picture.
    const left = drivingLeft(days);
    rows.push({
      title: wearingOut(alert.component),
      text: [severityWord(alert.severity), left ? `${left}, on current use.` : 'Wear is progressing on your current usage.'],
    });
    if (economics) {
      rows.push({
        title: `${OWNER.repairNow} ${formatINR(economics.repair_inr)}`,
        text: [`${OWNER.failsOnRoad} ${formatINR(economics.breakdown_inr)}`],
      });
    }
    if (booking) {
      rows.push({
        title: `${booking.status === 'booked' ? 'Booked' : 'Held'} · ${formatSlot(booking.slot_start)}`,
        text: [booking.center_name],
      });
    }
  }

  // G7: while the car moves, an alert may use at most this many elements.
  const cap = s.allowed.max_elements;
  const shown = cap === null ? rows : rows.slice(0, cap);

  const actions: CarAction[] = [];
  if (s.allowed.touch) {
    if (alert && !booking && s.allowed.slots && s.slots.length > 0) {
      actions.push({ id: 'book', title: OWNER.book, primary: true, parkedOnly: true });
    }
    actions.push(cars > 1 ? { id: 'cars', title: 'Change car' } : { id: 'refresh', title: 'Refresh' });
  }

  return { id: STATUS, kind: 'pane', title: `${s.model} · ${s.vin}`, rows: shown, actions };
}

// ── booking ─────────────────────────────────────────────────────────────────────────────────────

/** The times to choose from. The server sends none while the car moves, so this is empty then. */
export function slotsScreen(s: CarScreen): CarScreenModel {
  return {
    id: SLOTS,
    kind: 'list',
    title: 'Pick a time',
    back: true,
    empty: 'No times are free right now.',
    rows: s.slots.slice(0, MAX_SLOTS).map((slot, i) => ({
      title: formatSlot(slot.slot_start),
      text: [slot.center_name],
      action: `slot:${i}`,
      parkedOnly: true,
    })),
  };
}

/**
 * The booking, from the tap to the answer, is one screen of its own: a pane that is loading, then the
 * same pane with the result — which the host counts as a refresh, so the whole flow costs three
 * templates (the card, the times, this). It has no back arrow: its way out is its button, and going back
 * to a list of times that no longer exist would only confuse.
 */
export const bookingScreen = (slot: Slot): CarScreenModel =>
  ({ id: BOOKING, kind: 'pane', title: `Booking ${formatSlot(slot.slot_start)}`, loading: true });

export const bookedScreen = (slot: Slot): CarScreenModel => ({
  id: BOOKING,
  kind: 'pane',
  title: 'Booked',
  rows: [{ title: formatSlot(slot.slot_start), text: [slot.center_name, 'Nothing else is needed.'] }],
  actions: [{ id: 'done', title: 'Done', primary: true }],
});

export const refusedScreen = (reason: string): CarScreenModel => ({
  id: BOOKING,
  kind: 'pane',
  title: 'Not booked',
  rows: [{ title: reason }],
  actions: [{ id: 'back', title: 'Back', primary: true }],
});

// ── more than one car ───────────────────────────────────────────────────────────────────────────

export function carsScreen(cars: OwnedCar[], selected: string | null): CarScreenModel {
  return {
    id: CARS,
    kind: 'list',
    title: 'Choose a car',
    back: true,
    rows: cars.map((car) => ({
      title: car.model ?? car.vin,
      text: [
        `${car.vin} · ${car.severity ? severityWord(car.severity) : 'Healthy'}`,
        ...(car.vin === selected ? ['Showing now'] : []),
      ],
      action: `car:${car.vin}`,
    })),
  };
}
