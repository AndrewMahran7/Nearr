import { useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components';
import { Radius, Spacing } from '@/constants';
import { CATEGORY_LABELS } from '@/lib/placeCategory';
import { formatNearbyDistance } from '@/lib/alsoNearby';
import { openExternalMaps } from '@/lib/externalMaps';
import { useTheme } from '@/lib/theme';
import type { PlaceRecommendation } from '@/lib/placeRecommendations';

type Props = {
  recommendation: PlaceRecommendation | null;
  onClose: () => void;
  onSave?: (recommendation: PlaceRecommendation) => Promise<boolean>;
};

/**
 * Read-only detail for an unsaved recommendation. Opening this view never
 * saves; the only mutation is the explicit "Save place" button.
 */
export function RecommendedPlaceDetails({ recommendation, onClose, onSave }: Props) {
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const [saving, setSaving] = useState(false);

  if (!recommendation) return null;

  const handleSave = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    try {
      const saved = await onSave(recommendation);
      if (saved) onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDirections = () => {
    void openExternalMaps({
      google_maps_url: recommendation.googleMapsUrl,
      google_place_id: recommendation.googlePlaceId,
      latitude: recommendation.latitude,
      longitude: recommendation.longitude,
      name: recommendation.name,
      formatted_address: recommendation.formattedAddress,
    });
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: Math.max(insets.top, Spacing.md) }]}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Back to saved place"
            hitSlop={10}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Feather name="chevron-down" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Nearby place</Text>
          <View style={styles.iconButton} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            {recommendation.photoUrl ? (
              <Image source={{ uri: recommendation.photoUrl }} style={styles.heroImage} resizeMode="cover" />
            ) : (
              <View style={styles.heroFallback}>
                <Feather name="map-pin" size={44} color={colors.accent} />
              </View>
            )}
          </View>

          <View style={styles.copy}>
            <Text accessibilityRole="header" style={styles.name}>{recommendation.name}</Text>
            <Text style={styles.meta}>
              {CATEGORY_LABELS[recommendation.nearrCategory]}
              {' · '}
              {formatNearbyDistance(recommendation.distanceMeters)} away
            </Text>
            {recommendation.formattedAddress ? (
              <Text style={styles.address}>{recommendation.formattedAddress}</Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            <Button title="Directions" variant="secondary" onPress={handleDirections} style={styles.action} />
            {onSave ? (
              <Button
                title="Save place"
                onPress={() => void handleSave()}
                loading={saving}
                disabled={saving}
                style={styles.action}
              />
            ) : null}
          </View>
          <Text style={styles.disclaimer}>Not saved until you choose Save place.</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.md,
    },
    headerTitle: { ...typography.bodyStrong, color: colors.text },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.65 },
    content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xl * 2 },
    hero: {
      height: 260,
      overflow: 'hidden',
      borderRadius: Radius.lg,
      backgroundColor: colors.surfaceElevated,
    },
    heroImage: { width: '100%', height: '100%' },
    heroFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    copy: { gap: Spacing.xs },
    name: { ...typography.title, color: colors.text },
    meta: { ...typography.bodyStrong, color: colors.accent },
    address: { ...typography.body, color: colors.textSecondary },
    actions: { flexDirection: 'row', gap: Spacing.sm },
    action: { flex: 1 },
    disclaimer: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  });
}
