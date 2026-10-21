/**
 * The phone app is for vehicle owners. Before this, a staff account signed in
 * and was shown whichever fleet car had an alert as "My car". The web owner
 * app already turned staff away (frontend/src/MobileApp.jsx); this matches it.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { renderWithSession, SESSION } from '@/test/harness';

import OwnersOnly from './OwnersOnly';

const STAFF = { user_id: 'USR-admin', email: 'admin@autosaarthi.io', full_name: 'Platform Admin',
                role: 'platform_admin', scope_kind: 'all' };
const status = () => screen.getByTestId('status').props.children;

async function open(principal?: object) {
  return renderWithSession(<OwnersOnly><Text>{"the owner's car"}</Text></OwnersOnly>, {
    stored: 'refresh-token-1-xxxxxxxxxxxx',
    routes: {
      'POST /api/auth/refresh': () => (principal ? SESSION(1, principal) : SESSION()),
      'POST /api/auth/logout': () => ({ revoked: true }),
    },
  });
}

it('lets an owner through', async () => {
  await open();
  expect(await screen.findByText("the owner's car")).toBeOnTheScreen();
});

it('turns a staff account away, and says where its screens are', async () => {
  await open(STAFF);
  expect(await screen.findByText('This app is for vehicle owners')).toBeOnTheScreen();
  expect(screen.getByText(/signed in as Platform Admin \(platform admin\)/i)).toBeOnTheScreen();
  expect(screen.queryByText("the owner's car")).toBeNull();
});

it('lets the staff account sign out to hand the phone over', async () => {
  const { server } = await open(STAFF);
  await fireEvent.press(await screen.findByRole('button', { name: 'Sign in as someone else' }));
  await waitFor(() => expect(status()).toBe('signedOut'));
  expect(server.calls.some((c) => c.path === '/api/auth/logout')).toBe(true);
});
