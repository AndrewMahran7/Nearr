/**
 * Demo places search. Filters the local catalog by token match against the
 * candidate's name, category, formatted address, and tags. Returns up to 8
 * candidates so the UI looks like a real search result.
 *
 * No HTTP, no API key, no quota.
 */

import { DEMO_PLACE_CATALOG, type DemoPlaceCatalogEntry } from '@/lib/demoData';
import type { LocationBias, PlaceCandidate } from '@/services/placesService';

const MAX_RESULTS = 8;

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function entryText(e: DemoPlaceCatalogEntry): string {
  return [e.name, e.category ?? '', e.formattedAddress ?? '', ...e.tags]
    .join(' ')
    .toLowerCase();
}

function score(e: DemoPlaceCatalogEntry, tokens: string[]): number {
  const text = entryText(e);
  let s = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (e.tags.includes(t)) s += 5;
    if (text.includes(t)) s += 1;
  }
  return s;
}

export async function searchDemoPlaces(
  query: string,
  _locationBias?: LocationBias,
): Promise<PlaceCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const tokens = tokenize(trimmed);
  console.log('[demo:places] search', { q: trimmed, tokens });

  const scored = DEMO_PLACE_CATALOG
    .map((e) => ({ e, s: score(e, tokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_RESULTS)
    .map(({ e }) => stripTags(e));

  return scored;
}

export async function getDemoPlaceDetails(placeId: string): Promise<PlaceCandidate> {
  const hit = DEMO_PLACE_CATALOG.find((e) => e.googlePlaceId === placeId);
  if (!hit) throw new Error(`Demo place not found: ${placeId}`);
  return stripTags(hit);
}

function stripTags(e: DemoPlaceCatalogEntry): PlaceCandidate {
  // Drop the `tags` field — it's an internal demo-only helper not part of
  // the public PlaceCandidate shape.
  const { tags: _ignore, ...rest } = e;
  void _ignore;
  return rest;
}
