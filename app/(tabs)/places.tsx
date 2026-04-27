/**
 * Places tab — pure list view of the user's saved places.
 *
 * Uses the same data source as Home but without the dashboard header. Useful
 * when the user just wants to scan their saved list.
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

import { Button, Card, EmptyState, SavedPlaceCard, Screen } from '@/components';
import { Colors, Spacing, Typography } from '@/constants';

import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { getProfile } from '@/services/profileService';
import { deleteSavedPlace } from '@/services/savedPlacesService';
import type { Profile } from '@/types';

export default function PlacesTab() {
  const router = useRouter();
  const { data, loading, refreshing, error, refresh } = useSavedPlaces();
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(async () => {
    setProfile(await getProfile());
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

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

  if (loading && data.length === 0) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (error && data.length === 0) {
    return (
      <Screen>
        <EmptyState
          variant="error"
          title={'Couldn\u2019t load your places'}
          body={error}
          actionTitle="Try again"
          onAction={refresh}
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={data}
        keyExtractor={(s) => s.id}
        contentContainerStyle={
          data.length === 0 ? styles.emptyContent : styles.listContent
        }
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
            framed={false}
            title="No places yet"
            body="Save your first spot, or paste a link from TikTok or Instagram."
            actionTitle="Save a place"
            onAction={() => router.push('/add-place')}
            secondaryTitle="Save from a link"
            onSecondary={() => router.push('/share')}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg },
  emptyBox: { alignItems: 'center' },
  muted: { color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.xs },
  center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
});
