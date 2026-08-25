import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { CandidatePhotoCarousel } from '@/components/CandidatePhotoCarousel';
import type { PlaceImageResolutionKind } from '@/components/PlaceImage';
import { Radius, Spacing } from '@/constants';
import {
  candidateCategoryLabel,
  candidateMatchLabel,
  candidateMatchedFramesLabel,
  candidateWhyMatchLines,
  isBroadCandidate,
  type CandidateConfirmationPlace,
} from '@/lib/vayrinCandidateConfirmation';

const BRAND = {
  cream: '#F4F2EF',
  charcoal: '#17191E',
  orange: '#FF6A1A',
  muted: '#A7A39D',
  border: '#34363D',
  selected: '#211B18',
};

export const COMPACT_CANDIDATE_PHOTO_HEIGHT = 132;
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
  selectionRole?: 'checkbox' | 'radio';
};

export function CandidateConfirmationCard({
  candidate,
  locality,
  selected = false,
  selectable = false,
  saved = false,
  evidence,
  bestMatch = false,
  onPress,
  onImageResolved,
  compact = false,
  selectionRole = 'radio',
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const broad = isBroadCandidate(candidate);
  const category = candidateCategoryLabel(candidate);
  const matchLabel = candidateMatchLabel(candidate);
  const matchedFrames = candidateMatchedFramesLabel(candidate);
  const conciseEvidence = evidence ?? matchedFrames ?? (!broad ? category : null);
  const whyLines = candidateWhyMatchLines(candidate, locality);
  const actionLabel = selectable ? (selected ? 'Selected' : selectionRole === 'checkbox' ? 'Select' : 'Choose') : null;
  const compactMeta = [
    locality,
    broad ? 'Area match' : matchLabel,
    bestMatch && !broad ? 'Best match' : null,
  ].filter(Boolean).join(' · ');
  const accessibilityLabel = [
    candidate.name,
    locality,
    broad ? 'Area match' : category,
    matchLabel,
    conciseEvidence,
    saved ? 'Already saved; saving will attach this post' : null,
    actionLabel,
  ].filter(Boolean).join(', ');

  const headerContent = (
    <>
        <View style={styles.titleCopy}>
          {!compact ? <View style={styles.badgeRow}>
            {broad ? <Text style={styles.areaLabel}>AREA MATCH</Text> : null}
            {bestMatch && !broad ? <Text style={styles.bestLabel}>BEST MATCH</Text> : null}
          </View> : null}
          <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={compact ? 2 : 3}>{candidate.name}</Text>
          {(compact ? compactMeta : locality) ? (
            <Text style={[styles.locality, compact && styles.localityCompact]} numberOfLines={compact ? 1 : 2}>
              {compact ? compactMeta : locality}
            </Text>
          ) : null}
        </View>
        {selectable ? (
          <View style={[
            selectionRole === 'checkbox' ? styles.checkbox : styles.chooseBadge,
            selected && (selectionRole === 'checkbox' ? styles.checkboxSelected : styles.chooseBadgeSelected),
          ]}>
            {selected ? <Feather name="check" size={16} color="#FFFFFF" /> : null}
            {selectionRole === 'radio' ? (
              <Text style={[styles.chooseText, selected && styles.chooseTextSelected]}>{actionLabel}</Text>
            ) : null}
          </View>
        ) : null}
    </>
  );

  return (
    <View style={[styles.card, compact && styles.cardCompact, selected && styles.cardSelected]}>
      {selectable && onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole={selectionRole}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={selectionRole === 'checkbox' ? 'Toggles this place for saving' : 'Selects this place for saving'}
          accessibilityState={{ checked: selected }}
          style={({ pressed }) => [styles.header, compact && styles.headerCompact, pressed && styles.pressed]}
          testID="candidate-selection-control"
        >
          {headerContent}
        </Pressable>
      ) : (
        <View style={[styles.header, compact && styles.headerCompact]}>{headerContent}</View>
      )}

      <CandidatePhotoCarousel
        googlePlaceId={candidate.googlePlaceId}
        initialPhotoUrls={candidate.photoUrls}
        sourceUri={candidate.photoUrl}
        fallbackSourceUri={candidate.sourceFrameUrl}
        accessibilityLabel={`Photo of ${candidate.name}`}
        onResolvedKind={onImageResolved}
        height={compact ? COMPACT_CANDIDATE_PHOTO_HEIGHT : STANDARD_CANDIDATE_PHOTO_HEIGHT}
      />

      <View style={[styles.evidenceBlock, compact && styles.evidenceBlockCompact]}>
        {broad && !compact ? (
          <Text style={styles.areaDescription}>Vayrin narrowed the video to this area.</Text>
        ) : null}
        {matchLabel && !compact ? (
          <View style={styles.evidenceRow}>
            <Text style={styles.evidenceKey}>Vayrin match</Text>
            <Text style={styles.matchValue}>{matchLabel}</Text>
          </View>
        ) : null}
        {conciseEvidence ? compact ? (
          <Text style={styles.conciseEvidence} numberOfLines={1}>
            {matchedFrames ? 'Video evidence' : broad ? 'Area evidence' : 'Category'}: {conciseEvidence}
          </Text>
        ) : (
          <View style={styles.evidenceRow}>
            <Text style={styles.evidenceKey}>{matchedFrames ? 'Video evidence' : 'Category'}</Text>
            <Text style={styles.evidenceValue}>{conciseEvidence}</Text>
          </View>
        ) : null}

        {whyLines.length > 0 ? (
          <>
            <Pressable
              onPress={() => setExpanded((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel="Why this match?"
              accessibilityState={{ expanded }}
              hitSlop={8}
              style={styles.whyButton}
            >
              <Text style={styles.whyButtonText}>Why this match?</Text>
              <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={BRAND.orange} />
            </Pressable>
            {expanded ? (
              <View style={styles.whyPanel}>
                <Text style={styles.whyTitle}>Why Vayrin thinks this matches</Text>
                {whyLines.map((line) => (
                  <View key={line} style={styles.whyLine}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.whyText}>{line}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
        {saved ? <Text style={styles.saved}>Already on your map · this post will be attached</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden', backgroundColor: BRAND.charcoal, borderRadius: Radius.lg,
    borderWidth: 2, borderColor: BRAND.border, marginBottom: Spacing.lg,
  },
  cardCompact: { marginBottom: Spacing.sm },
  cardSelected: { borderColor: BRAND.orange, backgroundColor: BRAND.selected },
  pressed: { opacity: 0.9 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.md },
  headerCompact: { minHeight: 68, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9 },
  titleCopy: { flex: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: 3 },
  areaLabel: { color: BRAND.orange, fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 0.9 },
  bestLabel: { color: BRAND.cream, fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 0.8 },
  name: { color: BRAND.cream, fontSize: 21, lineHeight: 27, fontWeight: '700' },
  nameCompact: { fontSize: 17, lineHeight: 21 },
  locality: { color: BRAND.muted, fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 3 },
  localityCompact: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  chooseBadge: {
    minHeight: 40, minWidth: 70, paddingHorizontal: Spacing.sm, borderRadius: 20,
    borderWidth: 1, borderColor: BRAND.orange, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 5,
  },
  chooseBadgeSelected: { backgroundColor: BRAND.orange },
  checkbox: {
    width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: BRAND.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: BRAND.orange },
  chooseText: { color: BRAND.orange, fontSize: 13, fontWeight: '800' },
  chooseTextSelected: { color: '#FFFFFF' },
  evidenceBlock: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  evidenceBlockCompact: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 5 },
  areaDescription: { color: BRAND.muted, fontSize: 14, lineHeight: 20, marginBottom: Spacing.sm },
  evidenceRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, marginBottom: 7 },
  evidenceKey: { color: BRAND.muted, fontSize: 13, lineHeight: 19 },
  matchValue: { color: BRAND.cream, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  evidenceValue: { flex: 1, color: BRAND.cream, fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'right' },
  conciseEvidence: { color: BRAND.muted, fontSize: 12, lineHeight: 17, paddingVertical: 4 },
  whyButton: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BRAND.border,
  },
  whyButtonText: { color: BRAND.orange, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  whyPanel: { paddingTop: Spacing.xs, paddingBottom: Spacing.xs },
  whyTitle: { color: BRAND.cream, fontSize: 14, lineHeight: 20, fontWeight: '700', marginBottom: 6 },
  whyLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  bullet: { color: BRAND.orange, fontSize: 16, lineHeight: 20 },
  whyText: { flex: 1, color: BRAND.muted, fontSize: 14, lineHeight: 20 },
  saved: { color: BRAND.orange, fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: Spacing.sm },
});
