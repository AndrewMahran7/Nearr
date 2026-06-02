import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import { Colors, Typography } from '@/constants';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type ThemeColors = typeof Colors & { modalBackdrop: string };

const THEME_PREFERENCE_KEY = 'nearr:themePreference';

const LightColors: ThemeColors = {
  bg: '#FFF8F1',
  surface: '#FFFFFF',
  surfaceElevated: '#FFF3E7',
  border: '#E7D6C4',
  text: '#1F1913',
  textSecondary: '#6F6257',
  textMuted: '#8A7D72',
  textInverse: '#FFFFFF',
  primary: '#D85C16',
  accent: '#D85C16',
  gradientStart: '#FF9A3D',
  gradientEnd: '#E5512C',
  danger: '#D14343',
  success: '#1F9D55',
  overlay: 'rgba(20, 14, 9, 0.18)',
  modalBackdrop: 'rgba(20, 14, 9, 0.18)',
};

const DarkColors: ThemeColors = {
  ...Colors,
  modalBackdrop: Colors.overlay,
};

function createTypography(colors: ThemeColors) {
  return {
    ...Typography,
    display: { ...Typography.display, color: colors.text },
    title: { ...Typography.title, color: colors.text },
    heading: { ...Typography.heading, color: colors.text },
    body: { ...Typography.body, color: colors.text },
    bodyStrong: { ...Typography.bodyStrong, color: colors.text },
    caption: { ...Typography.caption, color: colors.textSecondary },
    label: { ...Typography.label, color: colors.text },
  };
}

type ThemeContextValue = {
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  resolvedTheme: ResolvedTheme;
  colors: ThemeColors;
  typography: ReturnType<typeof createTypography>;
  isThemeReady: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [isThemeReady, setIsThemeReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const storedPreference = await AsyncStorage.getItem(THEME_PREFERENCE_KEY);
        if (!cancelled && isThemePreference(storedPreference)) {
          setThemePreferenceState(storedPreference);
        }
      } finally {
        if (!cancelled) {
          setIsThemeReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setThemePreference = useCallback((preference: ThemePreference) => {
    setThemePreferenceState(preference);
    void AsyncStorage.setItem(THEME_PREFERENCE_KEY, preference);
  }, []);

  // 2026-05-27 — Light mode re-enabled. The resolved theme now honors
  // the user's `themePreference` again: `system` follows the OS color
  // scheme, `light` forces `LightColors`, `dark` forces `DarkColors`.
  //
  // Historical note (kept for context): screens that import the static
  // `Colors` constant directly will still render with the dark palette
  // regardless of the resolved theme — those screens should migrate to
  // `useTheme().colors` if they look off in light mode. See
  // docs/UI_THEME_NOTES.md.
  const resolvedTheme: ResolvedTheme =
    themePreference === 'system'
      ? systemColorScheme === 'light'
        ? 'light'
        : 'dark'
      : themePreference;

  const colors = resolvedTheme === 'light' ? LightColors : DarkColors;
  const typography = useMemo(() => createTypography(colors), [colors]);

  const value = useMemo(
    () => ({
      themePreference,
      setThemePreference,
      resolvedTheme,
      colors,
      typography,
      isThemeReady,
    }),
    [themePreference, setThemePreference, resolvedTheme, colors, typography, isThemeReady],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }

  return context;
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export { DarkColors, LightColors, THEME_PREFERENCE_KEY };