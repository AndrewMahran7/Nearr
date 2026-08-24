import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PlaceImage, type PlaceImageResolutionKind } from '@/components/PlaceImage';
import { Radius, Spacing } from '@/constants';
import {
  candidateCategoryLabel,
  candidateEvidenceLabel,
  isBroadCandidate,
  type CandidateConfirmationPlace,
} from '@/lib/vayrinCandidateConfirmation';

const BRAND = {
  cream: '#F4F2EF',
  charcoal: '#0F1014',
  orange: '#FF6A1A',
  muted: '#625F5A',
  border: '#DED9D2',
  selected: '#FFF1E8',
};

type Props = {
  candidate: CandidateConfirmationPlace;
  locality?: string | null;
  selected?: boolean;
  selectable?: boolean;
  saved?: boolean;
  evidence?: string | null;
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
  onPress,
  onImageResolved,
  compact = false,
  selectionRole = 'radio',
}: Props) {
  const broad = isBroadCandidate(candidate);
  const category = candidateCategoryLabel(candidate);
  const evidenceLabel = evidence ?? candidateEvidenceLabel(candidate.sourceTimestamps);
  const actionLabel = selectable ? (selected ? 'Selected' : selectionRole === 'checkbox' ? 'Select' : 'Choose') : null;
  const accessibilityLabel = [
    candidate.name,
    locality,
    broad ? 'Area match' : category,
    evidenceLabel,
    saved ? 'Already saved; saving will attach this post' : null,
    actionLabel,
  ].filter(Boolean).join(', ');

  const card = (
    <View style={[
      styles.card,
      selected && styles.cardSelected,
      compact && styles.cardCompact,
    ]}>
      <PlaceImage
        googlePlaceId={candidate.googlePlaceId}
        sourceUri={candidate.photoUrl}
        fallbackSourceUri={candidate.sourceFrameUrl}
        preferPlacePhoto
        width={compact ? 88 : '100%'}
        height={compact ? 88 : 184}
        borderRadius={compact ? 14 : 0}
        style={compact ? styles.compactImageFrame : styles.imageFrame}
        accessibilityLabel={`Photo of ${candidate.name}`}
        onResolvedKind={onImageResolved}
      />
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            {broad ? <Text style={styles.areaLabel}>AREA MATCH</Text> : null}
            <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={compact ? 2 : 3}>{candidate.name}</Text>
          </View>
          {selectable ? (
            <View style={[
              selectionRole === 'checkbox' ? styles.checkbox : styles.chooseBadge,
              selected && (selectionRole === 'checkbox' ? styles.checkboxSelected : styles.chooseBadgeSelected),
            ]}>
              {selected ? <Feather name="check" size={15} color="#FFFFFF" /> : null}
              {selectionRole === 'radio' ? (
                <Text style={[styles.chooseText, selected && styles.chooseTextSelected]}>{actionLabel}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {locality ? <Text style={styles.locality} numberOfLines={2}>{locality}</Text> : null}
        <View style={styles.metaRow}>
          {broad ? null : category ? <Text style={styles.meta}>{category}</Text> : null}
          {evidenceLabel ? <Text style={styles.evidence}>{evidenceLabel}</Text> : null}
        </View>
        {saved ? (
          <Text style={styles.saved}>Already on your map · this post will be attached</Text>
        ) : null}
      </View>
    </View>
  );

  if (!selectable || !onPress) return card;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={selectionRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={selectionRole === 'checkbox' ? 'Toggles this place for saving' : 'Selects this place for saving'}
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {card}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    backgroundColor: BRAND.cream,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: BRAND.border,
    marginBottom: Spacing.md,
  },
  cardSelected: { borderColor: BRAND.orange, borderWidth: 2, backgroundColor: BRAND.selected },
  cardCompact: {
    minHeight: 96,
    marginBottom: Spacing.sm,
    padding: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pressed: { opacity: 0.88 },
  imageFrame: { borderWidth: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BRAND.border },
  compactImageFrame: { borderWidth: 0, flexShrink: 0 },
  copy: { flex: 1, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  titleCopy: { flex: 1 },
  areaLabel: { color: BRAND.orange, fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 0.9, marginBottom: 3 },
  name: { color: BRAND.charcoal, fontSize: 21, lineHeight: 26, fontWeight: '700' },
  nameCompact: { fontSize: 17, lineHeight: 21 },
  locality: { color: BRAND.muted, fontSize: 15, lineHeight: 21, fontWeight: '600', marginTop: 4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  meta: { color: BRAND.muted, fontSize: 13, lineHeight: 18, textTransform: 'capitalize' },
  evidence: { color: BRAND.charcoal, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  chooseBadge: {
    minHeight: 36,
    minWidth: 70,
    paddingHorizontal: Spacing.sm,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BRAND.orange,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  chooseBadgeSelected: { backgroundColor: BRAND.orange },
  checkbox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BRAND.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: BRAND.orange },
  chooseText: { color: BRAND.orange, fontSize: 13, fontWeight: '800' },
  chooseTextSelected: { color: '#FFFFFF' },
  saved: { color: BRAND.orange, fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: Spacing.sm },
});
