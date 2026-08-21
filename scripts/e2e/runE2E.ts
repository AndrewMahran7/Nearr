/**
 * scripts/e2e/runE2E.ts
 *
 * Tier 3 entry point — the deployed Nearr-Dev end-to-end regression suite.
 *
 *   npx ts-node -P scripts/tsconfig.json scripts/e2e/runE2E.ts --suite <name>
 *
 * Suites:
 *   config       deployed configuration + service readiness only (free, ~10s)
 *   dispatch     config + the media-dispatch proof (free)
 *   pipeline     config + fixtures A, B, E through the real Edge (free)
 *   safety       config + fixture D, the creator-identity invariant (free)
 *   all          everything above except the live model canary (free) [default]
 *   vayrin-live  config + fixture C against the REAL provider (PAID, opt-in)
 *
 * Nothing here runs unless the target has been PROVEN to be Nearr-Dev; see
 * ./target.ts. A refusal exits 2 so it is distinguishable from a test failure.
 */

import { StageReporter, errText } from './report';
import { TargetRefusedError } from './target';
import { openSession, type E2ESession } from './session';
import { runReadiness } from './checks/readiness';
import { runMediaDispatchProof } from './checks/dispatch';
import {
  fixtureCheapPath,
  fixtureCreatorIdentitySafety,
  fixtureHardNegative,
  fixtureMediaFallback,
} from './fixtures/pipeline';
import {
  fixtureVayrinLiveCanary,
  printLiveModelBanner,
  resolveCanaryOptions,
} from './fixtures/vayrin';

const SUITES = ['config', 'dispatch', 'pipeline', 'safety', 'all', 'vayrin-live'] as const;
type Suite = (typeof SUITES)[number];

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_REFUSED = 2;

function parseSuite(argv: string[]): Suite {
  const index = argv.indexOf('--suite');
  const raw = index >= 0 ? (argv[index + 1] ?? '') : 'all';
  if ((SUITES as readonly string[]).includes(raw)) return raw as Suite;
  console.error(`Unknown suite "${raw}". Expected one of: ${SUITES.join(', ')}`);
  process.exit(EXIT_REFUSED);
}

function needsIdentity(suite: Suite): boolean {
  return suite !== 'config';
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const suite = parseSuite(argv);

  console.log('');
  console.log(`Nearr-Dev deployed E2E — suite "${suite}"`);
  console.log('');

  // The paid gate is resolved BEFORE anything is created, so an operator who
  // forgot to name a canary source is told immediately and nothing is spent.
  let canary: ReturnType<typeof resolveCanaryOptions> | null = null;
  if (suite === 'vayrin-live') {
    canary = resolveCanaryOptions();
    if ('error' in canary) {
      console.error(canary.error);
      return EXIT_REFUSED;
    }
  }

  let session: E2ESession;
  try {
    session = await openSession({ withIdentity: needsIdentity(suite) });
  } catch (err) {
    if (err instanceof TargetRefusedError) {
      console.error(err.message);
      return EXIT_REFUSED;
    }
    console.error(`Could not open an E2E session: ${errText(err)}`);
    return EXIT_REFUSED;
  }

  const reporter = new StageReporter(`Nearr-Dev E2E (${suite})`, session.correlationId);
  if (session.identity) reporter.identify({ userId: session.identity.userId });
  console.log(`correlation id : ${session.correlationId}`);
  console.log(`supabase       : ${session.config.supabaseRef} (Nearr-Dev)`);
  console.log(`worker         : ${session.config.workerBaseUrl}`);
  if (session.identity) console.log(`test identity  : ${session.identity.email} (ephemeral)`);
  console.log('');

  let ok = true;
  try {
    // Readiness always runs first: a pipeline failure caused by a missing flag
    // should be reported as a missing flag, not as a timeout a minute later.
    const ready = await runReadiness(reporter, session.config, { admin: session.admin });
    ok = ready;

    if (!ready && suite !== 'config') {
      console.log('');
      console.log('Readiness failed — skipping the pipeline fixtures, because every');
      console.log('downstream failure would be a consequence of the configuration above.');
      for (const name of pendingStagesFor(suite)) reporter.skip(name, 'readiness failed');
    } else if (suite === 'dispatch' || suite === 'all') {
      const dispatched = await runMediaDispatchProof(reporter, session);
      ok = ok && dispatched;
    }

    if (ready && (suite === 'pipeline' || suite === 'all')) {
      for (const fixture of [fixtureCheapPath, fixtureMediaFallback, fixtureHardNegative]) {
        const outcome = await fixture(reporter, session);
        ok = ok && outcome.ok;
      }
    }

    if (ready && (suite === 'safety' || suite === 'all')) {
      const outcome = await fixtureCreatorIdentitySafety(reporter, session);
      ok = ok && outcome.ok;
    }

    if (ready && suite === 'vayrin-live' && canary && !('error' in canary)) {
      printLiveModelBanner(canary.sourceUrl, session.config.railwayVars.VAYRIN_MODEL || 'gpt-5.6-sol (worker default)');
      const outcome = await fixtureVayrinLiveCanary(reporter, session, canary);
      ok = ok && outcome;
    }
  } finally {
    const cleanup = await session.cleanup().catch((err) => ({
      attempted: true,
      userDeleted: false,
      diagnosticsDeleted: 0,
      retained: ['cleanup threw'],
      errors: [errText(err)],
    }));
    if (!cleanup.attempted) {
      reporter.skip('cleanup', cleanup.retained[0] ?? 'nothing to clean up');
    } else if (cleanup.userDeleted && cleanup.errors.length === 0) {
      reporter.pass(
        'cleanup',
        0,
        `ephemeral user deleted (cascading ${session.trackedJobIds.length} share job(s), their media tasks and any saved places) and ${cleanup.diagnosticsDeleted} diagnostics row(s) removed`,
      );
    } else {
      reporter.warn('cleanup', `retained: ${cleanup.retained.join('; ')} | errors: ${cleanup.errors.join('; ')}`);
    }
  }

  const exit = reporter.summarize();
  return ok && exit === EXIT_OK ? EXIT_OK : EXIT_FAILED;
}

function pendingStagesFor(suite: Suite): string[] {
  switch (suite) {
    case 'dispatch':
      return ['media dispatch proof'];
    case 'pipeline':
      return ['Fixture A — cheap metadata path', 'Fixture B — media fallback dispatch', 'Fixture E — hard negative'];
    case 'safety':
      return ['Fixture D — creator identity is not place identity'];
    case 'vayrin-live':
      return ['Fixture C — live Vayrin model boundary'];
    case 'all':
      return [
        'media dispatch proof',
        'Fixture A — cheap metadata path',
        'Fixture B — media fallback dispatch',
        'Fixture E — hard negative',
        'Fixture D — creator identity is not place identity',
      ];
    default:
      return [];
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof TargetRefusedError) {
      console.error(err.message);
      process.exit(EXIT_REFUSED);
    }
    console.error(`\nNearr-Dev E2E crashed: ${errText(err)}`);
    process.exit(EXIT_FAILED);
  });
