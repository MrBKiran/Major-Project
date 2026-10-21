import { Platform } from 'react-native';

/**
 * Where the backend is.
 *
 * Set EXPO_PUBLIC_API_URL for a phone on the network or a deployed server (it
 * must be https outside development). Without it: the Android emulator reaches
 * the computer it runs on at 10.0.2.2, and the browser preview asks its own
 * origin, which the development server forwards to the backend (metro.config.js).
 */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'web' ? '' : Platform.OS === 'android' ? 'http://10.0.2.2:8010' : 'http://localhost:8010');
