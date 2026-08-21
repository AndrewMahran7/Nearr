// @ts-nocheck — Deno runtime.

const DEVELOPMENT_REF = 'qnfxnmvxpjzfydgudtvs';
const DEVELOPMENT_HOST = `${DEVELOPMENT_REF}.supabase.co`;

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Katz&#39;s Delicatessen, New York, NY</title>
    <meta property="og:title" content="Katz&#39;s Delicatessen, New York, NY">
    <meta property="og:description" content="Katz&#39;s Delicatessen. Visit at 205 East Houston Street, New York, NY 10002.">
    <meta name="description" content="Katz&#39;s Delicatessen. Visit at 205 East Houston Street, New York, NY 10002.">
  </head>
  <body>Nearr development cheap-metadata fixture.</body>
</html>`;

function isDevelopmentDeployment(): boolean {
  try {
    return new URL(Deno.env.get('SUPABASE_URL') ?? '').hostname === DEVELOPMENT_HOST;
  } catch {
    return false;
  }
}

Deno.serve((request) => {
  if (!isDevelopmentDeployment()) {
    return new Response('Not Found', { status: 404 });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }
  return new Response(request.method === 'HEAD' ? null : FIXTURE_HTML, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
});
