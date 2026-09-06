import { isDemoMode } from '@/lib/demoMode';
import { isMapPreviewMode } from '@/lib/mapPreview';
import type { PlaceVideoGallery, PlaceVideoItem } from '@/lib/placeVideoGallery';
import { supabase } from '@/lib/supabase';

function item(value: unknown): PlaceVideoItem | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.sourceId !== 'string' || typeof row.thumbnailUrl !== 'string' ||
      typeof row.originalUrl !== 'string' || !['OWNER', 'COMMUNITY'].includes(String(row.ownership))) return null;
  const platform = String(row.platform);
  if (!['instagram', 'tiktok', 'youtube', 'facebook', 'snapchat', 'link'].includes(platform)) return null;
  return {
    sourceId: row.sourceId,
    thumbnailUrl: row.thumbnailUrl,
    originalUrl: row.originalUrl,
    platform: platform as PlaceVideoItem['platform'],
    creatorHandle: typeof row.creatorHandle === 'string' ? row.creatorHandle : null,
    ownership: row.ownership as PlaceVideoItem['ownership'],
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
  };
}

export async function loadPlaceVideos(args: {
  placeId: string;
  includeCommunity?: boolean;
  cursor?: string | null;
  limit?: number;
}): Promise<PlaceVideoGallery> {
  if (!args.placeId || isDemoMode() || isMapPreviewMode()) {
    return { placeId: args.placeId, placeName: null, ownerVideos: [], communityVideos: [], totalVideoCount: 0, nextCursor: null };
  }
  const { data, error } = await supabase.functions.invoke('get-place-videos', {
    body: {
      placeId: args.placeId,
      includeCommunity: args.includeCommunity === true,
      cursor: args.cursor ?? null,
      limit: Math.max(1, Math.min(20, Math.floor(args.limit ?? 20))),
    },
  });
  if (error) throw new Error(error.message);
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return {
    placeId: typeof body.placeId === 'string' ? body.placeId : args.placeId,
    placeName: typeof body.placeName === 'string' ? body.placeName : null,
    ownerVideos: Array.isArray(body.ownerVideos) ? body.ownerVideos.map(item).filter((entry): entry is PlaceVideoItem => !!entry) : [],
    communityVideos: Array.isArray(body.communityVideos) ? body.communityVideos.map(item).filter((entry): entry is PlaceVideoItem => !!entry) : [],
    totalVideoCount: Number.isFinite(body.totalVideoCount) ? Number(body.totalVideoCount) : 0,
    nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null,
  };
}
