/**
 * Memoized cluster marker.
 *
 * Speaks the same visual language as NearrMapMarker — cream disc, dark hairline
 * ring, category glyph — with two additions that make it read as a group rather
 * than a place: an explicit count under the glyph, and an outer halo ring.
 *
 * It never requests anything. Everything it draws comes from the count and the
 * dominant category the clustering engine already computed, which is what keeps
 * a 40-place cluster from fanning out 40 photo requests.
 *
 * View tracking follows the same discipline as the place marker: armed only
 * while the visual is changing, then frozen, so Android's bitmap rasterization
 * path is not re-entered on every pan.
 */

import { memo, useCallback, useEffect, useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Marker } from 'react-native-maps';

import {
  CLUSTER_ACCESSIBILITY_HINT,
  type MapClusterMarker as MapClusterMarkerModel,
} from '@/lib/mapClustering';

type Props = {
  cluster: MapClusterMarkerModel;
  onPress: (cluster: MapClusterMarkerModel) => void;
  dimmed: boolean;
};

const CLUSTER_SNAPSHOT_SETTLE_MS = 120;

function NearrMapClusterMarkerView({ cluster, onPress, dimmed }: Props) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  // Re-arm native snapshotting only when the drawn visual actually changes.
  useEffect(() => {
    setTracksViewChanges(true);
    const id = setTimeout(() => setTracksViewChanges(false), CLUSTER_SNAPSHOT_SETTLE_MS);
    return () => clearTimeout(id);
  }, [cluster.count, cluster.glyph, cluster.sizing.diameter]);

  const handlePress = useCallback(
    (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      onPress(cluster);
    },
    [cluster, onPress],
  );

  const { diameter, iconSize, countFontSize } = cluster.sizing;
  const haloSize = diameter + 6;

  return (
    <Marker
      identifier={cluster.id}
      opacity={dimmed ? 0.35 : 1}
      // Below the selected place (30) so a selection is never covered by a
      // cluster, above ordinary pins so a group is not lost behind one.
      zIndex={25}
      coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      centerOffset={{ x: 0, y: 0 }}
      tracksViewChanges={tracksViewChanges}
      onPress={handlePress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={cluster.accessibilityLabel}
      accessibilityHint={CLUSTER_ACCESSIBILITY_HINT}
    >
      <View
        style={[styles.wrap, { width: haloSize, height: haloSize }]}
        pointerEvents="none"
      >
        <View
          style={[
            styles.halo,
            { width: haloSize, height: haloSize, borderRadius: haloSize / 2 },
          ]}
        />
        <View
          style={[
            styles.disc,
            { width: diameter, height: diameter, borderRadius: diameter / 2 },
          ]}
        >
          <MaterialCommunityIcons
            name={cluster.glyph as ComponentProps<typeof MaterialCommunityIcons>['name']}
            size={iconSize}
            color="#282421"
          />
          <Text
            style={[
              styles.count,
              { fontSize: countFontSize, lineHeight: countFontSize + 2 },
            ]}
            numberOfLines={1}
            allowFontScaling={false}
          >
            {cluster.count}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

export const NearrMapClusterMarker = memo(NearrMapClusterMarkerView, (prev, next) =>
  prev.cluster.id === next.cluster.id &&
  // A stable native owner must still receive the current engine/index payload
  // so its onPress closure can never resolve against a superseded generation.
  prev.cluster.datasetKey === next.cluster.datasetKey &&
  prev.cluster.clusterId === next.cluster.clusterId &&
  prev.cluster.clusterKey === next.cluster.clusterKey &&
  prev.cluster.count === next.cluster.count &&
  prev.cluster.glyph === next.cluster.glyph &&
  prev.cluster.latitude === next.cluster.latitude &&
  prev.cluster.longitude === next.cluster.longitude &&
  prev.cluster.sizing.diameter === next.cluster.sizing.diameter &&
  prev.cluster.accessibilityLabel === next.cluster.accessibilityLabel &&
  prev.dimmed === next.dimmed &&
  prev.onPress === next.onPress,
);

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 106, 26, 0.20)',
    borderWidth: 1,
    borderColor: 'rgba(40, 36, 33, 0.28)',
  },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF4E8',
    borderWidth: 1.5,
    borderColor: '#282421',
    shadowColor: '#000000',
    shadowOpacity: 0.24,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  count: {
    marginTop: 1,
    color: '#282421',
    fontWeight: '800',
  },
});
