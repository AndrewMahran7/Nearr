/**
 * SavePlace screen — manual flow.
 *
 * Two-step UX:
 *   1. Search by text -> Google Places results list.
 *   2. Tap a result   -> confirmation card with radius chooser + Save.
 *
 * Radius modes:
 *   - 'default'  : leave radius_value / radius_unit NULL so the profile
 *                  default (default_radius_value / default_radius_unit) is
 *                  used at notification time.
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
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';

import { Button, Card, EmptyState, Input, Screen } from '@/components';
import { Colors, Radius, Spacing, Typography } from '@/constants';
import { getActivationSaveFeedback } from '@/lib/activation';

import { usePlacesSearch } from '@/hooks/usePlacesSearch';
import { getProfile } from '@/services/profileService';
import { listSavedPlaces, saveSavedPlace } from '@/services/savedPlacesService';
import { trackEvent } from '@/lib/analytics';
import type { LocationBias, PlaceCandidate, PlacesError } from '@/services/placesService';
import type { Profile, RadiusUnit, SourceType } from '@/types';

type RadiusMode = 'default' | 'miles' | 'minutes';

const SOURCE_TYPES: SourceType[] = ['manual', 'tiktok', 'instagram', 'link'];

function isSourceType(v: string | undefined): v is SourceType {
  return !!v && (SOURCE_TYPES as string[]).includes(v);
}

function placesErrorMessage(err: PlacesError): string {
  switch (err.code) {
    case 'MISSING_API_KEY':
      return 'Google Places API key is missing. Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY.';
    case 'NETWORK':
      return 'Network error. Check your connection and try again.';
    case 'OVER_QUERY_LIMIT':
      return 'Search quota exceeded for now. Try again later.';
    case 'REQUEST_DENIED':
      return 'Search request denied. Check the API key configuration.';
    case 'INVALID_REQUEST':
      return 'Could not understand that search.';
    case 'NOT_FOUND':
      return 'No results.';
    default:
      return err.message || 'Something went wrong.';
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

  // ---- profile (for default radius display) ------------------------------
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let alive = true;
    getProfile().then((p) => {
      if (alive) setProfile(p);
    });
    return () => {
      alive = false;
    };
  }, []);

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

  const defaultRadiusLabel = useMemo(() => {
    if (!profile) return 'Profile default';
    return `${profile.default_radius_value} ${profile.default_radius_unit}`;
  }, [profile]);

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
      if (!result.savedPlaceId) {
        console.warn('[save-flow] saved place id missing; opening map without focus');
        router.replace('/(tabs)/map');
        return;
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
      Alert.alert('Could not save', e?.message ?? 'Unknown error.');
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
        <Text style={[Typography.title, styles.headerTitle]}>Save place</Text>

        <Card style={styles.confirmCard}>
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
            label={`Default (${defaultRadiusLabel})`}
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
          <Button title="Save" onPress={handleSave} loading={saving} style={{ flex: 1 }} />
        </View>
      </Screen>
    );
  }

  // -----------------------------------------------------------------------
  // Render: search step
  // -----------------------------------------------------------------------
  return (
    <Screen>
      <Text style={[Typography.title, styles.headerTitle]}>Add a place</Text>

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
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setSelected(item)}
          >
            <Text style={Typography.bodyStrong}>{item.name}</Text>
            {item.formattedAddress ? (
              <Text style={[Typography.caption, styles.muted, { marginTop: 2 }]}>
                {item.formattedAddress}
              </Text>
            ) : null}
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
  return (
    <Pressable
      onPress={onPress}
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
const styles = StyleSheet.create({
  headerTitle: { marginBottom: Spacing.lg },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  row: {
    paddingVertical: Spacing.md,
  },
  rowPressed: { opacity: 0.6 },
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
