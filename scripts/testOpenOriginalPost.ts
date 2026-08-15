/**
 * scripts/testOpenOriginalPost.ts
 *
 * Unit tests for lib/openOriginalPost.ts — the security validation behind the
 * confirmation screen's "Open original post" action. Covers the spec cases:
 *   - valid Instagram / TikTok / YouTube URL opens
 *   - missing URL disables the action
 *   - malformed URL is rejected
 *   - unsupported host is rejected
 *   - opening the source can only ever "open" (never resolve/remove the job)
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testOpenOriginalPost.ts
 */

import {
  validateSourceUrl,
  canOpenOriginal,
  planOpenOriginal,
} from '../lib/openOriginalPost';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// ---- valid platform URLs open ---------------------------------------------
check('instagram post is allowed', validateSourceUrl('https://www.instagram.com/p/ABC123/').ok);
check('instagram reel is allowed', validateSourceUrl('https://instagram.com/reel/XYZ/').ok);
check('tiktok video is allowed', validateSourceUrl('https://www.tiktok.com/@user/video/7646649399942139166').ok);
check('tiktok short link is allowed', validateSourceUrl('https://vm.tiktok.com/ZM123/').ok);
check('youtube watch is allowed', validateSourceUrl('https://www.youtube.com/watch?v=abcdEFGhijk').ok);
check('youtube short link is allowed', validateSourceUrl('https://youtu.be/abcdEFGhijk').ok);
check('youtube shorts is allowed', validateSourceUrl('https://youtube.com/shorts/abcdEFGhijk').ok);
check('facebook reel is allowed', validateSourceUrl('https://www.facebook.com/reel/1234567890123456/').ok);
check('facebook videos is allowed', validateSourceUrl('https://www.facebook.com/SomePage/videos/1234567890123456/').ok);
check('fb.watch is allowed', validateSourceUrl('https://fb.watch/abcDEF123/').ok);
check('snapchat spotlight is allowed', validateSourceUrl('https://www.snapchat.com/spotlight/W7_abc123XYZ').ok);
check('x.com is allowed', validateSourceUrl('https://x.com/user/status/123').ok);

// ---- missing URL disables the action --------------------------------------
check('null is missing', validateSourceUrl(null).ok === false);
check('undefined is missing', validateSourceUrl(undefined).ok === false);
check('empty string is missing', validateSourceUrl('   ').ok === false);
const nullCheck = validateSourceUrl(null);
check('missing reason is "missing"', !nullCheck.ok && nullCheck.reason === 'missing');
check('canOpenOriginal false when missing', canOpenOriginal(null) === false);

// ---- malformed URL is rejected --------------------------------------------
check('garbage is malformed', validateSourceUrl('not a url').ok === false);
check('bare host without scheme is malformed', validateSourceUrl('instagram.com/p/ABC').ok === false);

// ---- insecure / dangerous schemes are rejected ----------------------------
check('http is rejected', validateSourceUrl('http://instagram.com/p/ABC').ok === false);
check('javascript: is rejected', validateSourceUrl('javascript:alert(1)').ok === false);
check('data: is rejected', validateSourceUrl('data:text/html,<script>1</script>').ok === false);
check('file: is rejected', validateSourceUrl('file:///etc/passwd').ok === false);
check(
  'a javascript URL reports insecure_scheme',
  (() => {
    const v = validateSourceUrl('javascript:void(0)');
    return !v.ok && v.reason === 'insecure_scheme';
  })(),
);

// ---- unsupported host is rejected -----------------------------------------
check('random https host rejected', validateSourceUrl('https://evil.example.com/p/ABC').ok === false);
check(
  'lookalike host rejected (not a real subdomain)',
  validateSourceUrl('https://instagram.com.evil.com/p/ABC').ok === false,
);
check(
  'unsupported host reports unsupported_host',
  (() => {
    const v = validateSourceUrl('https://maps.google.com/place/x');
    return !v.ok && v.reason === 'unsupported_host';
  })(),
);

// ---- planOpenOriginal: opening never resolves/removes the job -------------
const plan = planOpenOriginal('https://www.instagram.com/p/ABC123/');
check('valid plan is an "open"', plan.kind === 'open');
check(
  'open plan fires share_job_original_post_opened',
  plan.kind === 'open' && plan.analyticsEvent === 'share_job_original_post_opened',
);
check(
  'plan has NO resolve/remove/save outcome (open or unavailable only)',
  plan.kind === 'open' || plan.kind === 'unavailable',
);
check('invalid plan is "unavailable"', planOpenOriginal('nope').kind === 'unavailable');
// Idempotent / side-effect-free: calling twice yields an equal plan, so
// "returning to Nearr preserves the confirmation state" is never disturbed by
// this pure decision.
check(
  'planOpenOriginal is idempotent',
  JSON.stringify(planOpenOriginal('https://youtu.be/abcdEFGhijk')) ===
    JSON.stringify(planOpenOriginal('https://youtu.be/abcdEFGhijk')),
);

if (failures > 0) {
  console.error(`\n${failures} open-original-post test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll open-original-post tests passed.');
