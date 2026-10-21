/**
 * What the app expects from the server, checked when it arrives. A renamed or
 * missing field becomes a clear "did not understand" instead of a screen that
 * silently shows nothing — the way a `name` / `full_name` mix-up once went
 * unnoticed. The screens' types are inferred from these, so they cannot drift.
 */

import { z } from 'zod';

const nullableNumber = z.number().nullable();

export const SlotSchema = z.object({
  center_id: z.string(),
  center_name: z.string(),
  city: z.string(),
  slot_start: z.string(),
  slot_end: z.string().optional(),
});

export const BookingSchema = z.object({
  appointment_id: z.string(),
  center_id: z.string(),
  center_name: z.string(),
  city: z.string(),
  slot_start: z.string(),
  status: z.string(),
});

export const AlertSchema = z.object({
  component: z.string(),
  severity: z.string(),
  days_to_failure: nullableNumber,
});

export const ServiceSchema = z.object({
  vin: z.string(),
  model: z.string(),
  odometer: nullableNumber.optional().default(null),
  city: z.string().nullable().optional().default(null),
  alert: AlertSchema.nullable(),
  economics: z.object({ repair_inr: z.number(), breakdown_inr: z.number() }).nullable(),
  booking: BookingSchema.nullable(),
  slots: z.array(SlotSchema),
});

export const ReadingSchema = z
  .object({ ts: z.string(), drive_state: z.string().nullable().optional() })
  .catchall(z.union([z.number(), z.string(), z.null()]));

export const DetailSchema = z.object({
  vehicle: z.object({
    vin: z.string(),
    model: z.string().optional(),
    odometer: nullableNumber.optional(),
    city: z.string().nullable().optional(),
  }),
  series: z.array(ReadingSchema),
  predictions: z.array(z.object({
    component: z.string(),
    severity: z.string().nullable(),
    failure_prob: nullableNumber.optional(),
    days_to_failure: nullableNumber.optional(),
  })),
  maintenance_history: z.array(z.object({
    date: z.string(),
    service_type: z.string(),
    cost: nullableNumber,
    km_at_service: nullableNumber,
    components_replaced: z.array(z.string()).nullable().optional(),
  })),
  dtc_codes: z.array(z.string()),
});

export const FleetSchema = z.object({
  vehicles: z.array(z.object({ vin: z.string(), severity: z.string().nullable() })),
});

export type Slot = z.infer<typeof SlotSchema>;
export type Booking = z.infer<typeof BookingSchema>;
export type Alert = z.infer<typeof AlertSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type Reading = z.infer<typeof ReadingSchema>;
export type Detail = z.infer<typeof DetailSchema>;

export const NOT_UNDERSTOOD = 'AutoSaarthi sent something this app did not understand. Update the app, or try again later.';
