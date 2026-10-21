/**
 * Registering for push, and where a tapped notification leads.
 *
 * The app tells the server where it can be reached (POST /api/me/devices) only
 * when it really can be: on a device, with the owner's permission, and with an
 * Expo project to issue the token. And a notification may only open one of the
 * app's own screens — never a URL the payload names.
 */

import { registerForPush, routeForNotification, type PushDeps } from './push';

function deps(over: Partial<PushDeps> = {}): PushDeps & { posted: unknown[] } {
  const posted: unknown[] = [];
  return {
    posted,
    platform: 'android',
    isDevice: true,
    projectId: 'project-1',
    getPermission: jest.fn(async () => 'granted' as const),
    requestPermission: jest.fn(async () => 'granted' as const),
    createChannel: jest.fn(async () => {}),
    getToken: jest.fn(async () => 'ExponentPushToken[abc123]'),
    post: jest.fn(async (_path: string, body: unknown) => { posted.push(body); }),
    ...over,
  };
}

describe('registering', () => {
  it('sends the token and platform to the server', async () => {
    const d = deps();
    await expect(registerForPush(d)).resolves.toBe('registered');
    expect(d.post).toHaveBeenCalledWith('/api/me/devices', { token: 'ExponentPushToken[abc123]', platform: 'android' });
  });

  it('makes the Android channel before asking, so Android 13 can ask at all', async () => {
    const order: string[] = [];
    const d = deps({
      createChannel: jest.fn(async () => { order.push('channel'); }),
      getPermission: jest.fn(async () => { order.push('check'); return 'undetermined' as const; }),
      requestPermission: jest.fn(async () => { order.push('ask'); return 'granted' as const; }),
    });
    await registerForPush(d);
    expect(order).toEqual(['channel', 'check', 'ask']);
  });

  it('asks only when it has not been asked', async () => {
    const d = deps();
    await registerForPush(d);
    expect(d.requestPermission).not.toHaveBeenCalled();
  });

  it('registers nothing when the owner says no', async () => {
    const d = deps({ getPermission: jest.fn(async () => 'undetermined' as const),
                     requestPermission: jest.fn(async () => 'denied' as const) });
    await expect(registerForPush(d)).resolves.toBe('denied');
    expect(d.getToken).not.toHaveBeenCalled();
    expect(d.post).not.toHaveBeenCalled();
  });

  it.each([
    ['in the browser preview', { platform: 'web' }],
    ['on an emulator without push', { isDevice: false }],
    ['before there is an Expo project to issue tokens', { projectId: undefined }],
  ])('does not ask %s', async (_why, over) => {
    const d = deps(over as Partial<PushDeps>);
    await expect(registerForPush(d)).resolves.toBe('unavailable');
    expect(d.getPermission).not.toHaveBeenCalled();
    expect(d.requestPermission).not.toHaveBeenCalled();
    expect(d.post).not.toHaveBeenCalled();
  });

  it('offline, reports it rather than failing sign-in', async () => {
    const d = deps({ getToken: jest.fn(async () => { throw new Error('network'); }) });
    await expect(registerForPush(d)).resolves.toBe('unavailable');
  });
});

describe('a tapped notification', () => {
  it.each([
    [{ deeplink: 'autosaarthi://book' }, '/book'],
    [{ deeplink: 'autosaarthi://agent' }, '/agent'],
    [{ deeplink: 'autosaarthi://evidence' }, '/evidence'],
    [{ deeplink: 'autosaarthi://history' }, '/history'],
    [{}, '/'],
    [undefined, '/'],
  ])('%j opens %s', (data, route) => {
    expect(routeForNotification(data)).toBe(route);
  });

  it.each([
    'https://evil.example/phish', 'other://book', 'autosaarthi://sign-in', 'autosaarthi://book/../../x', 'javascript:alert(1)', 42,
  ])('never follows %j anywhere but home', (deeplink) => {
    expect(routeForNotification({ deeplink })).toBe('/');
  });
});
