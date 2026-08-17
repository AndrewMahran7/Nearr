/**
 * lib/placeSource.ts
 *
 * ONE canonical answer to "where did this saved place come from, and how do we
 * brand it?" — shared by every surface that shows source attribution.
 *
 * Why this exists: Instagram had a real brand mark (Feather ships an
 * `instagram` glyph) while TikTok fell back to a generic `video` icon, because
 * Feather has no TikTok glyph. That made TikTok saves look like a lesser,
 * unbranded citizen next to Instagram. Ionicons — already bundled with
 * @expo/vector-icons, so no new dependency — carries `logo-tiktok`,
 * `logo-instagram`, `logo-youtube`, `logo-facebook` and `logo-snapchat`, which
 * lets every platform be branded from ONE family and look like a peer.
 *
 * PURE — no React Native imports, no I/O. The icon name is returned as a
 * string; the component maps it onto <Ionicons>. Unit-tested from ts-node.
 */

import type { SourceType } from '@/types';

export type PlaceSourcePlatform =
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'facebook'
  | 'snapchat'
  | 'link';

export type PlaceSourceAttribution = {
  platform: PlaceSourcePlatform;
  /** Human name for the platform, e.g. "TikTok". */
  platformName: string;
  /** Ionicons glyph. Real brand marks for every social platform. */
  brandIcon: string;
  /** Whether `brandIcon` is an actual platform logo (vs. a generic fallback). */
  branded: boolean;
  /** Compact button label, e.g. "Watch post". */
  actionLabel: string;
  /** Full accessibility label for the watch/open action. */
  actionA11yLabel: string;
  /** Accessibility label for the attribution itself, e.g. "TikTok source". */
  sourceA11yLabel: string;
  /** Brand colour for the logo. Used sparingly — the mark only, never a fill. */
  brandColor: string;
  /**
   * Heading for the row of OTHER saved places that came from this same post.
   * Video-first platforms say "video"; a generic link says "post", because
   * calling an unknown web page a video would simply be untrue.
   */
  siblingSectionTitle: string;
};

const PLATFORMS: Record<PlaceSourcePlatform, Omit<PlaceSourceAttribution, 'platform'>> = {
  instagram: {
    platformName: 'Instagram',
    brandIcon: 'logo-instagram',
    branded: true,
    actionLabel: 'Watch post',
    actionA11yLabel: 'Watch original Instagram post',
    sourceA11yLabel: 'Instagram source',
    brandColor: '#E4405F',
    siblingSectionTitle: 'From this video',
  },
  tiktok: {
    platformName: 'TikTok',
    brandIcon: 'logo-tiktok',
    branded: true,
    actionLabel: 'Watch post',
    actionA11yLabel: 'Watch original TikTok',
    sourceA11yLabel: 'TikTok source',
    // TikTok's mark is black/white on brand; on a themed surface the neutral
    // text colour reads better than either cyan or magenta alone, so the
    // component uses this only where a tint is genuinely wanted.
    brandColor: '#000000',
    siblingSectionTitle: 'From this video',
  },
  youtube: {
    platformName: 'YouTube',
    brandIcon: 'logo-youtube',
    branded: true,
    actionLabel: 'Watch video',
    actionA11yLabel: 'Watch original YouTube video',
    sourceA11yLabel: 'YouTube source',
    brandColor: '#FF0000',
    siblingSectionTitle: 'From this video',
  },
  facebook: {
    platformName: 'Facebook',
    brandIcon: 'logo-facebook',
    branded: true,
    actionLabel: 'Watch post',
    actionA11yLabel: 'Watch original Facebook post',
    sourceA11yLabel: 'Facebook source',
    brandColor: '#1877F2',
    siblingSectionTitle: 'From this video',
  },
  snapchat: {
    platformName: 'Snapchat',
    brandIcon: 'logo-snapchat',
    branded: true,
    actionLabel: 'Watch post',
    actionA11yLabel: 'Watch original Snapchat post',
    sourceA11yLabel: 'Snapchat source',
    brandColor: '#FFFC00',
    siblingSectionTitle: 'From this video',
  },
  link: {
    platformName: 'Link',
    // Deliberately NOT a fake brand: a generic link really is generic.
    brandIcon: 'link-outline',
    branded: false,
    actionLabel: 'Open link',
    actionA11yLabel: 'Open original link',
    sourceA11yLabel: 'Link source',
    brandColor: '#8E8E93',
    siblingSectionTitle: 'From this post',
  },
};

/** Host-based fallback, used ONLY when `source_type` is absent. */
function platformFromUrl(url: string | null | undefined): PlaceSourcePlatform | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  let host = '';
  try {
    host = new URL(url.trim()).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  if (!host) return null;
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtu.be'
  ) {
    return 'youtube';
  }
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch') {
    return 'facebook';
  }
  if (host === 'snapchat.com' || host.endsWith('.snapchat.com')) return 'snapchat';
  return null;
}

function normalizeSourceType(value: unknown): PlaceSourcePlatform | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return key in PLATFORMS ? (key as PlaceSourcePlatform) : null;
}

/**
 * Resolve the attribution for a saved place.
 *
 * Returns `null` when there is no social/link source at all — a manual save
 * must render NO source card rather than an empty shell or a fake platform.
 *
 * Canonical `source_type` always wins. The URL host is consulted only when
 * `source_type` is missing, so a mislabelled URL can never override the
 * persisted contract.
 */
export function resolvePlaceSource(saved: {
  source_type?: SourceType | string | null;
  source_url?: string | null;
}): PlaceSourceAttribution | null {
  const url = typeof saved?.source_url === 'string' ? saved.source_url.trim() : '';
  const declared = normalizeSourceType(saved?.source_type);
  const platform = declared ?? platformFromUrl(url);
  // No platform AND no URL → a manual save. Nothing to attribute.
  if (!platform) {
    if (!url) return null;
    return { platform: 'link', ...PLATFORMS.link };
  }
  return { platform, ...PLATFORMS[platform] };
}

/** True when we have an actual URL to open for this place's source. */
export function hasOpenableSource(saved: { source_url?: string | null }): boolean {
  return typeof saved?.source_url === 'string' && saved.source_url.trim().length > 0;
}
