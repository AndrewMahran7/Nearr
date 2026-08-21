/** Deterministic TikTok acquisition/normalization contract tests. No network. */

import assert from 'node:assert/strict';
import {
  fetchPostMetadata,
  isPermanentMetadataFailure,
} from '../supabase/functions/process-share-link/metadata/fetchMetadata';
import { planMediaCanonicalUrl } from '../supabase/functions/process-share-jobs/sourceCanonicalization';

const DIRECT = 'https://www.tiktok.com/@satexasfoodies/video/7433811014237326622';
const SHORT = 'https://vm.tiktok.com/ZMfixture/';
const FULL_CAPTION = [
  'Hidden gem coffee shop in Northwest San Antonio Texas located in a plant nursery.',
  'Tuxedo Cats Coffee 6075 Heath Rd San Antonio TX 78250.',
  'The creator keeps useful details here for a roundup and does not want ingestion to cut them off.',
  '#sanantonio #coffee #texas #hiddengem',
].join(' ').padEnd(697, ' more-place-context');

type MockReply = {
  ok: boolean;
  status: number;
  url: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

function reply(args: { url: string; status?: number; html?: string; json?: unknown }): MockReply {
  const status = args.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    url: args.url,
    async text() { return args.html ?? ''; },
    async json() { return args.json ?? {}; },
  };
}

function page(description: string): string {
  return `<html><head><meta property="og:title" content="TikTok fixture"><meta property="og:description" content="${description}"></head></html>`;
}

function oembed(caption = FULL_CAPTION, url = DIRECT) {
  const creator = url.match(/\/@([^/]+)/)?.[1] ?? 'satexasfoodies';
  const postId = url.match(/\/video\/(\d+)/)?.[1] ?? '7433811014237326622';
  return {
    title: caption,
    author_name: 'Sanitized Creator',
    author_url: `https://www.tiktok.com/@${creator}`,
    html: `<blockquote cite="${url}" data-video-id="${postId}"></blockquote>`,
  };
}

async function withFetch<T>(handler: (url: string) => MockReply, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => handler(String(input))) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

async function main() {
  const direct = await withFetch(
    (url) => url.includes('/oembed?')
      ? reply({ url, json: oembed() })
      : reply({ url: DIRECT, html: page(FULL_CAPTION.slice(0, 180)) }),
    () => fetchPostMetadata(`${DIRECT}?is_from_webapp=1&_t=noise`, 'tiktok'),
  );
  assert.equal(direct.ok, true);
  if (direct.ok) {
    assert.equal(direct.resolvedUrl, DIRECT);
    assert.equal(direct.metadata.description, FULL_CAPTION);
    assert.ok((direct.metadata.description?.length ?? 0) > 240);
    assert.match(direct.metadata.description ?? '', /#sanantonio/);
    assert.equal(direct.metadata.creatorHandle, 'satexasfoodies');
    assert.equal(direct.metadata.postId, '7433811014237326622');
    assert.equal(direct.usedTikTokOEmbed, true);
  }

  const expanded = await withFetch(
    (url) => url.includes('/oembed?')
      ? reply({ url, json: oembed() })
      : reply({ url: DIRECT, html: page('Short preview') }),
    () => fetchPostMetadata(SHORT, 'tiktok'),
  );
  assert.equal(expanded.ok && expanded.resolvedUrl, DIRECT);

  let unsupportedFetches = 0;
  const unsupported = await withFetch(
    (url) => { unsupportedFetches += 1; return reply({ url }); },
    () => fetchPostMetadata('https://www.tiktok.com/discover/best-pizza', 'tiktok'),
  );
  assert.deepEqual(unsupported, { ok: false, reason: 'unsupported_tiktok_url' });
  assert.equal(unsupportedFetches, 0);
  assert.equal(isPermanentMetadataFailure('unsupported_tiktok_url'), true);
  assert.equal(isPermanentMetadataFailure('network_error'), false);

  const offPlatform = await withFetch(
    () => reply({ url: 'https://apps.apple.com/us/app/tiktok/id835599320', html: page('App Store') }),
    () => fetchPostMetadata(SHORT, 'tiktok'),
  );
  assert.deepEqual(offPlatform, { ok: false, reason: 'redirect_off_platform' });

  const other = 'https://www.tiktok.com/@satexasfoodies/video/9999999999999999999';
  const mismatch = await withFetch(
    (url) => url.includes('/oembed?')
      ? reply({ url, json: oembed('Other caption', other) })
      : reply({ url: other, html: page('Other caption') }),
    () => fetchPostMetadata(DIRECT, 'tiktok'),
  );
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.reason, 'tiktok_post_mismatch');

  const adopted = planMediaCanonicalUrl({
    platform: 'tiktok', sourceUrl: SHORT, canonicalUrl: SHORT, discoveredCanonicalUrl: DIRECT,
  });
  assert.equal(adopted.canonicalUrl, DIRECT);
  assert.equal(adopted.changed, true);
  assert.equal(adopted.acceptedDiscoveredUrl, true);
  const replay = planMediaCanonicalUrl({
    platform: 'tiktok', sourceUrl: SHORT, canonicalUrl: adopted.canonicalUrl, discoveredCanonicalUrl: DIRECT,
  });
  assert.equal(replay.changed, false);
  const rejected = planMediaCanonicalUrl({
    platform: 'tiktok', sourceUrl: DIRECT, canonicalUrl: DIRECT, discoveredCanonicalUrl: other,
  });
  assert.equal(rejected.reason, 'post_id_mismatch');
  assert.equal(rejected.canonicalUrl, DIRECT);
  const spoof = planMediaCanonicalUrl({
    platform: 'tiktok', sourceUrl: SHORT, canonicalUrl: SHORT,
    discoveredCanonicalUrl: 'https://eviltiktok.com/@satexasfoodies/video/7433811014237326622',
  });
  assert.equal(spoof.reason, 'missing_or_invalid');
  assert.equal(spoof.canonicalUrl, SHORT);

  console.log('All TikTok ingestion parity assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
