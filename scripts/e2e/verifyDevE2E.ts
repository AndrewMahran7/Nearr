/**
 * scripts/e2e/verifyDevE2E.ts
 *
 * PART 14 — the one command to run after a development deployment and before
 * picking up the phone.
 *
 *   npm run verify:dev:e2e
 *
 * It is a checklist, not a test report. Everything a share needs in order to
 * travel the whole path is verified in the order the share travels it, and the
 * run ends with exactly one of:
 *
 *   READY FOR PHYSICAL QA
 *   NOT READY FOR PHYSICAL QA
 *
 * The live Vayrin canary is deliberately SKIPped here: it costs money and the
 * boundary it guards is not on the critical path for deciding whether a build
 * is worth installing. Run `npm run test:e2e:dev:vayrin-live` when the provider
 * itself is what you need to check.
 */

import { StageReporter, errText } from './report';
import { TargetRefusedError } from './target';
import { openSession, type E2ESession } from './session';
import { runReadiness } from './checks/readiness';
import { runMediaDispatchProof } from './checks/dispatch';
import {
  fixtureCheapPath,
  fixtureCreatorIdentitySafety,
  fixtureMediaFallback,
} from './fixtures/pipeline';

const EXIT_READY = 0;
const EXIT_NOT_READY = 1;
const EXIT_REFUSED = 2;

async function main(): Promise<number> {
  console.log('');
  console.log('Nearr-Dev E2E Readiness');
  console.log('');

  let session: E2ESession;
  try {
    session = await openSession({ withIdentity: true });
  } catch (err) {
    if (err instanceof TargetRefusedError) {
      console.error(err.message);
      console.log('');
      console.log('NOT READY FOR PHYSICAL QA');
      return EXIT_REFUSED;
    }
    console.error(`Could not open an E2E session: ${errText(err)}`);
    console.log('');
    console.log('NOT READY FOR PHYSICAL QA');
    return EXIT_REFUSED;
  }

  const reporter = new StageReporter('Nearr-Dev E2E Readiness', session.correlationId);
  reporter.identify({ userId: session.identity?.userId ?? null });

  let ok = true;
  try {
    const ready = await runReadiness(reporter, session.config, { admin: session.admin });
    ok = ready;

    if (!ready) {
      // Deliberately stop. Running fixtures against a misconfigured deployment
      // produces failures that all describe the same root cause, which buries
      // the one line that matters.
      for (const name of [
        'cheap metadata path',
        'media fallback decision',
        'media task creation',
        'Railway claim',
        'callback/finalization',
        'creator-identity safety',
      ]) {
        reporter.skip(name, 'configuration is not ready — fix the failures above first');
      }
    } else {
      const cheap = await fixtureCheapPath(reporter, session);
      ok = ok && cheap.ok;

      // The media path, proven twice on purpose: the dispatch check drives a
      // task the suite inserted itself (isolating the dispatch chain), and
      // fixture B drives one the deployed Edge decided to create (proving the
      // decision as well as the delivery).
      const dispatched = await runMediaDispatchProof(reporter, session);
      ok = ok && dispatched;

      const fallback = await fixtureMediaFallback(reporter, session);
      ok = ok && fallback.ok;

      const safety = await fixtureCreatorIdentitySafety(reporter, session);
      ok = ok && safety.ok;
    }

    reporter.skip('live Vayrin canary', 'paid — run npm run test:e2e:dev:vayrin-live explicitly');
  } finally {
    const cleanup = await session.cleanup().catch((err) => ({
      attempted: true,
      userDeleted: false,
      diagnosticsDeleted: 0,
      evidenceObjectsDeleted: 0,
      retained: ['cleanup threw'],
      errors: [errText(err)],
    }));
    if (!cleanup.attempted) {
      reporter.skip('cleanup', cleanup.retained[0] ?? 'nothing to clean up');
    } else if (cleanup.userDeleted && cleanup.errors.length === 0) {
      reporter.pass('cleanup', 0, 'ephemeral test identity and every row it owned removed from Nearr-Dev');
    } else {
      reporter.warn('cleanup', `retained: ${cleanup.retained.join('; ')} | errors: ${cleanup.errors.join('; ')}`);
    }
  }

  const exit = reporter.summarize();
  const ready = ok && exit === 0;
  console.log('');
  console.log(ready ? 'READY FOR PHYSICAL QA' : 'NOT READY FOR PHYSICAL QA');
  return ready ? EXIT_READY : EXIT_NOT_READY;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof TargetRefusedError) console.error(err.message);
    else console.error(`\nReadiness check crashed: ${errText(err)}`);
    console.log('');
    console.log('NOT READY FOR PHYSICAL QA');
    process.exit(EXIT_REFUSED);
  });
