import MapScreen from '@/app/(tabs)/map';
import SettingsScreen from '@/app/(tabs)/settings';
import AccountAuthScreen from '@/app/(onboarding)/account';
import OnboardingScreen from '@/app/(onboarding)';
import ShareJobsScreen from '@/app/share-jobs';
import ShareJobDetailScreen from '@/app/share-jobs/[jobId]';
import { buildPhase2PreviewJob } from '@/lib/phase2Preview';
import { getDemoSeededSavedPlacesSync } from '@/services/demo';
import type { ActivityPreviewData } from '@/app/share-jobs';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SavedPlacesLibrary } from '@/components/map/SavedPlacesLibrary';
import { SelectedPlaceDetails } from '@/components/map/SelectedPlaceDetails';
import { useTheme } from '@/lib/theme';
import { selectOfflineOnboardingFixture } from '@/onboarding/fixtures/offlineOnboardingFixtures';
import publicPlaces from '../artifacts/fieldnotes-implementation/real-data/public-place-content.json';
import type { SavedPlaceWithPlace } from '@/types';

const capturedAt = new Date().toISOString();
const saved = getDemoSeededSavedPlacesSync()[0];
const realPlaces: SavedPlaceWithPlace[] = publicPlaces.map((place, index) => ({ ...saved,
  id: `fieldnotes-readonly-${index}`, user_id: 'fieldnotes-readonly', place_id: `fieldnotes-readonly-place-${index}`,
  notes: null, ai_note: null, source_type: 'manual', source_url: null, notifications_enabled: false,
  place: { ...place, id: `fieldnotes-readonly-place-${index}`, category: null, google_maps_url: null, created_at: capturedAt },
}));
const localFixture = selectOfflineOnboardingFixture('instagram', 'outdoors');
const fixturePlace: SavedPlaceWithPlace = { ...saved, id: `onboarding-scripted-save:${localFixture.place.id}`,
  user_id: 'fieldnotes-readonly', place_id: localFixture.place.id, notes: null, ai_note: localFixture.place.aiNote,
  source_type: 'instagram', source_url: localFixture.provenance.sourceUrl, notifications_enabled: false,
  place: { id: localFixture.place.id, google_place_id: localFixture.place.id, name: localFixture.place.name,
    formatted_address: localFixture.place.address, latitude: localFixture.place.latitude, longitude: localFixture.place.longitude,
    category: localFixture.place.category, google_maps_url: null, created_at: capturedAt },
};
const activityData: ActivityPreviewData = {
  jobs: [
    buildPhase2PreviewJob('phase2-preview-mixed-5'),
    { ...buildPhase2PreviewJob('phase2-preview-1'), id: 'fieldnotes-preview-processing', status: 'processing_metadata', decision: null, candidate_payload: null, created_at: capturedAt },
    { ...buildPhase2PreviewJob('phase2-preview-0'), id: 'fieldnotes-preview-recovery', status: 'failed', decision: 'failed', failure_reason: 'The original post could not be opened.', failure_category: 'media_access_required', created_at: capturedAt },
  ],
  recentAutoSaves: saved ? [{ resultId: 'fieldnotes-preview-saved', shareJobId: 'fieldnotes-preview-complete', savedPlaceId: saved.id, finalizedAt: capturedAt, confidenceScore: null, savedPlace: saved, candidate: null }] : [],
};

/**
 * Actual screen components mounted within the existing Development QA owner.
 * The caller gates this to __DEV__ + map preview + verified Development backend.
 * Auth routing, sessions and persistence services are never replaced.
 */
export function FieldnotesNativePreview({ surface }: { surface: string }) {
  const { colors } = useTheme();
  if (surface === 'real-saved') return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><SavedPlacesLibrary savedPlaces={realPlaces} nearbyPlaces={[]} locationState="unavailable" loading={false} requestLocationPermission={async () => false} onSelectPlace={() => undefined} onSaveFromLink={() => undefined} onSearchManually={() => undefined} /></SafeAreaView>;
  if (surface === 'photo-place' || surface === 'real-place') return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><ScrollView><View style={{ padding: 16 }}><SelectedPlaceDetails saved={surface === 'photo-place' ? fixturePlace : realPlaces[0]} allSavedPlaces={[]} onGetDirections={() => undefined} onRequestDismiss={() => undefined} /></View></ScrollView></SafeAreaView>;
  if (surface === 'map') return <MapScreen />;
  if (surface === 'settings') return <SettingsScreen />;
  if (surface === 'account') return <AccountAuthScreen />;
  if (surface === 'onboarding') return <OnboardingScreen />;
  if (surface === 'activity') return <ShareJobsScreen previewData={activityData} />;
  if (surface === 'review') return <ShareJobDetailScreen />;
  return null;
}
