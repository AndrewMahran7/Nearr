/**
 * MapPlaceSearchDropdown — a compact, Google-Maps-style place search anchored
 * under the top of the map. Replaces the previous full-screen saved-place
 * overlay.
 *
 * Behavior:
 *   - Searches REAL places via the existing `usePlacesSearch` hook (the same
 *     Google Places source `app/add-place.tsx` uses). It does NOT search saved
 *     places and does NOT trigger share-link extraction.
 *   - Renders as an absolutely-positioned panel over the map (map stays visible
 *     behind it); the panel is height-capped (~40% of the screen).
 *   - Tapping a result hands the place name to the parent, which opens the
 *     existing add/save flow (`/add-place?q=...`).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Radius, Spacing } from '@/constants';
import { usePlacesSearch } from '@/hooks/usePlacesSearch';
import { useTheme } from '@/lib/theme';
import type { PlaceCandidate } from '@/services/placesService';

type Props = {
  visible: boolean;
  /** Top safe-area + chrome offset so the input lines up with the search bar. */
  topInset: number;
  onClose: () => void;
  /** Open the existing add/save flow for the chosen real-world place. */
  onPickPlace: (place: PlaceCandidate) => void;
};

export function MapPlaceSearchDropdown({
  visible,
  topInset,
  onClose,
  onPickPlace,
}: Props) {
  const { colors, typography } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  const [query, setQuery] = useState('');
  const { results, loading, error, lastQuery, search, reset } = usePlacesSearch();
  const inputRef = useRef<TextInput>(null);

  // Reset + focus on open; clear search state on close.
  useEffect(() => {
    if (visible) {
      setQuery('');
      reset();
      const id = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(id);
    }
    reset();
    return undefined;
  }, [visible, reset]);

  // Debounced live search (300ms), mirroring add-place. The hook drops stale
  // responses, so the user always sees results for the latest query.
  useEffect(() => {
    if (!visible) return;
    const q = query.trim();
    if (q.length < 3) return;
    if (q === lastQuery) return;
    const id = setTimeout(() => {
      void search(q);
    }, 300);
    return () => clearTimeout(id);
  }, [query, visible, lastQuery, search]);

  const trimmed = query.trim();
  const panelMaxHeight = Math.round(windowHeight * 0.4);

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* Tap outside the panel to dismiss. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

      <View style={[styles.anchor, { top: topInset }]} pointerEvents="box-none">
        <View style={styles.inputRow}>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            style={styles.backBtn}
          >
            <Feather name="arrow-left" size={20} color={colors.text} />
          </Pressable>
          <View style={styles.inputWrap}>
            <Feather name="search" size={18} color={colors.textSecondary} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search for a place"
              placeholderTextColor={colors.textMuted}
              style={[typography.body, styles.input]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Feather name="x" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={[styles.panel, { maxHeight: panelMaxHeight }]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.panelContent}
          >
            {trimmed.length < 3 ? (
              <Text style={[typography.caption, styles.helper]}>
                Search for a restaurant, shop, park, or any place.
              </Text>
            ) : loading && results.length === 0 ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : error ? (
              <Text style={[typography.caption, styles.helper]}>
                Couldn’t search places. Try again.
              </Text>
            ) : results.length === 0 ? (
              <Text style={[typography.caption, styles.helper]}>No places found</Text>
            ) : (
              results.map((place) => (
                <Pressable
                  key={place.googlePlaceId ?? `${place.name}-${place.formattedAddress ?? ''}`}
                  onPress={() => onPickPlace(place)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${place.name}`}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <View style={styles.rowIcon}>
                    <Feather name="map-pin" size={16} color={colors.accent} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={typography.bodyStrong} numberOfLines={1}>
                      {place.name}
                    </Text>
                    {place.formattedAddress ? (
                      <Text style={[typography.caption, styles.rowAddr]} numberOfLines={1}>
                        {place.formattedAddress}
                      </Text>
                    ) : null}
                  </View>
                  {place.category ? (
                    <View style={styles.categoryChip}>
                      <Text style={styles.categoryChipText} numberOfLines={1}>
                        {place.category}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 20,
    },
    anchor: {
      position: 'absolute',
      left: Spacing.lg,
      right: Spacing.lg,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    backBtn: {
      width: 40,
      height: 50,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inputWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      height: 50,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.pill,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.primary,
      shadowColor: '#000',
      shadowOpacity: 0.28,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 5,
    },
    input: {
      flex: 1,
      color: colors.text,
      paddingVertical: 0,
    },
    panel: {
      marginTop: Spacing.sm,
      marginLeft: 40 + Spacing.sm,
      borderRadius: Radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    panelContent: {
      padding: Spacing.xs,
    },
    helper: {
      color: colors.textMuted,
      padding: Spacing.md,
    },
    center: {
      padding: Spacing.xl,
      alignItems: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.sm,
      borderRadius: Radius.md,
    },
    rowPressed: {
      backgroundColor: colors.surfaceElevated,
    },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: 11,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowCopy: {
      flex: 1,
    },
    rowAddr: {
      color: colors.textSecondary,
      marginTop: 1,
    },
    categoryChip: {
      paddingVertical: 3,
      paddingHorizontal: Spacing.sm,
      borderRadius: Radius.pill,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      maxWidth: 96,
    },
    categoryChipText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  });
}
