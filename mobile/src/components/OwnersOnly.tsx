/**
 * The phone app is for vehicle owners — the same rule as the web owner app
 * (frontend/src/MobileApp.jsx): a session whose scope is not the owner's own
 * cars is turned away, with a way to hand the phone to its owner.
 */

import { humanize } from '@autosaarthi/core';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { useSession } from '@/lib/session';
import { space } from '@/theme';

import { Button, Screen, Txt } from './ui';

export default function OwnersOnly({ children }: { children: ReactNode }) {
  const { principal, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  if (principal?.scope_kind === 'owned') return <>{children}</>;

  const who = typeof principal?.full_name === 'string' ? principal.full_name : 'a staff account';
  const role = typeof principal?.role === 'string' ? humanize(principal.role).toLowerCase() : '';
  return (
    <Screen>
      <View style={{ marginTop: space[12], gap: space[3] }}>
        <Txt step="display" weight="semibold" accessibilityRole="header">This app is for vehicle owners</Txt>
        <Txt tone="secondary">
          {`You’re signed in as ${who}${role ? ` (${role})` : ''}. The fleet, service and quality screens are in the console, on a larger screen.`}
        </Txt>
      </View>
      <Button kind="ghost" busy={busy} onPress={async () => { setBusy(true); await signOut(); }}>Sign in as someone else</Button>
    </Screen>
  );
}
