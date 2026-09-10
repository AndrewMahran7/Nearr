import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NearrAppIcon } from '@/components/onboarding/demo';
import { Phase1Colors } from '@/components/onboarding/v2/Phase1Visuals';
import { onboardingTutorialPreviewUrl } from '@/lib/onboardingTutorialPreview';
import { onboardingTutorialSourceAsset } from '@/lib/onboardingTutorialSourceAsset';
import type { OnboardingTutorialFixture, OnboardingV2Stage } from '@/lib/onboardingV2Core';

type ImmersiveStage = Extract<OnboardingV2Stage,
  'tutorial_ready' | 'tutorial_share_tapped' | 'tutorial_more_tapped' | 'tutorial_nearr_selected' | 'tutorial_favorite_added'
>;

type Props = {
  stage: ImmersiveStage;
  fixture?: OnboardingTutorialFixture;
  platform?: string;
  interest?: string;
  title?: string;
  onBack: () => void;
  onAdvance: (action: 'share' | 'more' | 'nearr' | 'favorite' | 'process') => void;
};

const PROGRESS: Record<ImmersiveStage, number> = {
  tutorial_ready: 0.44,
  tutorial_share_tapped: 0.5,
  tutorial_more_tapped: 0.56,
  tutorial_nearr_selected: 0.56,
  tutorial_favorite_added: 0.56,
};

const PLATFORM_LABELS: Record<OnboardingTutorialFixture['platform'], string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube',
};

/** A framed rehearsal. Durable stages wait for intentional taps; timers never advance it. */
export function ImmersiveGuidedSave({ stage, fixture, onBack, onAdvance }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const platformKey = fixture?.platform ?? 'instagram';
  const platform = fixture ? PLATFORM_LABELS[fixture.platform] : 'Instagram';
  const localFrame = fixture ? onboardingTutorialSourceAsset(fixture.contentId) : null;
  const remoteFrame = fixture ? onboardingTutorialPreviewUrl(fixture.platform, fixture.contentId, fixture.thumbnailUrl) : null;
  const source = localFrame ?? (remoteFrame ? { uri: remoteFrame } : null);
  const sheetHeight = Math.min(510, Math.max(360, height * 0.56));

  return <View style={styles.root}>
    <View style={styles.progressTrack} accessible accessibilityRole="progressbar" accessibilityLabel="Onboarding progress" accessibilityValue={{ min: 0, max: 100, now: Math.round(PROGRESS[stage] * 100) }}>
      <View style={[styles.progressFill, { width: `${PROGRESS[stage] * 100}%` }]} />
    </View>
    <View style={styles.sourceCard} accessibilityLabel={`Practice sharing the selected ${platform} post`}>
      {source ? <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <View style={styles.missingFrame}><Feather name="image" size={32} color="#FFFFFF" /></View>}
      <View style={styles.shade} />
      <View style={[styles.header, { top: insets.top + 18 }]}><View style={styles.practiceBadge}><Text style={styles.practiceBadgeText}>PRACTICE INSIDE NEARR</Text></View><Text style={styles.platformLabel}>{platform}</Text></View>
      <View style={styles.sourceAttribution}><Ionicons name={platformKey === 'instagram' ? 'logo-instagram' : platformKey === 'youtube' ? 'logo-youtube' : 'play-circle'} size={18} color="#FFFFFF" /><View style={styles.sourceCopy}><Text style={styles.sourceTitle}>A post worth saving</Text><Text style={styles.sourceMeta}>{fixture ? `Frame from the exact ${platform} post` : 'Guided sharing practice'}</Text></View></View>
      <View style={styles.actionRail}><View style={styles.hint}><Text style={styles.hintText}>{stage === 'tutorial_ready' ? (platformKey === 'instagram' ? 'Tap Send' : 'Tap Share') : 'Nice'}</Text></View><Pressable disabled={stage !== 'tutorial_ready'} onPress={() => onAdvance('share')} accessibilityRole="button" accessibilityLabel={platformKey === 'instagram' ? 'Send or share this Instagram post' : `Share this ${platform} post`} accessibilityHint="Opens the next step of this Nearr practice lesson" style={({ pressed }) => [styles.sendButton, stage === 'tutorial_ready' && styles.activeTarget, pressed && styles.pressed]}><Feather name={platformKey === 'instagram' ? 'send' : 'share-2'} size={28} color="#FFFFFF" /></Pressable><Text style={styles.actionLabel}>{platformKey === 'instagram' ? 'Send' : 'Share'}</Text></View>
    </View>
    <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8} style={({ pressed }) => [styles.back, { top: insets.top + 10 }, pressed && styles.pressed]}><Feather name="arrow-left" size={22} color="#FFFFFF" /></Pressable>
    {stage === 'tutorial_share_tapped' ? <PlatformShareMenu height={sheetHeight} platform={platform} onMore={() => onAdvance('more')} /> : null}
    {stage === 'tutorial_more_tapped' ? <SystemShareSheet height={sheetHeight} onNearr={() => onAdvance('nearr')} /> : null}
  </View>;
}

function PlatformShareMenu({ height, platform, onMore }: { height: number; platform: string; onMore: () => void }) {
  return <View style={[styles.darkSheet, { height }]} accessibilityLabel={`${platform} sharing choices`}><View style={styles.grabber} /><Text style={styles.sheetTitle}>Share</Text><View style={styles.peopleRow}>{['A', 'S', 'J', 'M'].map((name) => <View key={name} style={styles.person}><View style={styles.personCircle}><Text style={styles.personInitial}>{name}</Text></View><Text style={styles.personName}>Friend</Text></View>)}</View><View style={styles.menuActions}><MenuAction icon="link" label="Copy link" /><Pressable onPress={onMore} accessibilityRole="button" accessibilityLabel="Open more sharing apps" accessibilityHint="Opens the system share sheet" style={({ pressed }) => [styles.moreAction, styles.activeTarget, pressed && styles.pressed]}><View style={styles.menuIcon}><Feather name="more-horizontal" size={24} color="#FFFFFF" /></View><Text style={styles.menuLabel}>Share to…</Text><View style={styles.hintAbove}><Text style={styles.hintText}>Tap here</Text></View></Pressable></View><Text style={styles.lessonNote}>Nearr may be under Share to… or More the first time.</Text></View>;
}

function MenuAction({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) { return <View style={styles.moreAction}><View style={styles.menuIcon}><Feather name={icon} size={22} color="#FFFFFF" /></View><Text style={styles.menuLabel}>{label}</Text></View>; }

function SystemShareSheet({ height, onNearr }: { height: number; onNearr: () => void }) {
  return <View style={[styles.systemSheet, { height }]} accessibilityLabel="System share sheet practice"><View style={styles.systemGrabber} /><View style={styles.systemSource}><View style={styles.systemThumb}><Feather name="play" size={17} color="#FFFFFF" /></View><View style={styles.sourceCopy}><Text style={styles.systemTitle}>Social post</Text><Text style={styles.systemMeta}>Shared from the selected source</Text></View></View><Text style={styles.appsHeading}>Share with an app</Text><View style={styles.appsRow}><AppTile icon="message-circle" label="Messages" color="#31C95A" /><Pressable onPress={onNearr} accessibilityRole="button" accessibilityLabel="Choose Nearr" accessibilityHint="Submits the exact tutorial post through Nearr's normal save service" style={({ pressed }) => [styles.nearrTile, styles.activeTargetLight, pressed && styles.pressed]}><NearrAppIcon size={58} highlighted /><Text style={styles.appLabel}>Nearr</Text><View style={styles.hintAbove}><Text style={styles.hintText}>Choose Nearr</Text></View></Pressable><AppTile icon="more-horizontal" label="More" color="#D4D4D8" dark /></View><Text style={styles.systemLesson}>Your tap on Nearr starts this guided save. A real external share comes next.</Text></View>;
}

function AppTile({ icon, label, color, dark }: { icon: keyof typeof Feather.glyphMap; label: string; color: string; dark?: boolean }) { return <View style={styles.nearrTile}><View style={[styles.appGlyph, { backgroundColor: color }]}><Feather name={icon} size={22} color={dark ? '#333338' : '#FFFFFF'} /></View><Text style={styles.appLabel}>{label}</Text></View>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', overflow: 'hidden' }, progressTrack: { position: 'absolute', zIndex: 80, left: 0, right: 0, top: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.18)' }, progressFill: { height: 3, backgroundColor: Phase1Colors.orange },
  sourceCard: { flex: 1, backgroundColor: '#273C35', overflow: 'hidden' }, missingFrame: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#273C35' }, shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)' },
  header: { position: 'absolute', left: 62, right: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, practiceBadge: { minHeight: 28, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(15,15,15,0.78)' }, practiceBadgeText: { color: '#FF995E', fontSize: 9, fontWeight: '900', letterSpacing: 1 }, platformLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '900', textShadowColor: '#000000', textShadowRadius: 5 },
  sourceAttribution: { position: 'absolute', left: 18, right: 82, bottom: 34, flexDirection: 'row', alignItems: 'center', gap: 9 }, sourceCopy: { flex: 1 }, sourceTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' }, sourceMeta: { color: '#E7E7E7', fontSize: 12, marginTop: 3 }, actionRail: { position: 'absolute', right: 13, bottom: 30, width: 56, alignItems: 'center' }, sendButton: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.42)' }, actionLabel: { color: '#FFFFFF', fontSize: 10, fontWeight: '900', marginTop: 5 },
  activeTarget: { borderWidth: 2, borderColor: Phase1Colors.orange, backgroundColor: 'rgba(255,91,36,0.28)' }, activeTargetLight: { borderWidth: 3, borderColor: Phase1Colors.orange, borderRadius: 18, backgroundColor: '#FFF4EA' }, hint: { position: 'absolute', right: 58, top: 6, width: 84, minHeight: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: Phase1Colors.orange }, hintAbove: { position: 'absolute', alignSelf: 'center', bottom: 82, minWidth: 76, minHeight: 32, paddingHorizontal: 9, borderRadius: 16, justifyContent: 'center', backgroundColor: Phase1Colors.orange }, hintText: { color: '#161310', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  back: { position: 'absolute', zIndex: 90, left: 14, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,10,10,0.7)' }, darkSheet: { position: 'absolute', zIndex: 50, left: 0, right: 0, bottom: 0, paddingHorizontal: 18, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#202023' }, grabber: { width: 42, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 10, backgroundColor: '#66666C' }, sheetTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '900', textAlign: 'center', marginTop: 15 },
  peopleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 }, person: { alignItems: 'center', width: 64 }, personCircle: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5D7392' }, personInitial: { color: '#FFFFFF', fontWeight: '900' }, personName: { color: '#D5D5DA', fontSize: 10, marginTop: 6 }, menuActions: { flexDirection: 'row', gap: 22, marginTop: 37 }, moreAction: { width: 72, minHeight: 78, alignItems: 'center' }, menuIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#37373C' }, menuLabel: { color: '#FFFFFF', fontSize: 11, marginTop: 7, textAlign: 'center' }, lessonNote: { color: '#B8B8BD', fontSize: 13, lineHeight: 19, marginTop: 28 },
  systemSheet: { position: 'absolute', zIndex: 50, left: 8, right: 8, bottom: 0, paddingHorizontal: 18, borderTopLeftRadius: 27, borderTopRightRadius: 27, backgroundColor: '#F2F2F6' }, systemGrabber: { width: 38, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 10, backgroundColor: '#B5B5BA' }, systemSource: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 11 }, systemThumb: { width: 50, height: 50, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#577368' }, systemTitle: { color: '#1B1B1F', fontSize: 15, fontWeight: '800' }, systemMeta: { color: '#707075', fontSize: 11, marginTop: 3 }, appsHeading: { color: '#68686D', fontSize: 11, fontWeight: '800', letterSpacing: 0.7, marginTop: 10 }, appsRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 30 }, nearrTile: { position: 'relative', width: 76, minHeight: 84, alignItems: 'center', paddingTop: 3 }, appGlyph: { width: 58, height: 58, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, appLabel: { color: '#222226', fontSize: 10, marginTop: 6 }, systemLesson: { color: '#66666C', fontSize: 13, lineHeight: 19, marginTop: 24 }, pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});
