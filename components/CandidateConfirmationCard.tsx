import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CandidatePhotoCarousel } from '@/components/CandidatePhotoCarousel';
import type { PlaceImageResolutionKind } from '@/components/PlaceImage';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import type { CandidatePresentationContext } from '@/lib/candidatePresentation';
import { candidateCategoryLabel, candidateMatchedFramesLabel, candidateWhyMatchLines, isBroadCandidate, type CandidateConfirmationPlace } from '@/lib/vayrinCandidateConfirmation';

export const COMPACT_CANDIDATE_THUMB_WIDTH = 96;
export const COMPACT_CANDIDATE_PHOTO_HEIGHT = 112;
export const STANDARD_CANDIDATE_PHOTO_HEIGHT = 220;

type Props = {
  candidate: CandidateConfirmationPlace;
  locality?: string | null;
  selected?: boolean;
  selectable?: boolean;
  saved?: boolean;
  evidence?: string | null;
  bestMatch?: boolean;
  onPress?: () => void;
  onImageResolved?: (kind: PlaceImageResolutionKind) => void;
  compact?: boolean;
  compactPhotoHeight?: number;
  compactThumbnailWidth?: number;
  rank?: number;
  selectionRole?: 'checkbox' | 'radio';
  presentationActive?: boolean;
  presentationContext?: CandidatePresentationContext;
  /** Retained source imagery stays visibly separate from destination photos. */
  sourceEvidence?: ReactNode;
};

/** Presentation only: selection and persistence remain owned by the caller. */
export function CandidateConfirmationCard({
  candidate, locality, selected = false, selectable = false, saved = false,
  evidence, onPress, onImageResolved, compact = false,
  compactPhotoHeight = COMPACT_CANDIDATE_PHOTO_HEIGHT,
  compactThumbnailWidth = COMPACT_CANDIDATE_THUMB_WIDTH, rank,
  selectionRole = 'radio', presentationActive = true,
  presentationContext = { trigger: 'recognition_result' }, sourceEvidence,
}: Props) {
  const { colors, typography } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  const broad = isBroadCandidate(candidate);
  const category = candidateCategoryLabel(candidate);
  const matchedFrames = candidateMatchedFramesLabel(candidate);
  const whyLines = candidateWhyMatchLines(candidate, locality);
  const conciseEvidence = evidence ?? matchedFrames;
  const stacked = width < 360 || fontScale > 1.25;
  const accessibilityLabel = [candidate.name, locality, broad ? 'Area match' : 'Possible match',
    saved ? 'Already saved; saving will attach this post' : null].filter(Boolean).join(', ');
  const selection = selectable && onPress ? (
    <Pressable onPress={onPress} accessibilityRole={selectionRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={selectionRole === 'checkbox' ? 'Toggles this place for saving' : 'Selects this place for saving'}
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [styles.selection, selectionRole === 'checkbox' && styles.checkbox,
        selected && styles.selectionSelected, pressed && styles.pressed]}
      testID="candidate-selection-control">
      {selected ? <Feather name="check" size={19} color={colors.onGradient} /> : null}
    </Pressable>
  ) : null;
  const photo = (
    <CandidatePhotoCarousel googlePlaceId={candidate.googlePlaceId}
      initialPhotoUrls={candidate.photoUrls?.length ? candidate.photoUrls : candidate.photoUrl ? [candidate.photoUrl] : undefined}
      fallbackSourceUri={candidate.sourceFrameUrl} accessibilityLabel={`Photo of ${candidate.name}`}
      onResolvedKind={onImageResolved}
      height={compact && !stacked ? compactPhotoHeight : sourceEvidence && !stacked ? 168 : STANDARD_CANDIDATE_PHOTO_HEIGHT}
      thumbnailWidth={compactThumbnailWidth} variant={compact && !stacked ? 'thumbnail' : 'carousel'}
      active={presentationActive} presentationContext={presentationContext} />
  );
  const identity = (
    <View style={[styles.identity, compact && styles.identityCompact, compact && stacked && styles.stackedPane]}>
      <View style={styles.identityTop}>
        <View style={styles.copy}>
          <Text style={styles.possible}>{broad ? 'AREA MATCH' : 'Possible match'}{rank ? ` · ${rank}` : ''}</Text>
          <Text style={[compact ? typography.bodyStrong : typography.heading, styles.name]}>{candidate.name}</Text>
          {locality ? <Text style={styles.locality}>{locality}</Text> : null}
          {category && !broad ? <Text style={styles.category}>{category}</Text> : null}
        </View>
        {selection}
      </View>
      {broad ? <Text style={styles.evidence}>The video was narrowed to this area.</Text> : null}
      {conciseEvidence ? <Text style={styles.evidence}>{conciseEvidence}</Text> : !compact ? (
        <Text style={styles.evidence}>Check the name and location before saving.</Text>
      ) : null}
      {whyLines.length > 0 ? (
        <Pressable onPress={() => setExpanded((current) => !current)} accessibilityRole="button"
          accessibilityLabel="Why this match?" accessibilityState={{ expanded }}
          style={styles.whyButton} testID="candidate-why-match">
          <Text style={styles.whyButtonText}>Why this match?</Text>
          <Feather name={expanded ? 'chevron-up' : 'chevron-right'} size={17} color={colors.accent} />
        </Pressable>
      ) : null}
      {saved ? <Text style={styles.saved}>Already on your map · this post will be attached</Text> : null}
    </View>
  );
  return (
    <View style={[styles.card, compact && styles.cardCompact, selected && styles.cardSelected]}
      testID={compact ? 'compact-candidate-row' : 'fieldnotes-candidate-card'}>
      {compact ? <View style={[styles.compactRow, stacked && styles.stacked]}>{photo}{identity}</View> : <>
        <View style={[styles.photoPair, stacked && styles.stacked]}>
          {sourceEvidence ? <View style={[styles.photoPane, stacked && styles.stackedPane]}>{sourceEvidence}</View> : null}
          <View style={[styles.photoPane, stacked && styles.stackedPane]}>{photo}</View>
        </View>
        {identity}
      </>}
      {expanded ? (
        <View style={styles.whyPanel}>
          <Text style={styles.whyTitle}>Why this matches</Text>
          {whyLines.map((line) => <Text key={line} style={styles.whyText}>• {line}</Text>)}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    card: { backgroundColor: colors.surface, borderRadius: Radius.md, overflow: 'hidden', marginBottom: Spacing.md },
    cardCompact: { padding: Spacing.sm, borderWidth: 1, borderColor: colors.border },
    cardSelected: { borderWidth: 1.5, borderColor: colors.accent },
    pressed: { backgroundColor: colors.surfaceElevated },
    compactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
    stacked: { flexDirection: 'column' },
    photoPair: { flexDirection: 'row', gap: Spacing.sm },
    photoPane: { flex: 1, minWidth: 0, alignSelf: 'stretch' },
    stackedPane: { flex: 0, width: '100%' },
    identity: { padding: Spacing.md, alignSelf: 'stretch' },
    identityCompact: { flex: 1, padding: 0 },
    identityTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
    copy: { flex: 1, minWidth: 0 },
    possible: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '600', marginBottom: Spacing.xs },
    name: { color: colors.text },
    locality: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: Spacing.xs },
    category: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: Spacing.xs },
    selection: { width: 44, height: 44, borderRadius: Radius.pill, borderWidth: 1.5, borderColor: colors.controlBorder, alignItems: 'center', justifyContent: 'center' },
    checkbox: { borderRadius: Radius.sm },
    selectionSelected: { backgroundColor: colors.brand, borderColor: colors.accent },
    evidence: { color: colors.textSecondary, fontSize: 15, lineHeight: 21, marginTop: Spacing.sm },
    whyButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, alignSelf: 'flex-start' },
    whyButtonText: { color: colors.accent, fontSize: 13, lineHeight: 18, fontWeight: '600' },
    whyPanel: { padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    whyTitle: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '600', marginBottom: Spacing.sm },
    whyText: { color: colors.textSecondary, fontSize: 15, lineHeight: 21, marginBottom: Spacing.xs },
    saved: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: Spacing.xs },
  });
}
