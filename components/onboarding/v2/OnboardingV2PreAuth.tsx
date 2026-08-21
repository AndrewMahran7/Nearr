import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import {
  Phase1Colors,
  Phase1Frame,
  Phase1PrimaryButton,
} from '@/components/onboarding/v2/Phase1Visuals';
import { platformLabel, selectTutorialContent } from '@/constants/onboardingStarterContent';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { bootstrapAnonymousOnboarding } from '@/lib/anonymousOnboarding';
import { personalizedSavePrompt } from '@/lib/onboardingV2ImmersiveCore';
import {
  continueOnboardingV2ToTutorial,
  goBackOnboardingV2,
  recordOnboardingV2GetStarted,
  setOnboardingV2Interest,
  setOnboardingV2Platform,
} from '@/lib/onboardingV2';
import type { OnboardingInterest, OnboardingPlatform } from '@/lib/onboardingV2Core';

const PLATFORMS: Array<{
  value: Exclude<OnboardingPlatform, 'other'>;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  tint: string;
}> = [
  { value: 'instagram', label: 'Instagram', icon: 'instagram', tint: '#F173AE' },
  { value: 'tiktok', label: 'TikTok', icon: 'music', tint: '#63E6DF' },
  { value: 'youtube', label: 'YouTube', icon: 'play', tint: '#FF5D5D' },
  { value: 'facebook', label: 'Facebook', icon: 'facebook', tint: '#76A8FF' },
];

const PLATFORM_ROWS = [PLATFORMS.slice(0, 2), PLATFORMS.slice(2, 4)];

const INTERESTS: Array<{
  value: OnboardingInterest;
  label: string;
  detail: string;
  icon: keyof typeof Feather.glyphMap;
  tone: string;
  accent: string;
  wide?: boolean;
}> = [
  { value: 'food', label: 'Food', detail: 'Tables worth the trip', icon: 'coffee', tone: '#5A2D1D', accent: '#E58A4D', wide: true },
  { value: 'outdoors', label: 'Outdoors', detail: 'Trails and wild places', icon: 'sun', tone: '#18352E', accent: '#75A98D' },
  { value: 'travel', label: 'Travel', detail: 'For the next getaway', icon: 'navigation', tone: '#22324A', accent: '#718DB9' },
  { value: 'beaches', label: 'Beaches', detail: 'A better stretch of coast', icon: 'wind', tone: '#26424A', accent: '#73B2BD', wide: true },
  { value: 'anything', label: 'Anything cool', detail: 'Surprise me', icon: 'compass', tone: '#3D3025', accent: '#C99B65', wide: true },
];

export function OnboardingV2PreAuth() {
  const { state, loading } = useOnboardingV2();
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const bootstrapInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (
      loading ||
      bootstrapInFlightRef.current ||
      bootstrapError ||
      (state?.cohort === 'new_user_v2' && state.identityLifecycle === 'anonymous_active')
    ) return;
    bootstrapInFlightRef.current = true;
    setBootstrapping(true);
    void bootstrapAnonymousOnboarding().then((result) => {
      if (!mountedRef.current) return;
      if (result.kind === 'failed') setBootstrapError(result.reason);
    }).catch((error) => {
      if (mountedRef.current) {
        setBootstrapError(error instanceof Error ? error.message : 'anonymous_setup_failed');
      }
    }).finally(() => {
      bootstrapInFlightRef.current = false;
      if (mountedRef.current) setBootstrapping(false);
    });
  }, [bootstrapError, loading, state?.cohort, state?.identityLifecycle]);

  if (!state || loading || bootstrapping) return <View style={styles.loading} />;

  if (bootstrapError) {
    return (
      <Phase1Frame footer={<Phase1PrimaryButton title="Try again" onPress={() => setBootstrapError(null)} />}>
        <Text style={styles.eyebrow}>CONNECTION PAUSED</Text>
        <Text style={styles.headline}>We could not open your private map.</Text>
        <Text style={styles.body}>Check your connection and try again.</Text>
      </Phase1Frame>
    );
  }

  if (state.stage === 'overview') {
    return (
      <Phase1Frame
        footer={<Phase1PrimaryButton title="Try a save" onPress={() => void recordOnboardingV2GetStarted()} />}
        contentStyle={styles.welcomeContent}
      >
        <WelcomeProductHero />
        <Text style={styles.welcomeHeadline}>Spot it. Save it. Go.</Text>
        <Text style={styles.welcomeBody}>Share a place from social. Nearr puts it on your map.</Text>
      </Phase1Frame>
    );
  }

  if (state.stage === 'platform') {
    return (
      <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.14} progressLabel="Choose a source">
        <Text style={styles.eyebrow}>PICK A SOURCE</Text>
        <Text style={styles.headline}>Where do you find places?</Text>
        <View style={styles.platformGrid}>
          {PLATFORM_ROWS.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.platformRow}>
              {row.map((option) => (
                <Pressable
                  key={option.value}
                  disabled={option.value !== 'instagram'}
                  onPress={() => void setOnboardingV2Platform(option.value)}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityHint="Uses this app for the guided example"
                  accessibilityState={{
                    selected: state.preferredPlatform === option.value,
                    disabled: option.value !== 'instagram',
                  }}
                  style={({ pressed }) => [
                    styles.platformChoice,
                    state.preferredPlatform === option.value && styles.selectedChoice,
                    option.value !== 'instagram' && styles.upcomingChoice,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.platformIcon, { backgroundColor: option.tint }]}>
                    <Feather name={option.icon} size={22} color="#11110F" />
                  </View>
                  <Text style={styles.platformLabel} numberOfLines={1}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
        <View style={styles.sourceHint}>
          <Feather name="send" size={17} color={Phase1Colors.orange} />
          <Text style={styles.sourceHintText}>You will practice the same Share action you already know.</Text>
        </View>
      </Phase1Frame>
    );
  }

  if (state.stage === 'interest') {
    return (
      <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.27} progressLabel="Choose a category">
        <Text style={styles.eyebrow}>MAKE IT YOURS</Text>
        <Text style={styles.headline}>What catches your eye?</Text>
        <View style={styles.interestGrid}>
          {INTERESTS.map((option) => (
            <InterestTile
              key={option.value}
              {...option}
              onPress={() => {
                const tutorial = selectTutorialContent(state.preferredPlatform, option.value);
                void setOnboardingV2Interest(option.value, tutorial?.id ?? null);
              }}
            />
          ))}
        </View>
      </Phase1Frame>
    );
  }

  if (state.stage === 'interest_selected') {
    const tutorial = selectTutorialContent(state.preferredPlatform, state.interest);
    if (!tutorial) {
      return (
        <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.38} progressLabel="Choose a practice post">
          <Text style={styles.headline}>Choose another category.</Text>
          <Text style={styles.body}>That practice post is not available right now.</Text>
        </Phase1Frame>
      );
    }
    const shellPlatform = state.preferredPlatform && state.preferredPlatform !== 'other'
      ? platformLabel(state.preferredPlatform)
      : 'Social';
    return (
      <Phase1Frame
        onBack={() => void goBackOnboardingV2()}
        progress={0.38}
        progressLabel="Personalized save ready"
        footer={<Phase1PrimaryButton title={`Start with ${shellPlatform}`} onPress={() => void continueOnboardingV2ToTutorial()} />}
      >
        <Text style={styles.eyebrow}>{shellPlatform.toUpperCase()} + {(state.interest ?? 'anything').toUpperCase()}</Text>
        <Text style={styles.compactHeadline}>{personalizedSavePrompt(shellPlatform, state.interest === 'food' ? 'Food' : state.interest ?? 'Anything')}</Text>
        <PracticePostHero
          category={state.interest ?? 'anything'}
          platform={shellPlatform}
          title={tutorial.title}
          locality={tutorial.knownPlace?.locality ?? 'A place worth going'}
        />
      </Phase1Frame>
    );
  }

  // Stages owned by /activate, /account, or /map wait for the sole automatic
  // navigation authority in app/_layout.tsx. No screen-level resume CTA can
  // compete with AuthGate or bounce a deleted identity between routes.
  return <View style={styles.loading} accessibilityLabel="Opening your next Nearr step" />;
}

function WelcomeProductHero() {
  return (
    <View style={styles.welcomeHero} accessible accessibilityLabel="A social post flowing into a pin on the Nearr map">
      <View style={styles.socialCard}>
        <View style={styles.socialTop}>
          <View style={styles.miniAvatar} />
          <View>
            <Text style={styles.miniHandle}>weekend.finds</Text>
            <Text style={styles.miniMeta}>Hidden on the coast</Text>
          </View>
        </View>
        <View style={styles.socialMedia}>
          <View style={styles.sun} />
          <View style={styles.coastBack} />
          <View style={styles.coastFront} />
          <View style={styles.socialShare}><Feather name="send" size={18} color="#FFFFFF" /></View>
        </View>
      </View>
      <View style={styles.flowLine} />
      <View style={styles.mapCard}>
        <View style={[styles.mapRoad, styles.mapRoadOne]} />
        <View style={[styles.mapRoad, styles.mapRoadTwo]} />
        <View style={styles.mapPin}><Feather name="map-pin" size={21} color={Phase1Colors.onOrange} /></View>
        <View style={styles.mapCopy}>
          <Text style={styles.mapLabel}>FOUND</Text>
          <Text style={styles.mapTitle}>Hellfire Bay</Text>
        </View>
      </View>
    </View>
  );
}

function InterestTile({
  label,
  detail,
  icon,
  tone,
  accent,
  wide,
  onPress,
}: (typeof INTERESTS)[number] & { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      style={({ pressed }) => [
        styles.interestTile,
        wide ? styles.interestTileWide : styles.interestTileHalf,
        { backgroundColor: tone },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.tileOrb, { backgroundColor: accent }]} />
      <View style={styles.tileIcon}><Feather name={icon} size={21} color="#FFFFFF" /></View>
      <View style={styles.tileCopy}>
        <Text style={styles.tileTitle}>{label}</Text>
        <Text style={styles.tileDetail}>{detail}</Text>
      </View>
      <Feather name="arrow-up-right" size={18} color="#FFFFFF" />
    </Pressable>
  );
}

function PracticePostHero({
  category,
  platform,
  title,
  locality,
}: {
  category: OnboardingInterest;
  platform: string;
  title: string;
  locality: string;
}) {
  const icon: keyof typeof Feather.glyphMap = category === 'food' ? 'coffee' : category === 'beaches' ? 'wind' : 'map-pin';
  return (
    <View style={styles.practiceHero} accessible accessibilityLabel={'Practice post: ' + title + ', ' + locality}>
      <View style={styles.practiceTop}>
        <View style={styles.platformChip}><Text style={styles.platformChipText}>{platform}</Text></View>
        <Feather name="more-horizontal" size={20} color="#FFFFFF" />
      </View>
      <View style={styles.practiceSun} />
      <View style={styles.practiceLandscapeBack} />
      <View style={styles.practiceLandscapeFront} />
      <View style={styles.practiceIcon}><Feather name={icon} size={32} color="#FFFFFF" /></View>
      <View style={styles.practiceCopy}>
        <Text style={styles.practiceTitle}>{title}</Text>
        <View style={styles.placeLine}>
          <Feather name="map-pin" size={14} color={Phase1Colors.orange} />
          <Text style={styles.practiceLocality}>{locality}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: Phase1Colors.background },
  welcomeContent: { justifyContent: 'center', paddingTop: 2 },
  eyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.7, marginBottom: 10 },
  headline: { color: Phase1Colors.text, fontSize: 31, lineHeight: 35, fontWeight: '900', letterSpacing: -0.9 },
  compactHeadline: { color: Phase1Colors.text, fontSize: 28, lineHeight: 32, fontWeight: '900', letterSpacing: -0.8 },
  body: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 11 },
  welcomeHeadline: { color: Phase1Colors.text, fontSize: 38, lineHeight: 40, fontWeight: '900', letterSpacing: -1.4, marginTop: 24 },
  welcomeBody: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 22, marginTop: 10, maxWidth: 330 },
  welcomeHero: { height: 332, position: 'relative' },
  socialCard: { position: 'absolute', left: 0, top: 2, width: '72%', height: 260, borderRadius: 27, overflow: 'hidden', backgroundColor: '#171715', borderWidth: 1, borderColor: '#35312C', transform: [{ rotate: '-2deg' }] },
  socialTop: { height: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  miniAvatar: { width: 27, height: 27, borderRadius: 14, backgroundColor: Phase1Colors.orange },
  miniHandle: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  miniMeta: { color: '#8D8983', fontSize: 9, marginTop: 1 },
  socialMedia: { flex: 1, overflow: 'hidden', backgroundColor: '#24403B' },
  sun: { position: 'absolute', right: -25, top: -45, width: 150, height: 150, borderRadius: 75, backgroundColor: '#E07B3E' },
  coastBack: { position: 'absolute', left: -35, right: 40, bottom: 14, height: 120, borderRadius: 80, backgroundColor: '#315D52', transform: [{ rotate: '8deg' }] },
  coastFront: { position: 'absolute', left: 54, right: -60, bottom: -42, height: 145, borderRadius: 80, backgroundColor: '#152925', transform: [{ rotate: '-12deg' }] },
  socialShare: { position: 'absolute', right: 12, bottom: 14, width: 43, height: 43, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange, borderWidth: 2, borderColor: '#FFFFFF' },
  flowLine: { position: 'absolute', right: 45, top: 164, width: 72, borderTopWidth: 2, borderStyle: 'dashed', borderColor: Phase1Colors.orange, transform: [{ rotate: '46deg' }] },
  mapCard: { position: 'absolute', right: 0, bottom: 0, width: '58%', height: 150, borderRadius: 25, overflow: 'hidden', backgroundColor: '#F1E5D2', borderWidth: 4, borderColor: Phase1Colors.background, transform: [{ rotate: '2deg' }] },
  mapRoad: { position: 'absolute', height: 4, borderRadius: 4, backgroundColor: '#D3C3AA' },
  mapRoadOne: { width: 250, top: 45, left: -42, transform: [{ rotate: '-18deg' }] },
  mapRoadTwo: { width: 210, top: 85, right: -45, transform: [{ rotate: '31deg' }] },
  mapPin: { position: 'absolute', right: 24, top: 23, width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange },
  mapCopy: { position: 'absolute', left: 15, right: 10, bottom: 15 },
  mapLabel: { color: '#A64C1C', fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  mapTitle: { color: '#251B13', fontSize: 16, fontWeight: '900', marginTop: 3 },
  platformGrid: { gap: 10, marginTop: 28 },
  platformRow: { flexDirection: 'row', gap: 10 },
  platformChoice: { flex: 1, minWidth: 0, minHeight: 72, paddingHorizontal: 11, borderRadius: 19, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border },
  selectedChoice: { borderColor: Phase1Colors.orange },
  upcomingChoice: { opacity: 0.55 },
  platformIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  platformLabel: { flex: 1, minWidth: 0, color: Phase1Colors.text, fontSize: 14, fontWeight: '800' },
  sourceHint: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  sourceHintText: { flex: 1, color: Phase1Colors.textMuted, fontSize: 13, lineHeight: 18 },
  interestGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 24 },
  interestTile: { minHeight: 108, borderRadius: 22, padding: 15, overflow: 'hidden', flexDirection: 'row', alignItems: 'flex-start' },
  interestTileWide: { width: '100%' },
  interestTileHalf: { width: '48.5%', minHeight: 132 },
  tileOrb: { position: 'absolute', width: 115, height: 115, borderRadius: 58, right: -35, top: -47, opacity: 0.6 },
  tileIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.22)' },
  tileCopy: { position: 'absolute', left: 15, right: 40, bottom: 14 },
  tileTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  tileDetail: { color: 'rgba(255,255,255,0.72)', fontSize: 11, marginTop: 3 },
  practiceHero: { height: 410, borderRadius: 29, overflow: 'hidden', backgroundColor: '#244039', borderWidth: 1, borderColor: '#3E554D', marginTop: 22 },
  practiceTop: { position: 'absolute', zIndex: 2, left: 14, right: 14, top: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  platformChip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(8,8,7,0.72)' },
  platformChipText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  practiceSun: { position: 'absolute', right: -30, top: -25, width: 190, height: 190, borderRadius: 95, backgroundColor: '#D9763C' },
  practiceLandscapeBack: { position: 'absolute', width: 450, height: 230, left: -105, bottom: 42, borderRadius: 160, backgroundColor: '#315F53', transform: [{ rotate: '9deg' }] },
  practiceLandscapeFront: { position: 'absolute', width: 500, height: 245, left: 50, bottom: -75, borderRadius: 150, backgroundColor: '#142722', transform: [{ rotate: '-9deg' }] },
  practiceIcon: { position: 'absolute', top: 126, left: 0, right: 0, alignItems: 'center' },
  practiceCopy: { position: 'absolute', left: 18, right: 18, bottom: 20, padding: 16, borderRadius: 20, backgroundColor: 'rgba(8,8,7,0.78)' },
  practiceTitle: { color: '#FFFFFF', fontSize: 22, lineHeight: 26, fontWeight: '900' },
  placeLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  practiceLocality: { color: '#D8D0C7', fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
