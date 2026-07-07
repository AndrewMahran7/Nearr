import { Redirect } from 'expo-router';

import { useAuth } from '@/hooks/useAuth';

export default function Index() {
  // Initial-entry decision. Onboarding is now the PUBLIC pre-auth landing:
  // logged-out users see the intro first; signed-in users go to the map.
  // AuthGate remains the ongoing guard. (Rollback: point the signed-in
  // destination back to '/(tabs)/home'.)
  const { session, loading } = useAuth();

  if (loading) return null;
  if (!session) return <Redirect href="/(onboarding)" />;
  return <Redirect href="/(tabs)/map" />;
}
