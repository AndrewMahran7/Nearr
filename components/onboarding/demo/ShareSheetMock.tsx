import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { OnboardingColors } from '../theme';
import { NearrAppIcon } from './NearrAppIcon';

/**
 * Privacy-safe, instructional mock of the iOS Share Sheet.
 *
 * IMPORTANT (privacy): this is NOT the real user's Share Sheet. Every
 * recipient is a generic fictional placeholder (Alex / Sam / Jordan / Taylor)
 * — no real contact name, group, avatar, phone number, username, or thumbnail
 * is used. Only the Nearr app row tile uses the real app icon
 * (`assets/icon.png`).
 *
 * The Nearr tile is a real, accessible tap target. Tile sizes are derived from
 * `width` so five tiles per row never clip on small iPhones.
 */

const RECIPIENTS: { name: string; color: string }[] = [
  { name: 'Alex', color: '#7C9CF0' },
  { name: 'Sam', color: '#6FCF97' },
  { name: 'Jordan', color: '#B98CE0' },
  { name: 'Taylor', color: '#F2B36B' },
];

const APP_TILES: {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  bg: string;
  tint: string;
}[] = [
  { key: 'airdrop', label: 'AirDrop', icon: 'radio', bg: '#1E8FFF', tint: '#FFFFFF' },
  { key: 'messages', label: 'Messages', icon: 'message-circle', bg: '#31D158', tint: '#FFFFFF' },
  { key: 'mail', label: 'Mail', icon: 'mail', bg: '#1FA9F6', tint: '#FFFFFF' },
];

const H_PADDING = 14;

type Props = {
  /** Available width for the sheet (used to size the 5 tiles per row). */
  width: number;
  /** Called when the (accessible) Nearr tile is tapped. */
  onNearrPress?: () => void;
  style?: ViewStyle;
};

export function ShareSheetMock({ width, onNearrPress, style }: Props) {
  const innerWidth = Math.max(200, width - H_PADDING * 2);
  const recipientSlot = innerWidth / 5;
  const appSlot = innerWidth / 4;
  const recipientSize = Math.max(40, Math.min(54, Math.round(recipientSlot - 6)));
  const appIconSize = Math.max(46, Math.min(56, Math.round(appSlot - 12)));
  const nearrSize = Math.max(38, Math.min(52, Math.round(appSlot - 18)));

  return (
    <View style={[styles.sheet, { width }, style]} accessibilityLabel="Example iOS share sheet">
      <View style={styles.grabber} />

      <View style={styles.previewRow}>
        <View style={styles.previewThumb}>
          <Feather name="film" size={16} color="#8E8E93" />
        </View>
        <View style={styles.previewText}>
          <Text style={styles.previewTitle} numberOfLines={1}>
            Reel from a creator
          </Text>
          <Text style={styles.previewSub} numberOfLines={1}>
            instagram.com
          </Text>
        </View>
        <View style={styles.exampleTag}>
          <Text style={styles.exampleTagText}>Example</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Recipients row — fictional placeholders only */}
      <View style={styles.row}>
        {RECIPIENTS.map((r) => (
          <View key={r.name} style={[styles.tile, { width: recipientSlot }]}>
            <View
              style={[
                styles.avatar,
                { width: recipientSize, height: recipientSize, borderRadius: recipientSize / 2, backgroundColor: r.color },
              ]}
            >
              <Text style={styles.avatarInitial}>{r.name[0]}</Text>
              <View style={styles.msgBadge}>
                <Feather name="message-circle" size={9} color="#FFFFFF" />
              </View>
            </View>
            <Text style={styles.tileLabel} numberOfLines={1}>
              {r.name}
            </Text>
          </View>
        ))}
        <View style={[styles.tile, { width: recipientSlot }]}>
          <View
            style={[
              styles.avatar,
              styles.moreAvatar,
              { width: recipientSize, height: recipientSize, borderRadius: recipientSize / 2 },
            ]}
          >
            <Feather name="more-horizontal" size={20} color="#3C3C43" />
          </View>
          <Text style={styles.tileLabel}>More</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* App row — Nearr is the only tappable target. */}
      <View style={styles.row}>
        {APP_TILES.map((t) => (
          <View key={t.key} style={[styles.tile, { width: appSlot }]}>
            <View
              style={[
                styles.appIcon,
                { width: appIconSize, height: appIconSize, borderRadius: Math.round(appIconSize * 0.26), backgroundColor: t.bg },
              ]}
            >
              <Feather name={t.icon} size={Math.round(appIconSize * 0.44)} color={t.tint} />
            </View>
            <Text style={styles.tileLabel} numberOfLines={1}>
              {t.label}
            </Text>
          </View>
        ))}

        <NearrTile slot={appSlot} nearrSize={nearrSize} onPress={onNearrPress} />
      </View>

      <View style={styles.divider} />

      <ActionRow icon="copy" label="Copy" />
      <View style={styles.rowDivider} />
      <ActionRow icon="bookmark" label="Add to Reading List" />
    </View>
  );
}

/** The Nearr tile — a real ≥44×44 accessible tap target with an orange focus ring. */
function NearrTile({
  slot,
  nearrSize,
  onPress,
}: {
  slot: number;
  nearrSize: number;
  onPress?: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const firedRef = useRef(false);

  const handlePress = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.82, duration: 90, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
    onPress?.();
  };

  return (
    <View style={[styles.tile, { width: slot }]}>
      <Pressable
        onPress={onPress ? handlePress : undefined}
        disabled={!onPress}
        hitSlop={8}
        style={styles.nearrTarget}
        accessibilityRole="button"
        accessibilityLabel="Nearr"
        accessibilityHint="Sends the post to Nearr and advances the tutorial"
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <NearrAppIcon size={nearrSize} highlighted />
        </Animated.View>
      </Pressable>
      <Text style={[styles.tileLabel, styles.nearrLabel]} numberOfLines={1}>
        Nearr
      </Text>
    </View>
  );
}

function ActionRow({
  icon,
  label,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.actionRow}>
      <Text style={styles.actionLabel}>{label}</Text>
      <Feather name={icon} size={18} color="#3C3C43" />
    </View>
  );
}

const SHEET_BG = '#F4F4F6';

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: SHEET_BG,
    borderRadius: 18,
    paddingHorizontal: H_PADDING,
    paddingTop: 8,
    paddingBottom: 14,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#C7C7CC',
    marginBottom: 12,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 12,
  },
  previewThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#E1E1E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewText: {
    flex: 1,
  },
  previewTitle: {
    color: '#1C1C1E',
    fontSize: 15,
    fontWeight: '700',
  },
  previewSub: {
    color: '#8E8E93',
    fontSize: 13,
    marginTop: 1,
  },
  exampleTag: {
    backgroundColor: '#E1E1E6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  exampleTagText: {
    color: '#636366',
    fontSize: 11,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#D9D9DE',
    marginVertical: 10,
  },
  row: {
    flexDirection: 'row',
  },
  tile: {
    alignItems: 'center',
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  msgBadge: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#31D158',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: SHEET_BG,
  },
  moreAvatar: {
    backgroundColor: '#E1E1E6',
  },
  appIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    color: '#3C3C43',
    fontSize: 11,
    marginTop: 6,
  },
  nearrLabel: {
    color: '#1C1C1E',
    fontWeight: '700',
  },
  nearrTarget: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
  },
  actionLabel: {
    color: '#1C1C1E',
    fontSize: 15,
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#D9D9DE',
  },
});
