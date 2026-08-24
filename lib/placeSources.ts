import { canonicalContentIdentity } from './shareAgent/contentIdentity';
import type { SavedPlaceSource, SavedPlaceWithPlace, SourceType } from '../types';

export type PlaceSourceCard = {
  key: string;
  url: string;
  platform: Exclude<SourceType, 'manual'>;
  creator: string | null;
  caption: string | null;
  aiNote: string | null;
  thumbnailUrl: string | null;
  attachedAt: string | null;
  primary: boolean;
};

/** Source list for Place Detail, including a compatibility fallback for rows
 * loaded from an older schema/offline cache. Exact identities are deduped. */
export function placeSourceCards(
  saved: Pick<SavedPlaceWithPlace, 'source_url' | 'source_type' | 'ai_note' | 'created_at' | 'sources'>,
): PlaceSourceCard[] {
  const rows = Array.isArray(saved.sources) ? saved.sources : [];
  const cards = rows
    .filter((source): source is SavedPlaceSource => !!source?.canonical_url)
    .map((source) => ({
      key: source.identity_key,
      url: source.canonical_url,
      platform: source.platform,
      creator: source.creator_name ?? source.creator_handle,
      caption: source.caption_excerpt,
      aiNote: source.ai_note,
      thumbnailUrl: source.thumbnail_url,
      attachedAt: source.first_attached_at,
      primary: source.is_primary,
    }));

  const legacyUrl = saved.source_url?.trim();
  if (legacyUrl && saved.source_type && saved.source_type !== 'manual') {
    const identity = canonicalContentIdentity(legacyUrl);
    const key = identity?.key ?? `legacy:${legacyUrl.toLowerCase()}`;
    if (!cards.some((card) => card.key === key || card.url === legacyUrl)) {
      cards.push({
        key,
        url: legacyUrl,
        platform: saved.source_type,
        creator: null,
        caption: null,
        aiNote: saved.ai_note ?? null,
        thumbnailUrl: null,
        attachedAt: saved.created_at ?? null,
        primary: cards.length === 0,
      });
    }
  }

  const seen = new Set<string>();
  return cards
    .filter((card) => {
      const identity = canonicalContentIdentity(card.url);
      const key = identity?.key ?? card.key;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(b.primary) - Number(a.primary) ||
      (a.attachedAt ?? '').localeCompare(b.attachedAt ?? ''));
}

export function shouldShowMoreVideos(sources: readonly PlaceSourceCard[]): boolean {
  return sources.length >= 2;
}
