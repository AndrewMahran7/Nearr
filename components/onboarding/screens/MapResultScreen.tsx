import { StyleSheet, View } from 'react-native';

import { DemoMapCard } from '../demo';
import { ScreenHeading } from './ScreenHeading';

type Props = {
  /** Fired once when the pin animates into place (for analytics). */
  onPinShown?: () => void;
};

/**
 * Screen 5 of 5 — Map result.
 *
 * The orange pin drops/scales into place on appear and the place shows as
 * saved. Fully illustrative — no Google Maps SDK, no location, no permission.
 */
export function MapResultScreen({ onPinShown }: Props) {
  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="Saved to your map"
        subtext="Every place you save becomes a pin you can revisit later, and Nearr can remind you when you're nearby."
      />

      <View style={styles.demo}>
        <DemoMapCard onPinShown={onPinShown} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  demo: {
    marginTop: 4,
  },
});
