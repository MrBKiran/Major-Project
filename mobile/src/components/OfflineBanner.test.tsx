/** The phone's connection, said once at the top rather than as errors on every screen. */

import { render, screen } from '@testing-library/react-native';

import OfflineBanner from './OfflineBanner';

let mockState: { isConnected: boolean | null; isInternetReachable: boolean | null };
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: () => mockState }));

it('says the phone is offline', async () => {
  mockState = { isConnected: false, isInternetReachable: false };
  await render(<OfflineBanner />);
  expect(screen.getByRole('alert')).toHaveTextContent(/offline/i);
});

it('says so when connected to a network with no internet', async () => {
  mockState = { isConnected: true, isInternetReachable: false };
  await render(<OfflineBanner />);
  expect(screen.getByRole('alert')).toHaveTextContent(/offline/i);
});

it('is silent when online', async () => {
  mockState = { isConnected: true, isInternetReachable: true };
  await render(<OfflineBanner />);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('is silent while it does not yet know', async () => {
  // NetInfo reports null until its first check; that is not "offline".
  mockState = { isConnected: null, isInternetReachable: null };
  await render(<OfflineBanner />);
  expect(screen.queryByRole('alert')).toBeNull();
});
