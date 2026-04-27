import type { TextStyle } from 'react-native';

export const Typography: Record<string, TextStyle> = {
  display: { fontSize: 36, fontWeight: '800', letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 16, fontWeight: '400' },
  bodyStrong: { fontSize: 16, fontWeight: '600' },
  caption: { fontSize: 13, fontWeight: '400' },
  label: { fontSize: 14, fontWeight: '600' },
};
