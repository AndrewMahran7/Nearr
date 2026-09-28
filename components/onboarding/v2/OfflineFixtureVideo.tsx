import { useState } from 'react';
import { Video, ResizeMode } from 'expo-av';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { offlineOnboardingMedia } from '@/onboarding/assets/offlineOnboardingAssets';
import type { OfflineOnboardingAssetKey } from '@/onboarding/fixtures/offlineOnboardingFixtures';

type Props = {
  assetKey: OfflineOnboardingAssetKey;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  testID?: string;
};

/** Local-only, silent, looping playback. No runtime URL is accepted by design. */
export function OfflineFixtureVideo({ assetKey, style, accessibilityLabel, testID }: Props) {
  const media = offlineOnboardingMedia(assetKey);
  const [videoReady, setVideoReady] = useState(false);
  return (
    <View style={[styles.frame, style]} accessibilityLabel={accessibilityLabel} testID={testID}>
      <Image
        source={media.sourcePosterAsset}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        testID={testID ? `${testID}-poster` : undefined}
      />
      <Video
        source={media.sourceVideoAsset}
        posterSource={media.sourcePosterAsset}
        usePoster
        shouldPlay
        isLooping
        isMuted
        volume={0}
        resizeMode={ResizeMode.COVER}
        onReadyForDisplay={() => setVideoReady(true)}
        style={[StyleSheet.absoluteFill, !videoReady && styles.videoPending]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: '#1B2623' },
  videoPending: { opacity: 0 },
});
