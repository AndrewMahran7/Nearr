/**
 * Nearby-opportunity screen.
 *
 * Route: `/opportunity/[id]` where `id` is `saved_places.id`. Opened when the
 * user taps the body of a nearby-reminder notification.
 *
 * This is one of Nearr's highest-intent moments: the user is standing near
 * somewhere they already wanted to go. So the screen leads with the PLACE and
 * with why they saved it, then with going there — reminder mechanics are
 * demoted to a footer link. The old layout led with "Opportunity N of 3" and
 * stacked four equal-weight buttons, which read as reminder admin.
 *
 * Behavior is unchanged underneath:
 *   Get directions → openExternalMaps + opportunity_get_directions_tapped
 *   I went!        → markVisited + checkmark   (was "I went here")
 *   Not yet        → close, archiving on the 3rd (was "Maybe next time")
 *   Reminder settings → /place/[id] (redirects to the map's place sheet)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Screen } from '@/components';
import { Radius, Spacing } from '@/constants';

import {
  getSavedPlace,
  markArchived,
  markVisited,
} from '@/services/savedPlacesService';
import { trackEvent } from '@/lib/analytics';
import { openExternalMaps } from '@/lib/externalMaps';
import { planOpenOriginal } from '@/lib/openOriginalPost';
import { getCachedPlaceRichDetails } from '@/lib/placeRichDetailsCache';
import {
  MAX_OPPORTUNITIES,
  opportunityCopy,
  opportunityMetaChips,
  opportunityNarrative,
  opportunityNumberFor,
  shouldArchiveOnDecline,
  sourcePostLabel,
} from '@/lib/opportunityUi';
import { useTheme } from '@/lib/theme';
import type { SavedPlaceWithPlace } from '@/types';

export default function OpportunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  const [saved, setSaved] = useState<SavedPlaceWithPlace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [heroUri, setHeroUri] = useState<string | null>(null);
  const [heroFailed, setHeroFailed] = useState(false);

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

  // Hero photo comes from the SAME cached rich-details helper the map detail
  // uses — no new Places request is made for this screen.
  const googlePlaceId = saved?.place?.google_place_id?.trim() || null;
  useEffect(() => {
    let cancelled = false;
    setHeroUri(null);
    setHeroFailed(false);
    if (!googlePlaceId) return () => { cancelled = true; };
    void getCachedPlaceRichDetails(googlePlaceId).then((details) => {
      if (!cancelled) setHeroUri(details?.photoUrls?.[0] ?? null);
    });
    return () => { cancelled = true; };
  }, [googlePlaceId]);

  const opportunityNumber = useMemo(
    // reminder_opportunity_count is incremented at delivery time, so the count
    // at the moment the user opens the notification is "this one".
    () => opportunityNumberFor(saved?.reminder_opportunity_count),
    [saved],
  );
  const copy = useMemo(() => opportunityCopy(opportunityNumber), [opportunityNumber]);
  const chips = useMemo(() => opportunityMetaChips(saved), [saved]);
  const narrative = useMemo(() => opportunityNarrative(saved), [saved]);
  const canOpenSource = !!narrative.sourceUrl && planOpenOriginal(narrative.sourceUrl).kind === 'open';

  function playCheckmarkThen(action: () => void) {
    setShowCheckmark(true);
    Animated.parallel([
      Animated.timing(checkOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.spring(checkScale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 110 }),
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

  /** "Not yet" — the former "Maybe next time". Same archive-on-third policy. */
  async function handleNotYet() {
    if (!saved || busy) return;
    setBusy(true);
    try {
      void trackEvent('opportunity_maybe_next_time_tapped', {
        saved_place_id: saved.id,
        opportunity_number: opportunityNumber,
      });
      if (shouldArchiveOnDecline(saved.reminder_opportunity_count)) {
        await markArchived(saved.id, { exhausted: true });
        void trackEvent('opportunity_archived_after_3', { saved_place_id: saved.id });
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
      void trackEvent('place_marked_visited', { saved_place_id: saved.id });
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

  async function handleOpenSource() {
    if (!saved || !narrative.sourceUrl) return;
    const plan = planOpenOriginal(narrative.sourceUrl);
    if (plan.kind !== 'open') return;
    try {
      await Linking.openURL(plan.url);
    } catch {
      // Non-fatal: the place is still actionable without the post.
    }
  }

  if (loading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Nearby reminder' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
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

  const showHeroPhoto = !!heroUri && !heroFailed;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Hero: the place dominates. Name + context sit on the photo under a
            layered scrim (no gradient dependency in this project). Identical
            geometry with and without a photo, so nothing jumps. */}
        <View style={styles.hero}>
          {showHeroPhoto ? (
            <Image
              source={{ uri: heroUri! }}
              style={styles.heroImage}
              resizeMode="cover"
              onError={() => setHeroFailed(true)}
            />
          ) : (
            <View style={styles.heroFallback}>
              <Feather name="map-pin" size={40} color={colors.accent} />
            </View>
          )}
          <View pointerEvents="none" style={styles.scrimSoft} />
          <View pointerEvents="none" style={styles.scrimMid} />
          <View pointerEvents="none" style={styles.scrimStrong} />

          <View style={[styles.heroTopRow, { top: insets.top + Spacing.sm }]}>
            <View style={styles.nearbyPill}>
              <Feather name="navigation" size={12} color={colors.textInverse} />
              <Text style={styles.nearbyPillText}>{copy.eyebrow}</Text>
            </View>
            {/* Closing never mutates the place — it is purely a dismissal. */}
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.closeBtn}
            >
              <Feather name="x" size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          <View pointerEvents="none" style={styles.heroCaption}>
            <Text accessibilityRole="header" style={styles.placeName} numberOfLines={3}>
              {saved.place.name}
            </Text>
            {chips.length > 0 ? (
              <View style={styles.chipRow}>
                {chips.map((chip, index) => (
                  <View key={chip} style={styles.chipWrap}>
                    {index > 0 ? <View style={styles.chipDot} /> : null}
                    <Text style={styles.chipText} numberOfLines={1}>{chip}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.body}>
          {/* Going there is the outcome this screen exists for. */}
          <Pressable
            onPress={() => void handleGetDirections()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Get directions to ${saved.place.name}`}
            style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]}
          >
            {busy ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <>
                <Feather name="navigation" size={18} color={colors.textInverse} />
                <Text style={styles.primaryCtaText}>Get directions</Text>
              </>
            )}
          </Pressable>

          {/* Why this looked worth going. Omitted entirely when absent. */}
          {narrative.savedBecause ? (
            <View style={styles.savedBecause}>
              <View style={styles.savedBecauseAccent} />
              <View style={styles.savedBecauseBody}>
                <Text style={styles.savedBecauseLabel}>SAVED BECAUSE</Text>
                <Text style={styles.savedBecauseText}>{narrative.savedBecause}</Text>
              </View>
            </View>
          ) : null}

          {narrative.userNote ? (
            <View style={styles.noteBlock}>
              <Text style={styles.sectionLabel}>Your note</Text>
              <Text style={styles.noteText}>{narrative.userNote}</Text>
            </View>
          ) : null}

          {canOpenSource ? (
            <Pressable
              onPress={() => void handleOpenSource()}
              accessibilityRole="button"
              accessibilityLabel={sourcePostLabel(saved.source_type)}
              style={({ pressed }) => [styles.sourceBtn, pressed && styles.pressed]}
            >
              <Feather name="play-circle" size={17} color={colors.text} />
              <Text style={styles.sourceBtnText}>{sourcePostLabel(saved.source_type)}</Text>
            </Pressable>
          ) : null}

          {/* Visit decision: obvious, but clearly secondary to going. */}
          <View style={styles.decision}>
            <Text style={styles.decisionPrompt}>{copy.decisionPrompt}</Text>
            <View style={styles.decisionRow}>
              <Pressable
                onPress={() => void handleVisited()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`I went to ${saved.place.name}`}
                style={({ pressed }) => [styles.decisionBtn, styles.decisionPrimary, pressed && styles.pressed]}
              >
                <Text style={styles.decisionPrimaryText}>I went!</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleNotYet()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Not yet"
                style={({ pressed }) => [styles.decisionBtn, styles.decisionSecondary, pressed && styles.pressed]}
              >
                <Text style={styles.decisionSecondaryText}>Not yet</Text>
              </Pressable>
            </View>
            {copy.finalNote ? (
              <Text style={styles.finalNote}>{copy.finalNote}</Text>
            ) : null}
          </View>

          {/* Reminder mechanics: reachable, never competing with the place. */}
          <Pressable
            onPress={handleAdjustRadius}
            accessibilityRole="button"
            accessibilityLabel="Reminder settings for this place"
            style={({ pressed }) => [styles.reminderLink, pressed && styles.pressed]}
          >
            <Feather name="bell" size={14} color={colors.textMuted} />
            <Text style={styles.reminderLinkText}>Reminder settings</Text>
          </Pressable>
        </View>
      </ScrollView>

      {showCheckmark ? (
        <View pointerEvents="none" style={styles.checkOverlay}>
          <Animated.View
            style={[
              styles.checkBubble,
              { opacity: checkOpacity, transform: [{ scale: checkScale }] },
            ]}
          >
            <Feather name="check" size={44} color={colors.textInverse} />
          </Animated.View>
        </View>
      ) : null}
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
    content: { flexGrow: 1 },
    pressed: { opacity: 0.7 },

    hero: { height: 340, justifyContent: 'flex-end', backgroundColor: colors.surface },
    heroImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
    heroFallback: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
    },
    scrimSoft: {
      position: 'absolute', left: 0, right: 0, bottom: 0, height: '66%',
      backgroundColor: 'rgba(0,0,0,0.18)',
    },
    scrimMid: {
      position: 'absolute', left: 0, right: 0, bottom: 0, height: '42%',
      backgroundColor: 'rgba(0,0,0,0.34)',
    },
    scrimStrong: {
      position: 'absolute', left: 0, right: 0, bottom: 0, height: '24%',
      backgroundColor: 'rgba(0,0,0,0.48)',
    },
    heroTopRow: {
      position: 'absolute',
      left: Spacing.lg,
      right: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      zIndex: 4,
    },
    nearbyPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: Radius.pill,
      backgroundColor: colors.primary,
    },
    nearbyPillText: {
      ...typography.caption,
      color: colors.textInverse,
      fontWeight: '800',
    },
    closeBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    heroCaption: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.lg,
      gap: Spacing.sm,
    },
    placeName: {
      ...typography.title,
      color: '#FFFFFF',
      fontSize: 30,
      lineHeight: 35,
      textShadowColor: 'rgba(0,0,0,0.45)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 6,
    },
    chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
    chipWrap: { flexDirection: 'row', alignItems: 'center' },
    chipDot: {
      width: 3,
      height: 3,
      borderRadius: 1.5,
      marginHorizontal: Spacing.sm,
      backgroundColor: 'rgba(255,255,255,0.6)',
    },
    chipText: {
      ...typography.caption,
      color: 'rgba(255,255,255,0.9)',
      fontWeight: '600',
      textShadowColor: 'rgba(0,0,0,0.4)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },

    body: { padding: Spacing.lg, gap: Spacing.lg },

    primaryCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      minHeight: 56,
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      shadowColor: colors.primary,
      shadowOpacity: 0.3,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    primaryCtaText: { color: colors.textInverse, fontWeight: '800', fontSize: 16 },

    savedBecause: {
      flexDirection: 'row',
      borderRadius: Radius.md,
      overflow: 'hidden',
      backgroundColor: 'rgba(255,106,26,0.09)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,106,26,0.28)',
    },
    savedBecauseAccent: { width: 3, backgroundColor: colors.accent },
    savedBecauseBody: { flex: 1, gap: 6, padding: Spacing.md },
    savedBecauseLabel: {
      ...typography.caption,
      color: colors.accent,
      fontWeight: '800',
      letterSpacing: 0.7,
      fontSize: 11,
    },
    savedBecauseText: { ...typography.body, color: colors.text, lineHeight: 23 },

    noteBlock: { gap: Spacing.xs },
    sectionLabel: { ...typography.bodyStrong, color: colors.text },
    noteText: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },

    sourceBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      minHeight: 48,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    sourceBtnText: { ...typography.bodyStrong, color: colors.text },

    decision: { gap: Spacing.sm, paddingTop: Spacing.xs },
    decisionPrompt: { ...typography.bodyStrong, color: colors.text },
    decisionRow: { flexDirection: 'row', gap: Spacing.sm },
    decisionBtn: {
      flex: 1,
      minHeight: 50,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
    },
    decisionPrimary: {
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.accent,
    },
    decisionPrimaryText: { ...typography.bodyStrong, color: colors.accent },
    decisionSecondary: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    decisionSecondaryText: { ...typography.bodyStrong, color: colors.textSecondary },
    finalNote: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },

    reminderLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      minHeight: 44,
    },
    reminderLinkText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },

    checkOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.35)',
    },
    checkBubble: {
      width: 108,
      height: 108,
      borderRadius: 54,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
  });
}
