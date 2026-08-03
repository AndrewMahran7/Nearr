import { StyleSheet, View } from 'react-native';

import { FindingSavingCard } from '../demo';
import { ScreenHeading } from './ScreenHeading';

type Props = {
  /** Bump to replay the finding animation when the screen is (re)shown. */
  playKey?: number;
  /** Called when the user taps Save on the revealed result card. */
  onSave: () => void;
};

/**
 * Screen 4 of 5 — Finding and saving (interactive).
 *
 * The scan → progress → found → result sequence runs automatically. The user
 * then taps the real Save action to proceed. Deterministic and local — it does
 * NOT call the extraction backend.
 */
export function FindingSavingScreen({ playKey, onSave }: Props) {
  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="Nearr finds the place for you"
        subtext="We scan the post, identify the real location, and get it ready to save. Tap Save when it appears."
      />

      <View style={styles.demo}>
        <FindingSavingCard playKey={playKey} onSave={onSave} />
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
