/**
 * "Continue with Google" on the phone.
 *
 * Google's own sign-in sheet picks the account and hands back an ID token; the server
 * (POST /api/auth/google) is what decides whether that account belongs to anyone — the
 * app only carries the token. It must be asked for with the SAME web client id the
 * server checks tokens against (GET /api/auth/config), or the server refuses it as
 * minted for another app.
 *
 * Kept apart from the screen so the native module is imported in one place, and a
 * test can stand in for it.
 */

import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';

import { ApiError } from '@/lib/api';

let configured: string | null = null;

/** The ID token for the account the owner picks, or null if they backed out. */
export async function googleCredential(webClientId: string): Promise<string | null> {
  if (configured !== webClientId) {
    GoogleSignin.configure({ webClientId });
    configured = webClientId;
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // A previous account would otherwise be picked silently, with no chance to choose another.
    await GoogleSignin.signOut().catch(() => undefined);
    const res = await GoogleSignin.signIn();
    if (res.type !== 'success') return null;
    const token = res.data.idToken;
    if (!token) throw new ApiError(0, 'Google did not return a sign-in token. Try again.');
    return token;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) return null;
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new ApiError(0, 'Google sign-in needs Google Play services, which this phone does not have.');
      }
    }
    throw new ApiError(0, 'Google sign-in did not work. Use your email and password instead, or try again.');
  }
}
