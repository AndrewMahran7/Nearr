import { Redirect } from 'expo-router';

export default function Index() {
  // AuthGate handles routing. This is just a placeholder.
  // Map-first: the app lands on the Map tab. (Rollback: point this back to
  // '/(tabs)/home'.)
  return <Redirect href="/(tabs)/map" />;
}
