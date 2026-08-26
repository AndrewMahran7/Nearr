/** Dedicated provider-correction sheet for an existing saved place. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { Button, Input } from '@/components';
import { PlaceImage } from '@/components/PlaceImage';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { trackEvent } from '@/lib/analytics';
import { usePlacesSearch } from '@/hooks/usePlacesSearch';
import { planOpenOriginal } from '@/lib/openOriginalPost';
import { splitPlaceAddress } from '@/lib/sharePhase1Ui';
import { buildVayrinPresentation } from '@/lib/vayrinPresentation';
import {
  CORRECTION_COPY,
  correctionInitialQuery,
  correctionRejectionMessage,
  correctionResultMode,
  planWrongPlaceCorrection,
  reconcileCorrectedSavedPlaces,
} from '@/lib/wrongPlaceCorrection';
import { correctSavedPlace, rejectSavedPlaceRecognition } from '@/services/savedPlacesService';
import {
  getSavedPlacesCacheSnapshot,
  removeSavedPlaceFromCache,
  restoreSavedPlacesCache,
  updateSavedPlacesCache,
} from '@/hooks/useSavedPlaces';
import { invalidatePlaceRichDetails } from '@/lib/placeRichDetailsCache';
import type { PlaceCandidate } from '@/services/placesService';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  visible: boolean;
  saved: SavedPlaceWithPlace;
  actingUserId: string | null;
  extractedName?: string | null;
  /** Keeps the finder present only when correction was opened directly from a
   * Vayrin result. Ordinary saved-place correction remains Nearr-only. */
  finderMode?: boolean;
  onClose: () => void;
  onCorrected: (updated: SavedPlaceWithPlace) => void;
  onRejected?: (savedPlaceId: string) => void;
};

export function WrongPlaceSheet({
  visible,
  saved,
  actingUserId,
  extractedName,
  finderMode = false,
  onClose,
  onCorrected,
  onRejected,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { results, loading, error, lastQuery, search, reset } = usePlacesSearch();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PlaceCandidate | null>(null);
  const [saving, setSaving] = useState(false);
  const seededRef = useRef(false);

  const initialQuery = useMemo(
    () => correctionInitialQuery({
      extractedName,
      currentName: saved.place.name,
      locality: splitPlaceAddress(saved.place.formatted_address).locality,
    }),
    [extractedName, saved.place.formatted_address, saved.place.name],
  );

  const runSearch = useCallback(async (value: string) => {
    setSelected(null);
    await search(value);
  }, [search]);

  useEffect(() => {
    if (!visible) {
      seededRef.current = false;
      reset();
      setQuery('');
      setSelected(null);
      return;
    }
    if (seededRef.current || !initialQuery) return;
    seededRef.current = true;
    setQuery(initialQuery);
    void runSearch(initialQuery);
  }, [visible, initialQuery, reset, runSearch]);

  const mode = correctionResultMode(lastQuery ?? query, results);
  const strongCandidate = mode === 'strong_single' ? results[0] ?? null : null;
  const chosen = strongCandidate ?? selected;

  const apply = useCallback(async (candidate: PlaceCandidate) => {
    if (saving) return;
    const plan = planWrongPlaceCorrection({
      savedPlaceId: saved.id,
      ownerUserId: saved.user_id,
      actingUserId: actingUserId ?? '',
      currentGooglePlaceId: saved.place.google_place_id,
      userNote: saved.notes ?? null,
      aiNote: saved.ai_note ?? null,
      sourceType: saved.source_type ?? null,
      sourceUrl: saved.source_url ?? null,
      ruleVersion: saved.category_model_version ?? null,
      previousCategory: saved.category ?? null,
      notificationsEnabled: saved.notifications_enabled,
      radiusValue: saved.radius_value,
      radiusUnit: saved.radius_unit,
      createdAt: saved.created_at,
    }, candidate);

    if (!plan.ok) {
      Alert.alert('Could not correct', correctionRejectionMessage(plan.reason));
      return;
    }

    setSaving(true);
    try {
      const result = await correctSavedPlace({
        savedPlaceId: plan.savedPlaceId,
        replacement: candidate,
      });
      updateSavedPlacesCache((rows) => reconcileCorrectedSavedPlaces(
        rows,
        result.saved,
        result.mergedSavedPlaceId,
      ));
      if (saved.place.google_place_id) invalidatePlaceRichDetails(saved.place.google_place_id);
      invalidatePlaceRichDetails(candidate.googlePlaceId);
      void trackEvent('saved_place_corrected', {
        saved_place_id: result.saved.id,
        previous_google_place_id: plan.feedback.originalGooglePlaceId,
        corrected_google_place_id: plan.feedback.correctedGooglePlaceId,
        previous_category: plan.feedback.previousCategory,
        corrected_category: result.saved.category ?? null,
        source_job_id: result.sourceJobId,
        source_result_id: result.sourceResultId,
        corrected_at: plan.feedback.correctedAt,
        gate_version: result.sourceRuleVersion ?? plan.feedback.ruleVersion,
        merged_duplicate: !!result.mergedSavedPlaceId,
      });
      onCorrected(result.saved);
      onClose();
    } catch (caught) {
      Alert.alert('Could not correct', caught instanceof Error ? caught.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [actingUserId, onClose, onCorrected, saved, saving]);

  async function openOriginalPost() {
    const original = planOpenOriginal(saved.source_url);
    if (original.kind !== 'open') {
      Alert.alert('Original post unavailable');
      return;
    }
    try {
      await Linking.openURL(original.url);
    } catch {
      Alert.alert('Could not open the original post');
    }
  }

  function rejectWithoutReplacement() {
    if (saving) return;
    Alert.alert(
      'Mark this result as wrong?',
      'Nearr will remove it and will not silently auto-save this same place for this post again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark as wrong',
          style: 'destructive',
          onPress: async () => {
            const snapshot = getSavedPlacesCacheSnapshot();
            setSaving(true);
            removeSavedPlaceFromCache(saved.id);
            try {
              const sourceCount = await rejectSavedPlaceRecognition(saved.id);
              void trackEvent('user_rejected_recognition', {
                saved_place_id: saved.id,
                source_count: sourceCount,
                reason: 'wrong_place',
              });
              onRejected?.(saved.id);
              onClose();
            } catch (caught) {
              restoreSavedPlacesCache(snapshot);
              Alert.alert('Could not mark as wrong', caught instanceof Error ? caught.message : 'Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  }

  const finderPresentation = finderMode
    ? buildVayrinPresentation({ kind: 'correcting', source: 'async' })
    : null;
  const title = finderPresentation
    ? finderPresentation.headline
    : mode === 'strong_single' ? 'Is this the right place?' : 'Which place is it?';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close place correction"
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          {finderMode ? (
            <View style={styles.finderLabel} accessible accessibilityLabel="Vayrin correction">
              <View style={styles.finderRule} />
              <Text style={styles.finderLabelText}>VAYRIN</Text>
            </View>
          ) : null}
          <View style={styles.header}>
            <Text style={[typography.heading, styles.title]}>{title}</Text>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close place correction"
            >
              <Feather name="x" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={[typography.caption, styles.body]}>
            {finderPresentation?.body ?? CORRECTION_COPY.body}
          </Text>

          <Input
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void runSearch(query)}
            placeholder="Search for the right place"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.input}
            accessibilityLabel="Search for the correct place"
          />

          {loading ? (
            <View style={styles.loading} accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.primary} />
              <Text style={[typography.caption, styles.loadingText]}>Searching places…</Text>
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              contentContainerStyle={styles.listContent}
            >
              {results.map((candidate) => {
                const current = candidate.googlePlaceId === saved.place.google_place_id;
                const isSelected = chosen?.googlePlaceId === candidate.googlePlaceId;
                const locality = splitPlaceAddress(candidate.formattedAddress).locality;
                return (
                  <Pressable
                    key={candidate.googlePlaceId}
                    onPress={() => setSelected(candidate)}
                    disabled={current || saving || mode === 'strong_single'}
                    style={({ pressed }) => [
                      styles.row,
                      isSelected ? styles.rowSelected : null,
                      pressed && !current ? styles.rowPressed : null,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{
                      disabled: current || saving || mode === 'strong_single',
                      checked: isSelected,
                    }}
                    accessibilityLabel={`Choose ${candidate.name} as the correct place${locality ? `, ${locality}` : ''}`}
                    accessibilityHint={current ? 'This is the current place' : 'Choose this provider result'}
                  >
                    <PlaceImage googlePlaceId={candidate.googlePlaceId} size={56} borderRadius={10} />
                    <View style={styles.rowMain}>
                      <Text style={[typography.bodyStrong, styles.rowTitle]} numberOfLines={2}>
                        {candidate.name}
                      </Text>
                      {locality ? <Text style={[typography.caption, styles.rowMeta]}>{locality}</Text> : null}
                      {candidate.formattedAddress ? (
                        <Text style={[typography.caption, styles.rowAddress]} numberOfLines={2}>
                          {candidate.formattedAddress}
                        </Text>
                      ) : null}
                    </View>
                    {current ? (
                      <Text style={[typography.caption, styles.currentTag]}>Current</Text>
                    ) : isSelected ? (
                      <Feather name="check-circle" size={20} color={colors.primary} />
                    ) : (
                      <Feather name="circle" size={20} color={colors.textMuted} />
                    )}
                  </Pressable>
                );
              })}

              {!loading && results.length === 0 && lastQuery ? (
                <View style={styles.empty} accessibilityLiveRegion="polite">
                  <Text style={[typography.bodyStrong, styles.emptyTitle]}>
                    {error ? 'Could not search places' : 'No places found'}
                  </Text>
                  <Text style={[typography.caption, styles.emptyBody]}>
                    Edit the search above and try again.
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          )}

          {chosen && chosen.googlePlaceId !== saved.place.google_place_id ? (
            <Button
              title="Use this place"
              onPress={() => void apply(chosen)}
              loading={saving}
              style={styles.primaryButton}
            />
          ) : null}
          <Button
            title="Search again"
            variant="secondary"
            onPress={() => void runSearch(query)}
            disabled={loading || !query.trim()}
            style={styles.secondaryButton}
          />
          <Button
            title="This isn’t the place"
            variant="ghost"
            onPress={rejectWithoutReplacement}
            disabled={saving}
            style={styles.sourceButton}
          />
          {planOpenOriginal(saved.source_url).kind === 'open' ? (
            <Button
              title="Open original post"
              variant="ghost"
              onPress={() => void openOriginalPost()}
              style={styles.sourceButton}
            />
          ) : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.modalBackdrop },
    sheet: {
      maxHeight: '88%',
      backgroundColor: colors.bg,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.md,
    },
    handle: {
      alignSelf: 'center', width: 38, height: 4, borderRadius: 2,
      marginTop: Spacing.sm, backgroundColor: colors.textMuted, opacity: 0.7,
    },
    finderLabel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
    finderRule: { width: 18, height: 3, borderRadius: 2, backgroundColor: '#FF6A1A' },
    finderLabelText: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
    header: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.sm },
    title: { color: colors.text, flex: 1 },
    closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    body: { color: colors.textSecondary },
    input: { marginTop: Spacing.md },
    loading: { paddingVertical: Spacing.xl, alignItems: 'center', gap: Spacing.sm },
    loadingText: { color: colors.textSecondary },
    list: { marginTop: Spacing.sm, flexShrink: 1 },
    listContent: { paddingBottom: Spacing.sm },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      minHeight: 88, paddingVertical: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    rowSelected: { backgroundColor: colors.surfaceElevated },
    rowPressed: { opacity: 0.72 },
    rowMain: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.text },
    rowMeta: { color: colors.textSecondary, marginTop: 2 },
    rowAddress: { color: colors.textMuted, marginTop: 2, lineHeight: 17 },
    currentTag: { color: colors.textMuted },
    empty: { alignItems: 'center', paddingVertical: Spacing.xl },
    emptyTitle: { color: colors.text },
    emptyBody: { color: colors.textSecondary, marginTop: Spacing.xs },
    primaryButton: { marginTop: Spacing.sm, minHeight: 44 },
    secondaryButton: { marginTop: Spacing.sm, minHeight: 44 },
    sourceButton: { marginTop: Spacing.xs, minHeight: 44 },
  });
}
