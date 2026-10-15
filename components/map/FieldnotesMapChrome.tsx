import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { placeSourceCards } from '@/lib/placeSources';
import { splitPlaceAddress } from '@/lib/sharePhase1Ui';
import type { SavedPlacePhotoKind } from '@/lib/savedPlaceSnapshot';
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
export function SelectedPlaceCard({ place, imageUri, imageKind = 'unknown', onOpen, onClose }: {
  place: SavedPlaceWithPlace; imageUri: string | null; imageKind?: SavedPlacePhotoKind; onOpen: () => void; onClose: () => void;
}) {
  const { colors, typography } = useTheme();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.5;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const source = useMemo(() => placeSourceCards(place)[0], [place]);
  const reason = place.notes?.trim() || place.ai_note?.trim() || null;
  const locality = splitPlaceAddress(place.place.formatted_address).locality;
  const imageLabel = imageKind === 'destination' ? 'Destination photo' : imageKind === 'source' ? 'From your post' : 'Saved image';
  const platform = source?.platform === 'link' ? 'a shared post' : source?.platform ? ({ youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' } as Record<string,string>)[source.platform] || source.platform : null;
  return <View>
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${place.place.name} details${locality ? `, ${locality}` : ''}`} accessibilityHint="Shows the destination, original post and reminder" style={({ pressed }) => [styles.cardCopy, pressed && { opacity: 0.8 }]}>
      <View style={[styles.identityRow, largeText && styles.identityRowLarge]}>
        {imageUri && imageUri !== failedImage ? <View style={styles.imageWrap}>
          <Image source={{ uri: imageUri }} resizeMode="cover" style={styles.hero} accessibilityLabel={`${imageLabel}: ${place.place.name}`} onError={() => setFailedImage(imageUri)} />
          {imageKind === 'source' ? <View style={[styles.imageLabel, { backgroundColor: colors.surface }]}><Text style={[typography.caption, { color: colors.textSecondary }]}>Post</Text></View> : null}
        </View> : null}
        <View style={[styles.identityCopy, largeText && styles.identityCopyLarge]}>
          <Text style={[typography.heading, styles.title]} numberOfLines={largeText ? undefined : 2}>{place.place.name}</Text>
          {locality ? <Text style={[typography.caption, styles.context, { color: colors.textSecondary }]} numberOfLines={largeText ? undefined : 2}>{locality}</Text> : null}
          {platform ? <View style={styles.source}><Feather name="play" size={13} color={colors.textSecondary} /><Text style={[typography.caption, styles.context, { color: colors.textSecondary }]}>Saved from {platform}</Text></View> : null}
        </View>
      </View>
      {reason ? <Text style={[typography.caption, styles.reason, { color: colors.textSecondary }]} numberOfLines={largeText ? 3 : 2}>{reason}</Text> : null}
      <View style={styles.detailsLink}><Text style={[typography.label, { color: colors.accent }]}>View details</Text><Feather name="arrow-right" size={18} color={colors.accent} /></View>
    </Pressable>
    <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close place preview" style={[styles.close, { backgroundColor: colors.surface }]}><Feather name="x" size={20} color={colors.text} /></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 48, right: 48, flexDirection: 'row', padding: 5, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6, zIndex: 12 },
  dockItem: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 }, brandIcon: { width: 32, height: 32, borderRadius: 8 }, wordmark: { fontSize: 29, fontWeight: '700', letterSpacing: -1 },
  hero: { width: 88, height: 96, borderRadius: 12 }, imageWrap: { width: 88, height: 96 }, imageLabel: { position: 'absolute', left: 4, bottom: 4, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  cardCopy: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 8 }, identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 40 }, identityRowLarge: { flexWrap: 'wrap' }, identityCopy: { flex: 1, minWidth: 0 }, identityCopyLarge: { minWidth: 160 },
  title: { fontSize: 21, lineHeight: 26 }, context: { fontSize: 13, lineHeight: 18, flexShrink: 1, marginTop: 3 }, reason: { marginTop: 12, fontSize: 14, lineHeight: 20 }, source: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }, detailsLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, minHeight: 28 }, close: { position: 'absolute', top: 4, right: 0, width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
