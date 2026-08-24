import { supabase } from '@/lib/supabase';
import { canonicalContentIdentity } from '@/lib/shareAgent/contentIdentity';
import type { SourceType } from '@/types';

/** Attach public source provenance without ever turning a successful save into
 * a failure. The database RPC owns race-safe dedupe and owner validation. */
export async function attachSavedPlaceSource(args: {
  userId: string;
  savedPlaceId: string;
  sourceUrl?: string | null;
  sourceType?: SourceType | null;
  creatorHandle?: string | null;
  creatorName?: string | null;
  caption?: string | null;
  aiNote?: string | null;
  thumbnailUrl?: string | null;
}): Promise<'attached' | 'deduped' | 'skipped'> {
  const sourceUrl = args.sourceUrl?.trim();
  if (!sourceUrl || !args.sourceType || args.sourceType === 'manual') return 'skipped';
  const identity = canonicalContentIdentity(sourceUrl);
  if (!identity) return 'skipped';
  try {
    const { data, error } = await supabase.rpc('attach_saved_place_source', {
      p_user_id: args.userId,
      p_saved_place_id: args.savedPlaceId,
      p_identity_key: identity.key,
      p_identity_version: identity.identityVersion,
      p_platform: args.sourceType,
      p_content_id: identity.contentId,
      p_canonical_url: identity.canonicalUrl,
      p_original_url: sourceUrl,
      p_creator_handle: args.creatorHandle ?? null,
      p_creator_name: args.creatorName ?? null,
      p_caption_excerpt: typeof args.caption === 'string' ? args.caption.slice(0, 1000) : null,
      p_ai_note: typeof args.aiNote === 'string' ? args.aiNote.slice(0, 1000) : null,
      p_thumbnail_url: args.thumbnailUrl ?? null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row?.attached === true ? 'attached' : row?.deduped === true ? 'deduped' : 'skipped';
  } catch (error) {
    console.warn('[savedPlaceSourcesService] source attach failed (non-fatal)', (error as Error)?.message);
    return 'skipped';
  }
}
