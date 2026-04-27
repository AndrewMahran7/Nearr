/**
 * Home screen.
 *
 * One-screen overview:
 *   - greeting (uses the user's email handle)
 *   - quick "Save a place" CTA + secondary actions
 *   - the user's saved places, newest first
 *
 * Each card surfaces name, address, radius (with profile-default fallback),
 * notifications on/off, and source badge. Tapping the card opens the
 * detail/edit screen; the inline Remove button confirms then deletes.
 *
 * States handled: loading (initial spinner), error (with retry), empty
 * (gentle prompt), populated (FlatList with pull-to-refresh).
 *
 * Refreshes whenever the screen regains focus so a save / edit / delete
 * elsewhere is reflected immediately on return.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Button, Card, DemoModeBanner, DevModeBanner, EmptyState, SavedPlaceCard, Screen } from '@/components';
import { Colors, Spacing, Typography } from '@/constants';

import { useAuth } from '@/hooks/useAuth';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { getProfile } from '@/services/profileService';
import { deleteSavedPlace } from '@/services/savedPlacesService';
import type { Profile } from '@/types';

function greeting(email: string | null | undefined): string {
  if (!email) return 'Welcome back';
  const handle = email.split('@')[0];
  if (!handle) return 'Welcome back';
  return `Hi, ${handle}`;
}

export default function Home() {
  const router = useRouter();
  const { user, isLocalUiSession } = useAuth();
  const { data, loading, refreshing, error, refresh } = useSavedPlaces();

  const [profile, setProfile] = useState<Profile | null>(null);
  const loadProfile = useCallback(async () => {
    const p = await getProfile();
    setProfile(p);
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // Re-fetch list and profile whenever Home regains focus.
  useFocusEffect(
    useCallback(() => {
      void refresh();
      void loadProfile();
    }, [refresh, loadProfile]),
  );

  async function handleDelete(id: string) {
    try {
      await deleteSavedPlace(id);
      await refresh();
    } catch (e: any) {
      Alert.alert('Could not remove', e?.message ?? 'Unknown error.');
    }
  }

  const notificationsOff =
    !!profile && (!profile.notifications_enabled || !profile.nearby_notifications_enabled);

  // -----------------------------------------------------------------------
  // Header (greeting + actions + section label)
  // -----------------------------------------------------------------------
  const Header = (
    <View style={styles.header}>
      <DevModeBanner visible={isLocalUiSession} />
      <DemoModeBanner />
      <Text style={[Typography.title, styles.greeting]}>{greeting(user?.email)}</Text>
      <Text style={[Typography.body, styles.sub]}>
        {data.length === 0
          ? 'Save places once. Nearr reminds you when you\u2019re nearby.'
          : `You have ${data.length} saved place${data.length === 1 ? '' : 's'}.`}
      </Text>

      <View style={styles.actions}>
        <Button title="Save a place" onPress={() => router.push('/add-place')} />
        <View style={{ height: Spacing.sm }} />
        <View style={styles.secondaryRow}>
          <Button
            title="From a link"
            variant="secondary"
            onPress={() => router.push('/share')}
            style={{ flex: 1 }}
          />
          <View style={{ width: Spacing.sm }} />
          <Button
            title="Open map"
            variant="secondary"
            onPress={() => router.push('/(tabs)/map')}
            style={{ flex: 1 }}
          />
        </View>
      </View>

      {notificationsOff && data.length > 0 ? (
        <Card style={styles.hintCard}>
          <Text style={Typography.bodyStrong}>Nearby alerts are off</Text>
          <Text style={[Typography.caption, { color: Colors.textMuted, marginTop: 2 }]}>
            Turn them on in Settings to get pinged near your saved places.
          </Text>
          <View style={{ height: Spacing.sm }} />
          <Button
            title="Open settings"
            variant="secondary"
            onPress={() => router.push('/(tabs)/settings')}
          />
        </Card>
      ) : null}

      {data.length > 0 ? (
        <Text style={[Typography.label, styles.sectionLabel]}>Saved places</Text>
      ) : null}
    </View>
  );

  // -----------------------------------------------------------------------
  // States
  // -----------------------------------------------------------------------
  if (loading && data.length === 0) {
    return (
      <Screen>
        {Header}
        <View style={styles.centerBox}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (error && data.length === 0) {
    return (
      <Screen>
        <View style={{ padding: Spacing.lg }}>
          {Header}
          <EmptyState
            variant="error"
            title={'Couldn\u2019t load your places'}
            body={error}
            actionTitle="Try again"
            onAction={refresh}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={data}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={Header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        renderItem={({ item }) => (
          <SavedPlaceCard
            saved={item}
            profile={profile}
            onPress={() => router.push(`/place/${item.id}`)}
            onDelete={() => handleDelete(item.id)}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            title="No places yet"
            body="Save your first spot, or paste a TikTok / Instagram link to get started."
            actionTitle="Save a place"
            onAction={() => router.push('/add-place')}
            secondaryTitle="Save from a link"
            onSecondary={() => router.push('/share')}
            style={styles.emptyCard}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  header: {
    marginBottom: Spacing.md,
  },
  greeting: { marginBottom: Spacing.xs },
  sub: { color: Colors.textMuted, marginBottom: Spacing.lg },
  actions: { marginBottom: Spacing.xl },
  secondaryRow: { flexDirection: 'row' },
  sectionLabel: {
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  centerBox: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  errorCard: { marginTop: Spacing.lg },
  emptyCard: { marginTop: Spacing.md },
  hintCard: { marginBottom: Spacing.lg },
});
