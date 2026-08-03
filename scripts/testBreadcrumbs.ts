/**
 * scripts/testBreadcrumbs.ts
 *
 * Unit tests for lib/breadcrumbsCore.ts — the pure ring-buffer logic behind the
 * sanitized diagnostic breadcrumb trail shown in the global error boundary's
 * "Copy diagnostic". Proves the buffer stays bounded, preserves chronological
 * order, and strips secrets from field values.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testBreadcrumbs.ts
 */

import {
  appendBreadcrumb,
  formatBreadcrumb,
  formatBreadcrumbs,
  makeBreadcrumb,
  MAX_BREADCRUMBS,
  sanitizeBreadcrumbFields,
  type Breadcrumb,
} from '../lib/breadcrumbsCore';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// --- bounded ring buffer ----------------------------------------------------
let buf: Breadcrumb[] = [];
for (let i = 0; i < MAX_BREADCRUMBS + 15; i += 1) {
  buf = appendBreadcrumb(buf, makeBreadcrumb('actual_navigation', { route: `/r${i}` }, i));
}
check('buffer never exceeds MAX_BREADCRUMBS', buf.length === MAX_BREADCRUMBS, `len=${buf.length}`);
check(
  'oldest entries are dropped (newest kept)',
  buf[buf.length - 1].route === `/r${MAX_BREADCRUMBS + 14}`,
  buf[buf.length - 1].route ?? '?',
);
check(
  'chronological order preserved (newest last)',
  buf[0].t < buf[buf.length - 1].t,
);

// appendBreadcrumb is pure — does not mutate the input array.
const before: Breadcrumb[] = [makeBreadcrumb('app_launch', {}, 1)];
const after = appendBreadcrumb(before, makeBreadcrumb('map_mounted', {}, 2));
check('appendBreadcrumb does not mutate input', before.length === 1 && after.length === 2);

// --- sanitization -----------------------------------------------------------
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.abcDEF123-_signaturePart';
const dirty = sanitizeBreadcrumbFields({
  route: '/map',
  errorMessage: `token ${JWT} boom`,
});
check('sanitizes JWT out of field values', !(dirty.errorMessage ?? '').includes('eyJ'));
check('keeps safe route field', dirty.route === '/map');
check(
  'drops null/undefined fields',
  !('jobId' in sanitizeBreadcrumbFields({ route: '/x' })),
);

// --- formatting -------------------------------------------------------------
const one = makeBreadcrumb('save_response', { jobId: 'j1', result: 'saved' }, 0);
const line = formatBreadcrumb(one);
check('formatBreadcrumb includes event + fields', line.includes('save_response') && line.includes('jobId=j1') && line.includes('result=saved'));
check('formatBreadcrumbs handles empty buffer', formatBreadcrumbs([]) === '(no breadcrumbs)');
check(
  'formatBreadcrumbs joins multiple lines',
  formatBreadcrumbs([one, makeBreadcrumb('map_mounted', {}, 1)]).split('\n').length === 2,
);

if (failures > 0) {
  console.error(`\n${failures} breadcrumb test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll breadcrumb tests passed');
