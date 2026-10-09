import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { CandidatePhotoCarousel } from '@/components/CandidatePhotoCarousel';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import type { ShareJobResultCandidate } from '@/lib/shareJobResult';

type Props = {
  candidate: ShareJobResultCandidate;
  meta: string | null;
  selected: boolean;
  alreadySaved: boolean;
  persisted: boolean;
  duplicate: boolean;
  onPress: () => void;
};


/** Compact evidence-first candidate card with an independent native gallery gesture surface. */
export function MultiPlaceCandidateCard({ candidate, meta, selected, alreadySaved, persisted, duplicate, onPress }: Props) {
  const { colors } = useTheme();
  const BRAND = { cream: colors.text, orange: colors.accent, muted: colors.textSecondary, border: colors.border, surface: colors.surface, selected: colors.surfaceElevated };
  const styles = createStyles(BRAND);
  const match = 'Possible match';
  return (
    <View style={[styles.card, selected && styles.cardSelected, persisted && styles.cardPersisted]}>
      <Pressable
        onPress={onPress}
        disabled={persisted}
        accessibilityRole="radio"
        accessibilityLabel={[candidate.name, meta, match, alreadySaved ? 'Already saved; this video will be attached' : null].filter(Boolean).join(', ')}
        accessibilityHint="Selects this candidate for this moment"
        accessibilityState={{ checked: selected, disabled: persisted }}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        testID="candidate-selection-control"
      >
        <View style={styles.copy}>
          <Text style={styles.name} numberOfLines={3}>{candidate.name}</Text>
          {meta ? <Text style={styles.meta} numberOfLines={2}>{meta}</Text> : null}
          {match ? <Text style={styles.match}>{match}</Text> : null}
        </View>
        <View style={[styles.radio, selected && styles.radioSelected]}>
          {selected ? <Feather name="check" size={16} color={colors.onGradient} /> : null}
        </View>
      </Pressable>
      <CandidatePhotoCarousel
        googlePlaceId={candidate.googlePlaceId}
        initialPhotoUrls={candidate.photoUrls?.length
          ? candidate.photoUrls
          : candidate.photoUrl ? [candidate.photoUrl] : undefined}
        fallbackSourceUri={candidate.sourceFrameUrl}
        accessibilityLabel={`Photo of ${candidate.name}`}
        height={132}
        active={selected}
        presentationContext={{ trigger: 'multi_place' }}
      />
      {alreadySaved ? (
        <Pressable onPress={onPress} disabled={persisted} accessible={false} style={({ pressed }) => [styles.statusRow, pressed && styles.pressed]}>
          <Feather name="check-circle" size={15} color={BRAND.orange} />
          <Text style={styles.saved}>{persisted ? 'Already saved · source attached' : 'Already saved · this video will be attached'}</Text>
        </Pressable>
      ) : persisted ? (
        <View style={styles.statusRow}><Feather name="check-circle" size={15} color={BRAND.orange} /><Text style={styles.saved}>Saved</Text></View>
      ) : duplicate ? (
        <Pressable onPress={onPress} accessible={false} style={({ pressed }) => pressed && styles.pressed}>
          <Text style={styles.duplicate}>Same place selected for another moment · saved once</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(BRAND: { cream: string; orange: string; muted: string; border: string; surface: string; selected: string }) { return StyleSheet.create({
  card: { overflow: 'hidden', backgroundColor: BRAND.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: BRAND.border, marginTop: Spacing.sm },
  cardSelected: { borderColor: BRAND.orange, borderWidth: 2, backgroundColor: BRAND.selected },
  cardPersisted: { opacity: 0.92 },
  pressed: { opacity: 0.9 },
  header: { minHeight: 82, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.md },
  copy: { flex: 1 },
  name: { color: BRAND.cream, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  meta: { color: BRAND.muted, fontSize: 13, lineHeight: 18, marginTop: 3 },
  match: { color: BRAND.cream, fontSize: 12, lineHeight: 17, fontWeight: '700', marginTop: 4 },
  radio: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: BRAND.orange, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: '#FF9957' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  saved: { flex: 1, color: BRAND.orange, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  duplicate: { color: BRAND.orange, fontSize: 12, lineHeight: 17, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
}); }
