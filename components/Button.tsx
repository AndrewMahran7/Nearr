import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Fieldnotes, Radius } from '@/constants';
import { useTheme } from '@/lib/theme';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'text' | 'save' | 'destructive';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Feather>['name'];
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style, accessibilityLabel }: Props) {
  const { colors, typography } = useTheme();
  const quiet = variant === 'ghost' || variant === 'text';
  const foreground = variant === 'save' ? colors.onGradient : variant === 'primary' ? colors.textInverse : variant === 'destructive' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.base, {
        backgroundColor: variant === 'primary' ? colors.primary : variant === 'destructive' ? colors.dangerSurface : quiet ? 'transparent' : colors.surface,
        borderWidth: variant === 'secondary' ? 1 : 0,
        borderColor: colors.controlBorder,
        opacity: disabled ? 0.5 : pressed ? 0.82 : 1,
      }, style]}
    >
      {variant === 'save' && <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={foreground} /> : icon ? <Feather name={icon} size={18} color={foreground} /> : null}
        <Text style={[typography.button, { color: foreground, flexShrink: 1, textAlign: 'center' }]}>{title}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: Fieldnotes.buttonMinHeight, paddingVertical: 12, paddingHorizontal: 16, borderRadius: Radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
