import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { OnboardingActionCard, OnboardingSavedPlacePreview } from '..';
import { OnboardingColors } from '../theme';
import { ScreenHeading } from './ScreenHeading';

type Props = {
  /** Non-persisting placeholder handlers for preview (wired up later). */
  onOpenInstagram?: () => void;
  onOpenTikTok?: () => void;
  onPasteLink?: () => void;
  /** Disable the action cards while onboarding is completing / navigating. */
  disabled?: boolean;
};

/**
 * Screen 5 — First Save Challenge.
 *
 * Three action cards (Open Instagram / Open TikTok / Paste a link) plus a
 * sample saved-place preview so the user knows what a finished save looks
 * like. External linking is intentionally NOT wired yet — handlers are
 * optional no-ops for preview.
 */
export function FirstSaveScreen({
  onOpenInstagram,
  onOpenTikTok,
  onPasteLink,
  disabled,
}: Props) {
  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="You're ready to save your first place"
        subtext="Find a restaurant, hike, hotel, coffee shop, or spot online and share it to Nearr."
      />

      <View style={styles.actions}>
        {/* Feather has no TikTok glyph — "video" stands in. */}
        <OnboardingActionCard icon="instagram" title="Open Instagram" onPress={onOpenInstagram} disabled={disabled} />
        <OnboardingActionCard icon="video" title="Open TikTok" onPress={onOpenTikTok} disabled={disabled} />
        <OnboardingActionCard icon="link" title="Paste a link" onPress={onPasteLink} disabled={disabled} />
      </View>

      <View style={styles.previewSection}>
        <View style={styles.previewLabelRow}>
          <Feather name="eye" size={14} color={OnboardingColors.textMuted} />
          <Text style={styles.previewLabel}>What a saved place looks like</Text>
        </View>
        <OnboardingSavedPlacePreview />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  actions: {
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  previewSection: {
    gap: Spacing.md,
  },
  previewLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewLabel: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
