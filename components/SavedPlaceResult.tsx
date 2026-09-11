import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/Button';
import { PlaceImage } from '@/components/PlaceImage';
import { Radius, Spacing } from '@/constants';
import type { SavedPlaceResultViewModel } from '@/lib/savedPlaceResult';
import { splitPlaceAddress } from '@/lib/sharePhase1Ui';
import { useTheme } from '@/lib/theme';
import type { ShareJobSoftAlternative } from '@/services/shareJobsService';

const CARD_GAP = 12;

export type SavedPlaceAlternativeAction = 'keep' | 'promote' | 'remove';

type Props = {
  primary: SavedPlaceResultViewModel;
  sourceAvailable: boolean;
  alternatives: readonly ShareJobSoftAlternative[];
  pendingByResultId: Readonly<Record<string, SavedPlaceAlternativeAction | undefined>>;
  onWatchPost: () => void;
  onWrongPlace: () => void;
  onAlternativeAction: (alternative: ShareJobSoftAlternative, action: SavedPlaceAlternativeAction) => void;
  onViewOnMap: () => void;
  openMessage?: string | null;
};

export function SavedPlaceResult({
  primary,
  sourceAvailable,
  alternatives,
  pendingByResultId,
  onWatchPost,
  onWrongPlace,
  onAlternativeAction,
  onViewOnMap,
  openMessage,
}: Props) {
  const { width } = useWindowDimensions();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [visibleAlternativeIndex, setVisibleAlternativeIndex] = useState(0);
  const multiple = alternatives.length > 1;
  const cardWidth = multiple
    ? Math.max(274, Math.min(340, width - 70))
    : Math.max(260, width - (Spacing.lg * 2));
  const snapInterval = cardWidth + CARD_GAP;

  useEffect(() => {
    setVisibleAlternativeIndex((current) => Math.max(0, Math.min(current, alternatives.length - 1)));
  }, [alternatives.length]);

  const onAlternativeScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!multiple) return;
    const index = Math.max(0, Math.min(
      alternatives.length - 1,
      Math.round(event.nativeEvent.contentOffset.x / snapInterval),
    ));
    setVisibleAlternativeIndex(index);
  }, [alternatives.length, multiple, snapInterval]);

  const renderAlternative = useCallback(({ item, index }: { item: ShareJobSoftAlternative; index: number }) => {
    const pending = pendingByResultId[item.resultId];
    const saved = item.savedPlaceId != null;
    const location = item.candidate.shortFormattedAddress
      ?? splitPlaceAddress(item.candidate.formattedAddress).locality
      ?? item.candidate.formattedAddress;
    return (
      <View
        style={[styles.alternativeCard, { width: cardWidth }]}
      >
        <View style={styles.alternativeIdentity}>
          <PlaceImage
            googlePlaceId={item.candidate.googlePlaceId.startsWith('nearr-native:') ? undefined : item.candidate.googlePlaceId}
            allowGoogleLookup={!saved}
            initialPhotoUrls={item.candidate.photoUrls?.length
              ? item.candidate.photoUrls
              : item.candidate.photoUrl ? [item.candidate.photoUrl] : undefined}
            fallbackSourceUri={item.candidate.sourceFrameUrl}
            preferPlacePhoto
            presentationMode="candidate"
            presentationActive={index === visibleAlternativeIndex}
            presentationContext={{
              trigger: 'recognition_result',
              candidateIndex: index,
              candidateCount: alternatives.length,
            }}
            size={92}
            borderRadius={14}
            accessibilityLabel={`Photo of ${item.candidate.name}`}
          />
          <View style={styles.alternativeCopy}>
            <Text style={[typography.bodyStrong, styles.alternativeName]}>{item.candidate.name}</Text>
            {location ? (
              <View style={styles.metaRow}>
                <Feather name="map-pin" size={14} color={colors.textMuted} />
                <Text style={[typography.caption, styles.alternativeLocation]}>{location}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.alternativeActions}>
          <Pressable
            onPress={() => onAlternativeAction(item, 'keep')}
            disabled={Boolean(pending) || saved}
            accessibilityRole="button"
            accessibilityLabel={saved ? `${item.candidate.name} is saved` : `Save ${item.candidate.name} too`}
            accessibilityState={{ disabled: Boolean(pending) || saved, busy: pending === 'keep' }}
            style={({ pressed }) => [
              styles.alternativeAction,
              styles.saveTooAction,
              (pressed || saved) && styles.pressed,
            ]}
          >
            {pending === 'keep' ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Feather name={saved ? 'check' : 'plus'} size={17} color={colors.accent} />
            )}
            <Text style={styles.saveTooText}>{saved ? 'Saved' : 'Save too'}</Text>
          </Pressable>
          {!saved ? (
            <Pressable
              onPress={() => onAlternativeAction(item, 'promote')}
              disabled={Boolean(pending)}
              accessibilityRole="button"
              accessibilityLabel={`Use ${item.candidate.name} instead`}
              accessibilityState={{ disabled: Boolean(pending), busy: pending === 'promote' }}
              style={({ pressed }) => [styles.alternativeAction, styles.useInsteadAction, pressed && styles.pressed]}
            >
              {pending === 'promote' ? <ActivityIndicator size="small" color={colors.text} /> : null}
              <Text style={styles.useInsteadText}>Use instead</Text>
            </Pressable>
          ) : null}
          {!saved ? (
            <Pressable
              onPress={() => onAlternativeAction(item, 'remove')}
              disabled={Boolean(pending)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.candidate.name} suggestion`}
              accessibilityState={{ disabled: Boolean(pending), busy: pending === 'remove' }}
              hitSlop={6}
              style={({ pressed }) => [styles.removeAction, pressed && styles.pressed]}
            >
              {pending === 'remove'
                ? <ActivityIndicator size="small" color={colors.textMuted} />
                : <Feather name="x" size={20} color={colors.textSecondary} />}
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }, [alternatives.length, cardWidth, colors, onAlternativeAction, pendingByResultId, styles, typography, visibleAlternativeIndex]);

  return (
    <View style={styles.screen} testID="saved-place-result">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        <View style={styles.primaryCard} testID="saved-place-primary-card">
          <View style={styles.heroMedia}>
            <PlaceImage
              googlePlaceId={primary.googlePlaceId?.startsWith('nearr-native:') ? undefined : primary.googlePlaceId}
              allowGoogleLookup={false}
              sourceUri={primary.sourceThumbnailUrl}
              initialPhotoUrls={primary.candidatePhotoUrl ? [primary.candidatePhotoUrl] : undefined}
              fallbackSourceUri={primary.sourceFrameUrl ?? primary.sourceThumbnailUrl}
              preferPlacePhoto
              presentationMode="candidate"
              presentationActive
              presentationContext={{ trigger: 'recognition_result', candidateIndex: 0, candidateCount: 1 }}
              width="100%"
              height={196}
              size={196}
              borderRadius={0}
              style={styles.heroImage}
              accessibilityLabel={`Photo of ${primary.name}`}
            />
            <View style={styles.savedStateBadge}>
              <View style={styles.savedStateCheck}>
                <Feather name="check" size={15} color="#FFFFFF" />
              </View>
              <Text style={styles.savedStateText}>{primary.statusLabel}</Text>
            </View>
          </View>
          <View style={styles.primaryBody}>
            <Text accessibilityRole="header" style={[typography.heading, styles.primaryName]}>{primary.name}</Text>
            {primary.location ? (
              <View style={styles.metaRow}>
                <Feather name="map-pin" size={17} color={colors.textSecondary} />
                <Text style={[typography.body, styles.primaryLocation]}>{primary.location}</Text>
              </View>
            ) : null}
            {primary.source && primary.sourceCopy ? (
              <View style={styles.metaRow} accessibilityLabel={primary.source.sourceA11yLabel}>
                <Ionicons name={primary.source.brandIcon as never} size={18} color={colors.textSecondary} />
                <Text style={[typography.body, styles.sourceCopy]}>{primary.sourceCopy}</Text>
              </View>
            ) : null}
            <View style={styles.primaryActions}>
              {sourceAvailable && primary.source ? (
                <Pressable
                  onPress={onWatchPost}
                  accessibilityRole="button"
                  accessibilityLabel={primary.source.actionA11yLabel}
                  style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
                >
                  <Feather name="play" size={18} color={colors.text} />
                  <Text style={styles.primaryActionText}>{primary.source.actionLabel}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={onWrongPlace}
                accessibilityRole="button"
                accessibilityLabel={`Report that ${primary.name} is the wrong place`}
                style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
              >
                <Feather name="alert-triangle" size={18} color={colors.textSecondary} />
                <Text style={styles.primaryActionText}>Wrong place?</Text>
              </Pressable>
            </View>
            {openMessage ? <Text accessibilityLiveRegion="polite" style={styles.openMessage}>{openMessage}</Text> : null}
          </View>
        </View>

        {alternatives.length > 0 ? (
          <View style={styles.similarSection} testID="soft-alternatives-review">
            <View style={styles.sectionHeadingRow}>
              <View style={styles.sectionAccent} />
              <Text accessibilityRole="header" style={[typography.heading, styles.sectionHeading]}>Similar results</Text>
            </View>
            <Text style={[typography.body, styles.sectionHelp]}>Other places that may match this video.</Text>
            <FlatList
              horizontal
              data={alternatives as ShareJobSoftAlternative[]}
              renderItem={renderAlternative}
              keyExtractor={(item) => item.resultId}
              contentContainerStyle={styles.carouselContent}
              ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
              snapToInterval={multiple ? snapInterval : undefined}
              snapToAlignment="start"
              decelerationRate={multiple ? 'fast' : 'normal'}
              disableIntervalMomentum={multiple}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onAlternativeScrollEnd}
              nestedScrollEnabled
              accessibilityLabel={`${alternatives.length} similar ${alternatives.length === 1 ? 'result' : 'results'}`}
            />
            {multiple ? (
              <View
                style={styles.pagination}
                accessible
                accessibilityLabel={`Similar result ${visibleAlternativeIndex + 1} of ${alternatives.length}`}
              >
                {alternatives.map((alternative, index) => (
                  <View
                    key={alternative.resultId}
                    style={[styles.pageDot, index === visibleAlternativeIndex && styles.pageDotActive]}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          title="View on map"
          accessibilityLabel={`View ${primary.name} on map`}
          onPress={onViewOnMap}
          style={styles.mapButton}
        />
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs, paddingBottom: Spacing.lg },
    primaryCard: {
      overflow: 'hidden',
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.accentBorder,
      backgroundColor: colors.surface,
    },
    heroMedia: { height: 196, backgroundColor: colors.surfaceElevated },
    heroImage: { width: '100%', height: 196, borderWidth: 0 },
    savedStateBadge: {
      position: 'absolute', left: Spacing.md, top: Spacing.md,
      minHeight: 36, paddingHorizontal: 10, paddingVertical: 6,
      borderRadius: Radius.pill, flexDirection: 'row', alignItems: 'center', gap: 7,
      backgroundColor: 'rgba(20, 18, 17, 0.88)', borderWidth: 1, borderColor: colors.accent,
    },
    savedStateCheck: {
      width: 23, height: 23, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary,
    },
    savedStateText: { color: colors.accent, fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
    primaryBody: { padding: Spacing.lg },
    primaryName: { color: colors.text, flexShrink: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
    primaryLocation: { color: colors.textSecondary, flex: 1 },
    sourceCopy: { color: colors.textMuted, flex: 1 },
    primaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.lg },
    primaryAction: {
      minHeight: 46, minWidth: 132, flexGrow: 1, flexBasis: 132,
      paddingHorizontal: Spacing.md, borderRadius: Radius.md,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceElevated,
    },
    primaryActionText: { color: colors.text, fontSize: 14, fontWeight: '700' },
    openMessage: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: Spacing.sm, textAlign: 'center' },
    similarSection: { marginTop: Spacing.xl },
    sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    sectionAccent: { width: 38, height: 5, borderRadius: 3, backgroundColor: colors.primary },
    sectionHeading: { color: colors.text, flex: 1 },
    sectionHelp: { color: colors.textSecondary, marginTop: Spacing.xs, marginBottom: Spacing.md },
    carouselContent: { paddingRight: Spacing.lg },
    alternativeCard: {
      padding: Spacing.md, borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    alternativeIdentity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    alternativeCopy: { flex: 1, minWidth: 0 },
    alternativeName: { color: colors.text, fontSize: 17, lineHeight: 22 },
    alternativeLocation: { color: colors.textMuted, flex: 1 },
    alternativeActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.md },
    alternativeAction: {
      minHeight: 42, paddingHorizontal: 12, borderRadius: Radius.pill,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    },
    saveTooAction: { borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft },
    saveTooText: { color: colors.accent, fontSize: 13, fontWeight: '800' },
    useInsteadAction: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceElevated },
    useInsteadText: { color: colors.text, fontSize: 13, fontWeight: '700' },
    removeAction: {
      width: 42, height: 42, borderRadius: 21,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceElevated,
    },
    pagination: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: Spacing.md },
    pageDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
    pageDotActive: { backgroundColor: colors.primary },
    footer: {
      paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bg,
    },
    mapButton: { minHeight: 56 },
    pressed: { opacity: 0.62 },
  });
}
