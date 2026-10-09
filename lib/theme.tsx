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
import { Colors, Typography, LightPalette, DarkPalette } from '@/constants';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type ThemeColors = typeof Colors & { modalBackdrop: string };

const THEME_PREFERENCE_KEY = 'nearr:themePreference';

const LightColors: ThemeColors = { ...LightPalette, modalBackdrop: LightPalette.overlay };
const DarkColors: ThemeColors = { ...DarkPalette, modalBackdrop: DarkPalette.overlay };

function createTypography(colors: ThemeColors) {
  return Object.fromEntries(Object.entries(Typography).map(([role, style]) => [
    role, { ...style, color: role === 'eyebrow' ? colors.accent : ['caption', 'metadata'].includes(role) ? colors.textSecondary : colors.text },
  ])) as typeof Typography;
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
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('light');
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

  // Fieldnotes Light is the first-install default. Existing explicit preferences persist.
  const resolvedTheme: ResolvedTheme =
    themePreference === 'system'
      ? systemColorScheme === 'dark'
        ? 'dark'
        : 'light'
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