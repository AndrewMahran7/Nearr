export type PlaceVideoOwnership = 'OWNER' | 'COMMUNITY';
export type CommunityVisibility =
  | 'OWNER_ONLY'
  | 'PUBLIC_SOURCE_ELIGIBLE'
  | 'PUBLIC_SOURCE_UNAVAILABLE'
  | 'PRIVATE_SOURCE'
  | 'UNKNOWN';

export type PlaceVideoItem = {
  sourceId: string;
  thumbnailUrl: string;
  platform: 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'snapchat' | 'link';
  creatorHandle: string | null;
  originalUrl: string;
  ownership: PlaceVideoOwnership;
  createdAt: string;
};

export type PlaceVideoGallery = {
  placeId: string;
  placeName: string | null;
  ownerVideos: PlaceVideoItem[];
  communityVideos: PlaceVideoItem[];
  totalVideoCount: number;
  nextCursor: string | null;
};

export type RepresentativeFrame = {
  id: string;
  storagePath?: string | null;
  url?: string | null;
  timestampSeconds: number;
  width?: number | null;
  height?: number | null;
  relevance?: 'vayrin_selected' | 'candidate_evidence' | 'analysis_coverage' | string;
  sharpness?: number | null;
  distinctiveness?: number | null;
  textOnly?: boolean;
  faceOnly?: boolean;
};

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function relevanceScore(value: RepresentativeFrame['relevance']): number {
  if (value === 'candidate_evidence') return 40;
  if (value === 'vayrin_selected') return 30;
  if (value === 'analysis_coverage') return 10;
  return 0;
}

/** Deterministic, zero-model representative-frame choice. Place-specific
 * moments dominate; visual quality breaks ties when the producer supplied it. */
export function selectRepresentativeFrame(
  frames: readonly RepresentativeFrame[],
  placeTimestamps: readonly number[] = [],
): RepresentativeFrame | null {
  const candidates = frames.filter((frame) =>
    !!(frame.storagePath?.trim() || frame.url?.trim()) &&
    Number.isFinite(frame.timestampSeconds) && frame.timestampSeconds >= 0,
  );
  if (candidates.length === 0) return null;
  const moments = placeTimestamps.filter((value) => Number.isFinite(value) && value >= 0);
  const distance = (frame: RepresentativeFrame) => moments.length
    ? Math.min(...moments.map((moment) => Math.abs(moment - frame.timestampSeconds)))
    : 0;
  const visualScore = (frame: RepresentativeFrame) => {
    const width = Math.max(0, finite(frame.width));
    const height = Math.max(1, finite(frame.height, 1));
    const contextual = width / height >= 1.2 ? 12 : width / height >= 0.75 ? 6 : 0;
    return relevanceScore(frame.relevance) + contextual +
      finite(frame.sharpness) * 8 + finite(frame.distinctiveness) * 5 -
      (frame.textOnly ? 50 : 0) - (frame.faceOnly ? 35 : 0);
  };
  return [...candidates].sort((left, right) =>
    distance(left) - distance(right) ||
    visualScore(right) - visualScore(left) ||
    left.timestampSeconds - right.timestampSeconds ||
    left.id.localeCompare(right.id),
  )[0] ?? null;
}

export type GalleryCandidate = PlaceVideoItem & {
  identityKey: string;
  communityVisibility: CommunityVisibility;
  sourceReachability: 'REACHABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  synthetic?: boolean;
};

/** Owner precedence + canonical source dedupe. Unknown/private/unavailable and
 * synthetic sources can never cross the community privacy boundary. */
export function partitionPlaceVideos(candidates: readonly GalleryCandidate[]): {
  ownerVideos: PlaceVideoItem[];
  communityVideos: PlaceVideoItem[];
} {
  const newest = [...candidates].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || a.identityKey.localeCompare(b.identityKey));
  const owners = new Map<string, PlaceVideoItem>();
  for (const candidate of newest) {
    if (candidate.ownership === 'OWNER' && !owners.has(candidate.identityKey)) {
      owners.set(candidate.identityKey, candidate);
    }
  }
  const community = new Map<string, PlaceVideoItem>();
  for (const candidate of newest) {
    if (candidate.ownership !== 'COMMUNITY' || owners.has(candidate.identityKey) || community.has(candidate.identityKey)) continue;
    if (candidate.communityVisibility !== 'PUBLIC_SOURCE_ELIGIBLE') continue;
    if (candidate.sourceReachability !== 'REACHABLE' || candidate.synthetic) continue;
    community.set(candidate.identityKey, candidate);
  }
  return { ownerVideos: [...owners.values()], communityVideos: [...community.values()] };
}

export function selectVideoHero(
  providerPhotos: readonly string[],
  ownerVideos: readonly PlaceVideoItem[],
  communityVideos: readonly PlaceVideoItem[],
): { kind: 'PROVIDER' | 'OWNER_VIDEO' | 'COMMUNITY_VIDEO'; uri: string; video?: PlaceVideoItem } | null {
  const provider = providerPhotos.find((uri) => !!uri?.trim());
  if (provider) return { kind: 'PROVIDER', uri: provider };
  const owner = ownerVideos.find((video) => !!video.thumbnailUrl?.trim());
  if (owner) return { kind: 'OWNER_VIDEO', uri: owner.thumbnailUrl, video: owner };
  const community = communityVideos.find((video) => !!video.thumbnailUrl?.trim());
  return community ? { kind: 'COMMUNITY_VIDEO', uri: community.thumbnailUrl, video: community } : null;
}

export function videoGridColumnCount(): 2 { return 2; }
