/**
 * Home screen.
 *
 * One-screen overview:
 *   - greeting (uses the user's email handle)
 *   - quick "Save a place" CTA + secondary actions
 *   - the user's saved places, newest first
 *
 * Each card surfaces the place, where it came from, and quick actions to
 * get back to it. Tapping the card opens the detail/edit screen; the inline
 * Remove button confirms then deletes.
 *
 * States handled: loading (initial spinner), error (with retry), empty
 * (gentle prompt), populated (FlatList with pull-to-refresh).
 *
 * Refreshes whenever the screen regains focus so a save / edit / delete
 * elsewhere is reflected immediately on return.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Button,
  Card,
  DemoModeBanner,
  DevModeBanner,
  EmptyState,
  HowNearrWorksModal,
  SavedPlaceCard,
  Screen,
} from '@/components';
import { Colors, Spacing, Typography } from '@/constants';

import { useAuth } from '@/hooks/useAuth';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { distanceMeters, metersToMiles } from '@/lib/geo';
import { getProfile } from '@/services/profileService';
import { deleteSavedPlace } from '@/services/savedPlacesService';
import type { Profile, SavedPlaceWithPlace } from '@/types';

function greeting(email: string | null | undefined): string {
  if (!email) return 'Welcome back';
  const handle = email.split('@')[0];
  if (!handle) return 'Welcome back';
  return `Hi, ${handle}`;
}

function formatCount(count: number): string {
  return `${count} saved place${count === 1 ? '' : 's'}`;
}

function formatNearbyDistance(meters: number): string {
  const miles = metersToMiles(meters);
  if (miles < 0.1) return 'Nearby now';
  const rounded = miles >= 10 ? Math.round(miles) : Math.round(miles * 10) / 10;
  return `${rounded} mi away`;
}

type NearbyPlace = {
  saved: SavedPlaceWithPlace;
  distance: number;
};

export default function Home() {
  const router = useRouter();
  const { user, isLocalUiSession } = useAuth();
  const { data, loading, refreshing, error, refresh } = useSavedPlaces();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [howNearrWorksVisible, setHowNearrWorksVisible] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<Location.LocationObjectCoords | null>(null);

  const loadProfile = useCallback(async () => {
    const p = await getProfile();
    setProfile(p);
  }, []);

  const loadLocation = useCallback(async () => {
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setCurrentLocation(null);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCurrentLocation(position.coords);
    } catch {
      setCurrentLocation(null);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
    void loadLocation();
  }, [loadLocation, loadProfile]);

  // Re-fetch list and profile whenever Home regains focus.
  useFocusEffect(
    useCallback(() => {
      void refresh();
      void loadProfile();
      void loadLocation();
    }, [refresh, loadLocation, loadProfile]),
  );

  async function handleDelete(id: string) {
    try {
      await deleteSavedPlace(id);
      await refresh();
    } catch (e: any) {
      Alert.alert('Could not remove', e?.message ?? 'Unknown error.');
    }
  }

  const recentPlaces = useMemo(() => data.slice(0, 3), [data]);

  const nearbyPlaces = useMemo<NearbyPlace[]>(() => {
    if (!currentLocation) return [];

    return data
      .filter(
        (saved) =>
          Number.isFinite(saved.place?.latitude) && Number.isFinite(saved.place?.longitude),
      )
      .map((saved) => ({
        saved,
        distance: distanceMeters(
          { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
          { latitude: saved.place.latitude, longitude: saved.place.longitude },
        ),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 3);
  }, [currentLocation, data]);

  function renderSavedPlace(saved: SavedPlaceWithPlace, metaPrefix?: string | null) {
    return (
      <SavedPlaceCard
        key={saved.id}
        saved={saved}
        profile={profile}
        metaPrefix={metaPrefix}
        onPress={() => router.push(`/place/${saved.id}`)}
        onDelete={() => handleDelete(saved.id)}
        onShowOnMap={() =>
          router.push({
            pathname: '/(tabs)/map',
            params: { savedPlaceId: saved.id },
          })
        }
      />
    );
  }

  function renderSection(
    title: string,
    body: string,
    items: SavedPlaceWithPlace[],
    actionTitle?: string,
    onAction?: () => void,
    extraMeta?: Map<string, string>,
  ) {
    if (items.length === 0) return null;

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderCopy}>
            <Text style={Typography.heading}>{title}</Text>
            <Text style={[Typography.caption, styles.sectionBody]}>{body}</Text>
          </View>
          {actionTitle && onAction ? (
            <Button title={actionTitle} variant="ghost" onPress={onAction} />
          ) : null}
        </View>
        <View style={styles.sectionCards}>
          {items.map((saved) => (
            <View key={saved.id}>{renderSavedPlace(saved, extraMeta?.get(saved.id) ?? null)}</View>
          ))}
        </View>
      </View>
    );
  }

  const nearbyMeta = useMemo(
    () => new Map(nearbyPlaces.map(({ saved, distance }) => [saved.id, formatNearbyDistance(distance)])),
    [nearbyPlaces],
  );

  if (loading && data.length === 0) {
    return (
      <Screen>
        <View style={styles.content}>
          <Text style={[Typography.title, styles.greeting]}>{greeting(user?.email)}</Text>
          <Text style={[Typography.body, styles.sub]}>Loading your dashboard...</Text>
        </View>
        <View style={styles.centerBox}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (error && data.length === 0) {
    return (
      <Screen>
        <View style={styles.content}>
          <Text style={[Typography.title, styles.greeting]}>{greeting(user?.email)}</Text>
          <Text style={[Typography.body, styles.sub]}>We couldn&apos;t load your dashboard yet.</Text>
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

  const hasPlaces = data.length > 0;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <DevModeBanner visible={isLocalUiSession} />
        <DemoModeBanner />

        <View style={styles.hero}>
          <Text style={[Typography.title, styles.greeting]}>{greeting(user?.email)}</Text>
          <Text style={[Typography.body, styles.sub]}>
            {hasPlaces
              ? `${formatCount(data.length)} ready when you are.`
              : 'Save a place from Instagram, TikTok, or any link to get started.'}
          </Text>
        </View>

        <Card style={styles.ctaCard}>
          <Text style={Typography.heading}>Save a place</Text>
          <Text style={[Typography.body, styles.cardBody]}>
            Paste a link from Instagram, TikTok, or anywhere else.
          </Text>
          <View style={styles.ctaActions}>
            <Button title="Save from link" onPress={() => router.push('/share')} />
            <View style={{ height: Spacing.sm }} />
            <Button
              title="Open map"
              variant="secondary"
              onPress={() => router.push('/(tabs)/map')}
            />
          </View>
          <View style={styles.inlineActionRow}>
            <Button
              title="Search manually"
              variant="ghost"
              onPress={() => router.push('/add-place')}
            />
          </View>
        </Card>

        <Pressable style={styles.helpRow} onPress={() => setHowNearrWorksVisible(true)}>
          <View style={styles.helpCopy}>
            <Text style={Typography.bodyStrong}>New here?</Text>
            <Text style={[Typography.caption, styles.helpBody]}>
              See how Nearr works.
            </Text>
          </View>
          <Text style={styles.helpChevron}>›</Text>
        </Pressable>

        {!hasPlaces ? (
          <EmptyState
            title="No places yet"
            body="Save a place from a share link, then Nearr will show it on your map and remind you when you&apos;re nearby."
            actionTitle="Save from link"
            onAction={() => router.push('/share')}
            secondaryTitle="How Nearr Works"
            onSecondary={() => setHowNearrWorksVisible(true)}
            style={styles.emptyCard}
          />
        ) : (
          <>
            {nearbyPlaces.length > 0
              ? renderSection(
                  'Places near you',
                  'Saved spots you can actually go to right now.',
                  nearbyPlaces.map(({ saved }) => saved),
                  'Open map',
                  () => router.push('/(tabs)/map'),
                  nearbyMeta,
                )
              : null}

            {renderSection(
              'Recently saved',
              'Places you wanted to try.',
              recentPlaces,
              'View all',
              () => router.push('/(tabs)/places'),
            )}
          </>
        )}

        <HowNearrWorksModal
          visible={howNearrWorksVisible}
          onPrimary={() => setHowNearrWorksVisible(false)}
          onSecondary={() => setHowNearrWorksVisible(false)}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  hero: {
    marginBottom: Spacing.xl,
  },
  greeting: { marginBottom: Spacing.xs },
  sub: { color: Colors.textSecondary },
  ctaCard: {
    marginBottom: Spacing.lg,
    backgroundColor: Colors.surfaceElevated,
  },
  cardBody: {
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 22,
  },
  ctaActions: {
    marginTop: Spacing.lg,
  },
  inlineActionRow: {
    marginTop: Spacing.xs,
    alignItems: 'flex-start',
  },
  helpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.lg,
  },
  helpCopy: {
    flex: 1,
  },
  helpBody: {
    color: Colors.textSecondary,
    marginTop: 2,
  },
  helpChevron: {
    color: Colors.textMuted,
    fontSize: 22,
  },
  section: {
    marginTop: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sectionHeaderCopy: {
    flex: 1,
  },
  sectionBody: {
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 20,
  },
  sectionCards: {
    marginTop: Spacing.xs,
  },
  centerBox: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  emptyCard: { marginTop: Spacing.sm },
});
