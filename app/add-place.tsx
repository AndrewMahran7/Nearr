/**
 * SavePlace screen — manual flow.
 *
 * Two-step UX:
 *   1. Search by text -> Google Places results list.
 *   2. Tap a result   -> confirmation card with radius chooser + Save.
 *
 * Radius modes:
 *   - 'default'  : leave radius_value / radius_unit NULL so a category-aware
 *                  distance is used at notification time (see
 *                  lib/nearbyEligibility.ts).
 *   - 'miles'    : numeric override in miles.
 *   - 'minutes'  : numeric override in minutes (drive-time).
 *
 * On success: replace the route with /(tabs)/map (focused on the new place
 * via savedPlaceId) so the user sees it on their map and won't accidentally
 * pop back to the search list.
 *
 * Duplicates are non-fatal: we show a friendly alert and still navigate.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';

import { Button, Card, EmptyState, Input, Screen } from '@/components';
import { Colors, Radius, Spacing, Typography } from '@/constants';
import { useTheme } from '@/lib/theme';
import { PlaceImage } from '@/components/PlaceImage';
import { hapticSuccess } from '@/lib/haptics';
import { getActivationSaveFeedback } from '@/lib/activation';

import { usePlacesSearch } from '@/hooks/usePlacesSearch';
import { upsertSavedPlaceIntoCache } from '@/hooks/useSavedPlaces';
import { listSavedPlaces, saveSavedPlace } from '@/services/savedPlacesService';
import { trackEvent } from '@/lib/analytics';
import type { LocationBias, PlaceCandidate, PlacesError } from '@/services/placesService';
import type { RadiusUnit, SourceType } from '@/types';

type RadiusMode = 'default' | 'miles' | 'minutes';

const SOURCE_TYPES: SourceType[] = ['manual', 'tiktok', 'instagram', 'link'];

function isSourceType(v: string | undefined): v is SourceType {
  return !!v && (SOURCE_TYPES as string[]).includes(v);
}

function placesErrorMessage(err: PlacesError): string {
  switch (err.code) {
    case 'MISSING_API_KEY':
      return 'Place search is unavailable right now. Please try again later.';
    case 'NETWORK':
      return 'Network error. Check your connection and try again.';
    case 'OVER_QUERY_LIMIT':
      return 'Search quota exceeded for now. Try again later.';
    case 'REQUEST_DENIED':
      return 'Place search is unavailable right now. Please try again later.';
    case 'INVALID_REQUEST':
      return 'Could not understand that search.';
    case 'NOT_FOUND':
      return 'No results.';
    default:
      return 'Couldn?t search places. Please try again.';
  }
}

async function getPostSaveCount(): Promise<number | null> {
  try {
    const places = await listSavedPlaces();
    return places.length;
  } catch (err) {
    console.warn('[save-flow] post-save count lookup failed', (err as Error)?.message);
    return null;
  }
}

export default function SavePlace() {
  const router = useRouter();
  const { colors: Colors, typography: Typography } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const params = useLocalSearchParams<{
    q?: string;
    source_url?: string;
    source_type?: string;
  }>();

  const incomingSourceType: SourceType = isSourceType(params.source_type)
    ? params.source_type
    : 'manual';
  const incomingSourceUrl = params.source_url ?? null;

  // ---- search state ------------------------------------------------------
  const [query, setQuery] = useState(params.q ?? '');
  const { results, loading, error, lastQuery, search, reset } = usePlacesSearch();

  // ---- selection / confirmation state ------------------------------------
  const [selected, setSelected] = useState<PlaceCandidate | null>(null);
  const [saving, setSaving] = useState(false);

  // ---- best-effort user location for search bias ------------------------
  // Used so manual searches like "Starbucks" surface the closest one when
  // we already have foreground permission. We never prompt -- if the user
  // hasn't granted location, we just fall back to unbiased Places ranking.
  const userLatLngRef = useRef<LocationBias | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const last = await Location.getLastKnownPositionAsync({});
        if (!alive || !last) return;
        userLatLngRef.current = {
          lat: last.coords.latitude,
          lng: last.coords.longitude,
        };
      } catch {
        // ignore -- bias is best-effort
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ---- radius chooser state ----------------------------------------------
  const [radiusMode, setRadiusMode] = useState<RadiusMode>('default');
  const [milesText, setMilesText] = useState('1');
  const [minutesText, setMinutesText] = useState('10');

  // ---- auto-search if a query came in via deep-link/share ---------------
  useEffect(() => {
    if (params.q && params.q.trim()) {
      void search(params.q.trim(), userLatLngRef.current ?? undefined);
    }
    // Only run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- debounced live search as the user types ---------------------------
  // 300ms after the last keystroke we issue a search. Short enough to feel
  // like an autocomplete dropdown, long enough that we don't burn a Places
  // call on every character. The hook itself drops stale responses, so the
  // user always sees results for the most recent query.
  //
  // Skipped while we're showing the confirmation card (`selected !== null`)
  // and while a saved deep-link query is being served on mount, to avoid
  // double-firing.
  useEffect(() => {
    if (selected) return;
    const q = query.trim();
    // Don't fire on very short input -- 1-2 chars produces noise.
    if (q.length < 3) return;
    // Skip if this is the same query we already last fetched.
    if (q === lastQuery) return;
    const handle = setTimeout(() => {
      void search(q, userLatLngRef.current ?? undefined);
    }, 300);
    return () => clearTimeout(handle);
  }, [query, selected, lastQuery, search]);

  // -----------------------------------------------------------------------

  function runSearch() {
    void search(query, userLatLngRef.current ?? undefined);
  }

  function clearSelection() {
    setSelected(null);
  }

  async function handleSave() {
    if (!selected) return;

    let radiusValue: number | null = null;
    let radiusUnit: RadiusUnit | null = null;

    if (radiusMode === 'miles') {
      const n = Number.parseFloat(milesText);
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert('Invalid radius', 'Enter a positive number of miles.');
        return;
      }
      radiusValue = n;
      radiusUnit = 'miles';
    } else if (radiusMode === 'minutes') {
      const n = Number.parseInt(minutesText, 10);
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert('Invalid radius', 'Enter a positive number of minutes.');
        return;
      }
      radiusValue = n;
      radiusUnit = 'minutes';
    }

    setSaving(true);
    void trackEvent('save_started', {
      source_type: incomingSourceType,
      flow: 'manual',
      google_place_id: selected.googlePlaceId ?? null,
      query: query.trim() || null,
      candidate_count: results.length,
    });
    try {
      const result = await saveSavedPlace({
        candidate: selected,
        radiusValue,
        radiusUnit,
        sourceType: incomingSourceType,
        sourceUrl: incomingSourceUrl,
      });

      if (result.status === 'saved') hapticSuccess();
      if (result.status === 'duplicate') {
        Alert.alert('Already saved', `${selected.name} is already in your places.`);
      } else {
        const postSaveCount = await getPostSaveCount();
        if (postSaveCount == null) {
          Alert.alert('Saved to your map', selected.name);
        } else {
          const feedback = getActivationSaveFeedback(postSaveCount);
          Alert.alert(feedback.title, feedback.message);
          if (feedback.milestoneEvent) {
            void trackEvent(feedback.milestoneEvent, {
              source_type: incomingSourceType,
              flow: 'manual',
              saved_place_id: result.savedPlaceId,
              saved_count: postSaveCount,
            });
          }
          if (feedback.completed) {
            void trackEvent('activation_completed_3_saves', {
              source_type: incomingSourceType,
              flow: 'manual',
              saved_place_id: result.savedPlaceId,
              saved_count: postSaveCount,
            });
          }
        }
      }
      void trackEvent('save_success', {
        source_type: incomingSourceType,
        flow: 'manual',
        google_place_id: selected.googlePlaceId ?? null,
        saved_place_id: result.savedPlaceId,
        duplicate: result.status === 'duplicate',
      });
      // Seed the shared cache so the map's savedPlaceId focus finds the newly
      // saved place immediately (before any network revalidation).
      if (result.status === 'saved') {
        upsertSavedPlaceIntoCache(result.saved);
      }
      router.replace({
        pathname: '/(tabs)/map',
        params: { savedPlaceId: result.savedPlaceId },
      });
    } catch (e: any) {
      console.warn('[SavePlace] save failed', e?.message);
      void trackEvent('save_failed', {
        source_type: incomingSourceType,
        flow: 'manual',
        google_place_id: selected.googlePlaceId ?? null,
        error_code: 'save_threw',
      });
      Alert.alert('Could not save', 'Your place wasn?t saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Render: confirmation step
  // -----------------------------------------------------------------------
  if (selected) {
    return (
      <Screen>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48 }}>
        <Text style={[Typography.title, styles.headerTitle]}>Make it a memory</Text>

        <Card style={styles.confirmCard}>
          <PlaceImage googlePlaceId={selected.googlePlaceId} initialPhotoUrls={selected.photoUrls?.length ? selected.photoUrls : selected.photoUrl ? [selected.photoUrl] : undefined} preferPlacePhoto hydrationPolicy="active_manual_search" width="100%" height={210} borderRadius={Radius.md} accessibilityLabel={`Photo of ${selected.name}`} style={{ marginBottom: 16 }} />
          <Text style={Typography.heading}>{selected.name}</Text>
          {selected.formattedAddress ? (
            <Text style={[Typography.body, styles.muted]}>{selected.formattedAddress}</Text>
          ) : null}
          {selected.category ? (
            <Text style={[Typography.caption, styles.muted, { marginTop: Spacing.xs }]}>
              {selected.category}
            </Text>
          ) : null}
        </Card>

        <Text style={[Typography.label, styles.sectionLabel]}>Notify me when within</Text>

        <View style={styles.radiusGroup}>
          <RadiusOption
            label="Auto"
            active={radiusMode === 'default'}
            onPress={() => setRadiusMode('default')}
          />
          <RadiusOption
            label="Miles"
            active={radiusMode === 'miles'}
            onPress={() => setRadiusMode('miles')}
          />
          <RadiusOption
            label="Minutes"
            active={radiusMode === 'minutes'}
            onPress={() => setRadiusMode('minutes')}
          />
        </View>

        {radiusMode === 'miles' ? (
          <Input
            value={milesText}
            onChangeText={setMilesText}
            keyboardType="decimal-pad"
            placeholder="e.g. 1.5"
            style={styles.numberInput}
          />
        ) : null}
        {radiusMode === 'minutes' ? (
          <Input
            value={minutesText}
            onChangeText={setMinutesText}
            keyboardType="number-pad"
            placeholder="e.g. 10"
            style={styles.numberInput}
          />
        ) : null}

        <View style={styles.actions}>
          <Button title="Back" variant="secondary" onPress={clearSelection} disabled={saving} />
          <View style={{ width: Spacing.md }} />
          <Button title="Save this place" variant="save" onPress={handleSave} loading={saving} style={{ flex: 1 }} />
        </View>
        </ScrollView>
      </Screen>
    );
  }

  // -----------------------------------------------------------------------
  // Render: search step
  // -----------------------------------------------------------------------
  return (
    <Screen>
      <Text style={[Typography.title, styles.headerTitle]}>Find somewhere new</Text>

      <View style={styles.searchRow}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a place"
          onSubmitEditing={runSearch}
          returnKeyType="search"
          autoFocus
          style={{ flex: 1 }}
        />
        <View style={{ width: Spacing.sm }} />
        <Button title="Search" onPress={runSearch} loading={loading} />
      </View>

      <FlatList
        data={results}
        keyExtractor={(r) => r.googlePlaceId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={results.length === 0 ? styles.emptyContent : undefined}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item, index }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setSelected(item)}
            accessibilityRole="button"
            accessibilityLabel={`Inspect ${item.name}`}
          >
            <PlaceImage googlePlaceId={item.googlePlaceId} initialPhotoUrls={item.photoUrls?.length ? item.photoUrls : item.photoUrl ? [item.photoUrl] : undefined} size={72} borderRadius={Radius.md} preferPlacePhoto hydrationPolicy={index === 0 ? 'active_manual_search' : index < 4 ? 'compact_known_only' : 'offscreen_manual_search'} presentationMode="candidate" presentationActive={index === 0} />
            <View style={{ flex: 1 }}>
            <Text style={Typography.bodyStrong}>{item.name}</Text>
            {item.formattedAddress ? (
              <Text style={[Typography.caption, styles.muted, { marginTop: 2 }]}>
                {item.formattedAddress}
              </Text>
            ) : null}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <SearchEmptyState
            loading={loading}
            error={error}
            lastQuery={lastQuery}
            onClear={reset}
          />
        }
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function RadiusOption({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors: Colors, typography: Typography } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.radiusOption, active && styles.radiusOptionActive]}
    >
      <Text
        style={[
          Typography.label,
          { color: active ? Colors.textInverse : Colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SearchEmptyState({
  loading,
  error,
  lastQuery,
  onClear,
}: {
  loading: boolean;
  error: PlacesError | null;
  lastQuery: string | null;
  onClear: () => void;
}) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  if (loading) {
    return (
      <View style={styles.emptyBox}>
        <ActivityIndicator />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.emptyBox}>
        <EmptyState
          framed={false}
          variant="error"
          title="Search failed"
          body={placesErrorMessage(error)}
          actionTitle="Try again"
          onAction={onClear}
        />
      </View>
    );
  }
  if (lastQuery && !loading) {
    return (
      <View style={styles.emptyBox}>
        <EmptyState
          framed={false}
          title="No results"
          body={`We couldn\u2019t find anything for \u201C${lastQuery}\u201D. Try a more specific name, or include the city.`}
        />
      </View>
    );
  }
  return (
    <View style={styles.emptyBox}>
      <EmptyState
        framed={false}
        title="Search for a place"
        body={'Try \u201CJoe\u2019s Pizza Brooklyn\u201D or paste the venue name from a TikTok or Instagram post.'}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
function createStyles(Colors: ReturnType<typeof useTheme>['colors']) { return StyleSheet.create({
  headerTitle: { marginBottom: Spacing.lg },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16 },
  rowPressed: { backgroundColor: Colors.surfaceElevated },
  sep: { height: 1, backgroundColor: Colors.border },
  muted: { color: Colors.textMuted },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  emptyBox: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
  },

  // confirmation
  confirmCard: { marginBottom: Spacing.xl },
  sectionLabel: { marginBottom: Spacing.sm },
  radiusGroup: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  radiusOption: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  radiusOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  numberInput: { marginBottom: Spacing.lg },
  actions: {
    flexDirection: 'row',
    marginTop: Spacing.lg,
  },
});
}
