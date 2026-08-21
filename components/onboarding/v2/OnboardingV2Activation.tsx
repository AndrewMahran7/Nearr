import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { ImmersiveGuidedSave } from '@/components/onboarding/v2/ImmersiveGuidedSave';
import { Phase1Colors, Phase1Frame, Phase1PrimaryButton } from '@/components/onboarding/v2/Phase1Visuals';
import { platformLabel, starterContentById } from '@/constants/onboardingStarterContent';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { hapticSelection, hapticSuccess } from '@/lib/haptics';
import {
  advanceOnboardingV2SimulatedTutorial,
  goBackOnboardingV2,
  saveOnboardingV2TutorialPlace,
} from '@/lib/onboardingV2';
import type { OnboardingV2Stage } from '@/lib/onboardingV2Core';

const LEARN_PROGRESS: Partial<Record<OnboardingV2Stage, number>> = {
  tutorial_processing: 0.9,
  tutorial_result_seen: 1,
};

export function OnboardingV2Activation() {
  const router = useRouter();
  const { state } = useOnboardingV2();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const content = starterContentById(state?.tutorialContentId);
  const stage = state?.stage;
  const contentId = content?.id;
  const sourceUrl = content?.sourceUrl;
  const actionInput = contentId && sourceUrl ? { contentId, sourceUrl } : null;

  useEffect(() => {
    if (stage !== 'tutorial_processing' || !contentId || !sourceUrl) return;
    const timer = setTimeout(() => {
      hapticSuccess();
      void advanceOnboardingV2SimulatedTutorial('result', { contentId, sourceUrl });
    }, 1800);
    return () => clearTimeout(timer);
  }, [contentId, sourceUrl, stage]);

  if (!state || !stage || !content || !actionInput) {
    return (
      <Phase1Frame onBack={() => router.replace('/(onboarding)')}>
        <Text style={styles.eyebrow}>SAVE PAUSED</Text>
        <Text style={styles.headline}>Choose a new post to continue.</Text>
      </Phase1Frame>
    );
  }

  const selectedPlatform = state.preferredPlatform && state.preferredPlatform !== 'other'
    ? state.preferredPlatform
    : 'instagram';
  const platform = platformLabel(selectedPlatform);
  const progress = LEARN_PROGRESS[stage] ?? 0.9;
  const goBack = () => {
    hapticSelection();
    void goBackOnboardingV2();
  };
  const advance = (action: 'share' | 'more' | 'nearr' | 'favorite' | 'process') => {
    hapticSelection();
    void advanceOnboardingV2SimulatedTutorial(action, actionInput);
  };

  async function savePlace() {
    if (saving || !content) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveOnboardingV2TutorialPlace(content);
      hapticSuccess();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The place could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (stage === 'tutorial_processing') {
    return (
      <Phase1Frame onBack={goBack} progress={progress} progressLabel="Vayrin is finding the place" scroll={false} contentStyle={styles.processingContent}>
        <View style={styles.finderVisual} accessible accessibilityLabel="Vayrin is matching the post to the map">
          <View style={styles.finderOrbitLarge} />
          <View style={styles.finderOrbitSmall} />
          <View style={styles.finderTrace} />
          <View style={styles.finderSource}><Feather name="send" size={19} color="#FFFFFF" /></View>
          <View style={styles.finderPin}><Feather name="map-pin" size={28} color={Phase1Colors.onOrange} /></View>
          <ActivityIndicator style={styles.finderSpinner} color={Phase1Colors.orange} />
        </View>
        <View accessibilityLiveRegion="polite" style={styles.processingCopy}>
          <Text style={styles.eyebrow}>VAYRIN</Text>
          <Text style={[styles.headline, styles.centerText]}>Finding the place</Text>
          <Text style={[styles.body, styles.centerText]}>Turning that post into a place on your map.</Text>
        </View>
      </Phase1Frame>
    );
  }

  if (stage === 'tutorial_result_seen') {
    const placeName = content.targetPlace?.name ?? content.knownPlace?.name ?? content.title;
    const shortAddress = content.targetPlace?.shortFormattedAddress ?? content.knownPlace?.locality ?? 'Location matched';
    const fullAddress = content.targetPlace?.formattedAddress ?? shortAddress;
    const streetAddress = fullAddress.split(',')[0]?.trim() || shortAddress;
    const locality = content.knownPlace?.locality ?? shortAddress;
    return (
      <Phase1Frame onBack={goBack} progress={progress} progressLabel="Place found" footer={<Phase1PrimaryButton title="Save to my map" onPress={() => void savePlace()} loading={saving} />}>
        <FoundPlaceHero name={placeName} locality={locality} />
        <View style={styles.resultCopy} accessibilityLiveRegion="polite">
          <Text style={styles.eyebrow}>MATCHED BY VAYRIN</Text>
          <Text style={styles.resultHeadline}>{placeName}</Text>
          <View style={styles.addressLine}>
            <Feather name="map-pin" size={16} color={Phase1Colors.orange} />
            <View style={styles.addressCopy}><Text style={styles.addressText}>{streetAddress}</Text><Text style={styles.addressLocality}>{locality}</Text></View>
          </View>
        </View>
        {saveError ? <Text style={styles.error}>{saveError} Try again.</Text> : null}
      </Phase1Frame>
    );
  }

  if (
    stage === 'tutorial_ready' ||
    stage === 'tutorial_share_tapped' ||
    stage === 'tutorial_more_tapped' ||
    stage === 'tutorial_nearr_selected' ||
    stage === 'tutorial_favorite_added'
  ) {
    return <ImmersiveGuidedSave stage={stage} platform={platform} interest={state.interest ?? 'anything'} title={content.title} onBack={goBack} onAdvance={advance} />;
  }

  return null;
}

function FoundPlaceHero({ name, locality }: { name: string; locality: string }) {
  return (
    <View style={styles.foundHero} accessible accessibilityLabel={`Place found: ${name}, ${locality}`}>
      <View style={styles.heroGlow} />
      <View style={styles.heroPlate} />
      <View style={styles.heroBun} />
      <View style={styles.heroEgg} />
      <View style={styles.heroYolk} />
      <View style={styles.heroBase} />
      <View style={styles.foundBadge}><Feather name="check" size={13} color={Phase1Colors.onOrange} /><Text style={styles.foundBadgeText}>FOUND</Text></View>
      <View style={styles.foundCard}><Text style={styles.foundCardName} numberOfLines={1}>{name}</Text><Text style={styles.foundCardLocality} numberOfLines={1}>{locality}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.7, marginBottom: 9 },
  headline: { color: Phase1Colors.text, fontSize: 31, lineHeight: 35, fontWeight: '900', letterSpacing: -0.9 },
  body: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 22, marginTop: 10 },
  centerText: { textAlign: 'center' },
  processingContent: { alignItems: 'center', justifyContent: 'center', paddingBottom: 58 },
  processingCopy: { alignItems: 'center', marginTop: 34 },
  finderVisual: { width: 250, height: 250, alignItems: 'center', justifyContent: 'center' },
  finderOrbitLarge: { position: 'absolute', width: 226, height: 226, borderRadius: 113, borderWidth: 1, borderColor: '#3C3027' },
  finderOrbitSmall: { position: 'absolute', width: 146, height: 146, borderRadius: 73, borderWidth: 1, borderColor: '#59402F' },
  finderTrace: { position: 'absolute', width: 115, borderTopWidth: 2, borderStyle: 'dashed', borderColor: Phase1Colors.orange, transform: [{ rotate: '-31deg' }] },
  finderSource: { position: 'absolute', left: 30, top: 49, width: 47, height: 47, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A2926', borderWidth: 1, borderColor: '#4B4842' },
  finderPin: { width: 68, height: 68, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange },
  finderSpinner: { position: 'absolute', right: 38, bottom: 48 },
  resultCopy: { marginTop: 24 },
  resultHeadline: { color: Phase1Colors.text, fontSize: 34, lineHeight: 37, fontWeight: '900', letterSpacing: -1 },
  addressLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 12 },
  addressCopy: { flex: 1 },
  addressText: { color: Phase1Colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  addressLocality: { color: Phase1Colors.textMuted, fontSize: 14, lineHeight: 20 },
  error: { color: '#FF8B82', fontSize: 13, lineHeight: 19, marginTop: 14 },
  foundHero: { height: 400, borderRadius: 29, overflow: 'hidden', backgroundColor: '#8D4828', borderWidth: 1, borderColor: '#6A3E2A' },
  heroGlow: { position: 'absolute', width: 420, height: 420, borderRadius: 210, top: -90, left: -80, backgroundColor: '#DB8B50' },
  heroPlate: { position: 'absolute', width: 315, height: 165, borderRadius: 158, left: 8, top: 105, backgroundColor: '#F2DFBF', borderWidth: 10, borderColor: '#D2B58C', transform: [{ rotate: '-7deg' }] },
  heroBun: { position: 'absolute', width: 215, height: 86, borderTopLeftRadius: 108, borderTopRightRadius: 108, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, left: 57, top: 115, backgroundColor: '#E6A14D', borderBottomWidth: 7, borderBottomColor: '#B96C2D', transform: [{ rotate: '-7deg' }] },
  heroEgg: { position: 'absolute', width: 210, height: 47, borderRadius: 24, left: 61, top: 188, backgroundColor: '#FFF3D7', transform: [{ rotate: '-7deg' }] },
  heroYolk: { position: 'absolute', width: 57, height: 48, borderRadius: 25, left: 136, top: 187, backgroundColor: '#F6A313' },
  heroBase: { position: 'absolute', width: 210, height: 55, borderRadius: 26, left: 61, top: 225, backgroundColor: '#BD6D30', borderTopWidth: 8, borderTopColor: '#754021', transform: [{ rotate: '-7deg' }] },
  foundBadge: { position: 'absolute', top: 16, left: 16, minHeight: 34, paddingHorizontal: 11, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Phase1Colors.orange },
  foundBadgeText: { color: Phase1Colors.onOrange, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  foundCard: { position: 'absolute', left: 15, right: 15, bottom: 15, minHeight: 82, justifyContent: 'center', paddingHorizontal: 17, borderRadius: 20, backgroundColor: 'rgba(10,9,8,0.86)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)' },
  foundCardName: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  foundCardLocality: { color: '#D3CBC2', fontSize: 12, fontWeight: '700', marginTop: 5 },
});
