import { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants';
import { OnboardingColors } from './theme';
import { OnboardingProgress } from './OnboardingProgress';

type Props = {
  /** Main scrollable content (headline, cards, etc.). */
  children: ReactNode;
  /** Sticky bottom area — typically the primary CTA + optional skip. */
  footer?: ReactNode;
  /** Show a back chevron top-left and wire it up. Omit to hide. */
  onBack?: () => void;
  /** Optional element rendered top-right (e.g. a "Sign in" link). */
  headerRight?: ReactNode;
  /** Segmented progress shown under the top row. Omit to hide. */
  progress?: { total: number; current: number };
  /** Set false to render content in a plain View instead of a ScrollView. */
  scroll?: boolean;
  /** Extra style for the content container. */
  contentStyle?: ViewStyle;
};

/**
 * Layout scaffold for every onboarding screen.
 *
 * Structure (top → bottom):
 *   - safe-area top inset
 *   - top row: optional back button + optional progress + optional headerRight
 *   - flexible content area (scrolls by default)
 *   - sticky footer (CTA area) above the safe-area bottom inset
 *
 * Uses safe-area insets rather than hardcoded heights so it adapts to
 * notch / no-notch / Dynamic Island iPhones and Android.
 */
export function OnboardingScreenShell({
  children,
  footer,
  onBack,
  headerRight,
  progress,
  scroll = true,
  contentStyle,
}: Props) {
  const insets = useSafeAreaInsets();

  const hasTopRow = !!onBack || !!headerRight || !!progress;

  const content = (
    <View style={[styles.content, contentStyle]}>{children}</View>
  );

  return (
    <View style={styles.root}>
      <View style={{ height: insets.top }} />

      {hasTopRow ? (
        <View style={styles.topRow}>
          <View style={styles.topLeft}>
            {onBack ? (
              <Pressable
                onPress={onBack}
                hitSlop={12}
                style={styles.backButton}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Feather name="chevron-left" size={26} color={OnboardingColors.text} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.topCenter}>
            {progress ? (
              <OnboardingProgress total={progress.total} current={progress.current} />
            ) : null}
          </View>

          <View style={styles.topRight}>{headerRight}</View>
        </View>
      ) : null}

      {scroll ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      ) : (
        <View style={styles.flexFill}>{content}</View>
      )}

      {footer ? (
        <View
          style={[
            styles.footer,
            { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}
        >
          {footer}
        </View>
      ) : (
        <View style={{ height: Math.max(insets.bottom, Spacing.sm) }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: OnboardingColors.background,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    minHeight: 44,
  },
  topLeft: {
    width: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  topCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRight: {
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  backButton: {
    height: 44,
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  flexFill: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  content: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
  },
});
