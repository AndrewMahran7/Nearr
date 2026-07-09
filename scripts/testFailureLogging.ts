/**
 * scripts/testFailureLogging.ts
 *
 * Focused assertions for share extraction failure classification and
 * payload sanitization/truncation. Pure + offline.
 */

import {
  assessShareFailureLogging,
  recordShareExtractionFailure,
  type WireStatus,
} from '../supabase/functions/process-share-link/failureLogging';
import type { Evidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';
import type {
  ResolverResult,
  ResolvedCandidate,
} from '../supabase/functions/process-share-link/types';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    platform: 'instagram',
    rawTitle: null,
    rawDescription: null,
    captionText: '',
    address: null,
    addresses: [],
    cityState: null,
    venueNameHints: [],
    handles: {
      posterHandle: null,
      taggedHandles: [],
      venueHandles: [],
      posterNameHint: null,
    },
    isRoundup: false,
    taggedLocation: null,
    keys: [],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ResolvedCandidate> = {}): ResolvedCandidate {
  return {
    googlePlaceId: 'place_1',
    name: 'Some Place',
    formattedAddress: '123 Main St, Austin, TX 78701',
    confidenceScore: 0.9,
    reasons: [],
    evidence: [],
    ...overrides,
  };
}

function makeResult(overrides: Partial<ResolverResult> = {}): ResolverResult {
  return {
    decision: 'manual_fallback',
    confidence: 'low',
    cleanSearchQuery: 'test query',
    candidates: [],
    diagnostics: {
      queryPlan: ['query:test query'],
      decisionReasons: ['manual_fallback'],
    },
    warnings: [],
    safeToAutoSave: false,
    failureReason: 'manual_fallback_no_explicit_place_evidence',
    evidenceUsed: [],
    ...overrides,
  };
}

function testManualFallbackAddressPresent(): void {
  const evidence = makeEvidence({
    addresses: [
      {
        raw: '189 The Grove Dr, Los Angeles, CA 90036',
        venue: null,
        city: 'Los Angeles',
        state: 'CA',
        zip: '90036',
      },
    ],
  });

  const result = makeResult({
    warnings: ['address_present_but_no_verified_business'],
    candidates: [],
  });

  const assessed = assessShareFailureLogging({
    wireStatus: 'open_app',
    result,
    evidence,
  });

  check(
    'manual fallback with address logs',
    assessed.shouldLog === true &&
      assessed.failureClass === 'address_present_but_no_verified_business' &&
      assessed.addressPresent === true &&
      assessed.candidateCount === 0,
    JSON.stringify(assessed),
  );
}

function testGenericCaptionBlocked(): void {
  const assessed = assessShareFailureLogging({
    wireStatus: 'open_app',
    result: makeResult({ warnings: ['generic_caption_query_blocked'] }),
    evidence: makeEvidence(),
  });

  check(
    'generic caption blocked classification',
    assessed.failureClass === 'generic_caption_blocked' &&
      assessed.triggerReasons.includes('warning_generic_caption_query_blocked'),
    JSON.stringify(assessed),
  );
}

function testPlatformNoiseRejected(): void {
  const assessed = assessShareFailureLogging({
    wireStatus: 'open_app',
    result: makeResult({
      warnings: ['all_candidates_rejected_as_platform_noise'],
      failureReason: 'all_candidates_rejected_as_platform_noise',
    }),
    evidence: makeEvidence(),
  });

  check(
    'platform noise rejection classification',
    assessed.failureClass === 'platform_noise_rejected' &&
      assessed.triggerReasons.includes('warning_all_candidates_rejected_as_platform_noise'),
    JSON.stringify(assessed),
  );
}

function testSuspiciousCandidateConfirmation(): void {
  const candidate = makeCandidate({
    name: '123 Main St',
    confidenceScore: 0.21,
    reasons: ['generic_address_card'],
    evidence: [],
  });

  const assessed = assessShareFailureLogging({
    wireStatus: 'ambiguous',
    result: makeResult({
      decision: 'candidate_confirmation',
      failureReason: undefined,
      candidates: [candidate],
      primaryCandidate: candidate,
      warnings: [],
      evidenceUsed: [],
    }),
    evidence: makeEvidence({
      addresses: [
        {
          raw: '123 Main St, Austin, TX 78701',
          venue: null,
          city: 'Austin',
          state: 'TX',
          zip: '78701',
        },
      ],
    }),
  });

  check(
    'low-score generic address candidate classified',
    assessed.failureClass === 'places_only_generic_address' &&
      assessed.triggerReasons.includes('suspicious_low_confidence_candidate') &&
      assessed.triggerReasons.includes('candidate_confirmation_without_evidence') &&
      assessed.triggerReasons.includes('places_only_generic_address_candidates'),
    JSON.stringify(assessed),
  );
}

async function testTruncationAndSecretStripping(): Promise<void> {
  const insertedRows: unknown[] = [];
  const fakeClient = {
    from(_table: string) {
      return {
        insert(row: unknown) {
          insertedRows.push(row);
          return {
            select(_sel: string) {
              return {
                maybeSingle: async () => ({ data: { id: 'log_1' }, error: null }),
              };
            },
          };
        },
      };
    },
  };

  const longDescription = `${'word '.repeat(600)}tail`;
  const result = makeResult({
    diagnostics: {
      queryPlan: Array.from({ length: 50 }, (_v, i) => `query:${i}`),
      authorization: 'Bearer should-not-appear',
      token: 'secret-token',
      decisionReasons: ['manual_fallback'],
    },
    warnings: ['address_present_but_no_verified_business'],
    cleanSearchQuery: 'best food near me',
  });

  const evidence = makeEvidence({
    addresses: [
      {
        raw: '42 Wallaby Way, Sydney NSW 2000',
        venue: 'P Sherman',
        city: 'Sydney',
        state: 'NSW',
        zip: '2000',
      },
    ],
    venueNameHints: ['P Sherman 42 Wallaby Way Sydney'],
    handles: {
      posterHandle: '@poster',
      taggedHandles: ['@tag1', '@tag2'],
      venueHandles: ['@venue'],
      posterNameHint: 'Poster',
    },
  });

  const logged = await recordShareExtractionFailure({
    adminClient: fakeClient,
    userId: null,
    originalUrl: 'https://instagram.com/reel/abc123',
    canonicalUrl: 'https://instagram.com/reel/abc123',
    platform: 'instagram',
    wireStatus: 'open_app' as WireStatus,
    result,
    extraction: {
      title: 'A'.repeat(800),
      description: longDescription,
      query: 'foo',
    },
    evidence,
    requestId: 'req_1',
    appVersion: '1.2.3',
    backendVersion: 'test',
    logAllExtractions: true,
  });

  const inserted = insertedRows[0] as Record<string, unknown>;
  const diagnostics = inserted.diagnostics as Record<string, unknown>;
  const titlePreview = String(inserted.title_preview ?? '');
  const descPreview = String(inserted.description_preview ?? '');

  check('record insert returns id', logged.id === 'log_1', JSON.stringify(logged));
  check('single row inserted', insertedRows.length === 1, `rows=${insertedRows.length}`);
  check('title preview truncated', titlePreview.length <= 243, `len=${titlePreview.length}`);
  check('description preview truncated', descPreview.length <= 423, `len=${descPreview.length}`);
  check('authorization removed from diagnostics', !('authorization' in diagnostics));
  check('token removed from diagnostics', !('token' in diagnostics));
}

async function main(): Promise<void> {
  testManualFallbackAddressPresent();
  testGenericCaptionBlocked();
  testPlatformNoiseRejected();
  testSuspiciousCandidateConfirmation();
  await testTruncationAndSecretStripping();

  console.log(
    failures === 0
      ? '\nAll failure logging assertions passed.'
      : `\n${failures} assertion(s) failed.`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('FAIL unexpected error', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
