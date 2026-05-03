/**
 * Static seed data for Demo Mode.
 *
 * - `DEMO_PROFILE` is the fake user's profile (default radius, notification
 *   prefs, quiet hours).
 * - `DEMO_PLACE_CATALOG` is a small catalog of Google-Places-shaped
 *   candidates that powers the demo `searchPlaces()`.
 * - `DEMO_SEED_SAVED_PLACES` is the initial saved-places list for the
 *   demo user (10 items, mixed categories / radius modes / source types).
 *
 * Coordinates are approximate, real-ish Santa Cruz / Orange County / LA
 * locations. Names are realistic for the area but presented as fictional
 * test data for UX validation only — no claim of affiliation.
 */

import type { PlaceCandidate } from '@/services/placesService';
import type { Profile, RadiusUnit, SourceType } from '@/types';

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const DEMO_PROFILE: Profile = {
  id: 'demo-user',
  email: 'demo@nearr.local',
  default_radius_value: 1,
  default_radius_unit: 'miles',
  notifications_enabled: true,
  nearby_notifications_enabled: true,
  quiet_hours_enabled: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
  terms_accepted_at: null,
  privacy_accepted_at: null,
  legal_version: null,
  created_at: new Date('2026-04-01T00:00:00.000Z').toISOString(),
  updated_at: new Date('2026-04-01T00:00:00.000Z').toISOString(),
};

// ---------------------------------------------------------------------------
// Catalog of place candidates (powers demo searchPlaces)
// ---------------------------------------------------------------------------

/**
 * Each entry has search-friendly tags so the demo `searchPlaces()` can match
 * loose user queries like "sushi", "coffee", or "thrift".
 */
export type DemoPlaceCatalogEntry = PlaceCandidate & { tags: string[] };

export const DEMO_PLACE_CATALOG: DemoPlaceCatalogEntry[] = [
  // ---- Santa Cruz ------------------------------------------------------
  {
    googlePlaceId: 'demo-bantam',
    name: 'Bantam',
    formattedAddress: '1010 Fair Ave, Santa Cruz, CA 95060',
    latitude: 36.9595,
    longitude: -122.0511,
    category: 'pizza restaurant',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Bantam+Santa+Cruz',
    tags: ['pizza', 'italian', 'restaurant', 'dinner', 'santa cruz'],
  },
  {
    googlePlaceId: 'demo-akira',
    name: 'Akira Sushi Bar',
    formattedAddress: '1222 Soquel Ave, Santa Cruz, CA 95062',
    latitude: 36.9759,
    longitude: -122.0186,
    category: 'sushi restaurant',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Akira+Sushi+Santa+Cruz',
    tags: ['sushi', 'japanese', 'restaurant', 'dinner'],
  },
  {
    googlePlaceId: 'demo-verve',
    name: 'Verve Coffee Roasters',
    formattedAddress: '1540 Pacific Ave, Santa Cruz, CA 95060',
    latitude: 36.9745,
    longitude: -122.0244,
    category: 'coffee shop',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Verve+Coffee+Santa+Cruz',
    tags: ['coffee', 'cafe', 'breakfast', 'espresso'],
  },
  {
    googlePlaceId: 'demo-tacos-moreno',
    name: 'Tacos Moreno',
    formattedAddress: '1053 Water St, Santa Cruz, CA 95062',
    latitude: 36.9776,
    longitude: -122.0156,
    category: 'mexican restaurant',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Tacos+Moreno+Santa+Cruz',
    tags: ['tacos', 'mexican', 'burrito', 'lunch'],
  },
  {
    googlePlaceId: 'demo-aunt-marys',
    name: "Aunt Mary's Cafe",
    formattedAddress: '1239 Soquel Ave, Santa Cruz, CA 95062',
    latitude: 36.9762,
    longitude: -122.0181,
    category: 'breakfast restaurant',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Aunt+Marys+Cafe+Santa+Cruz',
    tags: ['breakfast', 'brunch', 'cafe', 'pancakes'],
  },
  {
    googlePlaceId: 'demo-buttercup',
    name: 'Buttercup Cakes & Farmhouse Frosting',
    formattedAddress: '1411 Pacific Ave, Santa Cruz, CA 95060',
    latitude: 36.9737,
    longitude: -122.0258,
    category: 'bakery',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Buttercup+Cakes+Santa+Cruz',
    tags: ['dessert', 'bakery', 'cake', 'sweets'],
  },

  // ---- Orange County ---------------------------------------------------
  {
    googlePlaceId: 'demo-burger-parlor',
    name: 'The Burger Parlor',
    formattedAddress: '204 N Harbor Blvd, Fullerton, CA 92832',
    latitude: 33.8741,
    longitude: -117.9249,
    category: 'burger restaurant',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Burger+Parlor+Fullerton',
    tags: ['burger', 'burgers', 'american', 'dinner'],
  },
  {
    googlePlaceId: 'demo-salt-straw',
    name: 'Salt & Straw',
    formattedAddress: '3030 S Bristol St, Costa Mesa, CA 92626',
    latitude: 33.6915,
    longitude: -117.8856,
    category: 'ice cream shop',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Salt+and+Straw+Costa+Mesa',
    tags: ['ice cream', 'dessert', 'sweets'],
  },
  {
    googlePlaceId: 'demo-sidecar',
    name: 'Sidecar Doughnuts & Coffee',
    formattedAddress: '270 E 17th St, Costa Mesa, CA 92627',
    latitude: 33.6420,
    longitude: -117.9062,
    category: 'donut shop',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Sidecar+Doughnuts+Costa+Mesa',
    tags: ['dessert', 'donut', 'doughnut', 'coffee', 'breakfast'],
  },

  // ---- LA --------------------------------------------------------------
  {
    googlePlaceId: 'demo-bear-republic',
    name: 'Bear Republic BBQ',
    formattedAddress: '4651 Eagle Rock Blvd, Los Angeles, CA 90041',
    latitude: 34.1338,
    longitude: -118.2168,
    category: 'barbecue restaurant',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Bear+Republic+BBQ+Los+Angeles',
    tags: ['bbq', 'barbecue', 'brisket', 'dinner', 'american'],
  },
  {
    googlePlaceId: 'demo-bludsos',
    name: "Bludso's BBQ",
    formattedAddress: '609 N La Brea Ave, Los Angeles, CA 90036',
    latitude: 34.0830,
    longitude: -118.3441,
    category: 'barbecue restaurant',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Bludsos+BBQ+Los+Angeles',
    tags: ['bbq', 'barbecue', 'brisket', 'ribs'],
  },
  {
    googlePlaceId: 'demo-sushi-roku',
    name: 'Sushi Roku',
    formattedAddress: '1401 Ocean Ave, Santa Monica, CA 90401',
    latitude: 34.0163,
    longitude: -118.4982,
    category: 'sushi restaurant',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Sushi+Roku+Santa+Monica',
    tags: ['sushi', 'japanese', 'dinner'],
  },

  // ---- Long Beach (non-food) ------------------------------------------
  {
    googlePlaceId: 'demo-crossroads',
    name: 'Crossroads Trading Co.',
    formattedAddress: '5234 E 2nd St, Long Beach, CA 90803',
    latitude: 33.7616,
    longitude: -118.1371,
    category: 'thrift store',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Crossroads+Trading+Long+Beach',
    tags: ['thrift', 'shopping', 'clothes', 'vintage'],
  },
  {
    googlePlaceId: 'demo-buffalo-exchange',
    name: 'Buffalo Exchange',
    formattedAddress: '1045 Pacific Ave, Santa Cruz, CA 95060',
    latitude: 36.9716,
    longitude: -122.0270,
    category: 'thrift store',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Buffalo+Exchange+Santa+Cruz',
    tags: ['thrift', 'shopping', 'clothes', 'vintage'],
  },

  // ---- Extra search-only candidates -----------------------------------
  {
    googlePlaceId: 'demo-in-n-out',
    name: 'In-N-Out Burger',
    formattedAddress: '594 W 19th St, Costa Mesa, CA 92627',
    latitude: 33.6388,
    longitude: -117.9226,
    category: 'burger restaurant',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=In+N+Out+Costa+Mesa',
    tags: ['burger', 'burgers', 'fast food', 'lunch'],
  },
  {
    googlePlaceId: 'demo-stumptown',
    name: 'Stumptown Coffee Roasters',
    formattedAddress: '806 S Santa Fe Ave, Los Angeles, CA 90021',
    latitude: 34.0349,
    longitude: -118.2349,
    category: 'coffee shop',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Stumptown+Los+Angeles',
    tags: ['coffee', 'cafe', 'espresso'],
  },
  {
    googlePlaceId: 'demo-petite-taqueria',
    name: 'Petite Taqueria',
    formattedAddress: '8520 Santa Monica Blvd, West Hollywood, CA 90069',
    latitude: 34.0904,
    longitude: -118.3818,
    category: 'mexican restaurant',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Petite+Taqueria+West+Hollywood',
    tags: ['tacos', 'mexican', 'dinner'],
  },
  {
    googlePlaceId: 'demo-pizzeria-mozza',
    name: 'Pizzeria Mozza',
    formattedAddress: '641 N Highland Ave, Los Angeles, CA 90036',
    latitude: 34.0832,
    longitude: -118.3387,
    category: 'pizza restaurant',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Pizzeria+Mozza+Los+Angeles',
    tags: ['pizza', 'italian', 'dinner'],
  },
];

// ---------------------------------------------------------------------------
// Seed saved places for the demo user
// ---------------------------------------------------------------------------

export type DemoSeedSaved = {
  /** Stable id used for `saved_places.id` in storage. */
  savedId: string;
  googlePlaceId: string;
  radius_value: number | null;
  radius_unit: RadiusUnit | null;
  source_type: SourceType;
  source_url: string | null;
  notifications_enabled: boolean;
  notes: string | null;
  /** Hours-ago offset used to compute created_at so the list ordering is realistic. */
  ageHours: number;
};

export const DEMO_SEED_SAVED_PLACES: DemoSeedSaved[] = [
  {
    savedId: 'demo-saved-bantam',
    googlePlaceId: 'demo-bantam',
    radius_value: 0.5,
    radius_unit: 'miles',
    source_type: 'manual',
    source_url: null,
    notifications_enabled: true,
    notes: 'Wood-fired pizza spot — try the soft serve too.',
    ageHours: 2,
  },
  {
    savedId: 'demo-saved-akira',
    googlePlaceId: 'demo-akira',
    radius_value: null,
    radius_unit: null,
    source_type: 'tiktok',
    source_url: 'https://www.tiktok.com/@foodie/video/12345',
    notifications_enabled: true,
    notes: null,
    ageHours: 6,
  },
  {
    savedId: 'demo-saved-verve',
    googlePlaceId: 'demo-verve',
    radius_value: null,
    radius_unit: null,
    source_type: 'manual',
    source_url: null,
    notifications_enabled: true,
    notes: 'Best pour-over downtown.',
    ageHours: 12,
  },
  {
    savedId: 'demo-saved-tacos-moreno',
    googlePlaceId: 'demo-tacos-moreno',
    radius_value: 1,
    radius_unit: 'miles',
    source_type: 'instagram',
    source_url: 'https://www.instagram.com/p/abc123/',
    notifications_enabled: false,
    notes: null,
    ageHours: 24,
  },
  {
    savedId: 'demo-saved-aunt-marys',
    googlePlaceId: 'demo-aunt-marys',
    radius_value: 5,
    radius_unit: 'minutes',
    source_type: 'link',
    source_url: 'https://example.com/best-brunch-santa-cruz',
    notifications_enabled: true,
    notes: null,
    ageHours: 36,
  },
  {
    savedId: 'demo-saved-bear-republic',
    googlePlaceId: 'demo-bear-republic',
    radius_value: 2,
    radius_unit: 'miles',
    source_type: 'tiktok',
    source_url: 'https://www.tiktok.com/@bbqlover/video/67890',
    notifications_enabled: true,
    notes: 'Try the brisket and burnt ends.',
    ageHours: 48,
  },
  {
    savedId: 'demo-saved-burger-parlor',
    googlePlaceId: 'demo-burger-parlor',
    radius_value: 15,
    radius_unit: 'minutes',
    source_type: 'manual',
    source_url: null,
    notifications_enabled: true,
    notes: null,
    ageHours: 72,
  },
  {
    savedId: 'demo-saved-salt-straw',
    googlePlaceId: 'demo-salt-straw',
    radius_value: null,
    radius_unit: null,
    source_type: 'instagram',
    source_url: 'https://www.instagram.com/p/saltstraw/',
    notifications_enabled: true,
    notes: 'Honey lavender flight.',
    ageHours: 96,
  },
  {
    savedId: 'demo-saved-sidecar',
    googlePlaceId: 'demo-sidecar',
    radius_value: null,
    radius_unit: null,
    source_type: 'manual',
    source_url: null,
    notifications_enabled: false,
    notes: null,
    ageHours: 120,
  },
  {
    savedId: 'demo-saved-crossroads',
    googlePlaceId: 'demo-crossroads',
    radius_value: 0.25,
    radius_unit: 'miles',
    source_type: 'manual',
    source_url: null,
    notifications_enabled: true,
    notes: 'Drop off bag #2 next visit.',
    ageHours: 168,
  },
];
