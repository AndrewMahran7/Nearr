/**
 * Camera geometry for the area of the map that the user can actually see.
 *
 * Overlay distances are measured from the MapView's edges, in layout pixels.
 * They already include safe areas/dock/keyboard where those overlap the map;
 * callers must not add an inset twice. No reminder radius participates here.
 */
export type MapCoordinate = { latitude: number; longitude: number };
export type MapScreenPoint = { x: number; y: number };
export type MapViewportPadding = { top: number; right: number; bottom: number; left: number };
export type MapUsableViewport = {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  usableWidth: number;
  usableHeight: number;
  center: MapScreenPoint;
  edgePadding: MapViewportPadding;
  valid: boolean;
};

const MERCATOR_LATITUDE_LIMIT = 85.0511287798066;
const TILE_SIZE = 256;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function nonnegative(value: number | undefined): number {
  return value != null && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * The selected marker is not always centered on its geographic coordinate.
 * In the labelled state its 148x90 canvas anchors on the photo disc, so the
 * bottom and horizontal extents are much larger than the old uniform 32px
 * allowance. Convert the rendered canvas + anchor into per-edge insets.
 */
export function mapMarkerViewportInsets(input: {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  breathingRoom?: number;
}): MapViewportPadding {
  const width = nonnegative(input.width);
  const height = nonnegative(input.height);
  const anchorX = clamp(Number.isFinite(input.anchorX) ? input.anchorX : 0.5, 0, 1);
  const anchorY = clamp(Number.isFinite(input.anchorY) ? input.anchorY : 0.5, 0, 1);
  const breathingRoom = nonnegative(input.breathingRoom);
  return {
    top: height * anchorY + breathingRoom,
    right: width * (1 - anchorX) + breathingRoom,
    bottom: height * (1 - anchorY) + breathingRoom,
    left: width * anchorX + breathingRoom,
  };
}

/** A near-full-screen detail page while retaining a small sheet-origin cue. */
export function expandedPlaceDetailHeight(input: {
  availableHeight: number;
  safeTopInset: number;
}): number {
  const availableHeight = nonnegative(input.availableHeight);
  if (availableHeight === 0) return 0;
  const topClearance = clamp(nonnegative(input.safeTopInset) + 8, 20, 44);
  return Math.max(
    Math.min(220, availableHeight),
    Math.round(Math.min(availableHeight * 0.95, availableHeight - topClearance)),
  );
}

/** Keyboard coverage of this map frame, after any native window resize. */
export function mapKeyboardOverlap(input: {
  mapY: number;
  mapHeight: number;
  keyboardScreenY: number | null;
}): number {
  if (input.keyboardScreenY == null || !Number.isFinite(input.keyboardScreenY)
    || !Number.isFinite(input.mapY) || !Number.isFinite(input.mapHeight)) return 0;
  return clamp(input.mapY + input.mapHeight - input.keyboardScreenY, 0, nonnegative(input.mapHeight));
}

export function normalizeMapLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function isValidMapCoordinate(coordinate: MapCoordinate): boolean {
  return Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude) &&
    coordinate.latitude >= -90 && coordinate.latitude <= 90 &&
    coordinate.longitude >= -180 && coordinate.longitude <= 180;
}

/** A 32px inset leaves room for the selected marker itself, not just its tip. */
export function mapUsableViewport(input: {
  width: number;
  height: number;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  margin?: number;
  /** Rendered marker extent from its geographic anchor, per edge. */
  markerInsets?: Partial<MapViewportPadding>;
}): MapUsableViewport {
  const width = nonnegative(input.width);
  const height = nonnegative(input.height);
  const margin = input.margin == null ? 32 : nonnegative(input.margin);
  const edgePadding = {
    top: nonnegative(input.top) + nonnegative(input.markerInsets?.top ?? margin),
    right: nonnegative(input.right) + nonnegative(input.markerInsets?.right ?? margin),
    bottom: nonnegative(input.bottom) + nonnegative(input.markerInsets?.bottom ?? margin),
    left: nonnegative(input.left) + nonnegative(input.markerInsets?.left ?? margin),
  };
  const left = edgePadding.left;
  const right = width - edgePadding.right;
  const top = edgePadding.top;
  const bottom = height - edgePadding.bottom;
  return {
    width,
    height,
    left,
    top,
    right,
    bottom,
    usableWidth: Math.max(0, right - left),
    usableHeight: Math.max(0, bottom - top),
    center: { x: (left + right) / 2, y: (top + bottom) / 2 },
    edgePadding,
    // Do not invent screen space by silently reducing measured overlays.
    valid: right - left >= 24 && bottom - top >= 24,
  };
}

function mercatorY(latitude: number): number {
  const radians = clamp(latitude, -MERCATOR_LATITUDE_LIMIT, MERCATOR_LATITUDE_LIMIT) * Math.PI / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
}

function latitudeAtY(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

/** Smallest circular interval containing every longitude, independent of order. */
function longitudeInterval(coordinates: readonly MapCoordinate[]): { start: number; span: number } {
  const longitudes = coordinates.map((coordinate) =>
    (normalizeMapLongitude(coordinate.longitude) + 360) % 360,
  ).sort((a, b) => a - b);
  let largestGap = -1;
  let intervalStart = longitudes[0]!;
  for (let index = 0; index < longitudes.length; index += 1) {
    const next = index + 1 < longitudes.length ? longitudes[index + 1]! : longitudes[0]! + 360;
    const gap = next - longitudes[index]!;
    if (gap > largestGap) {
      largestGap = gap;
      intervalStart = next % 360;
    }
  }
  return { start: intervalStart, span: Math.max(0, 360 - largestGap) };
}

export type SavedPinsCameraPlan = {
  kind: 'camera';
  center: MapCoordinate;
  zoom: number;
  region: MapCoordinate & { latitudeDelta: number; longitudeDelta: number };
  edgePadding: MapViewportPadding;
  coordinates: MapCoordinate[];
  validCoordinateCount: number;
  uniqueCoordinateCount: number;
  crossesAntimeridian: boolean;
  /** A near-global set can need more than one world width after pixel padding. */
  requiresWorldOverscan: boolean;
} | {
  kind: 'none';
  reason: 'no_coordinates' | 'unmeasured_viewport';
};

/**
 * Fit all supplied (already category-filtered) coordinates, including outliers.
 * One point and identical-coordinate groups keep neighborhood context at z15.
 * The center is translated in projected pixels so asymmetric overlays do not
 * hide the southernmost pin. Region is for native providers without zoom.
 */
export function planSavedPinsCamera(input: {
  coordinates: readonly MapCoordinate[];
  viewport: MapUsableViewport;
  maxZoom?: number;
}): SavedPinsCameraPlan {
  const coordinates = input.coordinates.filter(isValidMapCoordinate).map((coordinate) => ({ ...coordinate }));
  if (coordinates.length === 0) return { kind: 'none', reason: 'no_coordinates' };
  const viewport = input.viewport;
  if (!viewport.valid) return { kind: 'none', reason: 'unmeasured_viewport' };
  const interval = longitudeInterval(coordinates);
  const ys = coordinates.map((coordinate) => mercatorY(coordinate.latitude));
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  const width = interval.span / 360;
  const height = maximumY - minimumY;
  const maximumZoom = Number.isFinite(input.maxZoom) ? clamp(input.maxZoom!, 0, 20) : 15;
  const scale = Math.min(
    width > 0 ? viewport.usableWidth / width : Infinity,
    height > 0 ? viewport.usableHeight / height : Infinity,
    TILE_SIZE * 2 ** maximumZoom,
  );
  const centerX = (interval.start + interval.span / 2 + 180) / 360 -
    (viewport.center.x - viewport.width / 2) / scale;
  const centerY = (minimumY + maximumY) / 2 -
    (viewport.center.y - viewport.height / 2) / scale;
  const center = {
    latitude: latitudeAtY(centerY),
    longitude: normalizeMapLongitude(centerX * 360 - 180),
  };
  const north = latitudeAtY(centerY - viewport.height / (2 * scale));
  const south = latitudeAtY(centerY + viewport.height / (2 * scale));
  const longitudeDelta = viewport.width / scale * 360;
  const normalizedLongitudes = coordinates.map((coordinate) => normalizeMapLongitude(coordinate.longitude));
  const rawSpan = Math.max(...normalizedLongitudes) - Math.min(...normalizedLongitudes);
  return {
    kind: 'camera',
    center,
    zoom: Math.log2(scale / TILE_SIZE),
    region: {
      ...center,
      latitudeDelta: Math.max(1e-7, north - south),
      longitudeDelta: Math.max(1e-7, Math.min(360, longitudeDelta)),
    },
    edgePadding: { ...viewport.edgePadding },
    coordinates,
    validCoordinateCount: coordinates.length,
    uniqueCoordinateCount: new Set(coordinates.map((coordinate) =>
      `${coordinate.latitude}:${normalizeMapLongitude(coordinate.longitude)}`,
    )).size,
    crossesAntimeridian: rawSpan - interval.span > 1e-7,
    requiresWorldOverscan: longitudeDelta > 360,
  };
}

/** Project a north-up, flat camera; native projection is used for live selection. */
export function projectMapCoordinate(input: {
  coordinate: MapCoordinate;
  center: MapCoordinate;
  zoom: number;
  width: number;
  height: number;
}): MapScreenPoint {
  const scale = TILE_SIZE * 2 ** input.zoom;
  return {
    x: input.width / 2 + normalizeMapLongitude(input.coordinate.longitude - input.center.longitude) / 360 * scale,
    y: input.height / 2 + (mercatorY(input.coordinate.latitude) - mercatorY(input.center.latitude)) * scale,
  };
}

export type SelectedMarkerOcclusionPlan = {
  kind: 'move';
  targetPoint: MapScreenPoint;
  /** Unproject through native coordinateForPoint, then animateCamera({ center }). */
  cameraCenterPoint: MapScreenPoint;
  displacement: MapScreenPoint;
} | {
  kind: 'none';
  reason: 'visible' | 'unmeasured_viewport' | 'invalid_projection';
};

/**
 * Native projection keeps this correct under rotation and at high latitudes.
 * Only the minimum necessary translation is requested after overlay changes.
 * A deliberate place selection may opt into centering in the unobstructed map.
 */
export function planSelectedMarkerOcclusion(input: {
  point: MapScreenPoint;
  viewport: MapUsableViewport;
  forceCenter?: boolean;
}): SelectedMarkerOcclusionPlan {
  const { point, viewport } = input;
  if (!viewport.valid) return { kind: 'none', reason: 'unmeasured_viewport' };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { kind: 'none', reason: 'invalid_projection' };
  }
  const targetPoint = input.forceCenter ? viewport.center : {
    x: clamp(point.x, viewport.left, viewport.right),
    y: clamp(point.y, viewport.top, viewport.bottom),
  };
  const displacement = { x: point.x - targetPoint.x, y: point.y - targetPoint.y };
  // Layout/projection subpixels must not trigger a fresh animation indefinitely.
  if (Math.abs(displacement.x) < 1 && Math.abs(displacement.y) < 1) {
    return { kind: 'none', reason: 'visible' };
  }
  return {
    kind: 'move',
    targetPoint,
    displacement,
    cameraCenterPoint: {
      x: viewport.width / 2 + displacement.x,
      y: viewport.height / 2 + displacement.y,
    },
  };
}

/** Reject asynchronous native projection work after a gesture/new selection. */
export function canApplySelectedMarkerCorrection(input: {
  requestedSelectionId: string;
  currentSelectionId: string | null;
  requestedCameraRevision: number;
  currentCameraRevision: number;
  requestedSelectionRevision?: number;
  currentSelectionRevision?: number;
  userHasMoved: boolean;
}): boolean {
  return !input.userHasMoved && input.requestedSelectionId === input.currentSelectionId &&
    input.requestedCameraRevision === input.currentCameraRevision &&
    input.requestedSelectionRevision === input.currentSelectionRevision;
}
