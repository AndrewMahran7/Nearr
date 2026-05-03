import { useMemo } from 'react';
import { TextInput, TextInputProps, StyleSheet } from 'react-native';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

export function Input(props: TextInputProps) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      {...props}
      style={[styles.input, typography.body, props.style]}
    />
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      color: colors.text,
      backgroundColor: colors.surfaceElevated,
    },
  });
}
