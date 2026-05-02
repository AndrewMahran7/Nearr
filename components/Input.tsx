import { TextInput, TextInputProps, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants';

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={Colors.textMuted}
      {...props}
      style={[styles.input, Typography.body, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    color: Colors.text,
    backgroundColor: Colors.surfaceElevated,
  },
});
