import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useTheme } from '@/lib/theme';
import { MAP_FILTER_ALL, type MapFilterOption, type MapVisibilityFilter } from '@/lib/mapVisibility';

type Props = { options: MapFilterOption[]; value: MapVisibilityFilter; onChange: (next: MapVisibilityFilter) => void; onFitAll?: () => void; expanded?: boolean };
/** One quiet control in normal use; the actual filter choices remain visible for Phase 2 teaching. */
export function MapCategoryFilterBar({ options, value, onChange, onFitAll, expanded = false }: Props) {
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReduceMotion();
  const [open, setOpen] = useState(false);
  if (!options.length && !onFitAll) return null;
  const label = value === MAP_FILTER_ALL ? 'All places' : options.find(item => item.id === value)?.label ?? 'Filter';
  const choose = (next: MapVisibilityFilter) => { onChange(next); setOpen(false); };
  const choices = options.map(option => <Pressable key={option.id} onPress={() => choose(option.id)} accessibilityRole="button" accessibilityState={{ selected: option.id === value }} accessibilityLabel={`Show ${option.label}, ${option.count} places`} style={({ pressed }) => [styles.choice, { backgroundColor: option.id === value || pressed ? colors.surfaceElevated : 'transparent' }]}>
    <Text style={[typography.bodyStrong, styles.flex]}>{option.label}</Text><Text style={typography.caption}>{option.count}</Text>{option.id === value ? <Feather name="check" size={20} color={colors.accent} /> : null}
  </Pressable>);
  return <View style={expanded ? styles.expanded : styles.wrap}>
    {expanded ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teachingChoices}>{options.map(option => <Pressable key={option.id} onPress={() => onChange(option.id)} accessibilityRole="button" accessibilityState={{ selected: option.id === value }} style={[styles.chip, { backgroundColor: option.id === value ? colors.primary : colors.surface, borderColor: colors.border }]}><Text style={[typography.label, { color: option.id === value ? colors.textInverse : colors.text }]}>{option.label}</Text></Pressable>)}</ScrollView> :
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`Filter map, ${label}`} accessibilityState={{ expanded: open }} style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? colors.surfaceElevated : colors.surface, borderColor: colors.border }]}><Feather name="sliders" size={17} color={colors.text} /><Text style={typography.label}>{label}</Text></Pressable>}
    <Modal visible={open} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => setOpen(false)}>
      <View style={styles.modal}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close filters" />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.header}><Text style={[typography.heading, styles.flex]}>Your map, your way</Text><Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close filters" style={styles.close}><Feather name="x" size={22} color={colors.text} /></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled">{choices}{onFitAll ? <Pressable onPress={() => { setOpen(false); onFitAll(); }} accessibilityRole="button" accessibilityLabel="Fit all visible places on the map" style={styles.choice}><Feather name="maximize" size={20} color={colors.text} /><Text style={typography.bodyStrong}>Show these places on the map</Text></Pressable> : null}</ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({ wrap: { alignSelf: 'flex-end' }, expanded: { width: '100%' }, flex: { flex: 1 }, chip: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 44, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 8 }, teachingChoices: { gap: 8 }, modal: { flex: 1, justifyContent: 'flex-end' }, sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '80%', paddingHorizontal: 24, paddingTop: 16 }, header: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, padding: 12, borderRadius: 12, marginBottom: 4 } });
