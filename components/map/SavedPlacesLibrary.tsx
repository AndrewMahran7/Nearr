import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Input, SavedPlaceBrowseCard } from '@/components';
import { Radius, Spacing } from '@/constants';
import type { NearbyLocationState, NearbyPlace } from '@/hooks/useNearbyPlaces';
import { CATEGORY_LABELS, type NearrCategory } from '@/lib/placeCategory';
import {
  SAVED_CATEGORY_FILTER_SECTIONS,
  browseFilterCount,
  buildSavedPlacesBrowseResults,
  currentSavedPlaces,
  type SavedBrowseFilters,
  type SavedBrowsePlace,
  type SavedBrowseSort,
} from '@/lib/savedPlacesBrowse';
import { useTheme } from '@/lib/theme';
import type { SavedPlaceWithPlace } from '@/types';

const EMPTY_FILTERS: SavedBrowseFilters = { categories: [], hasOriginalPost: false };

type Props = {
  savedPlaces: SavedPlaceWithPlace[];
  nearbyPlaces: NearbyPlace[];
  locationState: NearbyLocationState;
  loading: boolean;
  requestLocationPermission: () => Promise<boolean>;
  onSelectPlace: (place: SavedPlaceWithPlace) => void;
  onSaveFromLink: () => void;
  onSearchManually: () => void;
};

export function SavedPlacesLibrary({
  savedPlaces,
  nearbyPlaces,
  locationState,
  loading,
  requestLocationPermission,
  onSelectPlace,
  onSaveFromLink,
  onSearchManually,
}: Props) {
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SavedBrowseSort>('recent');
  const [filters, setFilters] = useState<SavedBrowseFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<SavedBrowseFilters>(EMPTY_FILTERS);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [locationNotice, setLocationNotice] = useState(false);

  const currentPlaces = useMemo(() => currentSavedPlaces(savedPlaces), [savedPlaces]);
  const results = useMemo(
    () => buildSavedPlacesBrowseResults({
      places: savedPlaces,
      nearbyPlaces,
      nearbyReady: locationState === 'ready',
      query,
      filters,
      sort,
    }),
    [filters, locationState, nearbyPlaces, query, savedPlaces, sort],
  );
  const filterCount = browseFilterCount(filters);

  useEffect(() => {
    if (
      sort === 'nearby' &&
      (locationState === 'permission_denied' || locationState === 'unavailable' || locationState === 'error')
    ) {
      setSort('recent');
      setLocationNotice(true);
    }
  }, [locationState, sort]);

  const chooseNearby = useCallback(async () => {
    setSortOpen(false);
    const ready = await requestLocationPermission();
    if (ready) {
      setSort('nearby');
      setLocationNotice(false);
      return;
    }
    setSort('recent');
    setLocationNotice(true);
  }, [requestLocationPermission]);

  const openFilters = useCallback(() => {
    setDraftFilters({
      categories: [...filters.categories],
      hasOriginalPost: filters.hasOriginalPost,
    });
    setFiltersOpen(true);
  }, [filters]);

  const toggleDraftCategory = useCallback((category: NearrCategory) => {
    setDraftFilters((current) => ({
      ...current,
      categories: current.categories.includes(category)
        ? current.categories.filter((value) => value !== category)
        : [...current.categories, category],
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
  }, []);

  const renderCard = useCallback(
    ({ item }: { item: SavedBrowsePlace }) => (
      <SavedPlaceBrowseCard saved={item} onPress={onSelectPlace} />
    ),
    [onSelectPlace],
  );

  const listHeader = (
    <View style={styles.header}>
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
            pressed && styles.pressed,
          ]}
        >
          <Feather name="bar-chart-2" size={17} color={sort === 'nearby' ? colors.accent : colors.textSecondary} />
          <Text style={[typography.label, styles.controlLabel]}>
            {sort === 'nearby' ? 'Nearby' : 'Sort'}
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
            pressed && styles.pressed,
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
            <Text style={[typography.caption, styles.locationNoticeBody]}>Recently saved remains selected.</Text>
          </View>
          <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.settingsText}>Settings</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  function emptyState() {
    if (loading && currentPlaces.length === 0) {
      return (
        <View style={styles.empty} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.primary} />
          <Text style={[typography.body, styles.emptyBody]}>Loading saved places…</Text>
        </View>
      );
    }
    if (currentPlaces.length === 0) {
      return (
        <View style={styles.empty}>
          <Feather name="bookmark" size={30} color={colors.accent} />
          <Text style={[typography.heading, styles.emptyTitle]}>No saved places yet</Text>
          <Text style={[typography.body, styles.emptyBody]}>Share a place to Nearr or add one from search.</Text>
          <Button title="Save from link" onPress={onSaveFromLink} style={styles.emptyAction} />
          <Button title="Search manually" variant="secondary" onPress={onSearchManually} style={styles.emptySecondary} />
        </View>
      );
    }
    if (query.trim()) {
      return (
        <View style={styles.empty}>
          <Text style={typography.heading}>No matches</Text>
          <Text style={[typography.body, styles.emptyBody]}>Try another search.</Text>
          <Button title="Clear search" variant="secondary" onPress={() => setQuery('')} style={styles.emptyAction} />
        </View>
      );
    }
    if (filterCount > 0) {
      return (
        <View style={styles.empty}>
          <Text style={typography.heading}>Nothing matches these filters</Text>
          <Text style={[typography.body, styles.emptyBody]}>Clear filters to see all your saved places.</Text>
          <Button title="Clear filters" variant="secondary" onPress={clearFilters} style={styles.emptyAction} />
        </View>
      );
    }
    return null;
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={results}
        keyExtractor={(saved) => saved.id}
        renderItem={renderCard}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyState()}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={7}
        maxToRenderPerBatch={7}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      />

      <Modal visible={sortOpen} transparent animationType="slide" onRequestClose={() => setSortOpen(false)}>
        <SheetBackdrop label="Close sort" onClose={() => setSortOpen(false)} styles={styles}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={[typography.heading, styles.modalTitle]}>Sort saved places</Text>
            <Pressable onPress={() => setSortOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close sort">
              <Feather name="x" size={23} color={colors.textSecondary} />
            </Pressable>
          </View>
          <SortOption
            label="Recently saved"
            detail="Newest saves first"
            selected={sort === 'recent'}
            onPress={() => { setSort('recent'); setLocationNotice(false); setSortOpen(false); }}
            styles={styles}
          />
          <SortOption
            label="Nearby"
            detail="Nearest places first"
            selected={sort === 'nearby'}
            onPress={() => void chooseNearby()}
            styles={styles}
          />
          <View style={{ height: insets.bottom }} />
        </SheetBackdrop>
      </Modal>

      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
        <SheetBackdrop label="Close filters" onClose={() => setFiltersOpen(false)} styles={styles} tall>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={[typography.heading, styles.modalTitle]}>Filter saved places</Text>
            <Pressable onPress={() => setFiltersOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close filters">
              <Feather name="x" size={23} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={styles.filterScroll} contentContainerStyle={styles.filterContent} showsVerticalScrollIndicator={false}>
            {SAVED_CATEGORY_FILTER_SECTIONS.map((section) => (
              <View key={section.id} style={styles.filterSection}>
                <Text style={[typography.label, styles.sectionLabel]}>{section.label}</Text>
                <View style={styles.categoryGrid}>
                  {section.categories.map((category) => {
                    const selected = draftFilters.categories.includes(category);
                    return (
                      <Pressable
                        key={category}
                        onPress={() => toggleDraftCategory(category)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        accessibilityLabel={CATEGORY_LABELS[category]}
                        style={[styles.categoryOption, selected && styles.categoryOptionSelected]}
                      >
                        <Text style={[typography.caption, styles.categoryOptionText, selected && styles.categoryOptionTextSelected]}>
                          {CATEGORY_LABELS[category]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            <Text style={[typography.label, styles.sectionLabel]}>Source</Text>
            <Pressable
              onPress={() => setDraftFilters((current) => ({ ...current, hasOriginalPost: !current.hasOriginalPost }))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draftFilters.hasOriginalPost }}
              style={styles.sourceOption}
            >
              <View style={styles.sourceIcon}><Feather name="play" size={16} color={colors.accent} /></View>
              <View style={styles.sourceCopy}>
                <Text style={[typography.bodyStrong, styles.sourceTitle]}>Has original post</Text>
                <Text style={[typography.caption, styles.sourceBody]}>Instagram, TikTok, YouTube, or another supported post</Text>
              </View>
              <View style={[styles.checkbox, draftFilters.hasOriginalPost && styles.checkboxSelected]}>
                {draftFilters.hasOriginalPost ? <Feather name="check" size={15} color={colors.textInverse} /> : null}
              </View>
            </Pressable>
          </ScrollView>
          <View style={[styles.modalActions, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
            <Pressable onPress={() => setDraftFilters(EMPTY_FILTERS)} accessibilityRole="button" style={styles.clearButton}>
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
    </View>
  );
}

function SortOption({ label, detail, selected, onPress, styles }: {
  label: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const { typography } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} style={styles.sortOption}>
      <View style={styles.sortCopy}>
        <Text style={[typography.bodyStrong, styles.sortTitle]}>{label}</Text>
        <Text style={[typography.caption, styles.sortDetail]}>{detail}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
    </Pressable>
  );
}

function SheetBackdrop({ label, onClose, styles, tall, children }: {
  label: string;
  onClose: () => void;
  styles: ReturnType<typeof createStyles>;
  tall?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.modalBackdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={label} />
      <View style={[styles.modalSheet, tall && styles.modalSheetTall]}>{children}</View>
    </View>
  );
}

export const MemoizedSavedPlacesLibrary = memo(SavedPlacesLibrary);

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1 },
    listContent: { paddingHorizontal: Spacing.lg },
    header: { paddingBottom: Spacing.sm },
    searchWrap: { position: 'relative', marginTop: Spacing.xs, marginBottom: Spacing.sm },
    searchIcon: { position: 'absolute', left: Spacing.md, top: 17, zIndex: 1 },
    searchInput: { paddingLeft: 44, backgroundColor: colors.surfaceElevated },
    controlsRow: { flexDirection: 'row', gap: Spacing.sm },
    controlButton: {
      minHeight: 46,
      flex: 1,
      paddingHorizontal: Spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    controlButtonActive: { borderColor: colors.accent, backgroundColor: 'rgba(255,106,26,0.10)' },
    controlLabel: { color: colors.text },
    pressed: { opacity: 0.72 },
    locationNotice: {
      marginTop: Spacing.sm,
      padding: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceElevated,
    },
    locationNoticeCopy: { flex: 1 },
    locationNoticeTitle: { color: colors.text },
    locationNoticeBody: { color: colors.textMuted, marginTop: 2 },
    settingsText: { color: colors.accent, fontWeight: '700' },
    empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: Spacing.lg },
    emptyTitle: { marginTop: Spacing.md },
    emptyBody: { color: colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 22 },
    emptyAction: { width: '100%', marginTop: Spacing.lg },
    emptySecondary: { width: '100%', marginTop: Spacing.sm },
    modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.modalBackdrop },
    modalSheet: {
      maxHeight: '64%',
      paddingHorizontal: Spacing.lg,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    modalSheetTall: { height: '82%', maxHeight: '82%' },
    modalHandle: { width: 42, height: 5, borderRadius: Radius.pill, alignSelf: 'center', marginTop: Spacing.sm, backgroundColor: colors.border },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.lg },
    modalTitle: { color: colors.text },
    sortOption: { minHeight: 72, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    sortCopy: { flex: 1 },
    sortTitle: { color: colors.text },
    sortDetail: { color: colors.textMuted, marginTop: 3 },
    radio: { width: 23, height: 23, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    radioSelected: { borderColor: colors.accent },
    radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.accent },
    filterScroll: { flex: 1 },
    filterContent: { paddingBottom: Spacing.lg },
    filterSection: { marginBottom: Spacing.md },
    sectionLabel: { color: colors.textSecondary, marginBottom: Spacing.sm },
    categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    categoryOption: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderRadius: Radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceElevated },
    categoryOptionSelected: { borderColor: colors.accent, backgroundColor: colors.primary },
    categoryOptionText: { color: colors.textSecondary, fontWeight: '600' },
    categoryOptionTextSelected: { color: colors.textInverse },
    sourceOption: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
    sourceIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,106,26,0.12)' },
    sourceCopy: { flex: 1 },
    sourceTitle: { color: colors.text },
    sourceBody: { color: colors.textMuted, marginTop: 3 },
    checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    checkboxSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
    modalActions: { flexDirection: 'row', gap: Spacing.sm, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    clearButton: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: colors.border },
    clearText: { color: colors.text, fontWeight: '700', fontSize: 16 },
    applyButton: { minHeight: 48, flex: 2, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: colors.primary },
    applyText: { color: colors.textInverse, fontWeight: '800', fontSize: 16 },
  });
}
