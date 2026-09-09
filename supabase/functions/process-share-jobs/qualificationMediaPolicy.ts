const WIRED_QUALIFICATION_MEDIA_PLATFORMS = new Set([
  'instagram',
  'tiktok',
  'youtube',
  'facebook',
  'snapchat',
]);

/**
 * The guarded qualification job mode promises a real fresh-media attempt.
 * Ordinary feature flags still control every normal app job; this override is
 * intentionally limited to the internal job mode created by the Dev-only
 * qualification RPC.
 */
export function qualificationMediaResolverEnabled(
  recognitionRunMode: unknown,
  platform: unknown,
): boolean {
  return recognitionRunMode === 'qualification_fresh' &&
    typeof platform === 'string' &&
    WIRED_QUALIFICATION_MEDIA_PLATFORMS.has(platform.toLowerCase());
}
