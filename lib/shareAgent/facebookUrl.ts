/**
 * Pure Facebook source-URL adapter.
 *
 * Facebook exposes the same public video through several URL families.  This
 * module reduces forms that already expose a numeric video id to one exact,
 * reopenable identity URL.  Opaque redirect links stay exact but are marked as
 * requiring server-side redirect resolution; no network access happens here.
 */

export type FacebookUrlKind =
  | 'reel'
  | 'video'
  | 'post'
  | 'story'
  | 'share_redirect'
  | 'short_redirect'
  | 'unsupported';

export type FacebookUrlInfo = {
  isFacebook: boolean;
  supported: boolean;
  kind: FacebookUrlKind;
  canonicalUrl: string;
  contentId: string | null;
  creatorOrPage: string | null;
  needsRedirectResolution: boolean;
};

export type FacebookDiscoveredCanonicalPlan = {
  canonicalUrl: string;
  accepted: boolean;
  reason: 'invalid_discovered_url' | 'video_id_mismatch' | 'exact_content';
};

const NUMERIC_ID_RE = /^\d{5,30}$/;
const POST_ID_RE = /^(?:\d{5,30}|pfbid[A-Za-z0-9]{8,})$/i;
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{4,200}$/;
const TRACKING_PARAMS = new Set([
  'fbclid', 'mibextid', 'ref', 'refsrc', 'refid', '__tn__', '__cft__',
]);

export function isFacebookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === 'fb.watch' || host === 'facebook.com' || host.endsWith('.facebook.com');
}

function cleanPath(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, '/');
  if (collapsed === '/') return '/';
  return collapsed.replace(/\/+$/, '') + '/';
}

function cleanQuery(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) {
      url.searchParams.delete(key);
    }
  }
}

export function canonicalFacebookVideoUrl(videoId: string): string | null {
  const id = videoId.trim();
  return NUMERIC_ID_RE.test(id) ? `https://www.facebook.com/reel/${id}/` : null;
}

function unsupported(url: URL): FacebookUrlInfo {
  cleanQuery(url);
  url.hash = '';
  url.hostname = url.hostname === 'fb.watch' ? 'fb.watch' : 'www.facebook.com';
  url.pathname = cleanPath(url.pathname);
  return {
    isFacebook: true,
    supported: false,
    kind: 'unsupported',
    canonicalUrl: url.toString(),
    contentId: null,
    creatorOrPage: null,
    needsRedirectResolution: false,
  };
}

/** Parse and normalize a Facebook URL. Returns null for non-Facebook input. */
export function inspectFacebookUrl(rawUrl: string): FacebookUrlInfo | null {
  let url: URL;
  try {
    url = new URL((rawUrl ?? '').trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !isFacebookHost(url.hostname)) return null;

  url.protocol = 'https:';
  url.port = '';
  url.hash = '';
  cleanQuery(url);
  const originalHost = url.hostname.toLowerCase();
  const path = cleanPath(url.pathname);
  const segments = path.split('/').filter(Boolean);

  // fb.watch carries an opaque token.  The public HTML/yt-dlp request follows
  // it and the resolved numeric id is canonicalized on the server.
  if (originalHost === 'fb.watch') {
    const token = segments[0] ?? '';
    if (!SHARE_TOKEN_RE.test(token)) return unsupported(url);
    url.hostname = 'fb.watch';
    url.pathname = `/${token}/`;
    url.search = '';
    return {
      isFacebook: true,
      supported: true,
      kind: 'short_redirect',
      canonicalUrl: url.toString(),
      contentId: token,
      creatorOrPage: null,
      needsRedirectResolution: true,
    };
  }

  url.hostname = 'www.facebook.com';

  // /reel/<id>, /reels/<id>
  if ((segments[0]?.toLowerCase() === 'reel' || segments[0]?.toLowerCase() === 'reels') &&
      NUMERIC_ID_RE.test(segments[1] ?? '')) {
    const id = segments[1]!;
    return {
      isFacebook: true,
      supported: true,
      kind: 'reel',
      canonicalUrl: canonicalFacebookVideoUrl(id)!,
      contentId: id,
      creatorOrPage: null,
      needsRedirectResolution: false,
    };
  }

  // /watch/?v=<id>, /watch/live/?v=<id>, /video.php?v=<id>
  const queryVideoId = url.searchParams.get('v') ?? '';
  if (
    NUMERIC_ID_RE.test(queryVideoId) &&
    (segments[0]?.toLowerCase() === 'watch' || segments[0]?.toLowerCase() === 'video.php' || segments.length === 0)
  ) {
    return {
      isFacebook: true,
      supported: true,
      kind: 'video',
      canonicalUrl: canonicalFacebookVideoUrl(queryVideoId)!,
      contentId: queryVideoId,
      creatorOrPage: null,
      needsRedirectResolution: false,
    };
  }

  // /<page>/videos/<id> and legacy /<page>/videos/vb.<page-id>/<id>
  const videosIndex = segments.findIndex((part) => part.toLowerCase() === 'videos');
  if (videosIndex >= 0) {
    const id = [...segments.slice(videosIndex + 1)].reverse().find((part) => NUMERIC_ID_RE.test(part));
    if (id) {
      const creator = videosIndex > 0 ? segments[videosIndex - 1] ?? null : null;
      return {
        isFacebook: true,
        supported: true,
        kind: 'video',
        canonicalUrl: canonicalFacebookVideoUrl(id)!,
        contentId: id,
        creatorOrPage: creator,
        needsRedirectResolution: false,
      };
    }
  }

  // Modern app share links: /share/r|v|p/<opaque-token>.  The token is exact
  // but not the post id, so the server must follow the redirect.
  if (segments[0]?.toLowerCase() === 'share' &&
      ['r', 'v', 'p'].includes((segments[1] ?? '').toLowerCase()) &&
      SHARE_TOKEN_RE.test(segments[2] ?? '')) {
    const family = segments[1]!.toLowerCase();
    const token = segments[2]!;
    url.pathname = `/share/${family}/${token}/`;
    url.search = '';
    return {
      isFacebook: true,
      supported: true,
      kind: 'share_redirect',
      canonicalUrl: url.toString(),
      contentId: token,
      creatorOrPage: null,
      needsRedirectResolution: true,
    };
  }

  // Exact post URLs may contain a video whose media id is only discoverable
  // from the public provider response. Preserve the post id until then.
  const postsIndex = segments.findIndex((part) => part.toLowerCase() === 'posts');
  if (postsIndex > 0 && POST_ID_RE.test(segments[postsIndex + 1] ?? '')) {
    const postId = segments[postsIndex + 1]!;
    const creator = segments[postsIndex - 1] ?? null;
    const ownerPath = segments.slice(0, postsIndex).join('/');
    url.pathname = `/${ownerPath}/posts/${postId}/`;
    url.search = '';
    return {
      isFacebook: true,
      supported: true,
      kind: 'post',
      canonicalUrl: url.toString(),
      contentId: postId,
      creatorOrPage: creator,
      needsRedirectResolution: false,
    };
  }

  // story.php/permalink.php retain the two identity-bearing query params.
  if (['story.php', 'permalink.php'].includes((segments[0] ?? '').toLowerCase())) {
    const storyId = url.searchParams.get('story_fbid') ?? '';
    const creatorId = url.searchParams.get('id') ?? '';
    if (POST_ID_RE.test(storyId)) {
      url.pathname = `/${segments[0]!.toLowerCase()}`;
      url.search = '';
      url.searchParams.set('story_fbid', storyId);
      if (/^\d{3,30}$/.test(creatorId)) url.searchParams.set('id', creatorId);
      return {
        isFacebook: true,
        supported: true,
        kind: 'story',
        canonicalUrl: url.toString(),
        contentId: storyId,
        creatorOrPage: creatorId || null,
        needsRedirectResolution: false,
      };
    }
  }

  return unsupported(url);
}

/**
 * Trust-boundary check for a stronger URL discovered by the media extractor.
 * A direct numeric input can never be changed to a different video id. Opaque
 * redirects and post ids may legitimately reveal their underlying video id.
 */
export function planFacebookDiscoveredCanonicalUrl(
  currentRawUrl: string,
  discoveredRawUrl: unknown,
): FacebookDiscoveredCanonicalPlan {
  const current = inspectFacebookUrl(currentRawUrl);
  const fallback = current?.canonicalUrl || currentRawUrl;
  const discovered = typeof discoveredRawUrl === 'string'
    ? inspectFacebookUrl(discoveredRawUrl)
    : null;
  if (!discovered?.supported || discovered.needsRedirectResolution) {
    return { canonicalUrl: fallback, accepted: false, reason: 'invalid_discovered_url' };
  }
  const currentHasNumericVideoIdentity =
    current?.supported && ['reel', 'video'].includes(current.kind) &&
    !!current.contentId && NUMERIC_ID_RE.test(current.contentId);
  if (
    currentHasNumericVideoIdentity &&
    current!.contentId !== discovered.contentId
  ) {
    return { canonicalUrl: fallback, accepted: false, reason: 'video_id_mismatch' };
  }
  return {
    canonicalUrl: discovered.canonicalUrl,
    accepted: true,
    reason: 'exact_content',
  };
}
