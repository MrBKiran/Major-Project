/**
 * What the car's screen expects from the server (GET /api/car/{vin}/screen, backend app/car.py),
 * checked when it arrives — the same discipline as ../lib/schemas.ts, for the same reason: a
 * renamed or missing field becomes a clear "did not understand", not a car screen that quietly
 * shows less than it should.
 *
 * The part that matters most is `drive` and `allowed`. The server decides, from the car's own
 * readings, what state the car is in and what a screen may therefore offer; a reading that is
 * missing, stale or self-contradictory already arrives as DRIVING. Nothing in the app works the
 * drive state out for itself.
 */

import { z } from 'zod';

import { AlertSchema, BookingSchema, SlotSchema } from '@/lib/schemas';

export const DriveStateSchema = z.enum(['PARKED', 'STOPPED_BRIEF', 'DRIVING']);

export const CarScreenSchema = z.object({
  vin: z.string(),
  model: z.string(),
  odometer: z.number().nullable().optional().default(null),
  city: z.string().nullable().optional().default(null),
  drive: z.object({
    state: DriveStateSchema,
    basis: z.string(),
    speed_kmph: z.number().nullable(),
    observed_at: z.string().nullable(),
  }),
  allowed: z.object({
    touch: z.boolean(),
    slots: z.boolean(),
    /** G7: how many elements an alert may use while the car moves; null when parked. */
    max_elements: z.number().nullable(),
  }),
  alert: AlertSchema.nullable(),
  economics: z.object({ repair_inr: z.number(), breakdown_inr: z.number() }).nullable(),
  booking: BookingSchema.nullable(),
  slots: z.array(SlotSchema),
});

/** The cars an owner has, as the fleet list gives them. */
export const OwnedCarsSchema = z.object({
  vehicles: z.array(z.object({
    vin: z.string(),
    model: z.string().nullable().optional().default(null),
    severity: z.string().nullable(),
  })),
});

export const BookedSchema = z.object({ booked: z.boolean() });

export type CarScreen = z.infer<typeof CarScreenSchema>;
export type OwnedCar = z.infer<typeof OwnedCarsSchema>['vehicles'][number];
