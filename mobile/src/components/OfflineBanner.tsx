/**
 * Says once, at the top, that the phone is offline — instead of every screen
 * failing on its own. NetInfo answers null until its first check; that is
 * "don't know yet", not offline, so the banner stays quiet.
 */

import { useNetInfo } from '@react-native-community/netinfo';
import { Text, View } from 'react-native';

import { fonts, space, useTheme } from '@/theme';

export default function OfflineBanner() {
  const { isConnected, isInternetReachable } = useNetInfo();
  const { c, type } = useTheme();
  if (isConnected !== false && isInternetReachable !== false) return null;
  return (
    <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite"
          style={{ backgroundColor: c.amberBg, paddingHorizontal: space[4], paddingVertical: space[2] }}>
      <Text maxFontSizeMultiplier={1.8} style={{ ...type.bodySm, fontFamily: fonts.medium, color: c.amberInk }}>
        You are offline. What you see may be out of date.
      </Text>
    </View>
  );
}
