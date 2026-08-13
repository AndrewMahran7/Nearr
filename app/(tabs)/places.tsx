import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
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

import { EmptyState, Input, OfflineBanner, SavedPlaceBrowseCard, Screen } from '@/components';
import { Radius, Spacing } from '@/constants';
import { useNearbyPlaces } from '@/hooks/useNearbyPlaces';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import {
  SAVED_CATEGORY_FILTERS,
  browseFilterCount,
  buildSavedPlacesBrowseResults,
  currentSavedPlaces,
  type SavedBrowseFilters,
  type SavedBrowseSort,
  type SavedCategoryFilter,
} from '@/lib/savedPlacesBrowse';
import { useTheme } from '@/lib/theme';

const EMPTY_FILTERS: SavedBrowseFilters = { categories: [], hasVideo: false };

export default function PlacesTab() {
  const router = useRouter();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { data, loading, refreshing, error, offline, lastSyncedAt, refresh, revalidate } = useSavedPlaces();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SavedBrowseSort>('recent');
  const [filters, setFilters] = useState<SavedBrowseFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<SavedBrowseFilters>(EMPTY_FILTERS);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [locationNotice, setLocationNotice] = useState(false);

  const currentPlaces = useMemo(() => currentSavedPlaces(data), [data]);
  const {
    nearbyPlaces,
    locationState,
    refreshLocation,
    requestLocationPermission,
  } = useNearbyPlaces(currentPlaces, {
    enabled: sort === 'nearby',
    requestPermission: false,
  });

  const results = useMemo(
    () => buildSavedPlacesBrowseResults({
      places: data,
      nearbyPlaces,
      nearbyReady: locationState === 'ready',
      query,
      filters,
      sort,
    }),
    [data, filters, locationState, nearbyPlaces, query, sort],
  );
  const filterCount = browseFilterCount(filters);
  const openPlace = useCallback((savedPlaceId: string) => {
    router.push(`/place/${savedPlaceId}`);
  }, [router]);

  useEffect(() => {
    if (
      sort === 'nearby' &&
      (locationState === 'permission_denied' || locationState === 'unavailable' || locationState === 'error')
    ) {
      setSort('recent');
      setLocationNotice(true);
    }
  }, [locationState, sort]);

  useFocusEffect(
    useCallback(() => {
      void revalidate();
      if (sort === 'nearby') void refreshLocation();
    }, [refreshLocation, revalidate, sort]),
  );

  async function chooseNearby() {
    setSortOpen(false);
    const ready = await requestLocationPermission();
    if (ready) {
      setSort('nearby');
      setLocationNotice(false);
    } else {
      setSort('recent');
      setLocationNotice(true);
    }
  }

  function openFilters() {
    setDraftFilters({ categories: [...filters.categories], hasVideo: filters.hasVideo });
    setFiltersOpen(true);
  }

  function toggleDraftCategory(id: SavedCategoryFilter) {
    setDraftFilters((current) => ({
      ...current,
      categories: current.categories.includes(id)
        ? current.categories.filter((value) => value !== id)
        : [...current.categories, id],
    }));
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
  }

  function renderEmptyState() {
    if (loading && data.length === 0) {
      return (
        <View style={styles.loadingState} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.primary} />
          <Text style={[typography.body, styles.emptyBody]}>Loading saved places…</Text>
        </View>
      );
    }
    if (error && data.length === 0) {
      return (
        <EmptyState
          framed={false}
          variant="error"
          title={offline ? 'You’re offline' : 'Couldn’t load your places'}
          body={offline ? 'Reconnect and try again. Your saved places will appear here.' : error}
          actionTitle="Try again"
          onAction={refresh}
        />
      );
    }
    if (currentPlaces.length === 0) {
      return (
        <EmptyState
          framed={false}
          title="No saved places yet"
          body="Share places to Nearr and they’ll show up here."
          actionTitle="Add a place"
          onAction={() => router.push('/add-place')}
        />
      );
    }
    if (query.trim()) {
      return (
        <EmptyState
          framed={false}
          title="No matches"
          body="Try another search."
          actionTitle="Clear search"
          onAction={() => setQuery('')}
        />
      );
    }
    if (filterCount > 0) {
      return (
        <EmptyState
          framed={false}
          title="Nothing matches these filters"
          body="Clear filters to see all your saved places."
          actionTitle="Clear filters"
          onAction={clearFilters}
        />
      );
    }
    return null;
  }

  const listHeader = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={styles.titleCopy}>
          <Text accessibilityRole="header" style={[typography.title, styles.title]}>Saved Places</Text>
          {currentPlaces.length > 0 ? (
            <Text style={[typography.caption, styles.savedCount]}>
              {currentPlaces.length} {currentPlaces.length === 1 ? 'place' : 'places'}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => router.push('/add-place')}
          accessibilityRole="button"
          accessibilityLabel="Add a place"
          hitSlop={8}
          style={({ pressed }) => [styles.addButton, pressed && styles.controlPressed]}
        >
          <Feather name="plus" size={22} color={colors.textInverse} />
        </Pressable>
      </View>

      <OfflineBanner visible={offline} lastSyncedAt={lastSyncedAt} />

      <View style={styles.searchWrap}>
        <Feather name="search" size={19} color={colors.textMuted} style={styles.searchIcon} />
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search saved places"
          accessibilityLabel="Search saved places"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={styles.searchInput}
        />
      </View>

      <View style={styles.controlsRow}>
        <Pressable
          onPress={() => setSortOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Sort saved places. Current sort: ${sort === 'nearby' ? 'Nearby' : 'Recently saved'}`}
          style={({ pressed }) => [
            styles.controlButton,
            sort === 'nearby' && styles.controlButtonActive,
            pressed && styles.controlPressed,
          ]}
        >
          <Feather name="arrow-up" size={17} color={sort === 'nearby' ? colors.accent : colors.textSecondary} />
          <Text style={[typography.label, styles.controlLabel]}>
            {sort === 'nearby' ? 'Sort: Nearby' : 'Sort'}
          </Text>
          <Feather name="chevron-down" size={16} color={colors.textMuted} />
        </Pressable>
        <Pressable
          onPress={openFilters}
          accessibilityRole="button"
          accessibilityLabel={`Filter saved places${filterCount ? `, ${filterCount} active` : ''}`}
          style={({ pressed }) => [
            styles.controlButton,
            filterCount > 0 && styles.controlButtonActive,
            pressed && styles.controlPressed,
          ]}
        >
          <Feather name="sliders" size={17} color={filterCount > 0 ? colors.accent : colors.textSecondary} />
          <Text style={[typography.label, styles.controlLabel]}>
            {filterCount > 0 ? `Filter (${filterCount})` : 'Filter'}
          </Text>
        </Pressable>
      </View>

      {locationNotice ? (
        <View style={styles.locationNotice} accessibilityLiveRegion="polite">
          <Feather name="map-pin" size={18} color={colors.accent} />
          <View style={styles.locationNoticeCopy}>
            <Text style={[typography.label, styles.locationNoticeTitle]}>Location is needed for Nearby</Text>
            <Text style={[typography.caption, styles.locationNoticeBody]}>Recently saved remains selected until location is available.</Text>
          </View>
          <Pressable
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            style={styles.settingsButton}
          >
            <Text style={styles.settingsText}>Settings</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen padded={false}>
      <FlatList
        data={results}
        keyExtractor={(saved) => saved.id}
        renderItem={({ item }) => (
          <SavedPlaceBrowseCard saved={item} onPress={openPlace} />
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={renderEmptyState()}
        contentContainerStyle={results.length === 0 ? styles.emptyContent : styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={7}
      />

      <Modal visible={sortOpen} transparent animationType="slide" onRequestClose={() => setSortOpen(false)}>
        <SheetBackdrop label="Close sort" onClose={() => setSortOpen(false)} styles={styles}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={[typography.heading, styles.sheetTitle]}>Sort saved places</Text>
            <Pressable onPress={() => setSortOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close sort">
              <Feather name="x" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <SortOption
            label="Recently saved"
            detail="Newest saves first"
            selected={sort === 'recent'}
            onPress={() => { setSort('recent'); setLocationNotice(false); setSortOpen(false); }}
          />
          <SortOption
            label="Nearby"
            detail="Nearest places first"
            selected={sort === 'nearby'}
            onPress={() => void chooseNearby()}
          />
        </SheetBackdrop>
      </Modal>

      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
        <SheetBackdrop label="Close filters" onClose={() => setFiltersOpen(false)} styles={styles}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={[typography.heading, styles.sheetTitle]}>Filter saved places</Text>
            <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close filters">
              <Feather name="x" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={styles.filterScroll} showsVerticalScrollIndicator={false}>
            <Text style={[typography.label, styles.sectionLabel]}>Category</Text>
            <View style={styles.categoryGrid}>
              {SAVED_CATEGORY_FILTERS.map((item) => {
                const selected = draftFilters.categories.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => toggleDraftCategory(item.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    style={[styles.categoryOption, selected && styles.categoryOptionSelected]}
                  >
                    <Text style={[typography.caption, styles.categoryOptionText, selected && styles.categoryOptionTextSelected]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[typography.label, styles.sectionLabel]}>Source</Text>
            <Pressable
              onPress={() => setDraftFilters((current) => ({ ...current, hasVideo: !current.hasVideo }))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draftFilters.hasVideo }}
              style={styles.videoOption}
            >
              <View style={styles.videoOptionIcon}><Feather name="play" size={16} color={colors.accent} /></View>
              <View style={styles.videoOptionCopy}>
                <Text style={[typography.bodyStrong, styles.videoOptionTitle]}>Has original video</Text>
                <Text style={[typography.caption, styles.videoOptionBody]}>Instagram, TikTok, YouTube, or another supported social post</Text>
              </View>
              <View style={[styles.checkbox, draftFilters.hasVideo && styles.checkboxSelected]}>
                {draftFilters.hasVideo ? <Feather name="check" size={15} color={colors.textInverse} /> : null}
              </View>
            </Pressable>
          </ScrollView>
          <View style={styles.sheetActions}>
            <Pressable
              onPress={() => setDraftFilters(EMPTY_FILTERS)}
              accessibilityRole="button"
              style={styles.clearButton}
            >
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
            <Pressable
              onPress={() => { setFilters(draftFilters); setFiltersOpen(false); }}
              accessibilityRole="button"
              style={styles.applyButton}
            >
              <Text style={styles.applyText}>Apply</Text>
            </Pressable>
          </View>
        </SheetBackdrop>
      </Modal>
    </Screen>
  );

  function SortOption({ label, detail, selected, onPress }: {
    label: string;
    detail: string;
    selected: boolean;
    onPress: () => void;
  }) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        style={styles.sortOption}
      >
        <View style={styles.sortOptionCopy}>
          <Text style={[typography.bodyStrong, styles.sortOptionTitle]}>{label}</Text>
          <Text style={[typography.caption, styles.sortOptionDetail]}>{detail}</Text>
        </View>
        <View style={[styles.radio, selected && styles.radioSelected]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
      </Pressable>
    );
  }
}

function SheetBackdrop({ label, onClose, styles, children }: {
  label: string;
  onClose: () => void;
  styles: ReturnType<typeof createStyles>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.modalBackdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={label} />
      <View style={styles.sheet}>{children}</View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    header: { paddingTop: Spacing.lg, paddingBottom: Spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg },
    titleCopy: { flex: 1 },
    title: { color: colors.text, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
    savedCount: { color: colors.textMuted, marginTop: 2 },
    addButton: {
      width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    searchWrap: { marginHorizontal: Spacing.lg, marginTop: Spacing.lg, justifyContent: 'center' },
    searchIcon: { position: 'absolute', left: Spacing.md, zIndex: 1 },
    searchInput: { minHeight: 52, paddingLeft: 42, backgroundColor: colors.surface, borderColor: colors.border },
    controlsRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, marginTop: Spacing.md },
    controlButton: {
      minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
      paddingHorizontal: Spacing.md, borderRadius: Radius.md, borderWidth: 1,
      borderColor: colors.border, backgroundColor: colors.surface,
    },
    controlButtonActive: { borderColor: 'rgba(255,106,26,0.65)', backgroundColor: 'rgba(255,106,26,0.08)' },
    controlPressed: { opacity: 0.72 },
    controlLabel: { color: colors.text },
    locationNotice: {
      minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      marginHorizontal: Spacing.lg, marginTop: Spacing.md, padding: Spacing.md,
      borderRadius: Radius.md, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    locationNoticeCopy: { flex: 1 },
    locationNoticeTitle: { color: colors.text },
    locationNoticeBody: { color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
    settingsButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.xs },
    settingsText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
    listContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
    emptyContent: { flexGrow: 1, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
    loadingState: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
    emptyBody: { color: colors.textSecondary },
    modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.modalBackdrop },
    sheet: {
      maxHeight: '88%', paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xl,
      borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
      backgroundColor: colors.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    },
    sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: Spacing.md },
    sheetHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sheetTitle: { color: colors.text },
    sortOption: {
      minHeight: 68, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    sortOptionCopy: { flex: 1 },
    sortOptionTitle: { color: colors.text },
    sortOptionDetail: { color: colors.textSecondary, marginTop: 2 },
    radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    radioSelected: { borderColor: colors.primary },
    radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
    sectionLabel: { color: colors.textSecondary, marginTop: Spacing.lg, marginBottom: Spacing.sm },
    filterScroll: { flexShrink: 1 },
    categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    categoryOption: {
      minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: Radius.pill,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    categoryOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
    categoryOptionText: { color: colors.text },
    categoryOptionTextSelected: { color: colors.textInverse, fontWeight: '700' },
    videoOption: {
      minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      paddingVertical: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    videoOptionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,106,26,0.12)' },
    videoOptionCopy: { flex: 1 },
    videoOptionTitle: { color: colors.text },
    videoOptionBody: { color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
    checkbox: { width: 26, height: 26, borderRadius: 7, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    checkboxSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
    sheetActions: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.lg },
    clearButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.sm },
    clearText: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
    applyButton: { minWidth: 136, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: colors.primary },
    applyText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },
  });
}
