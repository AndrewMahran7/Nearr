import { StyleSheet, View } from 'react-native';

import { FindingSavingCard } from '../demo';
import { ScreenHeading } from './ScreenHeading';

type Props = {
  /** Bump to replay the finding animation when the screen is (re)shown. */
  playKey?: number;
  /** Fired once when the simulated auto-save reaches the saved state. */
  onSaved: () => void;
};

/**
 * Screen 4 of 5 — Nearr finds the place and saves it (non-interactive).
 *
 * The finding → found → saved sequence runs by itself: there is no Save button,
 * because the real product saves a post with one clear place without asking.
 * Deterministic and local — it does NOT call the extraction backend.
 */
export function FindingSavingScreen({ playKey, onSaved }: Props) {
  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="Nearr finds the place"
        subtext="We match the post to the real location. When there's one clear place, Nearr saves it to your map for you."
      />

      <View style={styles.demo}>
        <FindingSavingCard playKey={playKey} onSaved={onSaved} />
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
