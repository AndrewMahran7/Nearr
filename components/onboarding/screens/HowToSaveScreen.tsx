import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { OnboardingCard, OnboardingStepRow } from '..';
import { OnboardingColors, OnboardingRadius } from '../theme';
import { ScreenHeading } from './ScreenHeading';

type SourceTab = {
  key: 'instagram' | 'tiktok' | 'youtube';
  label: string;
  icon: keyof typeof Feather.glyphMap;
  /** Placeholder shown until the local tutorial video asset exists. */
  placeholder: string;
  /** Local asset path to create (see TODO in TutorialVideoArea). */
  videoAsset: string;
  /** The exact working example the local asset is derived from. */
  sourceUrl: string;
};

// Editable tutorial sources. Instagram is selected by default. Feather has no
// TikTok glyph, so we use "video" as a stand-in.
const SOURCE_TABS: SourceTab[] = [
  {
    key: 'instagram',
    label: 'Instagram',
    icon: 'instagram',
    placeholder: 'Instagram tutorial video coming soon',
    videoAsset: 'assets/onboarding/instagram-save-tutorial.mp4',
    sourceUrl: 'https://www.instagram.com/p/DXqBOVHCBq6/',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    icon: 'video',
    placeholder: 'TikTok tutorial video coming soon',
    videoAsset: 'assets/onboarding/tiktok-save-tutorial.mp4',
    sourceUrl: 'https://www.tiktok.com/@ocfoodandview/video/7646649399942139166',
  },
  {
    key: 'youtube',
    label: 'YouTube',
    icon: 'youtube',
    placeholder: 'YouTube tutorial video coming soon',
    videoAsset: 'assets/onboarding/youtube-save-tutorial.mp4',
    sourceUrl: 'https://www.youtube.com/shorts/CWSdWKBZkxs',
  },
];

// The same four steps apply to every platform.
const STEPS = [
  'Tap share',
  'Choose Nearr',
  'Nearr finds the place',
  'See it on your map',
] as const;

/**
 * Screen 3 — Share a place to Nearr.
 *
 * Multi-platform tutorial. Tabs (Instagram / TikTok / YouTube) switch the
 * tutorial video area; the four save steps are the same for every platform.
 * Until the local tutorial videos exist, each tab shows a clean per-platform
 * placeholder — see `TutorialVideoArea` for the swap-to-video boundary.
 */
export function HowToSaveScreen() {
  const [activeTab, setActiveTab] = useState<SourceTab['key']>('instagram');
  const active = SOURCE_TABS.find((t) => t.key === activeTab) ?? SOURCE_TABS[0];

  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="Share a place to Nearr"
        subtext="Pick where you found the place, then watch how to save it."
      />

      <View style={styles.tabs}>
        {SOURCE_TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={[styles.tab, isActive ? styles.tabActive : styles.tabInactive]}
            >
              <Feather
                name={tab.icon}
                size={14}
                color={isActive ? OnboardingColors.onOrange : OnboardingColors.textMuted}
              />
              <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : styles.tabLabelInactive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TutorialVideoArea tab={active} />

      <OnboardingCard style={styles.steps}>
        {STEPS.map((step, index) => (
          <OnboardingStepRow key={step} number={index + 1} title={step} />
        ))}
      </OnboardingCard>
    </View>
  );
}

/**
 * Per-platform tutorial video area. Currently renders a clean placeholder
 * because the local video assets do not exist yet (the mock post card was
 * removed; this placeholder is the fallback).
 *
 * TODO(onboarding-video): swap this placeholder for real playback once the
 * local assets are recorded from the exact working examples below. No video
 * dependency is installed yet (no expo-av / expo-video); add one when wiring
 * playback, e.g.:
 *   const player = useVideoPlayer(source, (p) => { p.loop = true; p.muted = true; });
 *   return <VideoView player={player} style={styles.video} contentFit="cover" />;
 *
 * Local assets to create (each derived from its exact working example):
 *   assets/onboarding/instagram-save-tutorial.mp4  ← https://www.instagram.com/p/DXqBOVHCBq6/
 *   assets/onboarding/tiktok-save-tutorial.mp4     ← https://www.tiktok.com/@ocfoodandview/video/7646649399942139166
 *   assets/onboarding/youtube-save-tutorial.mp4    ← https://www.youtube.com/shorts/CWSdWKBZkxs
 */
function TutorialVideoArea({ tab }: { tab: SourceTab }) {
  return (
    <View style={styles.videoArea}>
      <View style={styles.videoIconBadge}>
        <Feather name={tab.icon} size={30} color={OnboardingColors.orange} />
      </View>
      <Text style={styles.videoPlaceholder}>{tab.placeholder}</Text>
      <Text style={styles.videoHint}>Short vertical tutorial</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: OnboardingRadius.pill,
    borderWidth: 1,
  },
  tabActive: {
    backgroundColor: OnboardingColors.orange,
    borderColor: OnboardingColors.orange,
  },
  tabInactive: {
    backgroundColor: OnboardingColors.card,
    borderColor: OnboardingColors.border,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: OnboardingColors.onOrange,
  },
  tabLabelInactive: {
    color: OnboardingColors.textMuted,
  },
  videoArea: {
    height: 280,
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    backgroundColor: OnboardingColors.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    overflow: 'hidden',
  },
  videoIconBadge: {
    width: 64,
    height: 64,
    borderRadius: OnboardingRadius.pill,
    backgroundColor: 'rgba(255, 107, 0, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  videoPlaceholder: {
    color: OnboardingColors.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  videoHint: {
    color: OnboardingColors.textMuted,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  // Reserved for the future <VideoView> (fills the video area).
  video: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: OnboardingRadius.card,
  },
  steps: {
    gap: 2,
  },
});
