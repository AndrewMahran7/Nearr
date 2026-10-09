/** Fieldnotes semantic palette. `Colors` is the light fallback for legacy callers. */
export const LightPalette = {
  bg: '#F7F4EE', surface: '#FFFDF8', surfaceElevated: '#EEEBE3',
  border: '#D9D8CF', controlBorder: '#7B8073',
  text: '#242621', textSecondary: '#62675B', textMuted: '#62675B',
  textInverse: '#FFFFFF', primary: '#263A32',
  accent: '#AD3A16', accentSoft: 'rgba(173, 58, 22, 0.07)', accentBorder: 'rgba(173, 58, 22, 0.24)',
  brand: '#FF9957', brandRed: '#FF6048', onGradient: '#29170F',
  gradientStart: '#FF9957', gradientEnd: '#FF6048',
  danger: '#973820', dangerSurface: '#F8DED5',
  success: '#284D34', successSurface: '#DEECD9',
  warning: '#684615', warningSurface: '#F4DFB7',
  overlay: 'rgba(24, 35, 27, 0.35)',
};

export const DarkPalette: typeof LightPalette = {
  bg: '#171A18', surface: '#222823', surfaceElevated: '#303830',
  border: '#505C4E', controlBorder: '#A1AD9B',
  text: '#F4F3EB', textSecondary: '#B4BCAE', textMuted: '#B4BCAE',
  textInverse: '#18231B', primary: '#DCE9DC',
  accent: '#FFA47B', accentSoft: 'rgba(255, 164, 123, 0.08)', accentBorder: 'rgba(255, 164, 123, 0.26)',
  brand: '#FF9957', brandRed: '#FF6048', onGradient: '#29170F',
  gradientStart: '#FF9957', gradientEnd: '#FF6048',
  danger: '#FFC4B8', dangerSurface: '#482A26',
  success: '#BEE1C4', successSurface: '#233D2D',
  warning: '#F2D49E', warningSurface: '#44371F',
  overlay: 'rgba(0, 0, 0, 0.55)',
};

export const Colors = LightPalette;
