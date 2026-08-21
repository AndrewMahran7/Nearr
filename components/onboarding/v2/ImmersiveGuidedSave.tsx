import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NearrAppIcon } from '@/components/onboarding/demo';
import { Phase1Colors, Phase1PrimaryButton } from '@/components/onboarding/v2/Phase1Visuals';
import { personalizedSavePrompt } from '@/lib/onboardingV2ImmersiveCore';
import type { OnboardingInterest, OnboardingV2Stage } from '@/lib/onboardingV2Core';

type ImmersiveStage = Extract<OnboardingV2Stage,
  | 'tutorial_ready'
  | 'tutorial_share_tapped'
  | 'tutorial_more_tapped'
  | 'tutorial_nearr_selected'
  | 'tutorial_favorite_added'
>;

type Props = {
  stage: ImmersiveStage;
  platform: string;
  interest: OnboardingInterest;
  title: string;
  onBack: () => void;
  onAdvance: (action: 'share' | 'more' | 'nearr' | 'favorite' | 'process') => void;
};

const PROGRESS: Record<ImmersiveStage, number> = {
  tutorial_ready: 0.2,
  tutorial_share_tapped: 0.4,
  tutorial_more_tapped: 0.6,
  tutorial_nearr_selected: 0.8,
  tutorial_favorite_added: 1,
};

/**
 * One continuously mounted simulation. Durable onboarding stages select a
 * stable resume checkpoint; sheets transform over the same Reel underneath.
 */
export function ImmersiveGuidedSave({ stage, platform, interest, title, onBack, onAdvance }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const isReel = stage === 'tutorial_ready';
  const sheetHeight = Math.min(540, Math.max(390, height * 0.58));

  return (
    <View style={styles.root}>
      <View
        style={styles.progressTrack}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Guided save progress"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(PROGRESS[stage] * 100) }}
      >
        <View style={[styles.progressFill, { width: `${PROGRESS[stage] * 100}%` }]} />
      </View>

      <Reel
        platform={platform}
        title={title}
        interest={interest}
        active={isReel}
        onShare={() => onAdvance('share')}
      />

      {!isReel ? <View pointerEvents="none" style={styles.reelDimmer} /> : null}

      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        style={({ pressed }) => [styles.backButton, { top: insets.top + 8 }, pressed && styles.pressed]}
      >
        <Feather name="arrow-left" size={22} color="#FFFFFF" />
      </Pressable>

      {stage === 'tutorial_share_tapped' ? (
        <InstagramShareSheet height={sheetHeight} platform={platform} onShareTo={() => onAdvance('more')} />
      ) : null}
      {stage === 'tutorial_more_tapped' ? (
        <SystemShareSheet height={sheetHeight} onNearr={() => onAdvance('nearr')} />
      ) : null}
      {stage === 'tutorial_nearr_selected' || stage === 'tutorial_favorite_added' ? (
        <FavoritesSheet
          height={sheetHeight}
          confirmed={stage === 'tutorial_favorite_added'}
          onFavorite={() => onAdvance('favorite')}
          onSend={() => onAdvance('process')}
        />
      ) : null}
    </View>
  );
}

function Reel({ platform, title, interest, active, onShare }: {
  platform: string;
  title: string;
  interest: OnboardingInterest;
  active: boolean;
  onShare: () => void;
}) {
  const promise = personalizedSavePrompt(platform, interest === 'food' ? 'Food' : interest);
  return (
    <View style={styles.reel} accessible accessibilityLabel={`${platform} Reel featuring ${title}`}>
      <FoodMedia />
      <View style={styles.reelHeader}>
        <Text style={styles.reelTitle}>{platform === 'Instagram' ? 'Reels' : platform}</Text>
        <Feather name="camera" size={23} color="#FFFFFF" />
      </View>
      {active ? (
        <View style={styles.personalizedChip} accessibilityRole="text">
          <Text style={styles.personalizedMeta}>{platform.toUpperCase()} + {interest.toUpperCase()}</Text>
          <Text style={styles.personalizedText}>{promise}</Text>
        </View>
      ) : null}
      <View style={styles.reelCaption}>
        <View style={styles.creatorLine}>
          <View style={styles.creatorAvatar}><Text style={styles.creatorAvatarText}>MY</Text></View>
          <Text style={styles.creator}>mad.yolks</Text>
          <View style={styles.followButton}><Text style={styles.followText}>Follow</Text></View>
        </View>
        <Text style={styles.captionText}>Breakfast worth crossing town for. Santa Cruz, CA</Text>
        <Text style={styles.audioText}>♫ mad.yolks · original audio</Text>
      </View>
      <View style={styles.reelRail}>
        <RailAction icon="heart" label="12.4K" />
        <RailAction icon="message-circle" label="238" />
        <View style={styles.shareCoachWrap}>
          {active ? <CoachMark label="Tap Share" side="left" /> : null}
          <Pressable
            onPress={onShare}
            disabled={!active}
            accessibilityRole="button"
            accessibilityLabel="Share"
            accessibilityHint="Opens the sharing surface"
            style={({ pressed }) => [styles.shareControl, active && styles.controlHighlight, pressed && styles.pressed]}
          >
            <Feather name="send" size={28} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.railLabel}>Share</Text>
        </View>
        <Feather name="more-horizontal" size={27} color="#FFFFFF" />
      </View>
    </View>
  );
}

function FoodMedia() {
  return (
    <View style={styles.foodMedia} pointerEvents="none">
      <View style={styles.foodGlow} />
      <View style={styles.counterBack} />
      <View style={styles.plate} />
      <View style={styles.sandwichShadow} />
      <View style={styles.bunTop} />
      <View style={styles.eggWhite} />
      <View style={styles.eggYolk} />
      <View style={styles.cheese} />
      <View style={styles.sandwichBase} />
      <View style={styles.mediaVignette} />
    </View>
  );
}

function RailAction({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) {
  return (
    <View style={styles.railAction}>
      <Feather name={icon} size={28} color="#FFFFFF" />
      <Text style={styles.railLabel}>{label}</Text>
    </View>
  );
}

function InstagramShareSheet({ height, platform, onShareTo }: { height: number; platform: string; onShareTo: () => void }) {
  return (
    <View style={[styles.darkSheet, { height }]} accessibilityLabel={`${platform} sharing surface`}>
      <View style={styles.grabber} />
      <View style={styles.sheetSearch}><Feather name="search" size={18} color="#A8A8AE" /><Text style={styles.searchText}>Search</Text></View>
      <View style={styles.peopleRow}>
        {['A', 'S', 'J', 'M'].map((initial, index) => (
          <View key={initial} style={styles.person}>
            <View style={[styles.personAvatar, { backgroundColor: ['#CA795C', '#5D84C9', '#607A66', '#8A659D'][index] }]}><Text style={styles.personInitial}>{initial}</Text></View>
            <Text style={styles.personName}>{['Alex', 'Sam', 'Jordan', 'Mia'][index]}</Text>
          </View>
        ))}
      </View>
      <View style={styles.shareActionGrid}>
        <SmallAction icon="link" label="Copy link" />
        <SmallAction icon="bookmark" label="Bookmark" />
        <View style={styles.shareToWrap}>
          <CoachMark label="Share to…" side="top" />
          <Pressable
            onPress={onShareTo}
            accessibilityRole="button"
            accessibilityLabel="Share to more apps"
            style={({ pressed }) => [styles.smallAction, styles.shareToTarget, pressed && styles.pressed]}
          >
            <View style={styles.smallActionIcon}><Feather name="more-horizontal" size={23} color="#FFFFFF" /></View>
            <Text style={styles.smallActionLabel}>Share to…</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function SmallAction({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) {
  return <View style={styles.smallAction}><View style={styles.smallActionIcon}><Feather name={icon} size={21} color="#FFFFFF" /></View><Text style={styles.smallActionLabel}>{label}</Text></View>;
}

function SystemShareSheet({ height, onNearr }: { height: number; onNearr: () => void }) {
  return (
    <View style={[styles.systemSheet, { height }]} accessibilityLabel="iOS sharing surface">
      <View style={styles.systemGrabber} />
      <View style={styles.systemSource}>
        <View style={styles.systemThumb}><Feather name="play" size={17} color="#FFFFFF" /></View>
        <View style={styles.systemSourceCopy}><Text style={styles.systemSourceTitle}>Mad Yolks</Text><Text style={styles.systemSourceMeta}>instagram.com</Text></View>
        <Feather name="x" size={19} color="#49494E" />
      </View>
      <View style={styles.appRow}>
        <AppTile icon="message-circle" label="Messages" color="#31C95A" />
        <AppTile icon="mail" label="Mail" color="#268CFF" />
        <View style={styles.nearrTileWrap}>
          <CoachMark label="Choose Nearr" side="top" />
          <Pressable onPress={onNearr} accessibilityRole="button" accessibilityLabel="Nearr" style={({ pressed }) => [styles.appTile, styles.nearrTarget, pressed && styles.pressed]}>
            <NearrAppIcon size={56} highlighted />
            <Text style={styles.systemAppLabel}>Nearr</Text>
          </Pressable>
        </View>
        <AppTile icon="more-horizontal" label="More" color="#D4D4D8" dark />
      </View>
      <View style={styles.systemDivider} />
      <SystemRow label="Copy" icon="copy" />
      <SystemRow label="Add to Reading List" icon="bookmark" />
    </View>
  );
}

function AppTile({ icon, label, color, dark }: { icon: keyof typeof Feather.glyphMap; label: string; color: string; dark?: boolean }) {
  return <View style={styles.appTile}><View style={[styles.appGlyph, { backgroundColor: color }]}><Feather name={icon} size={22} color={dark ? '#333338' : '#FFFFFF'} /></View><Text style={styles.systemAppLabel}>{label}</Text></View>;
}

function SystemRow({ label, icon }: { label: string; icon: keyof typeof Feather.glyphMap }) {
  return <View style={styles.systemRow}><Text style={styles.systemRowText}>{label}</Text><Feather name={icon} size={18} color="#333338" /></View>;
}

function FavoritesSheet({ height, confirmed, onFavorite, onSend }: { height: number; confirmed: boolean; onFavorite: () => void; onSend: () => void }) {
  return (
    <View style={[styles.systemSheet, styles.favoriteSheet, { height }]} accessibilityLabel="Edit sharing Favorites">
      <View style={styles.editorHeader}><Text style={styles.editorCancel}>Cancel</Text><Text style={styles.editorTitle}>Apps</Text><Text style={styles.editorDone}>Done</Text></View>
      {confirmed ? (
        <View style={styles.successToast} accessibilityLiveRegion="polite"><Feather name="check" size={16} color={Phase1Colors.onOrange} /><Text style={styles.successToastText}>Nearr is in Favorites</Text></View>
      ) : null}
      <Text style={styles.sectionLabel}>FAVORITES</Text>
      <EditorRow label="Messages" icon="message-circle" favorite />
      {confirmed ? <EditorNearr confirmed onPress={onFavorite} /> : null}
      <Text style={styles.sectionLabel}>SUGGESTIONS</Text>
      {!confirmed ? <EditorNearr confirmed={false} onPress={onFavorite} /> : null}
      <EditorRow label="Notes" icon="file-text" />
      {confirmed ? <View style={styles.sendFooter}><Phase1PrimaryButton title="Send to Nearr" onPress={onSend} /></View> : null}
    </View>
  );
}

function EditorNearr({ confirmed, onPress }: { confirmed: boolean; onPress: () => void }) {
  return (
    <View style={styles.editorNearrWrap}>
      {!confirmed ? <CoachMark label="Tap +" side="right" /> : null}
      <Pressable
        onPress={onPress}
        disabled={confirmed}
        accessibilityRole="button"
        accessibilityLabel={confirmed ? 'Nearr added to Favorites' : 'Add Nearr to Favorites'}
        style={({ pressed }) => [styles.editorRow, !confirmed && styles.editorTarget, pressed && styles.pressed]}
      >
        <View style={[styles.editButton, confirmed && styles.removeButton]}><Feather name={confirmed ? 'minus' : 'plus'} size={19} color="#FFFFFF" /></View>
        <NearrAppIcon size={38} highlighted={confirmed} />
        <Text style={styles.editorLabel}>Nearr</Text>
        {confirmed ? <Feather name="menu" size={20} color="#99999F" /> : null}
      </Pressable>
    </View>
  );
}

function EditorRow({ label, icon, favorite }: { label: string; icon: keyof typeof Feather.glyphMap; favorite?: boolean }) {
  return <View style={styles.editorRow}><View style={[styles.editButton, favorite && styles.removeButton]}><Feather name={favorite ? 'minus' : 'plus'} size={19} color="#FFFFFF" /></View><View style={styles.editorGeneric}><Feather name={icon} size={19} color="#FFFFFF" /></View><Text style={styles.editorLabel}>{label}</Text>{favorite ? <Feather name="menu" size={20} color="#99999F" /> : null}</View>;
}

function CoachMark({ label, side }: { label: string; side: 'left' | 'top' | 'right' }) {
  return <View pointerEvents="none" style={[styles.coach, styles[`coach${side}`]]}><Text style={styles.coachText}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', overflow: 'hidden' },
  progressTrack: { position: 'absolute', zIndex: 50, left: 0, right: 0, top: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.12)' },
  progressFill: { height: 2, backgroundColor: Phase1Colors.orange },
  reel: { flex: 1, backgroundColor: '#5B2C19', overflow: 'hidden' },
  foodMedia: { ...StyleSheet.absoluteFillObject, backgroundColor: '#8E4928' },
  foodGlow: { position: 'absolute', width: 440, height: 440, borderRadius: 220, top: 30, left: -105, backgroundColor: '#D98B54' },
  counterBack: { position: 'absolute', left: -40, right: -40, bottom: -40, height: '57%', borderRadius: 120, backgroundColor: '#5D2C20', transform: [{ rotate: '-8deg' }] },
  plate: { position: 'absolute', width: 330, height: 180, borderRadius: 165, left: '8%', top: '38%', backgroundColor: '#F4DFBE', borderWidth: 12, borderColor: '#D9BD93', transform: [{ rotate: '-8deg' }] },
  sandwichShadow: { position: 'absolute', width: 240, height: 92, borderRadius: 55, left: '19%', top: '50%', backgroundColor: 'rgba(42,16,9,0.38)', transform: [{ rotate: '-8deg' }] },
  bunTop: { position: 'absolute', width: 232, height: 104, borderTopLeftRadius: 116, borderTopRightRadius: 116, borderBottomLeftRadius: 34, borderBottomRightRadius: 34, left: '20%', top: '38%', backgroundColor: '#E6A14D', borderBottomWidth: 8, borderBottomColor: '#B96C2D', transform: [{ rotate: '-8deg' }] },
  eggWhite: { position: 'absolute', width: 224, height: 53, borderRadius: 30, left: '21%', top: '49%', backgroundColor: '#FFF3D7', transform: [{ rotate: '-8deg' }] },
  eggYolk: { position: 'absolute', width: 65, height: 54, borderRadius: 29, left: '46%', top: '48%', backgroundColor: '#F6A313' },
  cheese: { position: 'absolute', width: 205, height: 42, borderRadius: 8, left: '24%', top: '54%', backgroundColor: '#F2BD35', transform: [{ rotate: '-11deg' }] },
  sandwichBase: { position: 'absolute', width: 222, height: 60, borderRadius: 28, left: '21%', top: '57%', backgroundColor: '#C67A32', borderTopWidth: 9, borderTopColor: '#7A3E22', transform: [{ rotate: '-8deg' }] },
  mediaVignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.12)' },
  reelHeader: { position: 'absolute', top: 55, left: 64, right: 19, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reelTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 8 },
  personalizedChip: { position: 'absolute', top: 104, left: 18, right: 74, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 16, backgroundColor: 'rgba(10,10,10,0.76)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  personalizedMeta: { color: Phase1Colors.orange, fontSize: 9, fontWeight: '900', letterSpacing: 1.25 },
  personalizedText: { color: '#FFFFFF', fontSize: 15, lineHeight: 20, fontWeight: '800', marginTop: 4 },
  reelCaption: { position: 'absolute', left: 16, right: 76, bottom: 28 },
  creatorLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  creatorAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6C067', borderWidth: 1.5, borderColor: '#FFFFFF' },
  creatorAvatarText: { color: '#3A1B10', fontSize: 9, fontWeight: '900' },
  creator: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  followButton: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 4 },
  followText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  captionText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, marginTop: 9, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 5 },
  audioText: { color: '#FFFFFF', fontSize: 11, marginTop: 10, fontWeight: '700' },
  reelRail: { position: 'absolute', right: 12, bottom: 30, width: 54, alignItems: 'center', gap: 23 },
  railAction: { alignItems: 'center', gap: 4 },
  railLabel: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', marginTop: 4 },
  shareCoachWrap: { alignItems: 'center' },
  shareControl: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  controlHighlight: { backgroundColor: 'rgba(255,106,26,0.28)', borderWidth: 2, borderColor: Phase1Colors.orange },
  backButton: { position: 'absolute', zIndex: 60, left: 14, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,10,10,0.66)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)' },
  reelDimmer: { ...StyleSheet.absoluteFillObject, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.4)' },
  darkSheet: { position: 'absolute', zIndex: 20, left: 0, right: 0, bottom: 0, paddingHorizontal: 16, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: '#202023' },
  grabber: { width: 42, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 9, marginBottom: 16, backgroundColor: '#606066' },
  sheetSearch: { height: 39, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#313136' },
  searchText: { color: '#A8A8AE', fontSize: 15 },
  peopleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, paddingHorizontal: 6 },
  person: { width: 64, alignItems: 'center' },
  personAvatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  personInitial: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  personName: { color: '#EAEAEF', fontSize: 11, marginTop: 7 },
  shareActionGrid: { flexDirection: 'row', gap: 20, marginTop: 32, paddingHorizontal: 6 },
  smallAction: { width: 66, alignItems: 'center' },
  smallActionIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: '#35353A' },
  smallActionLabel: { color: '#F4F4F6', fontSize: 10, lineHeight: 13, textAlign: 'center', marginTop: 7 },
  shareToWrap: { position: 'relative' },
  shareToTarget: { borderRadius: 12 },
  systemSheet: { position: 'absolute', zIndex: 20, left: 8, right: 8, bottom: 0, paddingHorizontal: 16, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: '#F1F1F5' },
  systemGrabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 9, marginBottom: 13, backgroundColor: '#B4B4B9' },
  systemSource: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 11 },
  systemThumb: { width: 48, height: 48, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#B66538' },
  systemSourceCopy: { flex: 1 },
  systemSourceTitle: { color: '#17171A', fontSize: 15, fontWeight: '800' },
  systemSourceMeta: { color: '#717176', fontSize: 12, marginTop: 3 },
  appRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 20 },
  appTile: { width: 68, alignItems: 'center' },
  appGlyph: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  systemAppLabel: { color: '#222226', fontSize: 10, marginTop: 6, textAlign: 'center' },
  nearrTileWrap: { position: 'relative' },
  nearrTarget: { borderRadius: 14 },
  systemDivider: { height: 1, backgroundColor: '#D1D1D5' },
  systemRow: { height: 52, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D1D1D5' },
  systemRowText: { color: '#222226', fontSize: 16 },
  favoriteSheet: { paddingTop: 5 },
  editorHeader: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D1D1D5' },
  editorCancel: { color: '#717176', fontSize: 15 },
  editorTitle: { color: '#18181B', fontSize: 16, fontWeight: '800' },
  editorDone: { color: '#1478FF', fontSize: 15, fontWeight: '700' },
  successToast: { position: 'absolute', zIndex: 4, top: 58, alignSelf: 'center', minHeight: 38, borderRadius: 19, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, backgroundColor: Phase1Colors.orange },
  successToastText: { color: Phase1Colors.onOrange, fontSize: 12, fontWeight: '900' },
  sectionLabel: { color: '#7E7E84', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 18, marginBottom: 5 },
  editorNearrWrap: { position: 'relative' },
  editorRow: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D1D1D5' },
  editorTarget: { borderRadius: 13, borderWidth: 2, borderColor: Phase1Colors.orange, paddingHorizontal: 6, backgroundColor: '#FFF7EF' },
  editButton: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#34C759' },
  removeButton: { backgroundColor: '#FF3B30' },
  editorGeneric: { width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#41A65B' },
  editorLabel: { flex: 1, color: '#1E1E22', fontSize: 15, fontWeight: '700' },
  sendFooter: { marginTop: 14 },
  coach: { position: 'absolute', zIndex: 80, minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 17, backgroundColor: Phase1Colors.orange, shadowColor: '#000000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  coachleft: { right: 58, top: 5, width: 92 },
  coachtop: { bottom: 80, left: -8, width: 92 },
  coachright: { left: 0, top: -38, width: 66 },
  coachText: { color: Phase1Colors.onOrange, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});
