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
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { EmptyState, Input, OfflineBanner, SavedPlaceCard, Screen } from '@/components';
import { Radius, Spacing } from '@/constants';

import { useNearbyPlaces } from '@/hooks/useNearbyPlaces';
import {
  getSavedPlacesCacheSnapshot,
  removeSavedPlaceFromCache,
  restoreSavedPlacesCache,
  useSavedPlaces,
} from '@/hooks/useSavedPlaces';
import { useTheme } from '@/lib/theme';
import { trackEvent } from '@/lib/analytics';
import { getProfile } from '@/services/profileService';
import { deleteSavedPlace, unarchive } from '@/services/savedPlacesService';
import type { Profile, SavedPlaceWithPlace } from '@/types';
import { CATEGORY_FILTER_GROUPS, type CategoryFilterGroup } from '@/lib/placeCategory';
import { browseFilterCount, filterSavedPlaces } from '@/lib/savedPlacesBrowse';

type PlacesFilter =
  | 'active'
  | 'recent'
  | 'nearby'
  | 'visited'
  | 'archived'
  | 'instagram'
  | 'tiktok'
  | 'reminders-on';

function isRecent(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() - created <= 14 * 24 * 60 * 60 * 1000;
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
    case 'visited':
      return 'visited';
    case 'archived':
      return 'archived';
    case 'instagram':
      return 'Instagram';
    case 'tiktok':
      return 'TikTok';
    case 'reminders-on':
      return 'reminders on';
    default:
      return 'active';
  }
}

export default function PlacesTab() {
  const router = useRouter();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const { data, loading, refreshing, error, offline, lastSyncedAt, refresh, revalidate } = useSavedPlaces();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [filter, setFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<PlacesFilter>('recent');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterGroup | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activeData = useMemo(
    () => data.filter((s) => !s.archived_at && !s.visited_at),
    [data],
  );

  const { nearbyPlaces, locationState, refreshLocation } = useNearbyPlaces(activeData, {
    enabled: activeFilter === 'nearby',
    requestPermission: true,
  });

  const counts = useMemo(
    () => ({
      active: activeData.length,
      recent: activeData.filter((saved) => isRecent(saved.created_at)).length,
      nearby: nearbyPlaces.length,
      visited: data.filter((saved) => !!saved.visited_at).length,
      archived: data.filter((saved) => !!saved.archived_at && !saved.visited_at).length,
      instagram: activeData.filter((saved) => matchesSource(saved, 'instagram')).length,
      tiktok: activeData.filter((saved) => matchesSource(saved, 'tiktok')).length,
      remindersOn: activeData.filter((saved) => saved.notifications_enabled).length,
    }),
    [activeData, data, nearbyPlaces],
  );

  // Client-side filter — case-insensitive match across place name and
  // address. List is small (V1 = personal saves), so doing this in JS is
  // simpler than re-querying Supabase and feels instant while typing.
  const filteredData = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let base: SavedPlaceWithPlace[] = activeData;

    if (activeFilter === 'recent') {
      base = [...activeData].sort(
        (left, right) =>
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      );
    } else if (activeFilter === 'nearby') {
      base = nearbyPlaces;
    } else if (activeFilter === 'visited') {
      base = data
        .filter((saved) => !!saved.visited_at)
        .sort(
          (left, right) =>
            new Date(right.visited_at ?? right.updated_at).getTime() -
            new Date(left.visited_at ?? left.updated_at).getTime(),
        );
    } else if (activeFilter === 'archived') {
      base = data
        .filter((saved) => !!saved.archived_at && !saved.visited_at)
        .sort(
          (left, right) =>
            new Date(right.archived_at ?? right.updated_at).getTime() -
            new Date(left.archived_at ?? left.updated_at).getTime(),
        );
    } else if (activeFilter === 'instagram') {
      base = activeData.filter((saved) => matchesSource(saved, 'instagram'));
    } else if (activeFilter === 'tiktok') {
      base = activeData.filter((saved) => matchesSource(saved, 'tiktok'));
    } else if (activeFilter === 'reminders-on') {
      base = activeData.filter((saved) => saved.notifications_enabled);
    }

    const scoped = filterSavedPlaces(base, { category: categoryFilter, hasVideo });
    if (!q) return scoped;
    return scoped.filter((s) => {
      const name = s.place?.name?.toLowerCase() ?? '';
      const addr = s.place?.formatted_address?.toLowerCase() ?? '';
      return name.includes(q) || addr.includes(q);
    });
  }, [activeData, activeFilter, categoryFilter, data, filter, hasVideo, nearbyPlaces]);

  const loadProfile = useCallback(async () => {
    setProfile(await getProfile());
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useFocusEffect(
    useCallback(() => {
      void revalidate();
      void loadProfile();
      if (activeFilter === 'nearby') {
        void refreshLocation();
      }
    }, [activeFilter, revalidate, refreshLocation, loadProfile]),
  );

  async function handleDelete(id: string) {
    // Optimistic remove from the shared cache (instant across all screens),
    // roll back on failure.
    const snapshot = getSavedPlacesCacheSnapshot();
    removeSavedPlaceFromCache(id);
    try {
      await deleteSavedPlace(id);
    } catch (e: any) {
      restoreSavedPlacesCache(snapshot);
      Alert.alert('Could not remove', e?.message ?? 'Unknown error.');
    }
  }

  async function handleRestore(id: string) {
    try {
      await unarchive(id);
      void trackEvent('archived_place_restored', { saved_place_id: id });
      await refresh();
    } catch (e: any) {
      Alert.alert('Could not restore', e?.message ?? 'Unknown error.');
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
          title={offline ? 'You\u2019re offline' : 'Couldn\u2019t load your places'}
          body={
            offline
              ? 'Reconnect to the internet and pull to refresh \u2014 your saved places will appear here.'
              : error
          }
          actionTitle="Try again"
          onAction={refresh}
        />
      </Screen>
    );
  }

  function setFilterAndResetLocation(next: PlacesFilter) {
    setActiveFilter(next);
    if (next === 'nearby') {
      void refreshLocation();
    }
    if (next === 'visited') {
      void trackEvent('visited_filter_viewed');
    } else if (next === 'archived') {
      void trackEvent('archived_filter_viewed');
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
          onSecondary={() => setFilterAndResetLocation('active')}
        />
      );
    }

    if (activeFilter === 'nearby' && locationState !== 'ready') {
      return (
        <EmptyState
          framed={false}
          title="Turn on location to see saved places near you"
          body="Nearr uses your location to show which saved places are nearby."
          actionTitle="Try again"
          onAction={() => {
            void refreshLocation();
          }}
          secondaryTitle="Clear filter"
          onSecondary={() => setFilterAndResetLocation('active')}
        />
      );
    }

    if (activeFilter !== 'active') {
      const title =
        activeFilter === 'instagram'
          ? 'No Instagram saves yet'
          : activeFilter === 'tiktok'
            ? 'No TikTok saves yet'
            : activeFilter === 'reminders-on'
              ? 'No reminders on yet'
              : activeFilter === 'recent'
                ? 'No recent saves yet'
                : activeFilter === 'visited'
                  ? 'No visited places yet'
                  : activeFilter === 'archived'
                    ? 'Nothing archived yet'
                    : 'No nearby saved places yet';
      const body =
        activeFilter === 'recent'
          ? 'You have not saved any new places recently.'
          : activeFilter === 'nearby'
            ? 'Nothing you saved looks close enough to go right now.'
            : activeFilter === 'reminders-on'
              ? 'Turn on a nearby reminder for a place and it will show up here.'
              : activeFilter === 'visited'
                ? 'Mark a place visited from the nearby reminder and it will show up here.'
                : activeFilter === 'archived'
                  ? 'Archived places live here. Restore one to start getting reminders again.'
                  : `No ${filterLabel(activeFilter)} yet.`;

      return (
        <EmptyState
          framed={false}
          title={title}
          body={body}
          actionTitle="Show active places"
          onAction={() => setFilterAndResetLocation('active')}
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
            <Text style={[typography.title, styles.title]}>Places</Text>
            <Text style={[typography.body, styles.sub]}>
              Find places you wanted to try.
            </Text>

            <OfflineBanner visible={offline} lastSyncedAt={lastSyncedAt} />

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
                  style={styles.filterScroll}
                >
                  <FilterChip
                    label="Recent"
                    active={activeFilter === 'recent'}
                    onPress={() => setFilterAndResetLocation('recent')}
                    colors={colors}
                    typography={typography}
                  />
                  <FilterChip
                    label="Nearby"
                    active={activeFilter === 'nearby'}
                    onPress={() => setFilterAndResetLocation('nearby')}
                    colors={colors}
                    typography={typography}
                  />
                  <Pressable
                    onPress={() => setFiltersOpen(true)}
                    style={styles.filterButton}
                    accessibilityRole="button"
                    accessibilityLabel="Filters"
                  >
                    <Feather name="sliders" size={16} color={colors.text} />
                    <Text style={[typography.label, styles.filterButtonText]}>Filters</Text>
                    {browseFilterCount({ category: categoryFilter, hasVideo }) > 0 ? (
                      <Text style={[typography.caption, styles.filterCount]}>
                        {browseFilterCount({ category: categoryFilter, hasVideo })}
                      </Text>
                    ) : null}
                  </Pressable>
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
            onRestore={
              activeFilter === 'archived' && item.archived_at
                ? () => handleRestore(item.id)
                : undefined
            }
          />
        )}
        ListEmptyComponent={renderEmptyState()}
      />
      <Modal
        visible={filtersOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setFiltersOpen(false)}
      >
        <View style={styles.filterModalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setFiltersOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close filters"
          />
          <View style={styles.filterModal}>
            <View style={styles.modalHeader}>
              <Text style={[typography.heading, styles.modalTitle]}>Filters</Text>
              <Pressable
                onPress={() => setFiltersOpen(false)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close filters"
              >
                <Feather name="x" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={[typography.label, styles.filterHeading]}>Category</Text>
            <View style={styles.categoryGrid}>
              {(
                Object.keys(CATEGORY_FILTER_GROUPS) as CategoryFilterGroup[]
              ).filter((group) => group !== 'all').map((group) => {
                const active = categoryFilter === group;
                const label = group === 'fitness_wellness'
                  ? 'Fitness & Wellness'
                  : group.charAt(0).toUpperCase() + group.slice(1);
                return (
                  <Pressable
                    key={group}
                    onPress={() => setCategoryFilter(active ? null : group)}
                    style={[styles.categoryOption, active && styles.categoryOptionActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[typography.caption, { color: active ? colors.textInverse : colors.text }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[typography.label, styles.filterHeading]}>Source</Text>
            <Pressable
              onPress={() => setHasVideo((current) => !current)}
              style={styles.videoFilterRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: hasVideo }}
            >
              <Feather name="video" size={18} color={colors.accent} />
              <Text style={[typography.body, styles.videoFilterText]}>Has video</Text>
              <View style={[styles.checkbox, hasVideo && styles.checkboxActive]}>
                {hasVideo ? <Feather name="check" size={14} color={colors.textInverse} /> : null}
              </View>
            </Pressable>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setCategoryFilter(null);
                  setHasVideo(false);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.clearFilterText}>Clear</Text>
              </Pressable>
              <Pressable
                onPress={() => setFiltersOpen(false)}
                style={styles.applyFilterButton}
                accessibilityRole="button"
              >
                <Text style={styles.applyFilterText}>Apply</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
    title: {
      ...typography.title,
      color: colors.text,
    },
    sub: {
      color: colors.textSecondary,
      marginTop: Spacing.xs,
    },
    searchWrap: {
      marginTop: Spacing.lg,
    },
    filterScroll: {
      marginHorizontal: -Spacing.lg,
    },
    filterRow: {
      gap: Spacing.sm,
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
      paddingHorizontal: Spacing.lg,
    },
    filterButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    filterButtonText: { color: colors.text },
    filterCount: { color: colors.primary, fontWeight: '700' },
    filterModalBackdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.modalBackdrop,
    },
    filterModal: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      padding: Spacing.lg,
      paddingBottom: Spacing.xl,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    modalTitle: { color: colors.text },
    filterHeading: { color: colors.textSecondary, marginTop: Spacing.lg, marginBottom: Spacing.sm },
    categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    categoryOption: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    categoryOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    videoFilterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    videoFilterText: { color: colors.text, flex: 1 },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: Spacing.lg,
    },
    clearFilterText: { color: colors.textSecondary, fontWeight: '700' },
    applyFilterButton: {
      minWidth: 110,
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
    },
    applyFilterText: { color: colors.textInverse, fontWeight: '700' },
    listContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
    emptyContent: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg },
    center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  });
}

function FilterChip({
  label,
  active,
  onPress,
  colors,
  typography,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
  typography: ReturnType<typeof useTheme>['typography'];
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        stylesChip.base,
        { borderColor: active ? colors.primary : colors.border },
        active
          ? { backgroundColor: colors.primary }
          : { backgroundColor: colors.surfaceElevated },
      ]}
    >
      <Text
        style={[
          typography.label,
          { color: active ? colors.textInverse : colors.text },
        ]}
      >
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
});
