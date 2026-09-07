import { useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  PlaceBrowseWheel,
  type PlaceBrowseWheelItem,
} from '@/components/map/PlaceBrowseWheel';
import { Spacing } from '@/constants';
import { formatNearbyDistance } from '@/lib/alsoNearby';
import { CATEGORY_LABELS } from '@/lib/placeCategory';
import type { NearbyMapExplorerItem } from '@/lib/nearbyMapExplorer';

type Props = {
  items: readonly NearbyMapExplorerItem[];
  selectedId: string;
  savingItemId: string | null;
  onSelect: (item: NearbyMapExplorerItem, source: 'card') => void;
  onOpenDetails: (item: NearbyMapExplorerItem) => void;
  onSave: (item: NearbyMapExplorerItem) => void;
  onDirections: (item: NearbyMapExplorerItem) => void;
  onClose: () => void;
  onHeightChange?: (height: number) => void;
};

/** Nearby keeps its data/camera ownership and adapts it into the shared wheel. */
export function NearbyMapExplorerCarousel({
  items,
  selectedId,
  savingItemId,
  onSelect,
  onOpenDetails,
  onSave,
  onDirections,
  onClose,
  onHeightChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const wheelItems = useMemo<PlaceBrowseWheelItem[]>(() => items.map((item) => {
    const distance = item.distanceMeters == null || item.sourceType === 'anchor'
      ? null
      : formatNearbyDistance(item.distanceMeters);
    return {
      id: item.id,
      name: item.name,
      primaryMeta: [CATEGORY_LABELS[item.category], distance].filter(Boolean).join(' · '),
      secondaryMeta: item.shortFormattedAddress ?? item.address,
      googlePlaceId: item.providerPlaceId,
      sourceUri: item.photoUrl,
      stateLabel: item.savedState === 'saved' ? 'Saved' : 'Not saved',
      stateTone: item.savedState === 'saved' ? 'accent' : 'muted',
      contextLabel: item.sourceType === 'anchor' ? 'Starting place' : null,
      contextIcon: 'navigation',
    };
  }), [items]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const resolve = (item: PlaceBrowseWheelItem) => byId.get(item.id);

  return (
    <PlaceBrowseWheel
      items={wheelItems}
      selectedId={selectedId}
      title="Explore nearby"
      accessibilityLabel="Nearby map place cards"
      closeAccessibilityLabel="Back to place details"
      savingItemId={savingItemId}
      positioned
      bottomInset={Math.max(insets.bottom, Spacing.sm)}
      testID="nearby-map-place-wheel"
      onSelect={(item) => {
        const resolved = resolve(item);
        if (resolved) onSelect(resolved, 'card');
      }}
      onOpenDetails={(item) => {
        const resolved = resolve(item);
        if (resolved) onOpenDetails(resolved);
      }}
      onDirections={(item) => {
        const resolved = resolve(item);
        if (resolved) onDirections(resolved);
      }}
      onSave={(item) => {
        const resolved = resolve(item);
        if (resolved) onSave(resolved);
      }}
      onClose={onClose}
      onHeightChange={onHeightChange}
    />
  );
}
