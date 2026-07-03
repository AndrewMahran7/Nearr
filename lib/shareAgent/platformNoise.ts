/**
 * Deterministic "platform-noise" candidate detection — shared by the Deno
 * resolver (placeScoring) and unit tests. Pure, dependency-free, Deno+RN
 * safe.
 *
 * Problem: generic TikTok metadata (e.g. the og:title "TikTok - Make Your
 * Day") can leak into the Google Places query and make Places return
 * businesses that ARE the platform / social-media vendors rather than the
 * place the post is about:
 *   - "TikTok Inc."
 *   - "Tiktok Verification"
 *   - "The Short Media - TikTok Marketing Agency in USA"
 *   - "ByteDance"
 *
 * These must never be surfaced as a saved-place candidate for a TikTok
 * share. This filter is intentionally SCOPED to TikTok source posts (not a
 * global filter) so it can't hurt Instagram / generic-link resolution: a
 * real restaurant a TikTok post is about will not be named "TikTok …" /
 * "ByteDance", so rejecting those names is safe and precise.
 */

// Word-boundary match on the platform/company names. Case-insensitive.
// `tiktok` covers "TikTok Inc.", "Tiktok Verification", "… TikTok Marketing
// Agency …"; `bytedance` covers the parent company.
const TIKTOK_NOISE_RE = /\b(tik\s*tok|bytedance)\b/i;

/**
 * True when `name` is a platform/company result that must NOT be shown as a
 * place candidate for the given source `platform`. Only fires for TikTok
 * source posts.
 */
export function isPlatformNoiseName(
  name: string | null | undefined,
  platform: string | null | undefined,
): boolean {
  if (!name) return false;
  if ((platform ?? '').toLowerCase() !== 'tiktok') return false;
  return TIKTOK_NOISE_RE.test(name);
}

/**
 * True when a query SEED is just platform boilerplate (e.g. "TikTok - Make
 * Your Day" / "TikTok"). Used to keep such text from ever being sent to
 * Google Places. Applies regardless of platform because these strings are
 * never a real place query.
 */
export function isPlatformBoilerplateSeed(seed: string | null | undefined): boolean {
  if (!seed) return false;
  const s = seed.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (s === 'tiktok' || s === 'instagram' || s === 'make your day') return true;
  if (/^tik\s*tok\b/.test(s) && /make your day/.test(s)) return true;
  return false;
}
