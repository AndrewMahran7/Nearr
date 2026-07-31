/**
 * scripts/testShareUrlValidation.ts
 *
 * Unit tests for the SSRF-safe share-URL validator
 * (supabase/functions/create-share-job/urlValidation.ts). Pure module.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testShareUrlValidation.ts
 */

import {
  validateShareUrl,
  isBlockedHost,
} from '../supabase/functions/create-share-job/urlValidation';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function reason(input: unknown): string {
  const r = validateShareUrl(input);
  return r.ok ? 'ok' : r.reason;
}

// ---- Accepted public URLs --------------------------------------------------
check('https instagram ok', validateShareUrl('https://www.instagram.com/reel/abc/').ok);
check('http ok', validateShareUrl('http://example.com/x').ok);
check('tiktok short ok', validateShareUrl('https://vm.tiktok.com/ZM123/').ok);
check('public ip 8.8.8.8 ok', validateShareUrl('https://8.8.8.8/x').ok);
check('public ipv4 172.32 ok (outside /12)', validateShareUrl('https://172.32.0.1/x').ok);

// ---- Rejected schemes / shapes --------------------------------------------
check('empty => empty', reason('') === 'empty');
check('whitespace => empty', reason('   ') === 'empty');
check('non-string => not_a_string', reason(123 as unknown) === 'not_a_string');
check('garbage => invalid_url', reason('not a url') === 'invalid_url');
check('ftp => unsupported_scheme', reason('ftp://example.com') === 'unsupported_scheme');
check('file => unsupported_scheme', reason('file:///etc/passwd') === 'unsupported_scheme');
check('data => unsupported_scheme', reason('data:text/html,hi') === 'unsupported_scheme');
check('javascript => unsupported_scheme', reason('javascript:alert(1)') === 'unsupported_scheme');
check(
  'credentials => has_credentials',
  reason('https://user:pass@example.com') === 'has_credentials',
);

// ---- SSRF: blocked hosts ---------------------------------------------------
check('localhost blocked', reason('http://localhost/x') === 'blocked_host');
check('127.0.0.1 blocked', reason('http://127.0.0.1/x') === 'blocked_host');
check('0.0.0.0 blocked', reason('http://0.0.0.0/x') === 'blocked_host');
check('10.x blocked', reason('http://10.0.0.5/x') === 'blocked_host');
check('192.168.x blocked', reason('http://192.168.1.10/x') === 'blocked_host');
check('172.16.x blocked', reason('http://172.16.0.9/x') === 'blocked_host');
check('172.20.x blocked', reason('http://172.20.5.5/x') === 'blocked_host');
check('169.254 metadata blocked', reason('http://169.254.169.254/latest/meta-data') === 'blocked_host');
check('cgnat 100.64 blocked', reason('http://100.64.0.1/x') === 'blocked_host');
check('ipv6 loopback blocked', reason('http://[::1]/x') === 'blocked_host');
check('ipv6 link-local blocked', reason('http://[fe80::1]/x') === 'blocked_host');
check('*.local blocked', reason('http://printer.local/x') === 'blocked_host');
check('*.internal blocked', reason('http://db.internal/x') === 'blocked_host');
check('metadata.google.internal blocked', reason('http://metadata.google.internal/x') === 'blocked_host');

// ---- isBlockedHost direct --------------------------------------------------
check('isBlockedHost public host false', isBlockedHost('instagram.com') === false);
check('isBlockedHost 172.32 false', isBlockedHost('172.32.0.1') === false);
check('isBlockedHost 11.0.0.1 false', isBlockedHost('11.0.0.1') === false);

// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll share-URL validation assertions passed.');
