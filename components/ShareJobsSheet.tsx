import { i18n, t } from '@/lib/i18n';
import { useLocale } from '@/hooks/useLocale';
import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '@/lib/theme';

type Props = {
  children: ReactNode;
  onDismiss: () => void;
  size?: 'compact' | 'queue' | 'detail';
};

export function ShareJobsSheet({ children, onDismiss, size = 'queue' }: Props) {
  useLocale();
  const { colors, resolvedTheme } = useTheme();
  const { fontScale, height } = useWindowDimensions();
  const expandedForAccess = fontScale > 1.25 || height < 700;
  const styles = useMemo(() => createStyles(colors), [colors, i18n.language]);

  return (
    <View style={styles.backdrop}>
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t("Close")}
      />
      <SafeAreaView
        edges={['bottom', 'left', 'right']}
        style={[
          styles.sheet,
          size === 'detail'
            ? styles.detailSheet
            : size === 'compact'
              ? styles.compactSheet
              : styles.queueSheet,
          expandedForAccess && styles.detailSheet,
        ]}
      >

        <View style={styles.content}>{children}</View>
      </SafeAreaView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: colors.modalBackdrop,
    },
    sheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: 0,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    compactSheet: { height: '46%' },
    queueSheet: { height: '92%' },
    detailSheet: { height: '92%' },
    dragIndicator: {
      alignSelf: 'center',
      width: 38,
      height: 4,
      borderRadius: 2,
      marginTop: 8,
      backgroundColor: colors.textMuted,
      opacity: 0.7,
    },
    content: { flex: 1 },
  });
}
