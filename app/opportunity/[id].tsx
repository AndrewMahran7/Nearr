/**
 * Nearby-opportunity screen.
 *
 * Route: `/opportunity/[id]` where `id` is `saved_places.id`.
 *
 * Opened when the user taps the body of a nearby-reminder notification
 * (default tap, not an action button). Shows:
 *   - "You're near [Place Name]"
 *   - "Opportunity N of 3"
 *   - one of three short blurbs based on N
 *   - four actions:
 *       A. Get directions     → external maps + analytics
 *       B. Maybe next time    → close (and auto-archive on the 3rd)
 *       C. I went here        → markVisited + lightweight checkmark
 *       D. Adjust radius      → /place/[id]
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Card, Screen } from '@/components';
import { Spacing } from '@/constants';

import {
  getSavedPlace,
  markArchived,
  markVisited,
} from '@/services/savedPlacesService';
import { trackEvent } from '@/lib/analytics';
import { openExternalMaps } from '@/lib/externalMaps';
import { useTheme } from '@/lib/theme';
import type { SavedPlaceWithPlace } from '@/types';

const MAX_OPPORTUNITIES = 3;

function blurbForOpportunity(opportunityNumber: number): string {
  if (opportunityNumber <= 1) {
    return 'You happen to be in the area. Want to swing by?';
  }
  if (opportunityNumber === 2) {
    return "You're nearby again — a good moment to actually go?";
  }
  return "Last chance from Nearr. After this we'll archive the reminder so it doesn't keep nudging you.";
}

export default function OpportunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  const [saved, setSaved] = useState<SavedPlaceWithPlace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);

  const checkScale = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const s = await getSavedPlace(id);
      setSaved(s);
    } catch (e: any) {
      Alert.alert('Could not load this place', e?.message ?? 'Unknown error.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const opportunityNumber = useMemo(() => {
    if (!saved) return 1;
    // reminder_opportunity_count is incremented at delivery time, so the
    // count at the moment the user opens the notification is "this one".
    return Math.min(
      Math.max(saved.reminder_opportunity_count ?? 1, 1),
      MAX_OPPORTUNITIES,
    );
  }, [saved]);

  function playCheckmarkThen(action: () => void) {
    setShowCheckmark(true);
    Animated.parallel([
      Animated.timing(checkOpacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.spring(checkScale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 5,
        tension: 110,
      }),
    ]).start(() => {
      setTimeout(action, 600);
    });
  }

  async function handleGetDirections() {
    if (!saved || busy) return;
    setBusy(true);
    try {
      void trackEvent('opportunity_get_directions_tapped', {
        saved_place_id: saved.id,
        opportunity_number: opportunityNumber,
      });
      await openExternalMaps({
        latitude: saved.place.latitude,
        longitude: saved.place.longitude,
        name: saved.place.name,
        formatted_address: saved.place.formatted_address,
        google_place_id: saved.place.google_place_id,
        google_maps_url: saved.place.google_maps_url,
      });
      router.back();
    } finally {
      setBusy(false);
    }
  }

  async function handleMaybeNextTime() {
    if (!saved || busy) return;
    setBusy(true);
    try {
      void trackEvent('opportunity_maybe_next_time_tapped', {
        saved_place_id: saved.id,
        opportunity_number: opportunityNumber,
      });
      if ((saved.reminder_opportunity_count ?? 0) >= MAX_OPPORTUNITIES) {
        await markArchived(saved.id, { exhausted: true });
        void trackEvent('opportunity_archived_after_3', {
          saved_place_id: saved.id,
        });
      }
      router.back();
    } catch (e: any) {
      Alert.alert('Could not update', e?.message ?? 'Unknown error.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVisited() {
    if (!saved || busy) return;
    setBusy(true);
    try {
      void trackEvent('opportunity_visited_tapped', {
        saved_place_id: saved.id,
        opportunity_number: opportunityNumber,
      });
      await markVisited(saved.id);
      void trackEvent('place_marked_visited', {
        saved_place_id: saved.id,
      });
      playCheckmarkThen(() => router.back());
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Could not mark visited', e?.message ?? 'Unknown error.');
    }
  }

  function handleAdjustRadius() {
    if (!saved || busy) return;
    void trackEvent('opportunity_adjust_radius_tapped', {
      saved_place_id: saved.id,
      opportunity_number: opportunityNumber,
    });
    router.replace({ pathname: '/place/[id]', params: { id: saved.id } });
  }

  if (loading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Nearby reminder' }} />
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (!saved) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Nearby reminder' }} />
        <Card>
          <Text style={typography.bodyStrong}>This place is no longer saved.</Text>
          <View style={{ height: Spacing.md }} />
          <Button title="Close" variant="secondary" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Nearby reminder' }} />

      <View style={styles.dismissRow}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="x" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      <Card style={styles.heroCard}>
        <Text style={[typography.caption, styles.eyebrow]}>
          Opportunity {opportunityNumber} of {MAX_OPPORTUNITIES}
        </Text>
        <Text style={typography.heading}>You&apos;re near {saved.place.name}</Text>
        {saved.place.formatted_address ? (
          <Text style={[typography.body, styles.muted]}>
            {saved.place.formatted_address}
          </Text>
        ) : null}
        <Text style={[typography.body, styles.blurb]}>
          {blurbForOpportunity(opportunityNumber)}
        </Text>
      </Card>

      <View style={{ height: Spacing.lg }} />

      <Button
        title="Get directions"
        onPress={() => void handleGetDirections()}
        loading={busy}
      />
      <View style={{ height: Spacing.sm }} />
      <Button
        title="I went here"
        variant="secondary"
        onPress={() => void handleVisited()}
        loading={busy}
      />
      <View style={{ height: Spacing.sm }} />
      <Button
        title="Adjust reminder radius"
        variant="secondary"
        onPress={handleAdjustRadius}
      />
      <View style={{ height: Spacing.sm }} />
      <Button
        title="Maybe next time"
        variant="ghost"
        onPress={() => void handleMaybeNextTime()}
      />

      {showCheckmark ? (
        <View pointerEvents="none" style={styles.checkOverlay}>
          <Animated.View
            style={[
              styles.checkBubble,
              {
                opacity: checkOpacity,
                transform: [{ scale: checkScale }],
                backgroundColor: colors.accent,
              },
            ]}
          >
            <Feather name="check" size={64} color={colors.textInverse} />
          </Animated.View>
        </View>
      ) : null}
    </Screen>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
    dismissRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginBottom: Spacing.sm,
    },
    heroCard: {
      backgroundColor: colors.surfaceElevated,
      padding: Spacing.lg,
    },
    eyebrow: {
      color: colors.accent,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: Spacing.xs,
    },
    muted: { color: colors.textSecondary, marginTop: Spacing.xs },
    blurb: { color: colors.text, marginTop: Spacing.md },
    checkOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkBubble: {
      width: 140,
      height: 140,
      borderRadius: 70,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
  });
}

// (no further exports)
