import { i18n, t } from '@/lib/i18n';
import { useLocale } from '@/hooks/useLocale';
﻿import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlaceImage } from '@/components/PlaceImage';
import { usePlacesSearch } from '@/hooks/usePlacesSearch';
import { useTheme } from '@/lib/theme';
import { currentSavedPlaces, searchSavedPlaces, savedPlaceNotePreview } from '@/lib/savedPlacesBrowse';
import { placeSourceCards } from '@/lib/placeSources';
import { readSavedPlaceSnapshot } from '@/lib/savedPlaceSnapshot';
import { isUsableSavedPlaceImage } from '@/lib/savedPlaceImageStore';
import { offlineSavedPlacePhoto } from '@/lib/offlineSavedPlacePhoto';
import type { PlaceCandidate } from '@/services/placesService';
import type { SavedPlaceWithPlace } from '@/types';

type Props = { visible: boolean; topInset: number; locationBias?: { lat: number; lng: number }; onClose: () => void; onPickPlace: (place: PlaceCandidate) => void | Promise<unknown>; savedPlaces?: SavedPlaceWithPlace[]; offline?: boolean; onSelectSaved?: (place: SavedPlaceWithPlace) => void; onSaveFromLink?: () => void };
type SearchRow = { kind: 'saved'; place: SavedPlaceWithPlace } | { kind: 'new'; place: PlaceCandidate };

function SavedSearchPlaceImage({ saved }: { saved: SavedPlaceWithPlace }) {
  useLocale();
  const [localPhotoUrls, setLocalPhotoUrls] = useState<string[]>([]);
  const source = useMemo(() => placeSourceCards(saved)[0], [saved, i18n.language]);
  useEffect(() => {
    let cancelled = false;
    const bundledPhoto = offlineSavedPlacePhoto(saved.place.id);
    if (bundledPhoto) {
      setLocalPhotoUrls([bundledPhoto]);
      return;
    }
    setLocalPhotoUrls([]);
    void readSavedPlaceSnapshot({
      userId: saved.user_id,
      savedPlaceId: saved.id,
      googlePlaceId: saved.place.google_place_id?.trim() || null,
    }).then(async (result) => {
      if (cancelled || result.status !== 'hit') return;
      const candidates = [...new Set([
        ...(result.snapshot.localPhotoUris ?? []),
        result.snapshot.localImageUri,
      ].filter((uri): uri is string => !!uri))];
      const checked = await Promise.all(candidates.map(async (uri) => ({
        uri,
        usable: await isUsableSavedPlaceImage(uri),
      })));
      if (!cancelled) setLocalPhotoUrls(checked.filter((item) => item.usable).map((item) => item.uri));
    });
    return () => { cancelled = true; };
  }, [saved.id, saved.place.id, saved.place.google_place_id, saved.user_id]);
  return <PlaceImage
    googlePlaceId={saved.place.google_place_id}
    sourceUri={source?.thumbnailUrl}
    initialPhotoUrls={localPhotoUrls}
    size={72}
    borderRadius={12}
    preferPlacePhoto
    presentationMode="candidate"
    presentationActive={false}
    hydrationPolicy="saved_snapshot"
    presentationContext={{ trigger: 'manual_search' }}
    accessibilityLabel={`Photo of ${saved.place.name}`}
  />;
}

/** Local memory search and explicitly requested discovery share one calm, keyboard-safe surface. */
export function MapPlaceSearchDropdown({ visible, topInset, locationBias, onClose, onPickPlace, savedPlaces = [], offline = false, onSelectSaved, onSaveFromLink }: Props) {
  useLocale();
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'saved' | 'new'>('saved');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveErrorKey, setSaveErrorKey] = useState<string | null>(null);
  const savingRef = useRef(false);
  const { results, loading, error, lastQuery, search, reset } = usePlacesSearch();
  const inputRef = useRef<TextInput>(null);
  const trimmedQuery = query.trim();
  const runSearch = useCallback(() => {
    if (!visible || offline || scope !== 'new' || trimmedQuery.length < 3) return;
    void search(trimmedQuery, locationBias, { mode: 'manual', userLocation: locationBias ?? null, regionConfidence: 'none', sourceEvidence: [] });
  }, [visible, offline, scope, trimmedQuery, search, locationBias]);

  useEffect(() => { if (visible) { setQuery(''); setSaveErrorKey(null); setScope(savedPlaces.length || offline ? 'saved' : 'new'); reset(); const id = setTimeout(() => inputRef.current?.focus(), 120); return () => clearTimeout(id); } reset(); }, [visible, reset]);
  useEffect(() => {
    if (!visible || offline || scope !== 'new') return;
    if (trimmedQuery.length < 3 || trimmedQuery === lastQuery) return;
    const id = setTimeout(runSearch, 300);
    return () => clearTimeout(id);
  }, [trimmedQuery, visible, scope, offline, lastQuery, runSearch]);

  function changeQuery(next: string) {
    setQuery(next);
    setSaveErrorKey(null);
    // Invalidate an in-flight response immediately, including during debounce.
    // A result for the previous query must never be selectable as the new one.
    if (next.trim() !== trimmedQuery) reset();
  }
  const close = () => { Keyboard.dismiss(); onClose(); };
  const savedResults = useMemo(() => searchSavedPlaces(currentSavedPlaces(savedPlaces), query), [savedPlaces, query, i18n.language]);
  const rows: SearchRow[] = scope === 'saved' ? savedResults.map(place => ({ kind: 'saved', place })) : trimmedQuery.length >= 3 && !offline && lastQuery === trimmedQuery ? results.map(place => ({ kind: 'new', place })) : [];
  const currentError = scope === 'new' && !offline && lastQuery === trimmedQuery && !!error;
  const waitingForSearch = scope === 'new' && !offline && trimmedQuery.length >= 3 && (loading || lastQuery !== trimmedQuery);
  async function pickCandidate(candidate: PlaceCandidate, key: string) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingKey(key);
    setSaveErrorKey(null);
    Keyboard.dismiss();
    try {
      const saved = await onPickPlace(candidate);
      if (saved === null || saved === false) setSaveErrorKey(key);
    }
    catch { setSaveErrorKey(key); }
    finally { savingRef.current = false; setSavingKey(null); }
  }
  if (!visible) return null;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.overlay, { backgroundColor: colors.bg, paddingTop: topInset }]} accessibilityViewIsModal>
    <View style={styles.header}>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t("Close search")} style={({ pressed }) => [styles.icon, { backgroundColor: pressed ? colors.surfaceElevated : colors.surface }]}><Feather name="arrow-left" size={22} color={colors.text} /></Pressable>
      <Text style={[typography.heading, styles.headerTitle]}>{t("Find a place")}</Text>
      {onSaveFromLink ? <Pressable onPress={() => { Keyboard.dismiss(); onSaveFromLink(); }} accessibilityRole="button" accessibilityLabel={t("Paste a social post link")} style={({ pressed }) => [styles.icon, { backgroundColor: pressed ? colors.surfaceElevated : colors.surface }]}><Feather name="link" size={21} color={colors.text} /></Pressable> : <View style={styles.icon} />}
    </View>
    <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Feather name="search" size={22} color={colors.textSecondary} />
      <TextInput ref={inputRef} value={query} onChangeText={changeQuery} onSubmitEditing={() => { if (!loading && (currentError || lastQuery !== trimmedQuery)) runSearch(); }} placeholder={scope === 'saved' ? t("Name, city or your note") : t("Place, city or address")} placeholderTextColor={colors.textMuted} style={[typography.body, styles.input]} accessibilityLabel={t("Search places")} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
      {query ? <Pressable onPress={() => changeQuery('')} accessibilityRole="button" accessibilityLabel={t("Clear search")} style={({ pressed }) => [styles.icon, pressed && { backgroundColor: colors.surfaceElevated }]}><Feather name="x" size={21} color={colors.textSecondary} /></Pressable> : null}
    </View>
    <View style={styles.scopes}>{([{ id: 'saved', label: t("Your places") }, { id: 'new', label: t("Find somewhere new") }] as const).map(item => <Pressable key={item.id} onPress={() => setScope(item.id)} accessibilityRole="tab" accessibilityState={{ selected: scope === item.id }} style={({ pressed }) => [styles.scope, { backgroundColor: scope === item.id ? colors.primary : pressed ? colors.surfaceElevated : colors.surface, borderColor: colors.border }]}><Text style={[typography.label, { color: scope === item.id ? colors.textInverse : colors.text, textAlign: 'center' }]}>{item.label}</Text></Pressable>)}</View>
    <View style={styles.section}><Text style={[typography.heading, styles.flex]} accessibilityRole="header">{scope === 'saved' ? t("Your places") : t("Find somewhere new")}</Text>{waitingForSearch ? <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={t("Finding places")} /> : <Text style={typography.metadata}>{rows.length ? `${rows.length} ${rows.length === 1 ? 'match' : 'matches'}` : ''}</Text>}</View>
    <FlatList<SearchRow> data={rows} keyExtractor={item => item.kind === 'saved' ? item.place.id : item.place.googlePlaceId ?? `${item.place.name}-${item.place.formattedAddress}`} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }}
      ListEmptyComponent={<View style={styles.empty}>
        <Text style={[typography.body, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">{scope === 'saved' ? savedPlaces.length ? t("No memories found. Try a name, city or your note.") : t("Your saved places will be here. Find somewhere new to begin.") : offline ? t("You’re offline. Your saved places are still available.") : trimmedQuery.length < 3 ? t("Search for a restaurant, beach, shop or somewhere you want to go.") : waitingForSearch ? t("Finding places…") : currentError ? t("Couldn’t search places. Check your connection and try again.") : t("No places found. Try adding a city.")}</Text>
        {currentError ? <Pressable onPress={runSearch} accessibilityRole="button" accessibilityLabel={t("Retry place search")} style={({ pressed }) => [styles.retry, { backgroundColor: pressed ? colors.surfaceElevated : colors.surface, borderColor: colors.controlBorder }]}><Feather name="refresh-cw" size={18} color={colors.primary} /><Text style={[typography.label, { color: colors.primary }]}>{t("Try again")}</Text></Pressable> : null}
      </View>}
      renderItem={({ item, index }) => {
        const saved = item.kind === 'saved' ? item.place : null;
        const candidate = item.kind === 'new' ? item.place : null;
        const name = saved?.place.name ?? candidate!.name;
        const address = saved?.place.formatted_address ?? candidate?.formattedAddress;
        const note = saved ? savedPlaceNotePreview(saved) : null;
        const key = saved?.id ?? candidate?.googlePlaceId ?? `${name}-${address}`;
        return <Pressable onPress={() => { if (saved) { Keyboard.dismiss(); onSelectSaved?.(saved); } else { void pickCandidate(candidate!, key); } }} disabled={savingKey !== null} accessibilityRole="button" accessibilityState={{ disabled: savingKey !== null, busy: savingKey === key }} accessibilityLabel={saved ? `Show saved place ${name} on map` : savingKey === key ? `Saving ${name}` : `Save ${name}`} style={({ pressed }) => [styles.row, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceElevated : 'transparent' }]}>
          {saved ? <SavedSearchPlaceImage saved={saved} /> : <PlaceImage googlePlaceId={candidate?.googlePlaceId} initialPhotoUrls={candidate?.photoUrls?.length ? candidate.photoUrls : candidate?.photoUrl ? [candidate.photoUrl] : undefined} size={72} borderRadius={12} preferPlacePhoto presentationMode="candidate" presentationActive={index === 0} hydrationPolicy={index === 0 ? 'active_manual_search' : index < 4 ? 'compact_known_only' : 'offscreen_manual_search'} presentationContext={{ trigger: 'manual_search', candidateIndex: index, candidateCount: rows.length }} accessibilityLabel={`Photo of ${name}`} />}
          <View style={styles.flex}>{saved ? <Text style={[typography.eyebrow, { marginBottom: 4 }]}>{t("SAVED")}</Text> : null}<Text style={typography.bodyStrong} numberOfLines={fontScale >= 1.5 ? undefined : 3}>{name}</Text>{address ? <Text style={[typography.metadata, { marginTop: 4 }]} numberOfLines={fontScale >= 1.5 ? undefined : 2}>{address}</Text> : null}{note ? <Text style={[typography.metadata, { marginTop: 8 }]} numberOfLines={fontScale >= 1.5 ? undefined : 2}>{note.text}</Text> : null}</View>
          {savingKey === key ? <View style={styles.savingFeedback} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.primary} accessibilityLabel={t("Saving place")} /><Text style={[typography.label, { color: colors.primary }]}>{t("Saving…")}</Text></View> : saveErrorKey === key ? <View style={styles.savingFeedback}><Feather name="refresh-cw" size={18} color={colors.danger} /><Text style={[typography.caption, { color: colors.danger }]}>{t("Try again")}</Text></View> : <Feather name={saved ? 'chevron-right' : 'plus'} size={23} color={colors.text} />}
        </Pressable>;
      }} />
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({ overlay: { ...StyleSheet.absoluteFillObject, zIndex: 30 }, header: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginBottom: 24, gap: 8 }, headerTitle: { flex: 1, textAlign: 'center' }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 999 }, inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, borderWidth: 1, borderRadius: 12, paddingLeft: 16, paddingRight: 4, minHeight: 54 }, input: { flex: 1, paddingVertical: 12, minWidth: 0 }, scopes: { flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 16 }, scope: { flex: 1, minHeight: 48, paddingHorizontal: 8, paddingVertical: 12, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' }, section: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 24, marginTop: 24, marginBottom: 8 }, flex: { flex: 1, minWidth: 0 }, row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth }, savingFeedback: { minWidth: 74, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4 }, empty: { paddingTop: 16, gap: 16 }, retry: { flexDirection: 'row', gap: 8, alignItems: 'center', alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth } });
