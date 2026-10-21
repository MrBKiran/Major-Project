/**
 * "Why this part?" — the evidence behind an alert: the model's confidence, the
 * reading that shows the wear and which way it is going, any trouble codes,
 * and the costs. Readings taken with the ignition off are not evidence of
 * wear, so the trend uses the same engine-running rows the agent quotes from.
 */

import { fireEvent, screen } from '@testing-library/react-native';

import { GarageProvider } from '@/lib/garage';
import { renderWithSession, SESSION } from '@/test/harness';

import Evidence from './Evidence';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const VIN = 'MH12AB1001';
const row = (coolant: number, drive_state = 'DRIVING') => ({ ts: '2026-10-20T08:00:00Z', drive_state, coolant_temp: coolant, battery_voltage: 12.4 });

async function open({ alert = { component: 'water_pump', severity: 'P1', days_to_failure: 2 } as object | null,
                      series = [row(92), row(97), row(104), row(15, 'IGNITION_OFF')], dtc = [] as string[],
                      economics = { repair_inr: 2400, breakdown_inr: 18500 } as object | null } = {}) {
  return renderWithSession(<GarageProvider><Evidence /></GarageProvider>, {
    stored: 'refresh-token-1-xxxxxxxxxxxx',
    routes: {
      'POST /api/auth/refresh': () => SESSION(),
      'GET /api/fleet': () => ({ vehicles: [{ vin: VIN, severity: 'P1' }] }),
      'GET /api/vehicle/*': () => ({
        vehicle: { vin: VIN }, series, dtc_codes: dtc, maintenance_history: [],
        predictions: [
          { component: 'water_pump', severity: 'P1', failure_prob: 0.87, days_to_failure: 2 },
          { component: 'battery', severity: null, failure_prob: 0.31, days_to_failure: null },
        ],
      }),
      'GET /api/vehicles/*/service': () => ({ vin: VIN, model: 'Bolero', city: 'Pune', alert, economics, booking: null, slots: [] }),
    },
  });
}

beforeEach(() => mockPush.mockClear());

it('with nothing predicted, has nothing to explain', async () => {
  await open({ alert: null });
  expect(await screen.findByText(/no active prediction to explain/i)).toBeOnTheScreen();
});

it('gives the model’s confidence for this part, in words', async () => {
  await open();
  expect(await screen.findByText('87%')).toBeOnTheScreen();
  expect(screen.getByText(/likely/i)).toBeOnTheScreen();
  expect(screen.queryByText('0.87')).toBeNull();
});

it('claims no trend it cannot show', async () => {
  // Before: "has been climbing on an unchanged route" sat above "No readings in
  // the last 24 hours". A claim with no evidence under it.
  await open({ series: [] });
  await screen.findByText(/no readings in the last 24 hours/i);
  expect(screen.queryByText(/climbing|unchanged route|not weather/i)).toBeNull();
});

it('says so when the last day does not show the drift', async () => {
  await open({ series: [row(104), row(97), row(92)] });
  expect(await screen.findByText(/held steady over the last 24 hours/i)).toBeOnTheScreen();
  expect(screen.queryByText(/climbing/i)).toBeNull();
});

it('says which reading shows the wear, and which way it is going', async () => {
  await open();
  expect(await screen.findByText('Your coolant temperature has been climbing over the last 24 hours.')).toBeOnTheScreen();
});

it('draws the trend from engine-running readings only', async () => {
  await open();
  // The latest reading, 15 °C, is the engine off overnight — not evidence of anything.
  expect(await screen.findByLabelText('Coolant temperature, last 24 hours: from 92.0 to 104.0 °C')).toBeOnTheScreen();
  expect(screen.getByText('104.0 °C')).toBeOnTheScreen();
});

it('says so when there are no recent readings', async () => {
  await open({ series: [] });
  expect(await screen.findByText(/no readings in the last 24 hours/i)).toBeOnTheScreen();
});

it('lists trouble codes, or says none has fired yet', async () => {
  await open({ dtc: ['P0217', 'P0118'] });
  expect(await screen.findByText('P0217')).toBeOnTheScreen();
  expect(screen.getByText('P0118')).toBeOnTheScreen();
});

it('explains a trend caught before any code', async () => {
  await open();
  expect(await screen.findByText(/none fired yet/i)).toBeOnTheScreen();
});

it('quotes the server’s costs and leads to the open slots', async () => {
  await open();
  expect(await screen.findByText('₹18,500')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'See open slots' }));
  expect(mockPush).toHaveBeenCalledWith('/book');
});
