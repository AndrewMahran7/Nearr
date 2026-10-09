import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlaceImage } from '@/components/PlaceImage';
import { usePlacesSearch } from '@/hooks/usePlacesSearch';
import { useTheme } from '@/lib/theme';
import { currentSavedPlaces, searchSavedPlaces, savedPlaceNotePreview } from '@/lib/savedPlacesBrowse';
import { placeSourceCards } from '@/lib/placeSources';
import type { PlaceCandidate } from '@/services/placesService';
import type { SavedPlaceWithPlace } from '@/types';

type Props = { visible: boolean; topInset: number; locationBias?: { lat: number; lng: number }; onClose: () => void; onPickPlace: (place: PlaceCandidate) => void; savedPlaces?: SavedPlaceWithPlace[]; offline?: boolean; onSelectSaved?: (place: SavedPlaceWithPlace) => void; onSaveFromLink?: () => void };
type SearchRow = { kind: 'saved'; place: SavedPlaceWithPlace } | { kind: 'new'; place: PlaceCandidate };

/** Local memory search and explicitly requested discovery share one calm, keyboard-safe surface. */
export function MapPlaceSearchDropdown({ visible, topInset, locationBias, onClose, onPickPlace, savedPlaces = [], offline = false, onSelectSaved, onSaveFromLink }: Props) {
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'saved' | 'new'>('saved');
  const { results, loading, error, lastQuery, search, reset } = usePlacesSearch();
  const inputRef = useRef<TextInput>(null);
  useEffect(() => { if (visible) { setQuery(''); setScope(savedPlaces.length || offline ? 'saved' : 'new'); reset(); const id = setTimeout(() => inputRef.current?.focus(), 120); return () => clearTimeout(id); } reset(); }, [visible, reset]);
  useEffect(() => {
    if (!visible || offline || scope !== 'new') return;
    const q = query.trim(); if (q.length < 3 || q === lastQuery) return;
    const id = setTimeout(() => { void search(q, locationBias, { mode: 'manual', userLocation: locationBias ?? null, regionConfidence: 'none', sourceEvidence: [] }); }, 300);
    return () => clearTimeout(id);
  }, [query, visible, scope, offline, lastQuery, search, locationBias]);
  const savedResults = useMemo(() => searchSavedPlaces(currentSavedPlaces(savedPlaces), query), [savedPlaces, query]);
  const rows: SearchRow[] = scope === 'saved' ? savedResults.map(place => ({ kind: 'saved', place })) : query.trim().length >= 3 && !offline ? results.map(place => ({ kind: 'new', place })) : [];
  if (!visible) return null;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.overlay, { backgroundColor: colors.bg, paddingTop: topInset }]} accessibilityViewIsModal>
    <View style={styles.header}><Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close search" style={[styles.icon, { backgroundColor: colors.surface }]}><Feather name="arrow-left" size={22} color={colors.text} /></Pressable><Text style={[typography.heading, styles.headerTitle]}>Find a place</Text>{onSaveFromLink ? <Pressable onPress={onSaveFromLink} accessibilityRole="button" accessibilityLabel="Paste a social post link" style={[styles.icon, { backgroundColor: colors.surface }]}><Feather name="link" size={21} color={colors.text} /></Pressable> : <View style={styles.icon} />}</View>
    <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}><Feather name="search" size={22} color={colors.textSecondary} /><TextInput ref={inputRef} value={query} onChangeText={setQuery} placeholder={scope === 'saved' ? 'Name, city or your note' : 'Place, city or address'} placeholderTextColor={colors.textMuted} style={[typography.body, styles.input]} accessibilityLabel="Search places" autoCapitalize="none" autoCorrect={false} returnKeyType="search" />{query ? <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" style={styles.icon}><Feather name="x" size={21} color={colors.textSecondary} /></Pressable> : null}</View>
    <View style={styles.scopes}>{([{ id: 'saved', label: 'Your places' }, { id: 'new', label: 'Find somewhere new' }] as const).map(item => <Pressable key={item.id} onPress={() => setScope(item.id)} accessibilityRole="tab" accessibilityState={{ selected: scope === item.id }} style={[styles.scope, { backgroundColor: scope === item.id ? colors.primary : colors.surface, borderColor: colors.border }]}><Text style={[typography.label, { color: scope === item.id ? colors.textInverse : colors.text, textAlign: 'center' }]}>{item.label}</Text></Pressable>)}</View>
    <View style={styles.section}><Text style={[typography.heading, styles.flex]} accessibilityRole="header">{scope === 'saved' ? 'Your places' : 'Find somewhere new'}</Text>{loading && scope === 'new' ? <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Finding places" /> : <Text style={typography.caption}>{rows.length ? `${rows.length} ${rows.length === 1 ? 'match' : 'matches'}` : ''}</Text>}</View>
    <FlatList<SearchRow> data={rows} keyExtractor={item => item.kind === 'saved' ? item.place.id : item.place.googlePlaceId ?? `${item.place.name}-${item.place.formattedAddress}`} keyboardShouldPersistTaps="handled" initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }}
      ListEmptyComponent={<Text style={[typography.body, { color: colors.textSecondary, paddingTop: 16 }]}>{scope === 'saved' ? savedPlaces.length ? 'No memories found. Try a name, city or your note.' : 'Your saved places will be here. Find somewhere new to begin.' : offline ? 'You’re offline. Your saved places are still available.' : query.trim().length < 3 ? 'Search for a restaurant, beach, shop or somewhere you want to go.' : loading ? 'Finding places…' : error ? 'Couldn’t search places. Check your connection and try again.' : 'No places found. Try adding a city.'}</Text>}
      renderItem={({ item, index }) => {
        const saved = item.kind === 'saved' ? item.place : null;
        const candidate = item.kind === 'new' ? item.place : null;
        const name = saved?.place.name ?? candidate!.name;
        const address = saved?.place.formatted_address ?? candidate?.formattedAddress;
        const source = saved ? placeSourceCards(saved)[0] : null;
        const note = saved ? savedPlaceNotePreview(saved) : null;
        return <Pressable onPress={() => saved ? onSelectSaved?.(saved) : onPickPlace(candidate!)} accessibilityRole="button" accessibilityLabel={saved ? `Open saved place ${name}` : `Save ${name}`} style={({ pressed }) => [styles.row, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceElevated : 'transparent' }]}>
          <PlaceImage googlePlaceId={saved?.place.google_place_id ?? candidate?.googlePlaceId} sourceUri={source?.thumbnailUrl} initialPhotoUrls={candidate?.photoUrls?.length ? candidate.photoUrls : candidate?.photoUrl ? [candidate.photoUrl] : undefined} size={72} borderRadius={12} preferPlacePhoto presentationMode="candidate" presentationActive={item.kind === 'new' && index === 0} hydrationPolicy={saved ? 'saved_snapshot' : index === 0 ? 'active_manual_search' : index < 4 ? 'compact_known_only' : 'offscreen_manual_search'} presentationContext={{ trigger: 'manual_search', candidateIndex: index, candidateCount: rows.length }} accessibilityLabel={`Photo of ${name}`} />
          <View style={styles.flex}>{saved ? <Text style={[styles.eyebrow, { color: colors.accent }]}>SAVED</Text> : null}<Text style={typography.bodyStrong} numberOfLines={3}>{name}</Text>{address ? <Text style={[typography.caption, { marginTop: 4 }]} numberOfLines={2}>{address}</Text> : null}{note ? <Text style={[typography.caption, { marginTop: 8 }]} numberOfLines={2}>{note.text}</Text> : null}</View><Feather name={saved ? 'chevron-right' : 'plus'} size={23} color={colors.text} />
        </Pressable>;
      }} />
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({ overlay: { ...StyleSheet.absoluteFillObject, zIndex: 30 }, header: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginBottom: 24, gap: 8 }, headerTitle: { flex: 1, textAlign: 'center' }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 999 }, inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, borderWidth: 1, borderRadius: 12, paddingLeft: 16, paddingRight: 4, minHeight: 54 }, input: { flex: 1, paddingVertical: 12, minWidth: 0 }, scopes: { flexDirection: 'row', gap: 8, marginHorizontal: 24, marginTop: 16 }, scope: { flex: 1, minHeight: 48, paddingHorizontal: 8, paddingVertical: 12, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' }, section: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 24, marginTop: 24, marginBottom: 8 }, flex: { flex: 1, minWidth: 0 }, row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth }, eyebrow: { fontSize: 11, lineHeight: 16, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 } });
