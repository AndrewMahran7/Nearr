/**
 * EmptyState — shared component for empty / error / permission-denied states.
 *
 * Consistent typography, spacing, and an optional primary CTA across:
 *   - Home / Places (no saved places yet)
 *   - SavePlace search (no results, no query yet)
 *   - Map (location denied)
 *   - Settings (notifications disabled hint)
 *
 * Variants:
 *   - 'default'  : neutral muted text, primary CTA when provided.
 *   - 'error'    : title rendered in danger color; CTA defaults to secondary.
 *
 * Keep this component dumb — no animation, no async logic.
 */

import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import { Colors, Spacing, Typography } from '@/constants';

type Variant = 'default' | 'error';

type Props = {
  title: string;
  body?: string;
  /** Primary CTA. Hidden when not provided. */
  actionTitle?: string;
  onAction?: () => void;
  /** Secondary text-only action shown below the primary CTA. */
  secondaryTitle?: string;
  onSecondary?: () => void;
  variant?: Variant;
  /** Render inside a Card (default true). Set false for full-bleed contexts. */
  framed?: boolean;
  style?: ViewStyle;
};

export function EmptyState({
  title,
  body,
  actionTitle,
  onAction,
  secondaryTitle,
  onSecondary,
  variant = 'default',
  framed = true,
  style,
}: Props) {
  const titleColor = variant === 'error' ? Colors.danger : Colors.text;

  const content = (
    <>
      <Text style={[Typography.heading, { color: titleColor }]}>{title}</Text>
      {body ? (
        <Text style={[Typography.body, styles.body]} numberOfLines={4}>
          {body}
        </Text>
      ) : null}
      {actionTitle && onAction ? (
        <View style={styles.actionWrap}>
          <Button
            title={actionTitle}
            onPress={onAction}
            variant={variant === 'error' ? 'secondary' : 'primary'}
          />
        </View>
      ) : null}
      {secondaryTitle && onSecondary ? (
        <View style={styles.secondaryWrap}>
          <Button title={secondaryTitle} onPress={onSecondary} variant="ghost" />
        </View>
      ) : null}
    </>
  );

  if (framed) {
    return <Card style={StyleSheet.flatten([styles.card, style])}>{content}</Card>;
  }
  return <View style={[styles.bare, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'flex-start',
  },
  bare: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    alignItems: 'flex-start',
  },
  body: {
    color: Colors.textMuted,
    marginTop: Spacing.xs,
    lineHeight: 22,
  },
  actionWrap: {
    marginTop: Spacing.lg,
    alignSelf: 'stretch',
  },
  secondaryWrap: {
    marginTop: Spacing.xs,
    alignSelf: 'stretch',
  },
});
