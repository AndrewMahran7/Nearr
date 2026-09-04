import { StyleSheet, View } from 'react-native';

const ORANGE = '#FF6A1A';

export function TokenSymbol({ size = 18, muted = false }: { size?: number; muted?: boolean }) {
  const color = muted ? '#9B9BA0' : ORANGE;
  const arm = Math.max(2, Math.round(size * 0.16));
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={[styles.frame, { width: size, height: size }]}
    >
      <View
        style={[
          styles.diamond,
          {
            width: Math.round(size * 0.62),
            height: Math.round(size * 0.62),
            borderRadius: Math.max(2, Math.round(size * 0.13)),
            borderColor: color,
          },
        ]}
      />
      <View
        style={[
          styles.core,
          {
            width: arm,
            height: arm,
            borderRadius: arm / 2,
            backgroundColor: color,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  diamond: {
    position: 'absolute',
    borderWidth: 2,
    transform: [{ rotate: '45deg' }],
  },
  core: {
    position: 'absolute',
  },
});
