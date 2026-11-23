import { formatSlot } from '@autosaarthi/core';

import { drivingCar, parkedCar, booked } from './fixtures';
import * as view from './view';

const rowTitles = (screen: { rows?: { title: string }[] }) => (screen.rows ?? []).map((row) => row.title);
const actionIds = (screen: { actions?: { id: string }[] }) => (screen.actions ?? []).map((action) => action.id);

describe('the car screen while parked', () => {
  it('says what is wearing, what it costs now and if it fails, and offers to book', () => {
    const screen = view.statusScreen(parkedCar());
    expect(screen).toMatchObject({ id: 'status', kind: 'pane', title: 'Bolero · MH12AB1001' });
    expect(screen.rows).toEqual([
      { title: 'Your water pump is wearing out', text: ['Urgent', 'About 5 days of driving left, on current use.'] },
      { title: 'Repair now ₹2,400', text: ['If it fails on the road ₹18,500'] },
    ]);
    expect(screen.actions).toEqual([
      { id: 'book', title: 'Book a service', primary: true, parkedOnly: true },
      { id: 'refresh', title: 'Refresh' },
    ]);
  });

  it('uses plural words for parts that are plural', () => {
    const screen = view.statusScreen(parkedCar({ alert: { component: 'brake_pads', severity: 'P2', days_to_failure: 12 } }));
    expect(screen.rows?.[0]).toMatchObject({ title: 'Your brake pads are wearing out', text: ['Soon', 'About 12 days of driving left, on current use.'] });
  });

  it('says so, in words, when there is no estimate of how long is left', () => {
    const screen = view.statusScreen(parkedCar({ alert: { component: 'battery', severity: 'P3', days_to_failure: null } }));
    expect(screen.rows?.[0].text).toEqual(['Worth watching', 'Wear is progressing on your current usage.']);
  });

  it('shows the booking instead of offering to book', () => {
    const screen = view.statusScreen(parkedCar({ booking: booked, slots: [] }));
    expect(screen.rows?.[2]).toEqual({ title: `Booked · ${formatSlot(booked.slot_start)}`, text: ['Pune Central'] });
    expect(actionIds(screen)).toEqual(['refresh']);
  });

  it('calls a held slot held, not booked', () => {
    const screen = view.statusScreen(parkedCar({ booking: { ...booked, status: 'held' }, slots: [] }));
    expect(screen.rows?.[2].title).toMatch(/^Held · /);
  });

  it('is quiet when the car is healthy, and has nothing to book', () => {
    const screen = view.statusScreen(parkedCar({ alert: null, economics: null, slots: [] }));
    expect(screen.rows).toEqual([
      { title: 'Everything reads normal', text: ['We only interrupt you when something is actually changing.'] },
    ]);
    expect(actionIds(screen)).toEqual(['refresh']);
  });

  it('offers no costs it was not given', () => {
    expect(rowTitles(view.statusScreen(parkedCar({ economics: null })))).toEqual(['Your water pump is wearing out']);
  });

  it('offers to change car only when there is more than one', () => {
    expect(actionIds(view.statusScreen(parkedCar(), { cars: 1 }))).toEqual(['book', 'refresh']);
    expect(actionIds(view.statusScreen(parkedCar(), { cars: 2 }))).toEqual(['book', 'cars']);
  });

  it('does not offer to book without a time to book', () => {
    expect(actionIds(view.statusScreen(parkedCar({ slots: [] })))).toEqual(['refresh']);
  });
});

describe('the car screen while the car moves', () => {
  it('holds one line, with nothing to tap', () => {
    const screen = view.statusScreen(drivingCar());
    expect(screen.rows).toEqual([{
      title: 'Water pump service needed within 5 days.',
      text: ["I'll call you about it.", 'Booking opens when you park.'],
    }]);
    expect(screen.actions).toEqual([]);
  });

  it('says what is booked, in the same one line', () => {
    const screen = view.statusScreen(drivingCar({ booking: booked }));
    expect(screen.rows).toEqual([{ title: `Water pump service booked for ${formatSlot(booked.slot_start)}.` }]);
  });

  it('is the healthy line when there is nothing wrong', () => {
    const screen = view.statusScreen(drivingCar({ alert: null, economics: null }));
    expect(rowTitles(screen)).toEqual(['Everything reads normal']);
    expect(screen.actions).toEqual([]);
  });

  it('keeps to what the server allows, whatever else it sends', () => {
    const stopped = view.statusScreen(parkedCar({
      drive: { state: 'STOPPED_BRIEF', basis: 'telemetry', speed_kmph: 0, observed_at: null },
      allowed: { touch: false, slots: false, max_elements: 1 },
    }));
    expect(stopped.rows).toHaveLength(1);
    expect(stopped.actions).toEqual([]);
  });

  it('says exactly the same during a brief stop, so a car stopping at every light does not change its screen at every light', () => {
    const stopped = view.statusScreen(drivingCar({ drive: { state: 'STOPPED_BRIEF', basis: 'telemetry', speed_kmph: 0, observed_at: null } }));
    expect(stopped).toEqual(view.statusScreen(drivingCar()));
  });

  it('reads well for a part that is plural', () => {
    const screen = view.statusScreen(drivingCar({ alert: { component: 'brake_pads', severity: 'P1', days_to_failure: 1 } }));
    expect(screen.rows?.[0].title).toBe('Brake pads service needed within 1 day.');
  });

  it('shows no tap target even when more rows are allowed: touch is the server\'s call', () => {
    const screen = view.statusScreen(drivingCar({ allowed: { touch: false, slots: false, max_elements: 3 } }));
    expect(screen.actions).toEqual([]);
  });
});

describe('booking', () => {
  it('lists the times the server sent, three at most, each tappable only when parked', () => {
    const screen = view.slotsScreen(parkedCar({ slots: [...parkedCar().slots, ...parkedCar().slots] }));
    expect(screen).toMatchObject({ id: 'slots', kind: 'list', title: 'Pick a time', back: true });
    expect(screen.rows).toHaveLength(3);
    expect(screen.rows?.[0]).toEqual({
      title: formatSlot(parkedCar().slots[0].slot_start),
      text: ['Pune Central'],
      action: 'slot:0',
      parkedOnly: true,
    });
  });

  it('says there are no times when there are none', () => {
    const screen = view.slotsScreen(drivingCar());
    expect(screen.rows).toEqual([]);
    expect(screen.empty).toBe('No times are free right now.');
  });

  it('shows the booking being made, and how it ended, as one pane of its own', () => {
    const slot = parkedCar().slots[0];
    const making = view.bookingScreen(slot);
    expect(making).toMatchObject({ id: 'booking', kind: 'pane', loading: true });
    expect(making.title).toBe(`Booking ${formatSlot(slot.slot_start)}`);

    const done = view.bookedScreen(slot);
    expect(done).toMatchObject({ id: 'booking', kind: 'pane', title: 'Booked' });
    expect(done.rows).toEqual([{ title: formatSlot(slot.slot_start), text: ['Pune Central', 'Nothing else is needed.'] }]);
    expect(done.actions).toEqual([{ id: 'done', title: 'Done', primary: true }]);

    const refused = view.refusedScreen('That time is no longer free.');
    expect(refused).toMatchObject({ id: 'booking', kind: 'pane', title: 'Not booked', actions: [{ id: 'back', title: 'Back', primary: true }] });
    expect(refused.rows).toEqual([{ title: 'That time is no longer free.' }]);
  });

  it('keeps the same header through the booking, which the host needs to call the result a refresh', () => {
    const slot = parkedCar().slots[0];
    expect(new Set([view.bookingScreen(slot), view.bookedScreen(slot), view.refusedScreen('x')].map((s) => !!s.back)).size).toBe(1);
  });
});

describe('more than one car', () => {
  it('lists them with their state, and marks the one on screen', () => {
    const screen = view.carsScreen([
      { vin: 'MH12AB1001', model: 'Bolero', severity: 'P1' },
      { vin: 'MH12AB1002', model: null, severity: null },
    ], 'MH12AB1001');
    expect(screen.rows).toEqual([
      { title: 'Bolero', text: ['MH12AB1001 · Urgent', 'Showing now'], action: 'car:MH12AB1001' },
      { title: 'MH12AB1002', text: ['MH12AB1002 · Healthy'], action: 'car:MH12AB1002' },
    ]);
  });
});

describe('the screens that are not about the car', () => {
  it('each say one thing, and offer a retry only where one would help', () => {
    expect(view.loadingScreen()).toMatchObject({ id: 'status', kind: 'pane', title: 'AutoSaarthi', loading: true });
    expect(view.signedOutScreen().actions).toEqual([]);
    expect(view.signedOutScreen().message).toMatch(/sign in/i);
    expect(view.notAnOwnerScreen().message).toMatch(/vehicle owners/);
    expect(view.noCarScreen().message).toMatch(/No car is registered/);
    expect(view.offlineScreen().actions).toEqual([{ id: 'retry', title: 'Try again', primary: true }]);
    expect(view.errorScreen('Boom').message).toBe('Boom');
  });

  it('are all the first screen, so each replaces the last', () => {
    for (const screen of [view.signedOutScreen(), view.notAnOwnerScreen(), view.noCarScreen(), view.offlineScreen(), view.errorScreen('x')]) {
      expect(screen).toMatchObject({ id: 'status', kind: 'message', title: 'AutoSaarthi' });
    }
    expect(view.loadingScreen().id).toBe('status');
  });
});
