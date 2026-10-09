import assert from 'node:assert/strict';
import Module from 'node:module';
import { LightPalette, DarkPalette } from '../constants/colors';

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
const pairs = ['text', 'textSecondary', 'accent'] as const;
let checks = 0;
for (const [name, palette] of Object.entries({ light: LightPalette, dark: DarkPalette })) {
  for (const foreground of pairs) for (const surface of ['bg', 'surface', 'surfaceElevated'] as const) {
    const a = luminance(palette[foreground]), b = luminance(palette[surface]);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${name} ${foreground}/${surface} must meet normal text contrast`); checks++;
  }
  for (const [fg, bg] of [['textInverse', 'primary'], ['onGradient', 'gradientStart'], ['onGradient', 'gradientEnd'], ['success', 'successSurface'], ['warning', 'warningSurface'], ['danger', 'dangerSurface']] as const) {
    const a = luminance(palette[fg]), b = luminance(palette[bg]);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${name} ${fg}/${bg}`); checks++;
  }
}

const moduleInternals = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = moduleInternals._load;
const originalNow = Date.now;
const state = { currentState: 'active' };
const platform = { OS: 'ios' };
let now = 1000;
const calls: string[] = [];
moduleInternals._load = function (id, ...args) {
  if (id === 'react-native') return { AppState: state, Platform: platform };
  if (id === 'expo-haptics') return { selectionAsync: async () => { calls.push('selection'); }, impactAsync: async () => { calls.push('impact'); }, notificationAsync: async (kind: string) => { calls.push(kind); }, ImpactFeedbackStyle: { Light: 'light' }, NotificationFeedbackType: { Success: 'success', Error: 'error' } };
  return originalLoad.call(this, id, ...args);
};
try {
  Date.now = () => now;
  const { hapticSuccess, hapticSelection, hapticImpact, hapticError } = require('../lib/haptics');
  hapticSuccess(); hapticSuccess(); hapticSelection();
  assert.deepEqual(calls, ['success'], 'bursts must coalesce'); checks++;
  now += 600; hapticSelection(); assert.equal(calls.at(-1), 'selection'); checks++;
  now += 600; state.currentState = 'background'; hapticSuccess(); assert.equal(calls.length, 2); checks++;
  state.currentState = 'active'; platform.OS = 'web'; hapticImpact(); assert.equal(calls.length, 2); checks++;
  platform.OS = 'ios'; hapticError(); assert.equal(calls.at(-1), 'error'); checks++;
} finally { moduleInternals._load = originalLoad; Date.now = originalNow; }
console.log(`PASS Fieldnotes foundation: ${checks} contrast and feedback checks`);
