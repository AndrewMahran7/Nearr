import type { TextStyle } from 'react-native';
import { Colors } from './colors';

export const Typography: Record<string, TextStyle> = {
  display: { fontSize: 36, fontWeight: '800', letterSpacing: -0.5, color: Colors.text },
  title: { fontSize: 22, fontWeight: '700', color: Colors.text },
  heading: { fontSize: 18, fontWeight: '700', color: Colors.text },
  body: { fontSize: 16, fontWeight: '400', color: Colors.text },
  bodyStrong: { fontSize: 16, fontWeight: '600', color: Colors.text },
  caption: { fontSize: 13, fontWeight: '400', color: Colors.textSecondary },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text },
};
