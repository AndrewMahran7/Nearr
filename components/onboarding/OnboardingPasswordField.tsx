import { forwardRef } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { OnboardingColors, OnboardingRadius } from './theme';

type Props = Omit<TextInputProps, 'secureTextEntry'> & {
  /** Current visibility, owned by the screen so several fields can share it. */
  visible: boolean;
  onToggleVisible: () => void;
  accessibilityLabel: string;
};

/**
 * Secure text field with a show/hide affordance.
 *
 * Always renders as a secure input when hidden, exposes a 44pt toggle target,
 * and leaves autocomplete/content-type choices to the caller so sign-in
 * ("current-password") and sign-up ("new-password") get the right keychain
 * behaviour.
 */
export const OnboardingPasswordField = forwardRef<TextInput, Props>(
  function OnboardingPasswordField(
    { visible, onToggleVisible, accessibilityLabel, style, editable, ...rest },
    ref,
  ) {
    return (
      <View style={styles.field}>
        <TextInput
          ref={ref}
          {...rest}
          editable={editable}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholderTextColor={OnboardingColors.textMuted}
          accessibilityLabel={accessibilityLabel}
          style={[styles.input, style]}
        />
        <Pressable
          onPress={onToggleVisible}
          disabled={editable === false}
          hitSlop={8}
          style={styles.toggle}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          accessibilityHint="Toggles whether the password characters are visible"
        >
          <Feather
            name={visible ? 'eye-off' : 'eye'}
            size={19}
            color={OnboardingColors.textMuted}
          />
        </Pressable>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  field: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: OnboardingRadius.button,
    backgroundColor: OnboardingColors.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
  },
  input: {
    flex: 1,
    height: 54,
    paddingLeft: 18,
    color: OnboardingColors.text,
    fontSize: 16,
  },
  toggle: {
    width: 48,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
