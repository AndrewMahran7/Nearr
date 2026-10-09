import { Feather } from '@expo/vector-icons';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';

export function IconButton({ icon, label, onPress, disabled, style }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [{ minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }, style]}><Feather name={icon} size={20} color={colors.text} /></Pressable>;
}

export function FilterChip({ label, selected, onPress, count }: { label: string; selected?: boolean; onPress: () => void; count?: number }) {
  const { colors, typography } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${label}${count == null ? '' : `, ${count}`}`} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: selected ? colors.primary : colors.controlBorder, backgroundColor: selected ? colors.primary : colors.surface, opacity: pressed ? 0.8 : 1 })}><Text style={[typography.label, { color: selected ? colors.textInverse : colors.text }]}>{label}{count == null ? '' : ` · ${count}`}</Text></Pressable>;
}

export function StatusRow({ title, body, tone = 'neutral' }: { title: string; body?: string; tone?: 'neutral' | 'success' | 'warning' | 'error' }) {
  const { colors, typography } = useTheme();
  const ink = tone === 'error' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.textSecondary;
  const icon = tone === 'error' ? 'alert-circle' : tone === 'warning' ? 'help-circle' : tone === 'success' ? 'check-circle' : 'info';
  return <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 16 }}><Feather name={icon} size={20} color={ink} /><View style={{ flex: 1, gap: 4 }}><Text style={[typography.label, { color: ink }]}>{title}</Text>{body && <Text style={typography.compact}>{body}</Text>}</View></View>;
}
