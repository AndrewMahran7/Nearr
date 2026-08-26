import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageStyle,
  type StyleProp,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PhotoRolodexModal } from '@/components/PhotoRolodex';
import { Radius, Spacing } from '@/constants';
import { formatCandidateTimestamp } from '@/lib/vayrinCandidateConfirmation';
import { QUICK_CHECK_LAYOUT, quickCheckCompactEvidenceFrameWidth } from '@/lib/quickCheckDensity';
import { resolveShareEvidenceFrames, type ResolvedShareEvidenceFrame } from '@/lib/shareEvidenceFrames';
import type { ShareJobEvidenceFrame } from '@/lib/shareJobResult';

type Props = {
  frames: readonly ShareJobEvidenceFrame[];
  analysisAttempted?: boolean;
  title?: string;
  subtitle?: string;
  compact?: boolean;
  dense?: boolean;
  /** One small, tappable frame for progressive-disclosure review rows. */
  preview?: boolean;
};

const COLORS = {
  cream: '#F4F2EF', orange: '#FF6A1A', surface: '#17191E', border: '#303238', muted: '#A7A39D', black: '#050608',
};

/** Shared bounded source-frame gallery; multi-place uses the compact variant. */
export function SourceEvidenceGallery({
  frames,
  analysisAttempted = false,
  title = 'Frames Vayrin checked',
  subtitle = 'Evidence from the video',
  compact = false,
  dense = false,
  preview = false,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const frameWidth = preview
    ? 112
    : compact && dense
    ? quickCheckCompactEvidenceFrameWidth(windowWidth)
    : compact
    ? Math.min(160, Math.max(148, (windowWidth - 72) / 2))
    : Math.min(360, Math.max(280, windowWidth - 56));
  const frameHeight = preview ? 92 : compact && dense ? QUICK_CHECK_LAYOUT.evidenceFrameHeight : compact ? 100 : 204;
  const [resolved, setResolved] = useState<ResolvedShareEvidenceFrame[]>([]);
  const [loading, setLoading] = useState(frames.length > 0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const signature = useMemo(() => frames.map((frame) => `${frame.id}:${frame.storagePath ?? frame.url ?? ''}`).join('|'), [frames]);

  useEffect(() => {
    let cancelled = false;
    setActiveIndex(0);
    setLoading(frames.length > 0);
    void resolveShareEvidenceFrames(frames).then((next) => {
      if (!cancelled) { setResolved(next); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [signature]);

  const available = useMemo(() => resolved.filter((frame) => !!frame.uri), [resolved]);
  const rolodexItems = useMemo(() => available.map((frame, index) => ({
    key: frame.id,
    uri: frame.uri!,
    accessibilityLabel: `Source video frame ${index + 1} of ${available.length} at ${formatCandidateTimestamp(frame.timestampSeconds)}`,
    footerLabel: formatCandidateTimestamp(frame.timestampSeconds),
  })), [available]);
  if (frames.length === 0 && !analysisAttempted) return null;

  return (
    <View style={[styles.section, compact && styles.sectionCompact, dense && styles.sectionDense, preview && styles.sectionPreview]} testID="source-evidence-gallery">
      {!preview ? <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text> : null}
      {!preview ? <Text style={[styles.subtitle, dense && styles.subtitleDense]}>{subtitle}</Text> : null}
      {loading ? (
        <View style={[styles.missing, { width: frameWidth, height: frameHeight }]}>
          <ActivityIndicator color={COLORS.orange} />
          <Text style={styles.missingText}>Loading analyzed frames…</Text>
        </View>
      ) : available.length > 0 ? (
        <>
          <FlatList
            horizontal
            nestedScrollEnabled
            directionalLockEnabled
            scrollEnabled={available.length > 1}
            data={available}
            keyExtractor={(frame) => frame.id}
            showsHorizontalScrollIndicator={false}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={2}
            decelerationRate="fast"
            snapToInterval={frameWidth + Spacing.sm}
            snapToAlignment="start"
            disableIntervalMomentum
            scrollEventThrottle={16}
            contentContainerStyle={styles.carouselContent}
            onScroll={(event) => {
              const index = Math.round(event.nativeEvent.contentOffset.x / (frameWidth + Spacing.sm));
              setActiveIndex(Math.max(0, Math.min(index, available.length - 1)));
            }}
            onMomentumScrollEnd={(event) => {
              const index = Math.round(event.nativeEvent.contentOffset.x / (frameWidth + Spacing.sm));
              setActiveIndex(Math.max(0, Math.min(index, available.length - 1)));
            }}
            renderItem={({ item, index }) => (
              <Pressable
                onPress={() => setViewerIndex(index)}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Source video frame at ${formatCandidateTimestamp(item.timestampSeconds)}. Open fullscreen.`}
                style={[styles.frame, { width: frameWidth, height: frameHeight }]}
              >
                <Image source={{ uri: item.uri! }} style={styles.frameImage as StyleProp<ImageStyle>} resizeMode="cover" />
                <View style={styles.timestampBadge}><Text style={styles.timestamp}>{formatCandidateTimestamp(item.timestampSeconds)}</Text></View>
                <View style={styles.expandBadge}><Feather name="maximize-2" size={15} color={COLORS.cream} /></View>
              </Pressable>
            )}
          />
          {!preview && available.length > 1 ? (
            <View style={[styles.dots, dense && styles.dotsDense]} accessibilityLabel={`Frame ${activeIndex + 1} of ${available.length}`}>
              {available.map((frame, index) => <View key={frame.id} style={[styles.dot, index === activeIndex && styles.dotActive]} />)}
            </View>
          ) : null}
        </>
      ) : (
        <View style={[styles.missing, { width: frameWidth, minHeight: compact ? 92 : 112 }]}>
          <Feather name="film" size={22} color={COLORS.muted} />
          <Text style={styles.missingText}>Analyzed frames weren’t retained for this result.</Text>
        </View>
      )}
      <PhotoRolodexModal
        visible={viewerIndex != null}
        items={rolodexItems}
        initialIndex={viewerIndex ?? activeIndex}
        onClose={() => setViewerIndex(null)}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: Spacing.lg, marginBottom: Spacing.md },
  sectionCompact: { marginTop: Spacing.md, marginBottom: Spacing.sm },
  sectionDense: { marginTop: QUICK_CHECK_LAYOUT.evidenceSectionTop, marginBottom: QUICK_CHECK_LAYOUT.evidenceSectionBottom },
  sectionPreview: { marginTop: Spacing.sm, marginBottom: Spacing.sm },
  title: { color: COLORS.cream, fontSize: 19, lineHeight: 24, fontWeight: '700' },
  titleCompact: { fontSize: 15, lineHeight: 20 },
  subtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 2, marginBottom: Spacing.sm },
  subtitleDense: { lineHeight: QUICK_CHECK_LAYOUT.evidenceSubtitleHeight, marginTop: 0, marginBottom: QUICK_CHECK_LAYOUT.evidenceSubtitleBottomGap },
  carouselContent: { paddingRight: Spacing.lg, gap: Spacing.sm },
  frame: { overflow: 'hidden', borderRadius: Radius.lg, backgroundColor: COLORS.black, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border },
  frameImage: { width: '100%', height: '100%' },
  timestampBadge: { position: 'absolute', left: Spacing.sm, bottom: Spacing.sm, borderRadius: 8, backgroundColor: 'rgba(5,6,8,0.82)', paddingHorizontal: 8, paddingVertical: 4 },
  timestamp: { color: COLORS.cream, fontSize: 13, lineHeight: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  expandBadge: { position: 'absolute', right: Spacing.sm, top: Spacing.sm, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(5,6,8,0.72)', alignItems: 'center', justifyContent: 'center' },
  dots: { minHeight: 22, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  dotsDense: { minHeight: QUICK_CHECK_LAYOUT.evidenceDotsHeight },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  dotActive: { width: 18, backgroundColor: COLORS.orange },
  missing: { borderRadius: Radius.lg, backgroundColor: COLORS.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.sm },
  missingText: { color: COLORS.muted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
