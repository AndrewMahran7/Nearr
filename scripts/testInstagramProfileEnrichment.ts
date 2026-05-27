import {
  buildVerifiedProfileQuery,
  parseInstagramPublicProfileHtml,
} from '../lib/instagramProfileMetadata';

const mockHtml = `
<!doctype html>
<html>
  <head>
    <meta property="og:title" content="Old Fisherman's Grotto (@oldfishermansgrotto) • Instagram photos and videos" />
    <meta name="description" content="10,000 Followers, 42 Following, 850 Posts - Old Fisherman's Grotto (@oldfishermansgrotto) on Instagram: &quot;Seafood Perfection Since 1950. 39 Fisherman's Wharf, Monterey CA. oldfishermansgrotto.com&quot;" />
    <script type="application/json">
      {"category_name":"Restaurant","username":"oldfishermansgrotto"}
    </script>
  </head>
  <body></body>
</html>
`.trim();

function main() {
  const parsed = parseInstagramPublicProfileHtml({
    html: mockHtml,
    handle: 'oldfishermansgrotto',
  });

  console.log(JSON.stringify({
    parsed,
    verifiedProfileQuery: buildVerifiedProfileQuery(parsed),
  }, null, 2));
}

main();