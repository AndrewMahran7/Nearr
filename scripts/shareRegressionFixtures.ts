/**
 * scripts/shareRegressionFixtures.ts
 *
 * Typed fixtures for the share-extraction regression suite. Each fixture is a
 * real share URL plus the decision/candidate expectations we want the backend
 * to satisfy. These are consumed by the remote tester
 * (`scripts/testProcessShareLinkRemote.ts`) — run against the DEPLOYED Edge
 * Function, so they require Supabase creds and a live deploy (see notes at the
 * bottom). They are intentionally DATA-ONLY (no network / no side effects) so
 * they can also be imported by future assertion harnesses.
 *
 * STATUS: the fixture list exists; a fully-automated `npm run
 * test:share-regression` runner over these (assert decision + candidate name +
 * address against the live backend) is a follow-up — see PLAN below. For now
 * the deterministic venue-hint behavior is covered by the local unit tests in
 * scripts/testRecoveryHints.ts (cases A–E), which run offline.
 */

export type ShareRegressionFixture = {
  /** Stable identifier for reporting. */
  id: string;
  /** Share URL to send to process-share-link. */
  url: string;
  platform: 'instagram' | 'tiktok' | 'youtube' | 'link';
  /** Wire-level user-facing decisions considered a pass. */
  acceptedDecisions: Array<
    'auto_save' | 'candidate_confirmation' | 'candidate_picker' | 'manual_fallback'
  >;
  /** Case-insensitive substrings; the resolved candidate name must include
   *  at least one. Omit when a name is not assertable. */
  expectedCandidateNameIncludes?: string[];
  /** Case-insensitive substrings expected somewhere in the candidate address. */
  expectedAddressIncludes?: string[];
  /** Candidate names that must NEVER appear (poster/platform noise). */
  mustNotIncludeCandidateNames?: string[];
  /** Optional explicit assertion for the final safe-to-auto-save flag. */
  expectedSafeToAutoSave?: boolean;
  notes?: string;
};

export const SHARE_REGRESSION_FIXTURES: ShareRegressionFixture[] = [
  {
    id: 'instagram-capones-cucina-reel',
    url: 'https://www.instagram.com/reel/DUWyZkfgbT4/?igsh=NTc4MTIwNjQ2YQ==',
    platform: 'instagram',
    acceptedDecisions: ['candidate_confirmation', 'auto_save'],
    expectedCandidateNameIncludes: ['Capone'],
    expectedAddressIncludes: ['19688 Beach Blvd', 'Huntington Beach'],
    expectedSafeToAutoSave: false,
    mustNotIncludeCandidateNames: ['19688 Beach Blvd', 'Instagram', 'Media', 'Foodie'],
    notes: 'Handle + literal address. Must not pair street fragment Beach Blvd as venue.',
  },
  {
    id: 'instagram-brooklyn-city-pizzeria-reel',
    url: 'https://www.instagram.com/reel/CxdY35frOrf/?igsh=NTc4MTIwNjQ2YQ==',
    platform: 'instagram',
    acceptedDecisions: ['candidate_confirmation', 'auto_save'],
    expectedCandidateNameIncludes: ['Brooklyn City Pizzeria'],
    expectedAddressIncludes: ['30012 Crown Valley Pkwy', 'Laguna Niguel'],
    mustNotIncludeCandidateNames: ['Media', 'Instagram', 'Foodie'],
    notes:
      'Instagram Reel caption venue before address; should not use Media as venue.',
  },

  // ---- Known-good anchors (must not regress) ------------------------------
  {
    id: 'instagram-2nd-floor-post',
    url: 'https://www.instagram.com/p/DYpcd2ZBTsZ/',
    platform: 'instagram',
    acceptedDecisions: ['candidate_confirmation', 'auto_save'],
    expectedCandidateNameIncludes: ['2nd Floor'],
    expectedAddressIncludes: ['126 Main', 'Huntington Beach'],
    notes: 'Known-good: 2nd Floor, Huntington Beach.',
  },
  {
    id: 'instagram-paradise-dynasty-post',
    url: 'https://www.instagram.com/p/DX77lghIHeG/',
    platform: 'instagram',
    acceptedDecisions: ['candidate_confirmation', 'auto_save'],
    expectedCandidateNameIncludes: ['Paradise Dynasty'],
    expectedAddressIncludes: ['Costa Mesa'],
    notes: 'Known-good: Paradise Dynasty at South Coast Plaza / 3333 Bristol St.',
  },
];

/*
 * PLAN — full remote regression runner (follow-up):
 *   1. Add `scripts/testShareRegression.ts` that iterates
 *      SHARE_REGRESSION_FIXTURES, calls the deployed process-share-link (reuse
 *      the auth + fetch helpers already in testProcessShareLinkRemote.ts), and
 *      asserts: decision ∈ acceptedDecisions; candidate name includes one of
 *      expectedCandidateNameIncludes; address includes each expectedAddress-
 *      Includes; no candidate name matches mustNotIncludeCandidateNames.
 *   2. Add npm script "test:share-regression".
 *   3. Requires: Supabase creds (.env NEARR_TEST_EMAIL/PASSWORD) AND a live
 *      `npx supabase functions deploy process-share-link`. It hits Google
 *      Places, so results can shift with Google's index — treat as a smoke
 *      suite, not a hermetic unit test.
 */
