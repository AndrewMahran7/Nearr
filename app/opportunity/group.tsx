/**
 * Grouped nearby-opportunity screen.
 *
 * Route: `/opportunity/group?ids=<id,id,id>` — reached by tapping a grouped
 * nearby reminder ("You're near 4 saved places").
 *
 * The ids come FROM THE NOTIFICATION (`data.groupedSavedPlaceIds`), so this
 * screen shows exactly the places the user was told about. It deliberately
 * runs no proximity query of its own: the user may tap twenty minutes later
 * from somewhere else, and "whatever is nearby now" is not what the
 * notification promised.
 *
 * This is a BROWSE surface — compact cards to compare, not four hero pages.
 * Choosing one pushes the existing single-place opportunity screen, which
 * remains the single source of truth for Get directions / I went / Not yet /
 * reminder settings. Nothing here mutates a saved place, and opening it never
 * touches reminder_opportunity_count — delivery is the opportunity, this is
 * only viewing it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components';
import { PlaceImage } from '@/components/PlaceImage';
import { Radius, Spacing } from '@/constants';
import { trackEvent } from '@/lib/analytics';
import {
  decodeGroupedSavedPlaceIds,
  groupedOpportunityTitle,
} from '@/lib/nearbyGroupRouting';
import {
  opportunityMetaChips,
  opportunityNarrative,
} from '@/lib/opportunityUi';
import { useTheme } from '@/lib/theme';
import { resolveOpenSavedPlaceRoute } from '@/lib/openSavedPlace';
import { getSavedPlace } from '@/services/savedPlacesService';
import type { SavedPlaceWithPlace } from '@/types';

export default function GroupedOpportunityScreen() {
  const { ids } = useLocalSearchParams<{ ids: string }>();
  const router = useRouter();
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  const savedPlaceIds = useMemo(() => decodeGroupedSavedPlaceIds(ids), [ids]);
  const [places, setPlaces] = useState<SavedPlaceWithPlace[] | null>(null);

  const load = useCallback(async () => {
    if (savedPlaceIds.length === 0) {
      setPlaces([]);
      return;
    }
    // Every read goes through the RLS-scoped service, so an id belonging to
    // another user simply resolves to nothing. A place deleted since delivery
    // resolves to null and is dropped rather than breaking the group.
    const settled = await Promise.allSettled(savedPlaceIds.map((id) => getSavedPlace(id)));
    const resolved: SavedPlaceWithPlace[] = [];
    for (const result of settled) {
      if (result.status !== 'fulfilled' || !result.value?.place) continue;
      resolved.push(result.value);
    }
    setPlaces(resolved);
  }, [savedPlaceIds]);

  useEffect(() => {
    void load();
  }, [load]);

  // Returning from a single opportunity ("I went!") should reflect the change
  // without rebuilding the group from proximity.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!places) return;
    void trackEvent('grouped_opportunity_opened', { count: places.length });
  }, [places]);

  function openPlace(saved: SavedPlaceWithPlace) {
    void trackEvent('grouped_opportunity_place_tapped', { saved_place_id: saved.id });
    // The group stays a group — picking a member lands on the ONE canonical
    // saved-place detail (Place Detail V2), by exact saved_places.id, through
    // the same validated contract the Map/Queue/Home use. The minted
    // `openRequestId` means picking the same member again later still works.
    const target = resolveOpenSavedPlaceRoute({
      savedPlaceId: saved.id,
      source: 'notification',
    });
    router.push({
      pathname: target.pathname,
      params: { ...target.params, reminderOpen: 'true', reminderSource: 'notification' },
    });
  }

  if (!places) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" style={styles.title}>
            {groupedOpportunityTitle(places.length)}
          </Text>
          {places.length > 0 ? (
            <Text style={styles.subtitle}>You saved all of these. Pick one and go.</Text>
          ) : null}
        </View>
        {/* Closing is purely a dismissal — nothing is marked, declined, or archived. */}
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.closeBtn}
        >
          <Feather name="x" size={20} color={colors.text} />
        </Pressable>
      </View>

      {places.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="map-pin" size={30} color={colors.textMuted} />
          <Text style={styles.emptyText}>
            These places aren&apos;t saved anymore.
          </Text>
          <Button
            title="Back to map"
            variant="secondary"
            onPress={() => router.replace('/(tabs)/map')}
            style={styles.emptyBtn}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          {places.map((saved) => {
            const chips = opportunityMetaChips(saved);
            const narrative = opportunityNarrative(saved);
            const visited = !!saved.visited_at;
            return (
              <Pressable
                key={saved.id}
                onPress={() => openPlace(saved)}
                accessibilityRole="button"
                accessibilityLabel={[
                  saved.place.name,
                  chips.join(', '),
                  visited ? 'Already visited' : null,
                ]
                  .filter(Boolean)
                  .join('. ')}
                style={({ pressed }) => [
                  styles.card,
                  visited && styles.cardVisited,
                  pressed && styles.pressed,
                ]}
              >
                <PlaceImage
                  googlePlaceId={saved.place.google_place_id}
                  size={96}
                  borderRadius={14}
                  accessibilityLabel={`Photo of ${saved.place.name}`}
                />
                <View style={styles.cardBody}>
                  <Text style={styles.cardName} numberOfLines={2}>
                    {saved.place.name}
                  </Text>
                  {chips.length > 0 ? (
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {chips.join(' · ')}
                    </Text>
                  ) : null}
                  {narrative.savedBecause ? (
                    <Text style={styles.cardNote} numberOfLines={2}>
                      {narrative.savedBecause}
                    </Text>
                  ) : null}
                  {visited ? (
                    <View style={styles.visitedRow}>
                      <Feather name="check" size={13} color={colors.accent} />
                      <Text style={styles.visitedText}>You went here</Text>
                    </View>
                  ) : null}
                </View>
                <Feather name="chevron-right" size={18} color={colors.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.7 },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.md,
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.md,
    },
    headerText: { flex: 1, gap: 4 },
    title: { ...typography.title, color: colors.text, fontSize: 26, lineHeight: 31 },
    subtitle: { ...typography.body, color: colors.textSecondary },
    closeBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    list: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      padding: Spacing.md,
      borderRadius: Radius.lg,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cardVisited: { opacity: 0.62 },
    cardBody: { flex: 1, gap: 3 },
    cardName: { ...typography.bodyStrong, color: colors.text, fontSize: 16 },
    cardMeta: { ...typography.caption, color: colors.textSecondary },
    cardNote: { ...typography.caption, color: colors.text, lineHeight: 18, marginTop: 2 },
    visitedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
    visitedText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.md,
      padding: Spacing.xl,
    },
    emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    emptyBtn: { minWidth: 200 },
  });
}
