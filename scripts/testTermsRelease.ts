import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  LEGAL_ACCEPTANCE_REQUIRED,
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_VERSION,
  TERMS_PUBLIC_URL,
  TERMS_SECTIONS,
} from '../constants/legal';

// Canonical founder-published source: nearr-legal/terms.md at
// 82df43e51dc1d2bd8b1c3fbc6c52d9a997f53b31. Hash uses trimmed LF text.
const PUBLISHED_TERMS_SHA256 = 'dbbada82dcebb3218a2a49feeaa700c18daf3df6787d3ababe36a1dd853b4603';
const markdown = [
  '# Nearr Terms of Service',
  `Effective date: ${LEGAL_EFFECTIVE_DATE}`,
  ...TERMS_SECTIONS.map((section) => [
    `## ${section.heading}`,
    ...section.paragraphs,
  ].join('\n\n')),
].join('\n\n');
const sha256 = createHash('sha256').update(markdown.trim()).digest('hex');

assert.equal(sha256, PUBLISHED_TERMS_SHA256, 'in-app Terms must match the founder-published Terms exactly');
assert.equal(TERMS_PUBLIC_URL, 'https://nearrapp.com/terms');
assert.equal(LEGAL_CONTACT_EMAIL, 'andrew.mahran@icloud.com');
assert.equal(LEGAL_VERSION, '2026-05-02', 'legacy acceptance record key must not change with display copy');
assert.equal(LEGAL_ACCEPTANCE_REQUIRED, false, 'Terms display correction must not activate an acceptance gate');

const root = path.resolve(__dirname, '..');
for (const file of ['app/legal/terms.tsx', 'app/(tabs)/settings.tsx']) {
  const text = readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(text, /production draft|internal production readiness|lawyer review required/i, `${file} exposes a draft warning`);
}

console.log('PASS published Terms text, public link, legacy acceptance state, and visible draft-warning removal');
