/** Service history: every visit, newest first, in words. */

import { screen } from '@testing-library/react-native';

import { GarageProvider } from '@/lib/garage';
import { renderWithSession, SESSION } from '@/test/harness';

import History from './History';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

async function open(history: object[]) {
  return renderWithSession(<GarageProvider><History /></GarageProvider>, {
    stored: 'refresh-token-1-xxxxxxxxxxxx',
    routes: {
      'POST /api/auth/refresh': () => SESSION(),
      'GET /api/fleet': () => ({ vehicles: [{ vin: 'MH12AB1001', severity: null }] }),
      'GET /api/vehicle/*': () => ({ vehicle: { vin: 'MH12AB1001', model: 'Bolero' }, series: [], predictions: [], dtc_codes: [], maintenance_history: history }),
      'GET /api/vehicles/*/service': () => ({ vin: 'MH12AB1001', model: 'Bolero', alert: null, economics: null, booking: null, slots: [] }),
    },
  });
}

it('lists each visit in words, with its date, odometer and cost', async () => {
  await open([
    { date: '2026-02-18', service_type: 'brake_pad_replace', cost: 3100, km_at_service: 124900, components_replaced: ['brake_pads'] },
    { date: '2025-11-02', service_type: 'periodic_service', cost: 4200, km_at_service: 118200, components_replaced: null },
  ]);
  expect(await screen.findByText('Brake pad replace')).toBeOnTheScreen();
  expect(screen.getByText('18 Feb 2026 · 1,24,900 km')).toBeOnTheScreen();
  expect(screen.getByText('₹3,100')).toBeOnTheScreen();
  expect(screen.getByText('brake pads')).toBeOnTheScreen();
  expect(screen.getByText('Periodic service')).toBeOnTheScreen();
});

it('says so when there is no history yet', async () => {
  await open([]);
  expect(await screen.findByText(/no service visits on record/i)).toBeOnTheScreen();
});
