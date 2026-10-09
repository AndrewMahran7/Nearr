import type { TextStyle } from 'react-native';
import { Colors } from './colors';

/** Native/system type only. Text scales with the user's content-size preference. */
export const Typography = {
  display: { fontSize: 37, lineHeight: 41, fontWeight: '600', letterSpacing: -1.2, color: Colors.text },
  largeTitle: { fontSize: 32, lineHeight: 38, fontWeight: '600', letterSpacing: -0.8, color: Colors.text },
  title: { fontSize: 23, lineHeight: 28, fontWeight: '600', letterSpacing: -0.4, color: Colors.text },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: Colors.text },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400', color: Colors.text },
  bodyStrong: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: Colors.text },
  compact: { fontSize: 15, lineHeight: 21, fontWeight: '400', color: Colors.text },
  metadata: { fontSize: 13, lineHeight: 18, fontWeight: '400', color: Colors.textSecondary },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: Colors.textSecondary },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: Colors.text },
  button: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: Colors.text },
  eyebrow: { fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 1.2, color: Colors.accent },
} satisfies Record<string, TextStyle>;
