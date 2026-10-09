import { Feather } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

type Props = { title: string; platform?: string; thumbnail?: string | null; caption?: string; onPress?: () => void; compact?: boolean; unavailable?: boolean };

/** Provenance only. This component never fetches or substitutes place photography. */
export function SourceRibbon({ title, platform, thumbnail, caption, onPress, compact, unavailable }: Props) {
  const { colors, typography } = useTheme();
  return (
    <Pressable accessibilityRole={onPress && !unavailable ? 'button' : undefined} accessibilityLabel={`${platform ? `${platform}. ` : ''}${title}${unavailable ? '. Original unavailable' : ''}`} accessibilityHint={onPress && !unavailable ? 'Watch the original post in its source app' : undefined} disabled={!onPress || unavailable} onPress={onPress}
      style={({ pressed }) => [styles.ribbon, { backgroundColor: colors.surfaceElevated, opacity: pressed ? 0.8 : 1 }]}>
      <View style={[styles.thumbnail, { height: compact ? 48 : 66, width: compact ? 36 : 48, backgroundColor: colors.surface }]}>
        {thumbnail ? <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} /> : <Feather name="film" size={20} color={colors.textSecondary} />}
      </View>
      <View style={styles.text}>
        <Text style={[typography.eyebrow, { color: colors.textSecondary }]}>{platform ? `FROM ${platform.toUpperCase()}` : 'FROM THE ORIGINAL POST'}</Text>
        <Text style={typography.label} numberOfLines={compact ? 2 : undefined}>{title}</Text>
        {!!caption && !compact && <Text style={typography.metadata}>{caption}</Text>}
        {!!onPress && !unavailable && <Text style={[typography.label, { color: colors.accent }]}>Watch original</Text>}
        {unavailable && <Text style={typography.metadata}>Original unavailable</Text>}
      </View>
      {!!onPress && !unavailable && <Feather name="arrow-up-right" size={18} color={colors.textSecondary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ribbon: { minHeight: 64, padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbnail: { borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 4 },
});
