/**
 * The app's root: fonts, the session, and which screens exist for it.
 *
 * Signed in, the car's screens; signed out, sign-in — `Stack.Protected` moves
 * between them when the session changes, including when the server ends it.
 * A stored session that cannot be checked (offline) is neither: it waits on a
 * screen that says so, still signed in.
 */

import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import {
  SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { OWNER } from '@autosaarthi/core';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import OwnersOnly from '@/components/OwnersOnly';
import { Button, Screen, Txt } from '@/components/ui';
import { GarageProvider } from '@/lib/garage';
import { devicePush, registerForPush, routeForNotification, type PushResult } from '@/lib/push';
import { PushStatusContext } from '@/lib/push-status';
import { SessionProvider, useSession } from '@/lib/session';
import { fonts, space, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync();

const native = Platform.OS !== 'web';

if (native) {
  // While the app is open, still show the banner: an alert about the car the
  // owner is looking at is not a reason to stay silent.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
    }),
  });
}

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium,
  });
  if (!loaded) return null;
  return (
    <SessionProvider>
      <App />
    </SessionProvider>
  );
}

/** A tapped notification opens one of the app's own screens (src/lib/push.ts). */
const useNotificationTaps = native
  ? (enabled: boolean) => {
      const router = useRouter();
      const response = Notifications.useLastNotificationResponse();
      useEffect(() => {
        if (!enabled || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
        router.push(routeForNotification(response.notification.request.content.data) as never);
        Notifications.clearLastNotificationResponseAsync();
      }, [enabled, response, router]);
    }
  : () => {};

function App() {
  const { status, api, retry, signOut } = useSession();
  const { dark, c } = useTheme();
  const [push, setPush] = useState<PushResult>('unavailable');
  const signedIn = status === 'signedIn';

  useEffect(() => { if (status !== 'restoring') SplashScreen.hideAsync(); }, [status]);
  useEffect(() => {
    if (signedIn) registerForPush(devicePush((path, body) => api.post(path, body))).then(setPush);
  }, [signedIn, api]);
  useNotificationTaps(signedIn);

  if (status === 'restoring') return null;          // the splash screen is still up

  if (status === 'unreachable') {
    return (
      <Screen>
        <View style={{ marginTop: space[12], gap: space[3] }}>
          <Txt step="display" weight="semibold" accessibilityRole="header">Can’t reach AutoSaarthi</Txt>
          <Txt tone="muted">You are still signed in. The app could not check with the server — you may be offline.</Txt>
        </View>
        <Button onPress={retry}>Try again</Button>
        <Button kind="ghost" onPress={signOut}>Sign out</Button>
      </Screen>
    );
  }

  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: c.page, card: c.page, text: c.fg, border: c.border, primary: c.accentDeep },
  };

  const stack = (
    <Stack screenOptions={{
      headerShown: false,
      headerStyle: { backgroundColor: c.page },
      headerTintColor: c.fg,
      headerTitleStyle: { fontFamily: fonts.semibold },
      headerShadowVisible: false,
      contentStyle: { backgroundColor: c.page },
    }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="evidence" options={{ headerShown: true, title: OWNER.whyThisPart }} />
        <Stack.Screen name="book" options={{ headerShown: true, title: OWNER.book }} />
        <Stack.Screen name="agent" options={{ headerShown: true, title: 'AutoSaarthi agent' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );

  return (
    <ThemeProvider value={navTheme}>
      <PushStatusContext.Provider value={push}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        {signedIn ? <OwnersOnly><GarageProvider>{stack}</GarageProvider></OwnersOnly> : stack}
      </PushStatusContext.Provider>
    </ThemeProvider>
  );
}
