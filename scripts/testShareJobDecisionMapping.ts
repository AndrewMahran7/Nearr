/**
 * scripts/testShareJobDecisionMapping.ts
 *
 * Unit tests for the async share-job decision mapping + notification copy
 * (supabase/functions/process-share-jobs/decisionMapping.ts). Pure module, no
 * Deno/IO, so it runs under ts-node.
 *
 * Covers task test cases 5-8 (resolver decision → job outcome) plus the
 * notification copy for completed / needs_help variants.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testShareJobDecisionMapping.ts
 */

import {
  planFromResolverDecision,
  buildCompletedNotification,
  buildMediaResultNotification,
  buildNeedsHelpNotification,
  platformLabel,
} from '../supabase/functions/process-share-jobs/decisionMapping';
import { routeShareJobNotification } from '../lib/shareJobRouting';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// ---- Decision → plan -------------------------------------------------------

// 5. auto_save honored ONLY with the safety gate + a primary candidate.
{
  const plan = planFromResolverDecision({
    decision: 'auto_save',
    safeToAutoSave: true,
    hasPrimaryCandidate: true,
    candidateCount: 1,
    cleanSearchQuery: 'Capone Cucina',
  });
  check('auto_save + safe + primary => route auto_save', plan.route === 'auto_save');
}

// Safety: auto_save WITHOUT the gate must never silently save.
{
  const plan = planFromResolverDecision({
    decision: 'auto_save',
    safeToAutoSave: false,
    hasPrimaryCandidate: true,
    candidateCount: 1,
  });
  check(
    'auto_save WITHOUT safe gate => needs_help (never silent save)',
    plan.route === 'needs_help',

    JSON.stringify(plan),
  );
}

  // ---- Media Notification Tests -------------------------------------------
  {
    const n = buildMediaResultNotification({
      jobId: 'job-multi',
      createdSavedPlaceIds: ['sp1', 'sp2'],
      alreadySavedPlaceIds: ['sp3'],
      reviewCount: 0,
    });
    check('media multi notification counts only new saves', n.title === 'Saved 2 places to your map');
    check('media multi notification preserves all successful ids', JSON.stringify(n.data.savedPlaceIds) === JSON.stringify(['sp1', 'sp2', 'sp3']));
  }
  {
    const n = buildMediaResultNotification({
      jobId: 'job-mixed',
      createdSavedPlaceIds: ['sp1'],
      alreadySavedPlaceIds: ['sp2'],
      reviewCount: 2,
    });
    check('media mixed notification has honest counts', n.title === 'Saved 1 place. 2 need your review.');
    check('media mixed notification routes to review', n.data.type === 'share_job_needs_help' && n.data.jobId === 'job-mixed');
  }
// 6. candidate_confirmation => needs_help single.
{
  const plan = planFromResolverDecision({
    decision: 'candidate_confirmation',
    safeToAutoSave: false,
    hasPrimaryCandidate: true,
    candidateCount: 1,
  });
  check(
    'candidate_confirmation => needs_help single',
    plan.route === 'needs_help' && plan.mode === 'single',
    JSON.stringify(plan),
  );
}

// 7. multi_candidate_confirmation => needs_help multi.
{
  const plan = planFromResolverDecision({
    decision: 'multi_candidate_confirmation',
    safeToAutoSave: false,
    hasPrimaryCandidate: true,
    candidateCount: 3,
  });
  check(
    'multi_candidate_confirmation => needs_help multi',
    plan.route === 'needs_help' && plan.mode === 'multi',
    JSON.stringify(plan),
  );
}

// 8. manual_fallback => needs_help manual with suggested query preserved.
{
  const plan = planFromResolverDecision({
    decision: 'manual_fallback',
    safeToAutoSave: false,
    hasPrimaryCandidate: false,
    candidateCount: 0,
    cleanSearchQuery: 'Nova Kitchen Bar Arlington',
  });
  check(
    'manual_fallback => needs_help manual + suggestedQuery',
    plan.route === 'needs_help' &&
      plan.mode === 'manual' &&
      plan.suggestedQuery === 'Nova Kitchen Bar Arlington',
    JSON.stringify(plan),
  );
}

// failed => prefer needs_help (manual), never a dead-end here.
{
  const plan = planFromResolverDecision({
    decision: 'failed',
    safeToAutoSave: false,
    hasPrimaryCandidate: false,
    candidateCount: 0,
    failureReason: 'no_candidates',
  });
  check(
    'resolver failed => needs_help manual (prefer needs_help)',
    plan.route === 'needs_help' && plan.mode === 'manual',
    JSON.stringify(plan),
  );
}

// candidate_confirmation with zero renderable candidates downgrades to manual.
{
  const plan = planFromResolverDecision({
    decision: 'candidate_confirmation',
    safeToAutoSave: false,
    hasPrimaryCandidate: false,
    candidateCount: 0,
  });
  check(
    'candidate_confirmation + 0 candidates => manual',
    plan.route === 'needs_help' && plan.mode === 'manual',
    JSON.stringify(plan),
  );
}

// ---- Notification copy -----------------------------------------------------

{
  const n = buildCompletedNotification({
    placeName: "Capone's Cucina",
    platform: 'instagram',
    jobId: 'job-1',
    savedPlaceId: 'sp-1',
  });
  check('completed title = Found <name>', n.title === "Found Capone's Cucina", n.title);
  check('completed body names platform', n.body === 'Saved from your Instagram post.', n.body);
  check(
    'completed data carries type + ids',
    n.data.type === 'share_job_completed' &&
      n.data.jobId === 'job-1' &&
      n.data.savedPlaceId === 'sp-1',
    JSON.stringify(n.data),
  );
  check('completed data outcome=completed', n.data.outcome === 'completed', JSON.stringify(n.data));
  check(
    'completed notification routes to the saved place',
    JSON.stringify(routeShareJobNotification(n.data)) ===
      JSON.stringify({ kind: 'saved_place', savedPlaceId: 'sp-1' }),
    JSON.stringify(routeShareJobNotification(n.data)),
  );
}

{
  // Already-saved: explicit, non-error terminal outcome that REUSES the
  // existing saved place and routes there (usable existing saved-place target,
  // idempotent on replay).
  const n = buildCompletedNotification({
    placeName: 'NOVA Kitchen',
    platform: 'tiktok',
    jobId: 'job-5',
    savedPlaceId: 'sp-existing',
    alreadySaved: true,
  });
  check('already-saved title', n.title === 'Already saved', n.title);
  check('already-saved body', n.body === 'NOVA Kitchen is already in Nearr.', n.body);
  check('already-saved outcome=already_saved', n.data.outcome === 'already_saved', JSON.stringify(n.data));
  check('already-saved carries existing savedPlaceId', n.data.savedPlaceId === 'sp-existing', JSON.stringify(n.data));
  const route = routeShareJobNotification(n.data);
  check(
    'already-saved notification routes to existing saved place',
    JSON.stringify(route) === JSON.stringify({ kind: 'saved_place', savedPlaceId: 'sp-existing' }),
    JSON.stringify(route),
  );
  check(
    'already-saved replay is idempotent',
    JSON.stringify(routeShareJobNotification(n.data)) === JSON.stringify(route),
  );
}

{
  const n = buildNeedsHelpNotification({ mode: 'single', jobId: 'job-2', candidateName: 'NOVA Kitchen & Bar' });
  check('needs_help single title', n.title === 'Is this NOVA Kitchen & Bar?', n.title);
  check('needs_help single body', n.body === 'Tap to confirm the place.', n.body);
  check(
    'needs_help data type + jobId',
    n.data.type === 'share_job_needs_help' && n.data.jobId === 'job-2',
    JSON.stringify(n.data),
  );
}

{
  const n = buildNeedsHelpNotification({ mode: 'multi', jobId: 'job-3', candidateCount: 3 });
  check('needs_help multi title', n.title === 'We found 3 possible locations', n.title);
}

{
  const n = buildNeedsHelpNotification({ mode: 'manual', jobId: 'job-4' });
  check('needs_help manual title', n.title === 'We need help finding this place', n.title);
  check('needs_help manual body', n.body === 'Tap to search for it.', n.body);
}

check('platformLabel instagram', platformLabel('instagram') === 'Instagram');
check('platformLabel tiktok', platformLabel('tiktok') === 'TikTok');
check('platformLabel unknown => shared', platformLabel('foo') === 'shared');

// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll share-job decision-mapping assertions passed.');
