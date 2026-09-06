import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Screen } from '@/components';
import { Spacing } from '@/constants';
import { useAuth } from '@/hooks/useAuth';
import { trackEvent } from '@/lib/analytics';
import { planOpenOriginal } from '@/lib/openOriginalPost';
import {
  cleanReferralId,
  getOwnedSaveForPublicPlace,
  loadPublicPlace,
  saveSharedPlace,
  validPublicPlaceId,
  type OwnedSavedPlaceSummary,
  type PublicPlace,
} from '@/lib/publicPlace';
import {
  clearPendingSharedPlaceIntent,
  getPendingSharedPlaceIntent,
  persistSharedPlaceIntent,
  rememberSharedPlaceAcquisition,
} from '@/lib/sharedPlaceIntent';
import { useTheme } from '@/lib/theme';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function SharedPlaceScreen() {
  const params = useLocalSearchParams<{
    publicPlaceId?: string | string[];
    ref?: string | string[];
    action?: string | string[];
  }>();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const requestedId = firstParam(params.publicPlaceId).toLowerCase();
  const referralId = cleanReferralId(firstParam(params.ref));
  const saveRequested = firstParam(params.action) === 'save';
  const permanentSession = !!session && session.user.is_anonymous !== true;

  const [place, setPlace] = useState<PublicPlace | null>(null);
  const [ownedSave, setOwnedSave] = useState<OwnedSavedPlaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'not_found' | 'unavailable' | null>(null);
  const routedToAuthRef = useRef(false);
  const autoSaveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPlace(null);
    if (!validPublicPlaceId(requestedId)) {
      setError('not_found');
      setLoading(false);
      return () => { cancelled = true; };
    }
    void loadPublicPlace(requestedId, referralId)
      .then((next) => {
        if (!cancelled) setPlace(next);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error && reason.message === 'place_not_found' ? 'not_found' : 'unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [referralId, requestedId]);

  const refreshOwnedSave = useCallback(async (publicPlaceId: string) => {
    if (!permanentSession) {
      setOwnedSave(null);
      return null;
    }
    try {
      const existing = await getOwnedSaveForPublicPlace(publicPlaceId);
      setOwnedSave(existing);
      return existing;
    } catch {
      return null;
    }
  }, [permanentSession]);

  useEffect(() => {
    if (!place || authLoading) return;
    void refreshOwnedSave(place.publicId);
  }, [authLoading, place, refreshOwnedSave, session?.user.id]);

  const requestAuthentication = useCallback(async () => {
    if (!place || routedToAuthRef.current) return;
    routedToAuthRef.current = true;
    void trackEvent('shared_place_save_cta', {
      public_place_id: place.publicId,
      referral_id: referralId,
      authenticated: false,
    });
    await persistSharedPlaceIntent({
      publicPlaceId: place.publicId,
      referralId,
      placeName: place.name,
      authRequired: true,
    });
    router.push('/(onboarding)/account');
  }, [place, referralId, router]);

  const performSave = useCallback(async () => {
    if (!place || saving) return;
    if (!permanentSession) {
      await requestAuthentication();
      return;
    }
    setSaving(true);
    void trackEvent('shared_place_save_cta', {
      public_place_id: place.publicId,
      referral_id: referralId,
      authenticated: true,
    });
    try {
      const pending = await getPendingSharedPlaceIntent();
      const result = await saveSharedPlace(place.publicId, referralId);
      // The save RPC may have restored a server-authoritative shared source.
      // Re-read the owned row so Original video is available immediately;
      // the public place response itself remains intentionally source-free.
      const restored = await getOwnedSaveForPublicPlace(result.publicPlaceId).catch(() => null);
      setOwnedSave(restored ?? { id: result.savedPlaceId, sourceUrl: null });
      if (pending?.authRequired) {
        void trackEvent('shared_link_signup', {
          public_place_id: result.publicPlaceId,
          referral_id: referralId,
        });
      }
      if (result.created && pending?.authRequired) {
        void trackEvent('shared_link_first_save', {
          public_place_id: result.publicPlaceId,
          referral_id: referralId,
        });
      }
      await rememberSharedPlaceAcquisition(referralId);
      await clearPendingSharedPlaceIntent();
    } catch {
      Alert.alert('Could not save this place', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [permanentSession, place, referralId, requestAuthentication, saving]);

  useEffect(() => {
    if (!saveRequested || !place || authLoading || autoSaveRef.current) return;
    autoSaveRef.current = true;
    if (permanentSession) {
      void performSave();
    } else {
      void requestAuthentication();
    }
  }, [authLoading, performSave, permanentSession, place, requestAuthentication, saveRequested]);

  const original = planOpenOriginal(ownedSave?.sourceUrl);
  const location = [place?.locality, place?.region, place?.country].filter(Boolean).join(', ');

  if (loading || authLoading) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[typography.body, styles.loadingText]}>Opening place…</Text>
      </Screen>
    );
  }

  if (!place || error) {
    return (
      <Screen style={styles.center}>
        <View style={styles.iconCircle}>
          <Feather name="map-pin" size={25} color={colors.primary} />
        </View>
        <Text style={[typography.heading, styles.errorTitle]}>
          {error === 'not_found' ? "This place isn't here" : 'This place is unavailable'}
        </Text>
        <Text style={[typography.body, styles.muted]}>The link may be incomplete, or the place may have moved.</Text>
        <Button title="Back to Nearr" onPress={() => router.replace('/')} style={styles.fullButton} />
      </Screen>
    );
  }

  const openDirections = () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
    void Linking.openURL(url);
  };
  const openOriginal = () => {
    if (original.kind !== 'open') return;
    void trackEvent('shared_place_original_video_opened', { public_place_id: place.publicId });
    void Linking.openURL(original.url);
  };
  const openSaved = () => {
    if (!ownedSave) return;
    router.replace({ pathname: '/(tabs)/map', params: { savedPlaceId: ownedSave.id } });
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroGlow} />
          <View style={styles.pinOuter}>
            <Ionicons name="location" size={42} color={colors.primary} />
          </View>
          <Text style={styles.brand}>NEARR PLACE</Text>
        </View>

        <View style={styles.card}>
          <Text style={[typography.heading, styles.title]}>{place.name}</Text>
          <Text style={[typography.body, styles.location]}>
            {location || place.displayAddress || 'Saved on Nearr'}
          </Text>
          {place.placeType || place.category ? (
            <View style={styles.pill}>
              <Text style={styles.pillText}>{place.placeType ?? place.category}</Text>
            </View>
          ) : null}
          {place.displayAddress ? (
            <Pressable onPress={openDirections} style={styles.addressRow} accessibilityRole="link">
              <Feather name="navigation" size={17} color={colors.primary} />
              <Text style={[typography.body, styles.address]}>{place.displayAddress}</Text>
            </Pressable>
          ) : null}

          <Text style={[typography.body, styles.promise]}>
            Save places you find online and remember them on your map.
          </Text>

          <Button
            title={ownedSave ? 'Saved' : 'Save to my map'}
            onPress={ownedSave ? openSaved : () => void performSave()}
            loading={saving}
            style={styles.fullButton}
          />
          {ownedSave ? (
            <Button title="View on my map" variant="secondary" onPress={openSaved} style={styles.fullButton} />
          ) : null}
          {original.kind === 'open' ? (
            <Button title="Original video" variant="ghost" onPress={openOriginal} style={styles.fullButton} />
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    center: { alignItems: 'center', justifyContent: 'center', gap: 14 },
    loadingText: { color: colors.textSecondary },
    content: { padding: Spacing.lg, paddingBottom: 48 },
    hero: {
      height: 220,
      borderRadius: 28,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroGlow: {
      position: 'absolute',
      width: 220,
      height: 220,
      borderRadius: 110,
      backgroundColor: colors.accentSoft,
    },
    pinOuter: {
      width: 92,
      height: 92,
      borderRadius: 46,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    brand: { marginTop: 18, color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
    card: { paddingTop: 26, gap: 14 },
    title: { color: colors.text, fontSize: 30, lineHeight: 36 },
    location: { color: colors.textSecondary, fontSize: 16 },
    pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.accentSoft },
    pillText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
    addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
    address: { flex: 1, color: colors.text, lineHeight: 22 },
    promise: { color: colors.textSecondary, lineHeight: 23, marginTop: 4 },
    fullButton: { alignSelf: 'stretch' },
    iconCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    errorTitle: { color: colors.text, textAlign: 'center' },
    muted: { color: colors.textSecondary, textAlign: 'center', maxWidth: 320, lineHeight: 22 },
  });
}
