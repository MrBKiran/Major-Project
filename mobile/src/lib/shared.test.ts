import { onSharedSignedOut, sharedApi } from './shared';

describe('the shared API client', () => {
  it('is one client for the phone and the car, so only one of them ever renews the session', () => {
    expect(sharedApi()).toBe(sharedApi());
  });

  it('lets anyone listen for the session ending, and stop listening', () => {
    const listener = jest.fn();
    const stop = onSharedSignedOut(listener);
    expect(typeof stop).toBe('function');
    stop();
    expect(listener).not.toHaveBeenCalled();
  });
});
