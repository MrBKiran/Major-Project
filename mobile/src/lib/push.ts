/**
 * Push notifications: registering where the app can be reached, and where a
 * tapped notification leads.
 *
 * Registration needs a real device (Expo Go cannot receive remote push on
 * Android since SDK 53 — a development build can), the owner's permission,
 * and an EAS project id to issue the token (app.json extra.eas.projectId).
 * Without any of them the app simply does not register; sign-in never fails
 * over it. The server forgets the device when the account signs out.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export type Permission = 'granted' | 'denied' | 'undetermined';
export type PushResult = 'registered' | 'denied' | 'unavailable';

export interface PushDeps {
  platform: string;
  isDevice: boolean;
  projectId: string | undefined;
  getPermission(): Promise<Permission>;
  requestPermission(): Promise<Permission>;
  createChannel(): Promise<void>;
  getToken(projectId: string): Promise<string>;
  post(path: string, body: unknown): Promise<unknown>;
}

export async function registerForPush(d: PushDeps): Promise<PushResult> {
  if (d.platform === 'web' || !d.isDevice || !d.projectId) return 'unavailable';
  try {
    // Android 13+ will not show the permission prompt until a channel exists.
    if (d.platform === 'android') await d.createChannel();
    let permission = await d.getPermission();
    if (permission !== 'granted') permission = await d.requestPermission();
    if (permission !== 'granted') return 'denied';
    const token = await d.getToken(d.projectId);
    await d.post('/api/me/devices', { token, platform: d.platform });
    return 'registered';
  } catch {
    // Offline, or the push service is down: try again on the next launch.
    return 'unavailable';
  }
}

/** The app's own screens a notification may open; anything else opens Home. */
const ROUTES: Record<string, string> = { book: '/book', agent: '/agent', evidence: '/evidence', history: '/history' };

export function routeForNotification(data: unknown): string {
  const link = (data as { deeplink?: unknown } | null | undefined)?.deeplink;
  if (typeof link !== 'string') return '/';
  const match = /^autosaarthi:\/\/([a-z]+)\/?$/.exec(link);
  return (match && ROUTES[match[1]]) || '/';
}

function permissionOf(status: Notifications.NotificationPermissionsStatus): Permission {
  if (status.granted) return 'granted';
  return status.canAskAgain ? 'undetermined' : 'denied';
}

/** The real device, for the app; tests pass their own. */
export function devicePush(post: PushDeps['post']): PushDeps {
  return {
    platform: Platform.OS,
    isDevice: Device.isDevice,
    projectId: Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId,
    getPermission: async () => permissionOf(await Notifications.getPermissionsAsync()),
    requestPermission: async () => permissionOf(await Notifications.requestPermissionsAsync()),
    createChannel: async () => {
      await Notifications.setNotificationChannelAsync('service', {
        // eslint-disable-next-line import/namespace -- re-exported through `export *` (build/index.d.ts); the rule does not follow it
        name: 'Service alerts', importance: Notifications.AndroidImportance.HIGH,
      });
    },
    getToken: async (projectId) => (await Notifications.getExpoPushTokenAsync({ projectId })).data,
    post,
  };
}
