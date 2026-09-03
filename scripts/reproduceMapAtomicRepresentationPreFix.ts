import {
  buildMapClusterIndex,
  mapClusterQueryBbox,
  nextClusterZoom,
  queryMapClusters,
  regionToClusterZoom,
  type ClusterRegion,
} from '../lib/mapClustering';
import type { SavedPlaceWithPlace } from '../types';

type Place = SavedPlaceWithPlace;
const width = 390;
const continent: ClusterRegion = {
  latitude: 18,
  longitude: -92,
  latitudeDelta: 142,
  longitudeDelta: 174,
};
const transientOffscreen: ClusterRegion = {
  latitude: 18.02,
  longitude: 72,
  latitudeDelta: 142,
  longitudeDelta: 174,
};
const places = Array.from({ length: 48 }, (_, index) => ({
  id: `founder-${index}`,
  place: {
    name: `Founder ${index}`,
    latitude: index < 30 ? 32.5 + (index % 8) * 0.35 : -40 + (index % 12) * 7,
    longitude: index < 30 ? -120 + (index % 10) * 0.55 : -145 + (index % 15) * 7,
    category: index % 2 ? 'restaurant' : 'park',
  },
})) as Place[];
const index = buildMapClusterIndex(places);

function queried(region: ClusterRegion) {
  const visualZoom = regionToClusterZoom({ longitudeDelta: region.longitudeDelta, viewportWidth: width });
  const queryZoom = nextClusterZoom(1, visualZoom);
  const nodes = queryMapClusters(index, { region, zoom: queryZoom, viewportWidth: width });
  return {
    visualZoom,
    queryZoom,
    bbox: mapClusterQueryBbox(index, region, width),
    markers: nodes.filter((node) => node.kind === 'place').length,
    clusters: nodes.filter((node) => node.kind === 'cluster').length,
  };
}

const initial = queried(continent);
const transient = queried(transientOffscreen);
const rows = [
  {
    time: 0,
    eventType: 'settled_representation',
    viewportRevision: 40,
    cameraRevision: 7,
    continuousZoom: initial.visualZoom.toFixed(4),
    clusterQueryZoom: initial.queryZoom,
    queryBBox: initial.bbox.map((value) => value.toFixed(2)).join(','),
    visibleMarkers: initial.markers,
    visibleClusters: initial.clusters,
    oldCommitReason: 'settled query bound directly to render',
  },
  {
    time: 10,
    eventType: 'camera_revision_gap',
    viewportRevision: 40,
    cameraRevision: 8,
    continuousZoom: initial.visualZoom.toFixed(4),
    clusterQueryZoom: initial.queryZoom,
    queryBBox: initial.bbox.map((value) => value.toFixed(2)).join(','),
    visibleMarkers: places.length,
    visibleClusters: 0,
    oldCommitReason: 'unsynchronized query disables clustering and renders raw fallback',
  },
  {
    time: 30,
    eventType: 'region_change',
    viewportRevision: 41,
    cameraRevision: 8,
    continuousZoom: transient.visualZoom.toFixed(4),
    clusterQueryZoom: transient.queryZoom,
    queryBBox: transient.bbox.map((value) => value.toFixed(2)).join(','),
    visibleMarkers: transient.markers,
    visibleClusters: transient.clusters,
    oldCommitReason: 'continuous query output bound directly to render',
  },
  {
    time: 50,
    eventType: 'native_readback',
    viewportRevision: 42,
    cameraRevision: 8,
    continuousZoom: initial.visualZoom.toFixed(4),
    clusterQueryZoom: initial.queryZoom,
    queryBBox: initial.bbox.map((value) => value.toFixed(2)).join(','),
    visibleMarkers: initial.markers,
    visibleClusters: initial.clusters,
    oldCommitReason: 'final settled query bound directly to render',
  },
];

console.log('PRE-FIX deterministic 50ms representation replay');
console.table(rows);
console.log('FIRST_UNSTABLE_PATH=handleRegionChange -> commitViewport -> clusteringEnabled/queryMapClusters -> clusterMarkers/individualPlaces -> MapView');
console.log('ZOOM_BOUNDARY_CONTRIBUTION=NO (visual zoom and integer query zoom remain constant in this replay)');
