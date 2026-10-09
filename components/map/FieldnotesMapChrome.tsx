import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { placeSourceCards } from '@/lib/placeSources';
import type { SavedPlaceWithPlace } from '@/types';

/** Presentation-only map navigation; the parent retains camera ownership. */
export function MapSavedDock({ saved, bottom, onMap, onSaved }: {
  saved: boolean; bottom: number; onMap: () => void; onSaved: () => void;
}) {
  const { colors, typography } = useTheme();
  return <View style={[styles.dock, { bottom, backgroundColor: colors.surface, borderColor: colors.border }]}>
    {([{ label: 'Map', icon: 'map', active: !saved, onPress: onMap }, { label: 'Saved', icon: 'bookmark', active: saved, onPress: onSaved }] as const).map(item =>
      <Pressable key={item.label} onPress={item.onPress} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: item.active }}
        style={({ pressed }) => [styles.dockItem, { backgroundColor: item.active || pressed ? colors.surfaceElevated : 'transparent' }]}>
        <Feather name={item.icon} size={20} color={colors.text} /><Text style={[typography.label, { color: colors.text }]}>{item.label}</Text>
      </Pressable>)}
  </View>;
}

export function MapBrand() {
  const { colors } = useTheme();
  return <View style={styles.brand} accessible accessibilityLabel="Nearr">
    <Image source={require('../../assets/icon.png')} style={styles.brandIcon} accessible={false} />
    <Text style={[styles.wordmark, { color: colors.text }]} allowFontScaling>nearr</Text>
  </View>;
}

/** One destination-first tap surface; no second Directions action competing here. */
export function SelectedPlaceCard({ place, imageUri, onOpen, onClose }: {
  place: SavedPlaceWithPlace; imageUri: string | null; onOpen: () => void; onClose: () => void;
}) {
  const { colors, typography } = useTheme();
  const source = useMemo(() => placeSourceCards(place)[0], [place]);
  const reason = place.notes?.trim() || place.ai_note?.trim() || null;
  const platform = source?.platform === 'link' ? 'a shared post' : source?.platform ? ({ youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' } as Record<string,string>)[source.platform] || source.platform : null;
  return <View>
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${place.place.name} details`} accessibilityHint="Shows the destination, original post and reminder">
      {imageUri ? <Image source={{ uri: imageUri }} resizeMode="cover" style={styles.hero} accessibilityLabel={`Photo of ${place.place.name}`} /> :
        <View style={[styles.noPhoto, { backgroundColor: colors.surfaceElevated }]}><Feather name="map-pin" size={24} color={colors.textSecondary} /><Text style={[typography.caption, { color: colors.textSecondary }]}>A place to remember</Text></View>}
      <View style={styles.cardCopy}>
        <View style={styles.eyebrowRow}><Text style={[styles.eyebrow, { color: colors.accent }]}>{place.notes?.trim() ? 'YOUR NOTE' : place.ai_note?.trim() ? 'FROM THE POST' : 'SAVED TO YOUR WORLD'}</Text><Feather name="arrow-right" size={22} color={colors.text} /></View>
        {reason ? <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: 8 }]} numberOfLines={2}>{reason}</Text> : null}
        <Text style={[typography.heading, styles.title]} numberOfLines={3}>{place.place.name}</Text>
        {place.place.formatted_address ? <Text style={[typography.caption, { marginTop: 4 }]} numberOfLines={2}>{place.place.formatted_address}</Text> : null}
        {platform ? <View style={styles.source}><Feather name="play" size={14} color={colors.textSecondary} /><Text style={typography.caption}>Saved from {platform}</Text></View> : null}
      </View>
    </Pressable>
    <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close place preview" style={[styles.close, { backgroundColor: colors.surface }]}><Feather name="x" size={20} color={colors.text} /></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 48, right: 48, flexDirection: 'row', padding: 5, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6, zIndex: 12 },
  dockItem: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 }, brandIcon: { width: 32, height: 32, borderRadius: 8 }, wordmark: { fontSize: 29, fontWeight: '700', letterSpacing: -1 },
  hero: { width: '100%', height: 156, borderRadius: 12 }, noPhoto: { minHeight: 80, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  cardCopy: { paddingHorizontal: 8, paddingTop: 16, paddingBottom: 8 }, eyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }, eyebrow: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '700', letterSpacing: 1.2 },
  title: { fontSize: 23, lineHeight: 28 }, source: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }, close: { position: 'absolute', top: 8, right: 8, width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
