/**
 * Starts the car's screen when the app's JavaScript loads — before any screen on the phone.
 *
 * That is the point of doing it here and not in a component: Android Auto can bind to the app while
 * the phone is locked in a pocket and the app was never opened, and the native side then starts the
 * JavaScript with no activity at all. Nothing a screen mounts would ever run. A module that is
 * imported by the app's entry file (../../index.ts) does.
 *
 * It does nothing, and costs nothing, where there is no car module: iOS, the browser preview, and
 * Android builds made without it.
 */

import { onSharedSignedOut, sharedApi } from '@/lib/shared';

import { CarController } from './controller';
import { nativeCar } from './native';

let stop: (() => void) | null = null;

/** Safe to call more than once; the second call does nothing. */
export function startCar(): void {
  if (stop) return;
  try {
    const native = nativeCar();
    if (!native) return;
    stop = new CarController({ native, api: sharedApi(), onSignedOut: onSharedSignedOut }).start();
    // For whoever is working out why a car shows nothing: this line says the car's half of the app is up.
    if (__DEV__) console.log(`[car] ready, car connected: ${native.isConnected()}`);
  } catch (error) {
    // The car's screen is an extra: a failure here must never stop the app itself from loading.
    console.warn('The car screen could not start.', error);
  }
}

startCar();
