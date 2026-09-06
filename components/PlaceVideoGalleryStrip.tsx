import { useMemo } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

import { Radius, Spacing } from '@/constants';
import type { PlaceVideoItem } from '@/lib/placeVideoGallery';
import { resolvePlaceSource } from '@/lib/placeSource';
import { useTheme } from '@/lib/theme';

type MediaItem =
  | { kind: 'provider'; key: string; uri: string; index: number }
  | { kind: 'marker'; key: string }
  | { kind: 'video'; key: string; video: PlaceVideoItem }
  | { kind: 'cta'; key: string; count: number };

export function PlaceVideoGalleryStrip(props: {
  placeName: string;
  providerPhotos: readonly string[];
  ownerVideos: readonly PlaceVideoItem[];
  communityVideos: readonly PlaceVideoItem[];
  totalVideoCount: number;
  onOpenProvider: (index: number) => void;
  onOpenVideo: (video: PlaceVideoItem) => void;
  onSeeAll: () => void;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    root: { marginHorizontal: -Spacing.sm, gap: 8 },
    list: { gap: 8, paddingHorizontal: Spacing.sm, paddingRight: Spacing.lg },
    tile: { width: 126, gap: 5 },
    media: { width: 126, height: 84, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
    image: { width: '100%', height: '100%' },
    badge: { position: 'absolute', right: 6, bottom: 6, width: 25, height: 25, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
    context: { position: 'absolute', left: 6, top: 6, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: 'rgba(0,0,0,0.72)' },
    contextText: { ...typography.caption, color: '#fff', fontSize: 9, fontWeight: '800' },
    caption: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
    marker: { width: 74, height: 84, justifyContent: 'center', alignItems: 'center', gap: 5 },
    markerLine: { width: 36, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    markerText: { ...typography.caption, color: colors.textSecondary, fontSize: 10, textAlign: 'center', fontWeight: '800' },
    cta: { width: 126, height: 84, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.accentSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accentBorder },
    ctaText: { ...typography.caption, color: colors.accent, fontWeight: '800', textAlign: 'center' },
  }), [colors, typography]);
  const videos = [...props.ownerVideos, ...props.communityVideos];
  const items: MediaItem[] = useMemo(() => {
    if (!videos.length) return [];
    const media: MediaItem[] = props.providerPhotos.map((uri, index) => ({ kind: 'provider', key: `provider:${uri}`, uri, index }));
    if (media.length) media.push({ kind: 'marker', key: 'from-videos' });
    props.ownerVideos.forEach((video) => media.push({ kind: 'video', key: `owner:${video.sourceId}`, video }));
    props.communityVideos.slice(0, 5).forEach((video) => media.push({ kind: 'video', key: `community:${video.sourceId}`, video }));
    if (props.totalVideoCount > videos.length || videos.length > 1) media.push({ kind: 'cta', key: 'see-all', count: props.totalVideoCount });
    return media;
  }, [props.communityVideos, props.ownerVideos, props.providerPhotos, props.totalVideoCount]);
  if (!items.length) return null;
  return (
    <View style={styles.root} accessibilityLabel="Place media gallery">
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => {
          if (item.kind === 'marker') return <View style={styles.marker}><View style={styles.markerLine} /><Text style={styles.markerText}>FROM{`\n`}VIDEOS</Text><Feather name="play-circle" size={18} color={colors.textSecondary} /></View>;
          if (item.kind === 'cta') return <Pressable accessibilityRole="button" accessibilityLabel={`See all ${item.count} videos from this place`} onPress={props.onSeeAll} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.75 }]}><Feather name="grid" size={20} color={colors.accent} /><Text style={styles.ctaText}>Videos from this place · {item.count}</Text></Pressable>;
          if (item.kind === 'provider') return <Pressable accessibilityRole="button" accessibilityLabel={`${props.placeName}, provider photo ${item.index + 1}`} onPress={() => props.onOpenProvider(item.index)} style={styles.tile}><View style={styles.media}><Image source={{ uri: item.uri }} style={styles.image} resizeMode="cover" /></View><Text style={styles.caption}>Place photo</Text></Pressable>;
          const attribution = resolvePlaceSource({ source_type: item.video.platform, source_url: item.video.originalUrl });
          return <Pressable accessibilityRole="link" accessibilityLabel={`Open ${attribution?.platformName ?? item.video.platform} video, ${item.video.ownership === 'OWNER' ? 'saved by you' : 'found by the Nearr community'}`} onPress={() => props.onOpenVideo(item.video)} style={styles.tile}><View style={styles.media}><Image source={{ uri: item.video.thumbnailUrl }} style={styles.image} resizeMode="cover" /><View style={styles.context}><Text style={styles.contextText}>{item.video.ownership === 'OWNER' ? 'SAVED BY YOU' : 'NEARR COMMUNITY'}</Text></View><View style={styles.badge}><Ionicons name={(attribution?.brandIcon ?? 'play') as React.ComponentProps<typeof Ionicons>['name']} size={13} color="#fff" /></View></View><Text style={styles.caption} numberOfLines={1}>{item.video.creatorHandle ? `@${item.video.creatorHandle.replace(/^@/, '')}` : attribution?.platformName ?? 'Video'}</Text></Pressable>;
        }}
      />
    </View>
  );
}
