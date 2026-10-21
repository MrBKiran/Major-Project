/** Account: who is signed in, whether notifications reach this phone, and signing out. */

import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Meta, Screen, Txt } from '@/components/ui';
import { usePushStatus } from '@/lib/push-status';
import { useSession } from '@/lib/session';
import { space } from '@/theme';

const NOTIFICATIONS = {
  registered: 'Notifications are on. You hear about a problem before it strands you.',
  denied: 'Notifications are turned off in your phone’s settings. Turn them on there to hear about problems early.',
  unavailable: 'Notifications are not available in this build of the app.',
} as const;

export default function Account() {
  const { principal, signOut } = useSession();
  const push = usePushStatus();
  const [busy, setBusy] = useState(false);

  return (
    <Screen>
      <Txt step="display" weight="semibold" accessibilityRole="header">Account</Txt>
      <Card>
        <Meta>Signed in as</Meta>
        {typeof principal?.full_name === 'string' && <Txt step="title" weight="semibold" style={{ marginTop: space[2] }}>{principal.full_name}</Txt>}
        {typeof principal?.email === 'string' && <Txt tone="muted">{principal.email}</Txt>}
      </Card>
      <Card>
        <Meta>Notifications</Meta>
        <Txt tone="secondary" style={{ marginTop: space[2] }}>{NOTIFICATIONS[push]}</Txt>
      </Card>
      <View style={{ gap: space[2] }}>
        <Button kind="ghost" busy={busy} onPress={async () => { setBusy(true); await signOut(); }}>Sign out</Button>
        <Txt step="bodySm" tone="muted">Signs you out on every device, and this phone stops getting alerts.</Txt>
      </View>
    </Screen>
  );
}
