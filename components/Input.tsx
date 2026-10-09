import { useMemo, useState } from 'react';
import { TextInput, TextInputProps, StyleSheet } from 'react-native';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

export function Input(props: TextInputProps) {
  const [focused, setFocused] = useState(false);
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      {...props}
      selectionColor={colors.accent}
      onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
      style={[styles.input, typography.body, focused && { borderColor: colors.primary }, props.style]}
    />
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    input: {
      borderWidth: 1,
      borderColor: colors.controlBorder,
      minHeight: 50,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      color: colors.text,
      backgroundColor: colors.surfaceElevated,
    },
  });
}
