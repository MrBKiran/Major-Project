/** Account: who is signed in, whether notifications reach this phone, and signing out. */

import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { PushStatusContext } from '@/lib/push-status';
import { renderWithSession, SESSION } from '@/test/harness';

import Account from './Account';

const status = () => screen.getByTestId('status').props.children;

async function open(push?: 'registered' | 'denied' | 'unavailable') {
  const ui = push ? <PushStatusContext.Provider value={push}><Account /></PushStatusContext.Provider> : <Account />;
  return renderWithSession(ui, {
    stored: 'refresh-token-1-xxxxxxxxxxxx',
    routes: {
      'POST /api/auth/refresh': () => SESSION(),
      'POST /api/auth/logout': () => ({ revoked: true, scope: 'all_sessions' }),
    },
  });
}

it('says who is signed in', async () => {
  await open();
  expect(await screen.findByText('Ramesh Pawar')).toBeOnTheScreen();
  expect(screen.getByText('ramesh.pawar@example.in')).toBeOnTheScreen();
});

it.each([
  ['registered', /notifications are on/i],
  ['denied', /turned off in your phone’s settings/i],
  ['unavailable', /not available in this build/i],
] as const)('says whether notifications reach this phone (%s)', async (push, text) => {
  await open(push);
  expect(await screen.findByText(text)).toBeOnTheScreen();
});

it('signs out everywhere, and says so before doing it', async () => {
  const { server } = await open();
  await waitFor(() => expect(status()).toBe('signedIn'));
  expect(screen.getByText(/signs you out on every device/i)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(status()).toBe('signedOut'));
  expect(server.calls.some((c) => c.path === '/api/auth/logout')).toBe(true);
});
