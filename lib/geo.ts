/**
 * Geo helpers for Nearr.
 *
 * Distances are computed in **meters** (matching what `expo-location`
 * reports) and converted into / out of the user-facing units (miles,
 * minutes-of-driving) only at the boundary.
 *
 * Minutes ↔ distance is intentionally a coarse heuristic: we assume an
 * average urban driving speed (`AVG_DRIVING_MPH`). Replacing this with a
 * real routing API is a future task.
 */

const EARTH_R_M = 6_371_008.8; // mean Earth radius in meters
const METERS_PER_MILE = 1609.344;
const AVG_DRIVING_MPH = 25; // rough urban average — see file header

export type LatLng = { latitude: number; longitude: number };

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/** Great-circle distance between two coordinates, in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(x));
}

// ---------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------

export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

/**
 * Approximate "minutes of driving" → meters using a fixed average speed.
 * NOT a real driving estimate; used so a per-place "minutes" radius still
 * produces a usable proximity threshold without a routing API.
 */
export function minutesToMeters(minutes: number): number {
  const miles = (AVG_DRIVING_MPH / 60) * minutes;
  return milesToMeters(miles);
}

export function metersToMinutes(meters: number): number {
  const miles = metersToMiles(meters);
  return (miles / AVG_DRIVING_MPH) * 60;
}
