import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Radius, Spacing } from '@/constants';
import { isPlaceVideoGalleryEnabled } from '@/lib/featureFlags';
import { trackEvent } from '@/lib/analytics';
import { videoGridColumnCount, type PlaceVideoItem } from '@/lib/placeVideoGallery';
import { resolvePlaceSource } from '@/lib/placeSource';
import { useTheme } from '@/lib/theme';
import { loadPlaceVideos } from '@/services/placeVideosService';

type Row = { kind: 'header'; key: string; title: string } | { kind: 'pair'; key: string; videos: PlaceVideoItem[] };
const GRID_COLUMNS = videoGridColumnCount();

function rows(owner: PlaceVideoItem[], community: PlaceVideoItem[]): Row[] {
  const result: Row[] = [];
  const add = (title: string, values: PlaceVideoItem[]) => {
    if (!values.length) return;
    result.push({ kind: 'header', key: `header:${title}`, title });
    for (let index = 0; index < values.length; index += GRID_COLUMNS) result.push({ kind: 'pair', key: `${title}:${index}`, videos: values.slice(index, index + GRID_COLUMNS) });
  };
  add('FROM YOUR SAVES', owner);
  add('FOUND BY THE NEARR COMMUNITY', community);
  return result;
}

export default function PlaceVideosPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const [owner, setOwner] = useState<PlaceVideoItem[]>([]);
  const [community, setCommunity] = useState<PlaceVideoItem[]>([]);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const enabled = isPlaceVideoGalleryEnabled();

  useEffect(() => {
    if (!enabled || !id) { setLoading(false); return; }
    let canceled = false;
    void loadPlaceVideos({ placeId: id, includeCommunity: true, limit: 20 }).then((gallery) => {
      if (canceled) return;
      setOwner(gallery.ownerVideos); setCommunity(gallery.communityVideos); setPlaceName(gallery.placeName); setCursor(gallery.nextCursor);
      void trackEvent('place_videos_page_opened', { place_id: gallery.placeId, owner_count: gallery.ownerVideos.length, community_count: gallery.communityVideos.length });
    }).catch(() => { if (!canceled) Alert.alert('Videos unavailable', 'Nearr could not load videos from this place.'); }).finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [enabled, id]);

  async function open(video: PlaceVideoItem) {
    void trackEvent('place_video_thumbnail_tapped', { place_id: id, source_id: video.sourceId, ownership: video.ownership, platform: video.platform });
    try {
      if (!(await Linking.canOpenURL(video.originalUrl))) throw new Error('unavailable');
      await Linking.openURL(video.originalUrl);
      void trackEvent(video.ownership === 'OWNER' ? 'owner_video_opened' : 'community_video_opened', { place_id: id, source_id: video.sourceId, platform: video.platform });
      void trackEvent('place_video_original_opened', { place_id: id, source_id: video.sourceId, ownership: video.ownership, platform: video.platform });
    } catch { Alert.alert('Post unavailable', 'The original post can no longer be opened.'); }
  }
  async function more() {
    if (!cursor || !id) return;
    const gallery = await loadPlaceVideos({ placeId: id, includeCommunity: true, cursor, limit: 20 });
    setCommunity((current) => [...current, ...gallery.communityVideos.filter((item) => !current.some((old) => old.sourceId === item.sourceId))]);
    setCursor(gallery.nextCursor);
  }
  const data = rows(owner, community);
  return <View style={styles.screen}>
    <Stack.Screen options={{ title: 'Videos from this place', headerBackTitle: 'Back' }} />
    {!enabled ? <View style={styles.center}><Text style={styles.muted}>This Dev preview is not enabled.</Text><Pressable onPress={() => router.back()}><Text style={styles.link}>Go back</Text></Pressable></View> : loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> :
      <FlatList data={data} keyExtractor={(item) => item.key} contentContainerStyle={styles.list} ListHeaderComponent={placeName ? <Text style={styles.placeName}>{placeName}</Text> : null} ListEmptyComponent={<Text style={styles.muted}>No videos are available for this place yet.</Text>} onEndReached={() => { void more(); }} onEndReachedThreshold={0.5} renderItem={({ item }) => item.kind === 'header' ? <Text style={styles.header}>{item.title}</Text> : <View style={styles.row}>{item.videos.map((video) => { const attribution = resolvePlaceSource({ source_type: video.platform, source_url: video.originalUrl }); return <Pressable key={video.sourceId} onPress={() => { void open(video); }} accessibilityRole="link" style={styles.tile}><View style={styles.media}><Image source={{ uri: video.thumbnailUrl }} style={styles.image} resizeMode="cover" /><View style={styles.play}><Ionicons name={(attribution?.brandIcon ?? 'play') as React.ComponentProps<typeof Ionicons>['name']} size={15} color="#fff" /></View></View><Text style={styles.creator} numberOfLines={1}>{video.creatorHandle ? `@${video.creatorHandle.replace(/^@/, '')}` : attribution?.platformName}</Text><Text style={styles.label}>{video.ownership === 'OWNER' ? 'Saved by you' : 'Nearr community'}</Text></Pressable>; })}{item.videos.length === 1 ? <View style={styles.tile} /> : null}</View>} />}
  </View>;
}

function createStyles(colors: any, typography: any) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md }, list: { padding: Spacing.md, paddingBottom: 48, gap: Spacing.sm }, placeName: { ...typography.title, color: colors.text, marginBottom: Spacing.sm }, header: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', letterSpacing: 0.6, marginTop: Spacing.md }, row: { flexDirection: 'row', gap: Spacing.sm }, tile: { flex: 1, minWidth: 0, gap: 4, marginBottom: Spacing.sm }, media: { width: '100%', aspectRatio: 1.35, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: colors.surfaceElevated }, image: { width: '100%', height: '100%' }, play: { position: 'absolute', right: 7, bottom: 7, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.72)' }, creator: { ...typography.caption, color: colors.text, fontWeight: '700' }, label: { ...typography.caption, color: colors.textSecondary, fontSize: 11 }, muted: { ...typography.body, color: colors.textSecondary, textAlign: 'center' }, link: { ...typography.bodyStrong, color: colors.accent },
}); }
