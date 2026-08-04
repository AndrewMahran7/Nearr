import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { MapSnackbar } from '@/components/map';
import { useAuth } from '@/hooks/useAuth';
import {
  getSavedPlacesCacheSnapshot,
  removeSavedPlaceFromCache,
  restoreSavedPlacesCache,
  upsertSavedPlaceIntoCache,
} from '@/hooks/useSavedPlaces';
import { trackEvent } from '@/lib/analytics';
import { autoSaveUndoElapsedBucket } from '@/lib/autoSaveUndo';
import { isAsyncShareJobsEnabled } from '@/lib/featureFlags';
import { supabase } from '@/lib/supabase';
import {
  getRecentAutoSave,
  undoAutoSavedPlace,
  type RecentAutoSave,
} from '@/services/shareJobsService';

export function AutoSaveUndoToast() {
  const { session, isDevSession } = useAuth();
  const userId = session?.user.id ?? null;
  const enabled = isAsyncShareJobsEnabled() && !!userId && !isDevSession;
  const [item, setItem] = useState<RecentAutoSave | null>(null);

  useEffect(() => {
    setItem(null);
    if (!enabled || !userId) return;
    const channel = supabase
      .channel(`auto-save-undo:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'share_job_place_results',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.origin !== 'automatic' || row.outcome !== 'auto_saved' || typeof row.id !== 'string') return;
          void getRecentAutoSave(row.id)
            .then((recent) => {
              if (!recent) return;
              upsertSavedPlaceIntoCache(recent.savedPlace);
              setItem(recent);
              void trackEvent('auto_save_undo_shown', {
                surface: 'in_app_toast',
                category: recent.savedPlace.category ?? 'other',
              });
            })
            .catch(() => undefined);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, userId]);

  async function handleUndo() {
    if (!item) return;
    const target = item;
    const snapshot = getSavedPlacesCacheSnapshot();
    setItem(null);
    removeSavedPlaceFromCache(target.savedPlaceId);
    try {
      await undoAutoSavedPlace(target.savedPlaceId);
      void trackEvent('auto_save_undone', {
        surface: 'in_app_toast',
        elapsed_bucket: autoSaveUndoElapsedBucket(target.finalizedAt),
        category: target.savedPlace.category ?? 'other',
      });
    } catch (error) {
      restoreSavedPlacesCache(snapshot);
      Alert.alert('Could not undo', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  return (
    <MapSnackbar
      visible={!!item}
      message={item ? `Saved ${item.savedPlace.place.name} to your map` : ''}
      bottomOffset={92}
      actionLabel="Undo"
      onAction={() => void handleUndo()}
      onDismiss={() => setItem(null)}
      durationMs={8000}
    />
  );
}