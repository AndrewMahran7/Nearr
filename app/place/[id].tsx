import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Legacy/deep-link compatibility route. The map-owned SelectedPlaceDetails is
 * the single saved-place detail presentation, so fallback links enter that
 * same sheet instead of maintaining a second settings-style screen.
 */
export default function PlaceDetailRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <Redirect
      href={{
        pathname: '/(tabs)/map',
        params: { savedPlaceId: id },
      }}
    />
  );
}
