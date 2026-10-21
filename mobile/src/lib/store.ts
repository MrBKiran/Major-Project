import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { memoryStore, type TokenStore } from './api';

const KEY = 'autosaarthi.refresh';

/**
 * Where the refresh token is kept: the Android Keystore / iOS Keychain, via
 * SecureStore. The browser preview has neither, so it keeps the token in
 * memory only — a reload signs it out, which is the right failure for a
 * credential that must never reach localStorage.
 */
export const tokenStore: TokenStore = Platform.OS === 'web'
  ? memoryStore()
  : {
      get: () => SecureStore.getItemAsync(KEY),
      set: (value) => SecureStore.setItemAsync(KEY, value),
      clear: () => SecureStore.deleteItemAsync(KEY),
    };
