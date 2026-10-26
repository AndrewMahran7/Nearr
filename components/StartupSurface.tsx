import { t } from '@/lib/i18n';
import { useLocale } from '@/hooks/useLocale';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants';
import type { StartupOwner } from '@/lib/startupWatchdogCore';
import { useOptionalTheme } from '@/lib/theme';

export function StartupSurface({
  owner,
  recovery = false,
  onRetry,
}: {
  owner: StartupOwner;
  recovery?: boolean;
  onRetry?: () => void;
}) {
  useLocale();
  const theme = useOptionalTheme();
  const palette = theme?.colors ?? Colors;
  const styles = createStyles(palette);
  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={recovery ? t("Nearr startup recovery") : t("Nearr is opening")}
      testID={recovery ? 'startup-recovery' : 'startup-loading'}
    >
      <Image source={require('../assets/icon.png')} style={styles.mark} accessible={false} />
      <Text style={styles.title}>{recovery ? t("Nearr needs another try") : t("Opening Nearr")}</Text>
      <Text style={styles.body}>
        {recovery
          ? t("Your saved places are safe. Check your connection, then try opening the app again.")
          : owner === 'ONBOARDING'
            ? t("Preparing your private map…")
            : t("Restoring your map…")}
      </Text>
      {recovery ? (
        <Pressable
          style={styles.button}
          onPress={onRetry}
          disabled={!onRetry}
          accessibilityRole="button"
          accessibilityLabel={t("Try opening Nearr again")}
        >
          <Text style={styles.buttonText}>{t("Try again")}</Text>
        </Pressable>
      ) : (
        <ActivityIndicator color={palette.primary} size="small" />
      )}
      {__DEV__ && <Text style={styles.owner}>{t("STARTUP OWNER: ")}{owner}</Text>}
    </View>
  );
}

function createStyles(Colors: typeof import('@/constants').Colors) { return StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: Colors.bg,
  },
  mark: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    backgroundColor: Colors.primary,
  },
  markText: { color: Colors.textInverse, fontSize: 28, fontWeight: '900' },
  title: { color: Colors.text, fontSize: 23, lineHeight: 28, fontWeight: '600', textAlign: 'center' },
  body: {
    maxWidth: 330,
    marginTop: 10,
    marginBottom: 24,
    color: Colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    minWidth: 180,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: Colors.primary,
  },
  buttonText: { color: Colors.textInverse, fontSize: 16, fontWeight: '800' },
  owner: { marginTop: 24, color: Colors.textMuted, fontSize: 10, letterSpacing: 1.2 },
}); }
