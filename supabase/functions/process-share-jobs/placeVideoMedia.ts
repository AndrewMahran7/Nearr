import { canonicalContentIdentity } from '../../../lib/shareAgent/contentIdentity.ts';
import { selectRepresentativeFrame } from '../../../lib/placeVideoGallery.ts';
import { normalizeEvidenceFrames } from '../../../lib/shareJobResult.ts';

const EVIDENCE_BUCKET = 'share-evidence';
const GALLERY_BUCKET = 'place-video-thumbnails';

function chooseFrame(raw: unknown, timestamps: readonly number[]) {
  return selectRepresentativeFrame(normalizeEvidenceFrames(raw), timestamps);
}

async function identityHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** Promote exactly one already-retained frame. Failure is non-fatal: saving a
 * place remains authoritative and a later retry can fill the unique row. */
export async function promotePlaceVideoMedia(args: {
  admin: any;
  placeId: string;
  sourceUrl: string;
  resolvedUrl?: string | null;
  platform: string;
  creatorHandle?: string | null;
  creatorName?: string | null;
  evidenceFrames: unknown;
  placeTimestamps?: readonly number[];
  publicAccessVerified: boolean;
  isSynthetic?: boolean;
}): Promise<boolean> {
  const identity = canonicalContentIdentity(args.sourceUrl, args.resolvedUrl);
  if (!identity || !args.placeId) return false;
  const frame = chooseFrame(args.evidenceFrames, args.placeTimestamps ?? []);
  let storagePath: string | null = null;
  if (frame?.storagePath) {
    try {
      const { data, error } = await args.admin.storage.from(EVIDENCE_BUCKET).download(frame.storagePath);
      if (!error && data) {
        storagePath = `${args.placeId}/${await identityHash(identity.key)}.jpg`;
        const upload = await args.admin.storage.from(GALLERY_BUCKET).upload(storagePath, data, {
          contentType: 'image/jpeg', cacheControl: '604800', upsert: true,
        });
        if (upload.error) storagePath = null;
      }
    } catch { storagePath = null; }
  }
  const publicEligible = args.publicAccessVerified && !args.isSynthetic;
  const { data: existing } = await args.admin.from('place_video_media')
    .select('representative_frame_storage_path,representative_frame_timestamp_seconds,community_visibility,source_reachability,public_access_verified_at,original_url,creator_handle,creator_name')
    .eq('place_id', args.placeId).eq('identity_key', identity.key).maybeSingle();
  const explicitlyRestricted = existing?.community_visibility === 'PRIVATE_SOURCE' ||
    existing?.community_visibility === 'OWNER_ONLY' ||
    existing?.community_visibility === 'PUBLIC_SOURCE_UNAVAILABLE';
  const { error } = await args.admin.from('place_video_media').upsert({
    place_id: args.placeId,
    identity_key: identity.key,
    identity_version: identity.identityVersion,
    platform: ['tiktok','instagram','youtube','facebook','snapchat'].includes(args.platform) ? args.platform : 'link',
    content_id: identity.contentId,
    canonical_url: identity.canonicalUrl,
    original_url: args.sourceUrl || existing?.original_url || null,
    creator_handle: args.creatorHandle ?? existing?.creator_handle ?? null,
    creator_name: args.creatorName ?? existing?.creator_name ?? null,
    representative_frame_storage_path: storagePath ?? existing?.representative_frame_storage_path ?? null,
    representative_frame_timestamp_seconds: storagePath ? frame?.timestampSeconds ?? null : existing?.representative_frame_timestamp_seconds ?? null,
    community_visibility: explicitlyRestricted ? existing.community_visibility : publicEligible ? 'PUBLIC_SOURCE_ELIGIBLE' : existing?.community_visibility ?? 'UNKNOWN',
    source_reachability: explicitlyRestricted ? existing.source_reachability : publicEligible ? 'REACHABLE' : existing?.source_reachability ?? 'UNKNOWN',
    public_access_verified_at: explicitlyRestricted ? existing.public_access_verified_at : publicEligible ? new Date().toISOString() : existing?.public_access_verified_at ?? null,
    is_synthetic: args.isSynthetic === true,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'place_id,identity_key', ignoreDuplicates: false });
  if (error) {
    console.warn('[place-video-media] promotion_failed', error.message);
    return false;
  }
  return !!storagePath;
}
