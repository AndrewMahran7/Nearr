// Pure trust-boundary normalization for canonical URLs discovered by a media
// resolver after it follows a platform short link. The callback body is
// untrusted even though the endpoint is authenticated: only an exact TikTok
// post URL is accepted, and it may never change a post id already known from
// the task input.

import {
  extractTikTokPostIdentity,
  normalizeShareUrl,
} from '../../../lib/shareAgent/tiktokUrl.ts';

export type MediaCanonicalPlan = {
  canonicalUrl: string;
  changed: boolean;
  acceptedDiscoveredUrl: boolean;
  reason: 'not_tiktok' | 'missing_or_invalid' | 'post_id_mismatch' | 'exact_post';
  postId: string | null;
};

export function planMediaCanonicalUrl(args: {
  platform: string;
  sourceUrl: string;
  canonicalUrl: string | null;
  discoveredCanonicalUrl: unknown;
}): MediaCanonicalPlan {
  const currentRaw = args.canonicalUrl || args.sourceUrl;
  const current = normalizeShareUrl(currentRaw).url || currentRaw;
  if (args.platform.toLowerCase() !== 'tiktok') {
    return {
      canonicalUrl: current,
      changed: false,
      acceptedDiscoveredUrl: false,
      reason: 'not_tiktok',
      postId: null,
    };
  }

  const knownIdentity =
    extractTikTokPostIdentity(args.canonicalUrl ?? '') ??
    extractTikTokPostIdentity(args.sourceUrl);
  const discoveredIdentity = typeof args.discoveredCanonicalUrl === 'string'
    ? extractTikTokPostIdentity(args.discoveredCanonicalUrl)
    : null;
  if (!discoveredIdentity) {
    return {
      canonicalUrl: current,
      changed: false,
      acceptedDiscoveredUrl: false,
      reason: 'missing_or_invalid',
      postId: knownIdentity?.postId ?? null,
    };
  }
  if (knownIdentity && knownIdentity.postId !== discoveredIdentity.postId) {
    return {
      canonicalUrl: current,
      changed: false,
      acceptedDiscoveredUrl: false,
      reason: 'post_id_mismatch',
      postId: knownIdentity.postId,
    };
  }
  return {
    canonicalUrl: discoveredIdentity.canonicalUrl,
    changed: current !== discoveredIdentity.canonicalUrl,
    acceptedDiscoveredUrl: true,
    reason: 'exact_post',
    postId: discoveredIdentity.postId,
  };
}
