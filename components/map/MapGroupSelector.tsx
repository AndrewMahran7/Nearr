import { useMemo } from 'react';

import {
  PlaceBrowseWheel,
  type PlaceBrowseWheelItem,
} from '@/components/map/PlaceBrowseWheel';
import { CATEGORY_LABELS, savedPlaceCategory } from '@/lib/placeCategory';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  places: SavedPlaceWithPlace[];
  selectedId: string;
  sourceIdentityKey: string | null;
  failedCount: number;
  onSelect: (place: SavedPlaceWithPlace, interaction: 'tap' | 'swipe') => void;
  onOpenDetails: (place: SavedPlaceWithPlace) => void;
  onDirections: (place: SavedPlaceWithPlace) => void;
  onClose: () => void;
  onHeightChange?: (height: number) => void;
};

/** Durable source membership adapted into the same card wheel as Explore Nearby. */
export function MapGroupSelector({
  places,
  selectedId,
  sourceIdentityKey,
  failedCount,
  onSelect,
  onOpenDetails,
  onDirections,
  onClose,
  onHeightChange,
}: Props) {
  const wheelItems = useMemo<PlaceBrowseWheelItem[]>(() => places.map((place) => {
    const sourceThumbnail = place.sources?.find(
      (source) => source.identity_key === sourceIdentityKey,
    )?.thumbnail_url ?? null;
    return {
      id: place.id,
      name: place.place.name,
      primaryMeta: CATEGORY_LABELS[savedPlaceCategory(place)],
      secondaryMeta: place.place.short_formatted_address
        ?? place.place.formatted_address
        ?? 'Saved to your map',
      googlePlaceId: place.place.google_place_id,
      fallbackSourceUri: sourceThumbnail,
      preferPlacePhoto: true,
      allowGoogleLookup: false,
      stateLabel: 'Saved',
      stateTone: 'accent',
    };
  }), [places, sourceIdentityKey]);
  const byId = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const resolve = (item: PlaceBrowseWheelItem) => byId.get(item.id);

  return (
    <PlaceBrowseWheel
      items={wheelItems}
      selectedId={selectedId}
      title="Places from this video"
      subtitle={failedCount > 0
        ? `Swipe cards or tap a pin · ${failedCount} still need attention`
        : 'Swipe cards or tap a pin'}
      accessibilityLabel={`${places.length} saved places from this video`}
      closeAccessibilityLabel="Close places from this video"
      testID="source-group-nearby-wheel"
      onSelect={(item, interaction) => {
        const place = resolve(item);
        if (place) onSelect(place, interaction);
      }}
      onOpenDetails={(item) => {
        const place = resolve(item);
        if (place) onOpenDetails(place);
      }}
      onDirections={(item) => {
        const place = resolve(item);
        if (place) onDirections(place);
      }}
      onClose={onClose}
      onHeightChange={onHeightChange}
    />
  );
}
