/**
 * WrongPlaceSheet — correct a place Nearr resolved incorrectly.
 *
 * Because Nearr now saves confident results automatically, fixing a wrong save
 * has to be trivial. This opens from a low-emphasis "Wrong place?" action on the
 * saved-place details, pre-searches the place's own name, and swaps the provider
 * association in place — preserving the user's note and the original post.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { Input } from '@/components';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { trackEvent } from '@/lib/analytics';
import { usePlacesSearch } from '@/hooks/usePlacesSearch';
import { splitPlaceAddress } from '@/lib/sharePhase1Ui';
import {
  CORRECTION_COPY,
  correctionInitialQuery,
  correctionRejectionMessage,
  planWrongPlaceCorrection,
} from '@/lib/wrongPlaceCorrection';
import { correctSavedPlace } from '@/services/savedPlacesService';
import { updateSavedPlacesCache } from '@/hooks/useSavedPlaces';
import { invalidatePlaceRichDetails } from '@/lib/placeRichDetailsCache';
import type { PlaceCandidate } from '@/services/placesService';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  visible: boolean;
  saved: SavedPlaceWithPlace;
  /** Signed-in user, used for the ownership guard. */
  actingUserId: string | null;
  /** Place name the AI extracted from the post, when known. */
  extractedName?: string | null;
  onClose: () => void;
  onCorrected: (updated: SavedPlaceWithPlace) => void;
};

export function WrongPlaceSheet({
  visible,
  saved,
  actingUserId,
  extractedName,
  onClose,
  onCorrected,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { results, loading, search, reset } = usePlacesSearch();
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const seededRef = useRef(false);

  const initialQuery = useMemo(
    () =>
      correctionInitialQuery({
        extractedName,
        currentName: saved.place.name,
        locality: splitPlaceAddress(saved.place.formatted_address).locality,
      }),
    [extractedName, saved.place.formatted_address, saved.place.name],
  );

  // Search the extracted/current name automatically so the user usually only
  // has to tap the right result.
  useEffect(() => {
    if (!visible) {
      seededRef.current = false;
      reset();
      setQuery('');
      return;
    }
    if (seededRef.current || !initialQuery) return;
    seededRef.current = true;
    setQuery(initialQuery);
    void search(initialQuery);
  }, [visible, initialQuery, search, reset]);

  const apply = useCallback(
    async (candidate: PlaceCandidate) => {
      if (saving) return;
      const plan = planWrongPlaceCorrection(
        {
          savedPlaceId: saved.id,
          ownerUserId: saved.user_id,
          actingUserId: actingUserId ?? '',
          currentGooglePlaceId: saved.place.google_place_id,
          userNote: saved.notes ?? null,
          sourceType: saved.source_type ?? null,
          sourceUrl: saved.source_url ?? null,
          ruleVersion: saved.category_model_version ?? null,
        },
        {
          googlePlaceId: candidate.googlePlaceId,
          name: candidate.name,
          formattedAddress: candidate.formattedAddress,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
        },
      );

      if (!plan.ok) {
        Alert.alert('Could not correct', correctionRejectionMessage(plan.reason));
        return;
      }

      setSaving(true);
      try {
        const updated = await correctSavedPlace({
          savedPlaceId: plan.savedPlaceId,
          replacement: candidate,
          userNote: plan.preserved.userNote,
        });
        // Move the marker and drop stale provider photos immediately.
        updateSavedPlacesCache((rows) =>
          rows.map((row) => (row.id === updated.id ? updated : row)),
        );
        if (saved.place.google_place_id) {
          invalidatePlaceRichDetails(saved.place.google_place_id);
        }
        void trackEvent('saved_place_corrected', {
          original_google_place_id: plan.feedback.originalGooglePlaceId,
          corrected_google_place_id: plan.feedback.correctedGooglePlaceId,
          rule_version: plan.feedback.ruleVersion,
          corrected_at: plan.feedback.correctedAt,
        });
        onCorrected(updated);
        onClose();
      } catch (error) {
        Alert.alert(
          'Could not correct',
          error instanceof Error ? error.message : 'Please try again.',
        );
      } finally {
        setSaving(false);
      }
    },
    [actingUserId, onClose, onCorrected, saved, saving],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={[typography.heading, styles.title]}>{CORRECTION_COPY.title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={[typography.caption, styles.body]}>{CORRECTION_COPY.body}</Text>

          <Input
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void search(query)}
            placeholder="Search for the right place"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.input}
          />

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
              {results.map((candidate) => {
                const current = candidate.googlePlaceId === saved.place.google_place_id;
                const locality = splitPlaceAddress(candidate.formattedAddress).locality;
                return (
                  <Pressable
                    key={candidate.googlePlaceId}
                    onPress={() => void apply(candidate)}
                    disabled={current || saving}
                    style={({ pressed }) => [styles.row, pressed && !current ? styles.rowPressed : null]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: current || saving }}
                    accessibilityLabel={`Use ${candidate.name}`}
                  >
                    <View style={styles.rowMain}>
                      <Text style={[typography.bodyStrong, styles.rowTitle]} numberOfLines={2}>
                        {candidate.name}
                      </Text>
                      {locality ? (
                        <Text style={[typography.caption, styles.rowMeta]} numberOfLines={1}>
                          {locality}
                        </Text>
                      ) : null}
                    </View>
                    {current ? (
                      <Text style={[typography.caption, styles.currentTag]}>Current</Text>
                    ) : (
                      <Feather name="chevron-right" size={18} color={colors.textMuted} />
                    )}
                  </Pressable>
                );
              })}
              {results.length === 0 ? (
                <Text style={[typography.caption, styles.empty]}>
                  Search for the place you meant to save.
                </Text>
              ) : null}
            </ScrollView>
          )}
          {saving ? (
            <View style={styles.savingOverlay}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.modalBackdrop },
    sheet: {
      maxHeight: '78%',
      backgroundColor: colors.bg,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.md,
    },
    handle: {
      alignSelf: 'center',
      width: 38,
      height: 4,
      borderRadius: 2,
      marginTop: Spacing.sm,
      backgroundColor: colors.textMuted,
      opacity: 0.7,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Spacing.md,
    },
    title: { color: colors.text, flex: 1 },
    body: { color: colors.textSecondary, marginTop: Spacing.xs },
    input: { marginTop: Spacing.md },
    loading: { paddingVertical: Spacing.xl, alignItems: 'center' },
    list: { marginTop: Spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowPressed: { opacity: 0.7 },
    rowMain: { flex: 1 },
    rowTitle: { color: colors.text },
    rowMeta: { color: colors.textSecondary, marginTop: 2 },
    currentTag: { color: colors.textMuted },
    empty: { color: colors.textMuted, paddingVertical: Spacing.lg, textAlign: 'center' },
    savingOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.modalBackdrop,
    },
  });
}
