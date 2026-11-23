/**
 * The native car module (modules/autosaarthi-car), as the controller sees it: screens in, taps out.
 *
 * There is a module only on Android, in a build that includes it; everywhere else (iOS, the browser
 * preview, a build made before the module was added) `nativeCar()` is null and the car's screen
 * simply does not exist.
 */

import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { CarNative } from './model';

/** The module as the native side declares it (AutoSaarthiCarModule.kt): screens travel as JSON. */
interface AutoSaarthiCarModule {
  isConnected(): boolean;
  root(json: string): boolean;
  push(json: string): boolean;
  update(json: string): boolean;
  pop(toId: string | null): boolean;
  addListener(event: string, listener: (payload: never) => void): { remove(): void };
}

export function nativeCar(): CarNative | null {
  if (Platform.OS !== 'android') return null;
  const module = requireOptionalNativeModule<AutoSaarthiCarModule>('AutoSaarthiCar');
  if (!module) return null;

  const on = (event: string, handler: (payload: never) => void) => {
    const subscription = module.addListener(event, handler);
    return () => subscription.remove();
  };

  // The native side refuses a screen it cannot draw by throwing. That is a mistake in a screen, not a reason
  // to stop the car's session half-way, so it is reported and the car is told the screen did not go.
  const send = (what: string, call: () => boolean): boolean => {
    try {
      return call();
    } catch (error) {
      console.warn(`The car refused a screen (${what}).`, error);
      return false;
    }
  };

  return {
    isConnected: () => module.isConnected(),
    root: (screen) => send('root', () => module.root(JSON.stringify(screen))),
    push: (screen) => send('push', () => module.push(JSON.stringify(screen))),
    update: (screen) => send('update', () => module.update(JSON.stringify(screen))),
    pop: (toId) => send('pop', () => module.pop(toId ?? null)),
    on: on as CarNative['on'],
  };
}
