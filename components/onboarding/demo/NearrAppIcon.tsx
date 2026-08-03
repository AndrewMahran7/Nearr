import { Image, StyleSheet, View, ViewStyle } from 'react-native';

import { OnboardingColors } from '../theme';

type Props = {
  /** Square edge length in px. Corner radius scales with it (iOS squircle-ish). */
  size?: number;
  /** Wrap the icon in a soft orange focus ring (used for the "Tap Nearr" callout). */
  highlighted?: boolean;
  style?: ViewStyle;
};

/**
 * Renders the REAL Nearr app icon (`assets/icon.png`) at an iOS-app-icon
 * corner radius. This is the same asset shipped as the launcher/Share-Sheet
 * icon, so the onboarding demonstration matches what users actually see in
 * the iOS Share Sheet — no recreation, no bundled screenshot.
 */
export function NearrAppIcon({ size = 56, highlighted = false, style }: Props) {
  const radius = Math.round(size * 0.225);
  const icon = (
    <Image
      source={require('@/assets/icon.png')}
      style={{ width: size, height: size, borderRadius: radius }}
      accessibilityIgnoresInvertColors
    />
  );

  if (!highlighted) {
    return <View style={style}>{icon}</View>;
  }

  return (
    <View
      style={[
        styles.ring,
        {
          width: size + 12,
          height: size + 12,
          borderRadius: radius + 8,
        },
        style,
      ]}
    >
      {icon}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: OnboardingColors.orange,
    backgroundColor: 'rgba(255, 107, 0, 0.10)',
  },
});
