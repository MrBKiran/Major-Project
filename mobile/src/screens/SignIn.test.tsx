/**
 * Signing in on the phone: email and password, a phone code, and the second
 * factor when the account has one. Methods the server has switched off are not
 * offered.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { reply, renderWithSession, SESSION } from '@/test/harness';

import SignIn from './SignIn';

const CONFIG = (methods = ['password', 'phone_otp']) => ({ methods, google_client_id: null, mfa_enforced: false });

function open(routes: Record<string, any> = {}) {
  return renderWithSession(<SignIn />, { routes: { 'GET /api/auth/config': () => CONFIG(), ...routes } });
}

const status = () => screen.getByTestId('status').props.children;

it('opens on the phone code when the server offers it', async () => {
  await open();
  expect(await screen.findByRole('tab', { name: 'Phone', selected: true })).toBeOnTheScreen();
  expect(screen.getByLabelText('Mobile number')).toBeOnTheScreen();
});

it('signs in with an email and password', async () => {
  const { server } = await open({ 'POST /api/auth/login': () => SESSION() });
  await waitFor(() => expect(status()).toBe('signedOut'));
  await fireEvent.press(await screen.findByRole('tab', { name: 'Email' }));
  await fireEvent.changeText(screen.getByLabelText('Email'), 'ramesh.pawar@example.in');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'autosaarthi');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(status()).toBe('signedIn'));
  expect(server.calls.find((c) => c.path === '/api/auth/login')!.body)
    .toEqual({ email: 'ramesh.pawar@example.in', password: 'autosaarthi' });
});

it('says why the server refused', async () => {
  await open({ 'POST /api/auth/login': () => reply(401, { detail: 'invalid email or password' }) });
  await fireEvent.press(await screen.findByRole('tab', { name: 'Email' }));
  await fireEvent.changeText(screen.getByLabelText('Email'), 'a@b.in');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid email or password');
  expect(status()).toBe('signedOut');
});

it('does not send an empty form', async () => {
  const { server } = await open();
  await waitFor(() => expect(status()).toBe('signedOut'));
  await fireEvent.press(await screen.findByRole('tab', { name: 'Email' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/email and password/i);
  expect(server.calls.some((c) => c.path === '/api/auth/login')).toBe(false);
});

it('asks for the authenticator code when the account has a second factor', async () => {
  const { server } = await open({
    'POST /api/auth/login': () => reply(202, { mfa_required: true, mfa_token: 'challenge-1', expires_in: 300 }),
    'POST /api/auth/mfa/verify': () => SESSION(2),
  });
  await fireEvent.press(await screen.findByRole('tab', { name: 'Email' }));
  await fireEvent.changeText(screen.getByLabelText('Email'), 'a@b.in');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'pw');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  await fireEvent.changeText(await screen.findByLabelText('Authenticator or recovery code'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
  await waitFor(() => expect(status()).toBe('signedIn'));
  expect(server.calls.find((c) => c.path === '/api/auth/mfa/verify')!.body)
    .toEqual({ mfa_token: 'challenge-1', code: '123456' });
});

it('signs in with a code sent to the phone', async () => {
  const { server } = await open({
    'POST /api/auth/otp/request': () => reply(202, { sent: true }),
    'POST /api/auth/otp/verify': () => SESSION(3),
  });
  await fireEvent.press(await screen.findByRole('tab', { name: 'Phone' }));
  await fireEvent.changeText(screen.getByLabelText('Mobile number'), '+91 98765 43210');
  await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
  await fireEvent.changeText(await screen.findByLabelText('6-digit code'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(status()).toBe('signedIn'));
  const sent = server.calls.filter((c) => c.path.startsWith('/api/auth/otp/')).map((c) => c.body);
  expect(sent).toEqual([{ phone: '+91 98765 43210' }, { phone: '+91 98765 43210', code: '123456' }]);
});

it('checks the code is six digits before sending it', async () => {
  const { server } = await open({ 'POST /api/auth/otp/request': () => reply(202, { sent: true }) });
  await fireEvent.press(await screen.findByRole('tab', { name: 'Phone' }));
  await fireEvent.changeText(screen.getByLabelText('Mobile number'), '+919876543210');
  await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
  await fireEvent.changeText(await screen.findByLabelText('6-digit code'), '12345');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/6 digits/i);
  expect(server.calls.some((c) => c.path === '/api/auth/otp/verify')).toBe(false);
});

it('does not offer phone sign-in when the server has it switched off', async () => {
  await renderWithSession(<SignIn />, { routes: { 'GET /api/auth/config': () => CONFIG(['password']) } });
  await waitFor(() => expect(status()).toBe('signedOut'));
  await waitFor(() => expect(screen.getByLabelText('Email')).toBeOnTheScreen());
  expect(screen.queryByRole('tab', { name: 'Phone' })).toBeNull();
});

it('sends one request however often the button is pressed', async () => {
  let release: () => void = () => {};
  const { server } = await open({
    'POST /api/auth/login': () => new Promise((resolve) => { release = () => resolve(SESSION()); }),
  });
  await fireEvent.press(await screen.findByRole('tab', { name: 'Email' }));
  await fireEvent.changeText(screen.getByLabelText('Email'), 'a@b.in');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'pw');
  const button = screen.getByRole('button', { name: 'Sign in' });
  await fireEvent.press(button);
  await fireEvent.press(button);
  await waitFor(() => expect(server.calls.filter((c) => c.path === '/api/auth/login')).toHaveLength(1));
  release();
  await waitFor(() => expect(status()).toBe('signedIn'));
  expect(server.calls.filter((c) => c.path === '/api/auth/login')).toHaveLength(1);
});
