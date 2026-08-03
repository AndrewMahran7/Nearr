import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Spacing } from '@/constants';
import { InstagramReelMock } from '../demo';
import { ScreenHeading } from './ScreenHeading';

type Props = {
  /** Called when the highlighted Share target inside the reel is tapped. */
  onShareTap: () => void;
};

/**
 * Screen 2 of 5 — Tap Share (interactive).
 *
 * The user must tap the highlighted Share button inside the offline reel. Only
 * that target advances the flow; tapping elsewhere does nothing. Everything is
 * drawn natively — no network, no Instagram dependency.
 */
export function TapShareScreen({ onShareTap }: Props) {
  const { width } = useWindowDimensions();
  const reelWidth = Math.min(300, width - Spacing.xl * 2);

  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="See somewhere you want to go?"
        subtext="When you find a place on Instagram, tap the Share button."
      />

      <View style={styles.demo}>
        <InstagramReelMock width={reelWidth} highlightShare onSharePress={onShareTap} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  demo: {
    alignItems: 'center',
    marginTop: 4,
  },
});
