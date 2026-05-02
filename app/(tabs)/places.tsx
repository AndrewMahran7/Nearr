/**
 * Places tab — pure list view of the user's saved places.
 *
 * Uses the same data source as Home but without the dashboard header. Useful
 * when the user just wants to scan their saved list.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';

import { EmptyState, Input, SavedPlaceCard, Screen } from '@/components';
import { Colors, Radius, Spacing, Typography } from '@/constants';

import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { distanceMeters } from '@/lib/geo';
import { getProfile } from '@/services/profileService';
import { deleteSavedPlace } from '@/services/savedPlacesService';
import type { Profile, SavedPlaceWithPlace } from '@/types';

type PlacesFilter =
  | 'all'
  | 'recent'
  | 'nearby'
  | 'instagram'
  | 'tiktok'
  | 'reminders-on';

type NearbyItem = {
  saved: SavedPlaceWithPlace;
  distance: number;
};

type LocationState = 'idle' | 'available' | 'unavailable';

function isRecent(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  return Date.now() - created <= fourteenDaysMs;
}

function matchesSource(saved: SavedPlaceWithPlace, source: 'instagram' | 'tiktok'): boolean {
  const sourceType = saved.source_type?.toLowerCase();
  const sourceUrl = saved.source_url?.toLowerCase() ?? '';
  return sourceType === source || sourceUrl.includes(`${source}.com`);
}

function filterLabel(filter: PlacesFilter): string {
  switch (filter) {
    case 'recent':
      return 'recent';
    case 'nearby':
      return 'nearby saved places';
    case 'instagram':
      return 'Instagram';
    case 'tiktok':
      return 'TikTok';
    case 'reminders-on':
      return 'reminders on';
    default:
      return 'all';
  }
}

export default function PlacesTab() {
  const router = useRouter();
  const { data, loading, refreshing, error, refresh } = useSavedPlaces();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [filter, setFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<PlacesFilter>('all');
  const [currentLocation, setCurrentLocation] = useState<Location.LocationObjectCoords | null>(null);
  const [locationState, setLocationState] = useState<LocationState>('idle');

  const loadNearbyLocation = useCallback(async () => {
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      let status = permission.status;
      if (status !== 'granted') {
        const requested = await Location.requestForegroundPermissionsAsync();
        status = requested.status;
      }

      if (status !== 'granted') {
        setCurrentLocation(null);
        setLocationState('unavailable');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCurrentLocation(position.coords);
      setLocationState('available');
    } catch {
      setCurrentLocation(null);
      setLocationState('unavailable');
    }
  }, []);

  const nearbyItems = useMemo<NearbyItem[]>(() => {
    if (!currentLocation) return [];
    return data
      .filter(
        (saved) =>
          Number.isFinite(saved.place?.latitude) && Number.isFinite(saved.place?.longitude),
      )
      .map((saved) => ({
        saved,
        distance: distanceMeters(
          { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
          { latitude: saved.place.latitude, longitude: saved.place.longitude },
        ),
      }))
      .sort((left, right) => left.distance - right.distance);
  }, [currentLocation, data]);

  const counts = useMemo(
    () => ({
      all: data.length,
      recent: data.filter((saved) => isRecent(saved.created_at)).length,
      nearby: nearbyItems.length,
      instagram: data.filter((saved) => matchesSource(saved, 'instagram')).length,
      tiktok: data.filter((saved) => matchesSource(saved, 'tiktok')).length,
      remindersOn: data.filter((saved) => saved.notifications_enabled).length,
    }),
    [data, nearbyItems],
  );

  // Client-side filter — case-insensitive match across place name and
  // address. List is small (V1 = personal saves), so doing this in JS is
  // simpler than re-querying Supabase and feels instant while typing.
  const filteredData = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let base: SavedPlaceWithPlace[] = data;

    if (activeFilter === 'recent') {
      base = [...data].sort(
        (left, right) =>
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      );
    } else if (activeFilter === 'nearby') {
      base = nearbyItems.map(({ saved }) => saved);
    } else if (activeFilter === 'instagram') {
      base = data.filter((saved) => matchesSource(saved, 'instagram'));
    } else if (activeFilter === 'tiktok') {
      base = data.filter((saved) => matchesSource(saved, 'tiktok'));
    } else if (activeFilter === 'reminders-on') {
      base = data.filter((saved) => saved.notifications_enabled);
    }

    if (!q) return base;
    return base.filter((s) => {
      const name = s.place?.name?.toLowerCase() ?? '';
      const addr = s.place?.formatted_address?.toLowerCase() ?? '';
      return name.includes(q) || addr.includes(q);
    });
  }, [activeFilter, data, filter, nearbyItems]);

  const loadProfile = useCallback(async () => {
    setProfile(await getProfile());
  }, []);

  useEffect(() => {
    if (activeFilter !== 'nearby') return;
    if (locationState === 'available' || locationState === 'unavailable') return;
    void loadNearbyLocation();
  }, [activeFilter, loadNearbyLocation, locationState]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void loadProfile();
      if (activeFilter === 'nearby') {
        setLocationState('idle');
      }
    }, [activeFilter, refresh, loadProfile]),
  );

  async function handleDelete(id: string) {
    try {
      await deleteSavedPlace(id);
      await refresh();
    } catch (e: any) {
      Alert.alert('Could not remove', e?.message ?? 'Unknown error.');
    }
  }

  if (loading && data.length === 0) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (error && data.length === 0) {
    return (
      <Screen>
        <EmptyState
          variant="error"
          title={'Couldn\u2019t load your places'}
          body={error}
          actionTitle="Try again"
          onAction={refresh}
        />
      </Screen>
    );
  }

  function setFilterAndResetLocation(next: PlacesFilter) {
    setActiveFilter(next);
    if (next === 'nearby') {
      setLocationState('idle');
    }
  }

  function renderEmptyState() {
    if (filter.trim()) {
      return (
        <EmptyState
          framed={false}
          title="No matches"
          body={`No ${filterLabel(activeFilter)} saves match “${filter.trim()}”.`}
          actionTitle="Clear search"
          onAction={() => setFilter('')}
          secondaryTitle="Clear filter"
          onSecondary={() => setFilterAndResetLocation('all')}
        />
      );
    }

    if (activeFilter === 'nearby' && locationState !== 'available') {
      return (
        <EmptyState
          framed={false}
          title="Turn on location to see saved places near you"
          body="Nearr uses your location to show which saved places are nearby."
          actionTitle="Try again"
          onAction={() => {
            setLocationState('idle');
            void loadNearbyLocation();
          }}
          secondaryTitle="Clear filter"
          onSecondary={() => setFilterAndResetLocation('all')}
        />
      );
    }

    if (activeFilter !== 'all') {
      const title =
        activeFilter === 'instagram'
          ? 'No Instagram saves yet'
          : activeFilter === 'tiktok'
            ? 'No TikTok saves yet'
            : activeFilter === 'reminders-on'
              ? 'No reminders on yet'
              : activeFilter === 'recent'
                ? 'No recent saves yet'
                : 'No nearby saved places yet';
      const body =
        activeFilter === 'recent'
          ? 'You have not saved any new places recently.'
          : activeFilter === 'nearby'
            ? 'Nothing you saved looks close enough to go right now.'
            : activeFilter === 'reminders-on'
              ? 'Turn on a nearby reminder for a place and it will show up here.'
              : `No ${filterLabel(activeFilter)} yet.`;

      return (
        <EmptyState
          framed={false}
          title={title}
          body={body}
          actionTitle="Clear filter"
          onAction={() => setFilterAndResetLocation('all')}
        />
      );
    }

    return (
      <EmptyState
        framed={false}
        title="No places yet"
        body="Save your first spot, or paste a link from TikTok or Instagram."
        actionTitle="Save a place"
        onAction={() => router.push('/add-place')}
        secondaryTitle="Save from a link"
        onSecondary={() => router.push('/share')}
      />
    );
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={filteredData}
        keyExtractor={(s) => s.id}
        contentContainerStyle={
          filteredData.length === 0 ? styles.emptyContent : styles.listContent
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={Typography.title}>Places</Text>
            <Text style={[Typography.body, styles.sub]}>
              Find places you wanted to try.
            </Text>

            {data.length > 0 ? (
              <>
                <View style={styles.searchWrap}>
                  <Input
                    value={filter}
                    onChangeText={setFilter}
                    placeholder="Search saved places"
                    autoCapitalize="none"
                    autoCorrect={false}
                    clearButtonMode="while-editing"
                  />
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterRow}
                >
                  <FilterChip
                    label={`All${counts.all ? ` ${counts.all}` : ''}`}
                    active={activeFilter === 'all'}
                    onPress={() => setFilterAndResetLocation('all')}
                  />
                  <FilterChip
                    label={`Recent${counts.recent ? ` ${counts.recent}` : ''}`}
                    active={activeFilter === 'recent'}
                    onPress={() => setFilterAndResetLocation('recent')}
                  />
                  <FilterChip
                    label={`Nearby${counts.nearby ? ` ${counts.nearby}` : ''}`}
                    active={activeFilter === 'nearby'}
                    onPress={() => setFilterAndResetLocation('nearby')}
                  />
                  <FilterChip
                    label={`Instagram${counts.instagram ? ` ${counts.instagram}` : ''}`}
                    active={activeFilter === 'instagram'}
                    onPress={() => setFilterAndResetLocation('instagram')}
                  />
                  <FilterChip
                    label={`TikTok${counts.tiktok ? ` ${counts.tiktok}` : ''}`}
                    active={activeFilter === 'tiktok'}
                    onPress={() => setFilterAndResetLocation('tiktok')}
                  />
                  <FilterChip
                    label={`Reminders on${counts.remindersOn ? ` ${counts.remindersOn}` : ''}`}
                    active={activeFilter === 'reminders-on'}
                    onPress={() => setFilterAndResetLocation('reminders-on')}
                  />
                </ScrollView>
              </>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <SavedPlaceCard
            saved={item}
            profile={profile}
            onPress={() => router.push(`/place/${item.id}`)}
            onDelete={() => handleDelete(item.id)}
            onShowOnMap={() =>
              router.push({
                pathname: '/(tabs)/map',
                params: { savedPlaceId: item.id },
              })
            }
          />
        )}
        ListEmptyComponent={renderEmptyState()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  sub: {
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  searchWrap: {
    marginTop: Spacing.lg,
  },
  filterRow: {
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  listContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg },
  center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
});

function FilterChip({
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
      style={[stylesChip.base, active ? stylesChip.active : stylesChip.inactive]}
    >
      <Text style={[Typography.label, active ? stylesChip.activeText : stylesChip.inactiveText]}>
        {label}
      </Text>
    </Pressable>
  );
}

const stylesChip = StyleSheet.create({
  base: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  active: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  inactive: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
  },
  activeText: {
    color: Colors.textInverse,
  },
  inactiveText: {
    color: Colors.text,
  },
});
