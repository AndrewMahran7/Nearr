// supabase/functions/process-share-link/metadata/fetchMetadata.ts
//
// Fetch the raw HTML for a share URL and extract a normalized
// `PostMetadata` shape. Behaviorally identical to the inline meta
// fetching done by `processShareLink` in the legacy index.ts:
//   - 8-second hard timeout
//   - User-agent set to NearrBot
//   - Failures are propagated; callers decide how to degrade.

// @ts-nocheck — Deno runtime.

import { pickMeta, pickTitle } from './htmlMeta.ts';
import { cleanTitle, cleanDescription } from './normalizeText.ts';

const USER_AGENT =
  'Mozilla/5.0 (compatible; NearrBot/1.0; +https://nearr.app)';
const FETCH_TIMEOUT_MS = 8000;

export type PostMetadata = {
  title: string | null;
  description: string | null;
  /** Raw HTML — kept so caller can run platform-specific extra
   *  scrapes (e.g. Instagram profile enrichment). */
  html: string;
};

export type FetchMetadataResult =
  | { ok: true; metadata: PostMetadata }
  | { ok: false; reason: 'network_error' | 'http_error'; error?: string };

export async function fetchPostMetadata(url: string): Promise<FetchMetadataResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: 'http_error', error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const title = cleanTitle(
      pickMeta(html, 'og:title') ?? pickTitle(html),
    );
    const description = cleanDescription(
      pickMeta(html, 'og:description') ?? pickMeta(html, 'description'),
    );
    return { ok: true, metadata: { title, description, html } };
  } catch (err) {
    return {
      ok: false,
      reason: 'network_error',
      error: (err as Error)?.message,
    };
  } finally {
    clearTimeout(timer);
  }
}
