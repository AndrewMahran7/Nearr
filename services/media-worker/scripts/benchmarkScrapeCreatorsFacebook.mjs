const DEFAULT_URLS = [
  'https://www.facebook.com/reel/1535656380759655/',
  'https://www.facebook.com/reel/1356645589772949/',
  'https://www.facebook.com/reel/1303365218449136/',
  'https://www.facebook.com/reel/2349748325554244/',
  'https://www.facebook.com/reel/1313027950911844/',
  'https://www.facebook.com/reel/3384429771712962/',
  'https://www.facebook.com/reel/1052691990581061/',
  'https://fb.watch/J8m9M2wynx/',
  'https://www.facebook.com/watch/?v=10153231379946729',
  'https://www.facebook.com/reel/9999999999999999/',
];

const apiKey = process.env.SCRAPE_CREATORS_KEY;
if (!apiKey) {
  console.error('SCRAPE_CREATORS_KEY is not configured');
  process.exit(2);
}

const urls = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_URLS;

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedString(value, max = 2048) {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function host(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

const results = [];
for (const url of urls.slice(0, 20)) {
  const started = Date.now();
  try {
    const endpoint = new URL('https://api.scrapecreators.com/v1/facebook/post');
    endpoint.searchParams.set('url', url);
    const response = await fetch(endpoint, {
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    let body = {};
    try {
      body = objectValue(await response.json());
    } catch {
      // Status and latency remain useful without retaining a malformed body.
    }
    const video = objectValue(body.video);
    results.push({
      url,
      httpStatus: response.status,
      success: body.success === true,
      creditsCharged: Number.isFinite(Number(body.credits_charged))
        ? Number(body.credits_charged)
        : null,
      postId: boundedString(body.post_id, 80),
      returnedUrl: boundedString(body.url),
      videoId: boundedString(video.id, 80),
      sdHost: host(video.sd_url),
      hdHost: host(video.hd_url),
      durationSeconds: Number.isFinite(Number(video.length_in_second))
        ? Number(video.length_in_second)
        : null,
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    results.push({
      url,
      error: error?.name === 'TimeoutError' ? 'timeout' : 'transport_error',
      latencyMs: Date.now() - started,
    });
  }
}

console.log(JSON.stringify(results, null, 2));
