/**
 * PlaceCardRow — a titled, horizontally scrolling row of place cards inside
 * Place Detail.
 *
 * Purely presentational: it receives already-resolved entries and an onPress
 * per entry, and knows nothing about *why* those places were chosen. That is
 * the point — "Also nearby" is the only caller today, and the upcoming
 * "From this video" section drops in above it by rendering a second
 * <PlaceCardRow> with different entries, with no further Place Detail surgery.
 *
 * Selection semantics (which saved place, by which id) stay with the caller,
 * so this component can never open the wrong row.
 *
 * Card width is sized so three cards are previewable across a standard iPhone.
 * At 390pt the sheet's content width is 358 and 3 × 106 + 2 × 10 = 338, so the
 * third card is fully visible with the fourth peeking — which is what makes
 * the strip read as "there is more here" rather than as two oversized tiles.
 * It held two before, at 148pt each.
 */

import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PlaceImage } from '@/components/PlaceImage';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

export type PlaceCardEntry = {
  /** Stable React key — the caller passes the exact saved_places.id. */
  key: string;
  name: string;
  googlePlaceId?: string | null;
  /** Secondary line, e.g. "0.4 mi". */
  meta?: string | null;
  a11yLabel: string;
  onPress: () => void;
};

const CARD_WIDTH = 106;
const CARD_IMAGE_HEIGHT = 74;

function PlaceCardRowImpl({
  title,
  entries,
  actionLabel,
  onAction,
}: {
  title: string;
  entries: readonly PlaceCardEntry[];
  /** Optional trailing header action, e.g. "See map". */
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors, typography } = useTheme();
  if (entries.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={[typography.bodyStrong, styles.title, { color: colors.text }]}
        >
          {title}
        </Text>
        {actionLabel && onAction ? (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            hitSlop={10}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={[typography.caption, styles.actionText, { color: colors.accent }]}>
              {actionLabel}
            </Text>
            <Feather name="chevron-right" size={14} color={colors.accent} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {entries.map((entry) => (
          <Pressable
            key={entry.key}
            onPress={entry.onPress}
            accessibilityRole="button"
            accessibilityLabel={entry.a11yLabel}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.media}>
              {/* PlaceImage owns the whole fallback ladder: cached provider
                  photo → Nearr's pin treatment. Never a broken-image icon,
                  never a remote placeholder service.
                  No accessibilityLabel: the Pressable above already names the
                  place and its distance, and a nested accessible node would
                  make VoiceOver announce the card twice. */}
              <PlaceImage
                googlePlaceId={entry.googlePlaceId}
                size={CARD_WIDTH}
                borderRadius={0}
                style={styles.mediaImage}
              />
              {/* Everything in this row is already one of the user's saves, so
                  the bookmark is a filled state, not an unfulfilled action. */}
              <View
                style={[styles.savedBadge, { backgroundColor: colors.surface }]}
                pointerEvents="none"
              >
                <Feather name="bookmark" size={11} color={colors.accent} />
              </View>
            </View>
            <View style={styles.body}>
              <Text
                style={[typography.caption, styles.name, { color: colors.text }]}
                numberOfLines={2}
              >
                {entry.name}
              </Text>
              {entry.meta ? (
                <View style={styles.metaRow}>
                  <Feather name="map-pin" size={10} color={colors.textMuted} />
                  <Text
                    style={[typography.caption, styles.meta, { color: colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {entry.meta}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export const PlaceCardRow = memo(PlaceCardRowImpl);

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    minHeight: 30,
  },
  title: { fontSize: 16 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  actionText: { fontSize: 13, fontWeight: '700' },
  row: { gap: 10, paddingRight: Spacing.lg },
  card: {
    width: CARD_WIDTH,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.7 },
  media: { width: CARD_WIDTH, height: CARD_IMAGE_HEIGHT, overflow: 'hidden' },
  // PlaceImage draws a square at `size`; the frame above crops it to a
  // consistent card ratio so a row of cards never ends up ragged.
  mediaImage: { width: CARD_WIDTH, height: CARD_WIDTH, marginTop: -16, borderWidth: 0 },
  savedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: Spacing.sm, paddingVertical: 7, gap: 2 },
  name: { fontWeight: '700', fontSize: 12, lineHeight: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  meta: { fontSize: 11 },
});
