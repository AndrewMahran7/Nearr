const SAFE_CONTENT_ID = /^[A-Za-z0-9_-]+$/;
type TutorialPreviewPlatform = 'instagram' | 'tiktok' | 'facebook' | 'youtube';

/**
 * Resolve a public, place-answer-free preview for an exact tutorial source.
 * The Instagram route is owned by Instagram and redirects to the current
 * source poster, so no expiring CDN URL needs to be persisted in fixture data.
 */
export function onboardingTutorialPreviewUrl(
  platform: TutorialPreviewPlatform,
  contentId: string,
  advertisedUrl?: unknown,
): string | null {
  if (typeof advertisedUrl === 'string' && advertisedUrl.startsWith('https://')) {
    return advertisedUrl;
  }
  if (!SAFE_CONTENT_ID.test(contentId)) return null;
  if (platform === 'instagram') {
    return `https://www.instagram.com/p/${encodeURIComponent(contentId)}/media/?size=l`;
  }
  if (platform === 'youtube') {
    return `https://i.ytimg.com/vi/${encodeURIComponent(contentId)}/hqdefault.jpg`;
  }
  return null;
}
