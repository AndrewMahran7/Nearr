/**
 * scripts/testSanitizeError.ts
 *
 * Unit tests for lib/sanitizeError.ts — proves the error-boundary logging
 * strips tokens / URL credentials / secrets before anything is logged, so a
 * physical-device crash is diagnosable WITHOUT leaking sensitive data.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testSanitizeError.ts
 */

import { sanitizeErrorText, sanitizeStack } from '../lib/sanitizeError';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImV4cCI6OTk5OTk5OTk5OX0.abcDEF123-_signaturePart';

check('redacts a JWT', !sanitizeErrorText(`boom ${JWT} end`).includes('eyJ'));
check('jwt replaced with placeholder', sanitizeErrorText(JWT).includes('<jwt>'));

check(
  'redacts Bearer token',
  sanitizeErrorText('Authorization: Bearer abc123def456ghi').includes('Bearer <redacted>'),
);

check(
  'redacts URL credentials',
  sanitizeErrorText('failed https://user:secretpass@db.example.com/x') ===
    'failed https://<redacted>@db.example.com/x',
);

{
  const out = sanitizeErrorText('error access_token=abcDEF12345 more');
  check('redacts access_token value', out.includes('<redacted>') && !out.includes('abcDEF12345'));
}
{
  const out = sanitizeErrorText('{"refresh_token":"rTvalue12345"}');
  check('redacts refresh_token value', !out.includes('rTvalue12345'));
}
{
  const long = 'x'.repeat(50);
  check('redacts long opaque blob', !sanitizeErrorText(`k ${long}`).includes(long));
}

// Ordinary messages are preserved.
check(
  'preserves normal message',
  sanitizeErrorText('Cannot read property name of undefined') ===
    'Cannot read property name of undefined',
);
check(
  'Error instance => name: message',
  sanitizeErrorText(new TypeError('bad thing')) === 'TypeError: bad thing',
);

// Stack sanitized + capped.
{
  const stack = `at Foo (app.js:1)\nBearer tok_abcdef123456\n`.repeat(200);
  const out = sanitizeStack(stack, 500);
  check('stack capped', out.length <= 501);
  check('stack redacts bearer', !out.includes('tok_abcdef123456'));
}

if (failures > 0) {
  console.error(`\n${failures} sanitize-error test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll sanitize-error tests passed.');
