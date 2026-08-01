/**
 * scripts/testSharedAuthSession.ts
 *
 * Unit tests for lib/sharedAuthSession.ts — the pure JWT-claim + shared-session
 * validity logic the iOS Share Extension uses to decide whether it can submit
 * a job (Bug 1: false signed-out / expired-token handling).
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testSharedAuthSession.ts
 */

import {
  decodeJwtClaims,
  evaluateSharedSession,
  selectExtensionAuthAction,
} from '../lib/sharedAuthSession';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function makeToken(payload: Record<string, unknown>): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  return `${header}.${b64url(payload)}.fake-signature-not-verified`;
}

const NOW = 1_700_000_000_000; // fixed "now" in ms
const nowSec = Math.floor(NOW / 1000);

// ---- decodeJwtClaims --------------------------------------------------------
{
  const claims = decodeJwtClaims(makeToken({ sub: 'user-abc', exp: 123456 }));
  check('decode sub', claims?.sub === 'user-abc');
  check('decode exp', claims?.exp === 123456);
}
check('decode null => null', decodeJwtClaims(null) === null);
check('decode empty => null', decodeJwtClaims('   ') === null);
check('decode non-jwt => null', decodeJwtClaims('not-a-jwt') === null);
check('decode 2-part => null', decodeJwtClaims('a.b') === null);
check('decode garbage payload => null', decodeJwtClaims('h.!!!!.s') === null);
check(
  'decode missing sub => sub null',
  decodeJwtClaims(makeToken({ exp: 1 }))?.sub === null,
);
check(
  'decode missing exp => exp null',
  decodeJwtClaims(makeToken({ sub: 'x' }))?.exp === null,
);

// ---- evaluateSharedSession --------------------------------------------------
check('absent: null', evaluateSharedSession(null, NOW) === 'absent');
check('absent: undefined', evaluateSharedSession(undefined, NOW) === 'absent');
check('absent: whitespace', evaluateSharedSession('   ', NOW) === 'absent');

check('malformed: not a jwt', evaluateSharedSession('garbage', NOW) === 'malformed');
check(
  'malformed: jwt without exp',
  evaluateSharedSession(makeToken({ sub: 'u' }), NOW) === 'malformed',
);

check(
  'valid: exp 1h ahead',
  evaluateSharedSession(makeToken({ sub: 'u', exp: nowSec + 3600 }), NOW) === 'valid',
);
check(
  'expired: exp 10s ago',
  evaluateSharedSession(makeToken({ sub: 'u', exp: nowSec - 10 }), NOW) === 'expired',
);
check(
  'expired: exactly now (<= treated expired)',
  evaluateSharedSession(makeToken({ sub: 'u', exp: nowSec }), NOW, 0) === 'expired',
);
check(
  'expired: within default 30s skew',
  evaluateSharedSession(makeToken({ sub: 'u', exp: nowSec + 20 }), NOW, 30) === 'expired',
);
check(
  'valid: just past the skew window',
  evaluateSharedSession(makeToken({ sub: 'u', exp: nowSec + 31 }), NOW, 30) === 'valid',
);

// ---- selectExtensionAuthAction (every state) --------------------------------
const validToken = makeToken({ sub: 'u', exp: nowSec + 3600 });
const expiredToken = makeToken({ sub: 'u', exp: nowSec - 10 });

check(
  'action: valid + initialized => submit',
  selectExtensionAuthAction({ token: validToken, initialized: true, nowMs: NOW }) === 'submit',
);
check(
  'action: valid + NOT initialized => submit (valid wins)',
  selectExtensionAuthAction({ token: validToken, initialized: false, nowMs: NOW }) === 'submit',
);
check(
  'action: absent + NOT initialized => needs_setup',
  selectExtensionAuthAction({ token: null, initialized: false, nowMs: NOW }) === 'needs_setup',
);
check(
  'action: absent + initialized => signed_out',
  selectExtensionAuthAction({ token: null, initialized: true, nowMs: NOW }) === 'signed_out',
);
check(
  'action: empty token + initialized => signed_out',
  selectExtensionAuthAction({ token: '   ', initialized: true, nowMs: NOW }) === 'signed_out',
);
check(
  'action: expired => session_expired (regardless of init true)',
  selectExtensionAuthAction({ token: expiredToken, initialized: true, nowMs: NOW }) === 'session_expired',
);
check(
  'action: expired => session_expired (regardless of init false)',
  selectExtensionAuthAction({ token: expiredToken, initialized: false, nowMs: NOW }) === 'session_expired',
);
check(
  'action: malformed => session_expired',
  selectExtensionAuthAction({ token: 'garbage', initialized: true, nowMs: NOW }) === 'session_expired',
);

if (failures > 0) {
  console.error(`\n${failures} shared-auth-session test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll shared-auth-session tests passed.');
