/**
 * scripts/testShareSubmission.ts
 *
 * Unit tests for the PURE share-submission idempotency modules
 * (lib/shareSubmission.ts + lib/shareSubmit.ts). Proves one share action maps
 * to at most one create-share-job call across double-fires, cold/warm deep-link
 * re-delivery, extension→host handoff, and timeouts-after-accept.
 *
 * Run: npx ts-node -P scripts/tsconfig.json scripts/testShareSubmission.ts
 */

import {
  SUBMISSION_ID_PARAM,
  appendSubmissionId,
  deriveSubmissionIdForUrl,
  extractSubmissionId,
  isSubmissionId,
  mintSubmissionId,
  resolveSubmissionId,
} from '../lib/shareSubmission';
import { createShareSubmitter, type GuardedSubmitResult } from '../lib/shareSubmit';
import { buildHostDeepLink } from '../lib/shareRoutes';

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const URL_A = 'https://www.instagram.com/reel/ABC123/';
const URL_B = 'https://www.tiktok.com/@x/video/999';

// ---- deriveSubmissionIdForUrl: stable within a bucket, distinct across ------
{
  const t = 1_000_000_000_000;
  const id1 = deriveSubmissionIdForUrl(URL_A, t);
  const id2 = deriveSubmissionIdForUrl(URL_A, t + 5_000); // same 2-min bucket
  const id3 = deriveSubmissionIdForUrl(URL_A, t + 200_000); // later bucket
  const id4 = deriveSubmissionIdForUrl(URL_B, t);
  check('same url + same bucket => same id (cold/warm collapse)', id1 === id2);
  check('same url + later bucket => different id (deliberate re-share)', id1 !== id3);
  check('different url => different id', id1 !== id4);
  check('derived id is well-formed', isSubmissionId(id1));
  check('derive is case-insensitive on url', deriveSubmissionIdForUrl(URL_A.toUpperCase(), t) === id1);
}

// ---- mintSubmissionId: unique + well-formed --------------------------------
{
  const a = mintSubmissionId(() => 0.1, () => 111);
  const b = mintSubmissionId(() => 0.9, () => 222);
  check('minted ids are well-formed', isSubmissionId(a) && isSubmissionId(b));
  check('minted ids differ', a !== b);
}

// ---- append/extract roundtrip (empty-host deep link form) ------------------
{
  const sid = 'u_abc123';
  const link = 'nearr:///share?url=' + encodeURIComponent(URL_A);
  const withSid = appendSubmissionId(link, sid);
  check('append adds sid param', withSid.includes(`${SUBMISSION_ID_PARAM}=${sid}`));
  check('extract roundtrips sid', extractSubmissionId(withSid) === sid);
  check('append is idempotent (no double sid)', appendSubmissionId(withSid, 'u_other') === withSid);
  check('append to path with no query uses ?', appendSubmissionId('nearr:///share-jobs', sid).includes('?sid='));
  check('extract null when absent', extractSubmissionId(link) === null);
  check('extract rejects malformed sid', extractSubmissionId('nearr:///share?sid=%20%20') === null);

  // Representative Instagram handoff: JS encodes the source URL, native
  // preserves that percentEncodedQuery, and Expo/URL parsing decodes it once.
  const handoffPath = appendSubmissionId(`share?url=${encodeURIComponent(URL_A)}`, sid);
  const handoffURL = buildHostDeepLink(handoffPath);
  const decoded = new URL(handoffURL).searchParams.get('url');
  check('Instagram handoff uses canonical empty-host /share route', handoffURL.startsWith('nearr:///share?'));
  check('Instagram handoff source URL decodes exactly once', decoded === URL_A);
  check('Instagram handoff carries the same invocation id', new URL(handoffURL).searchParams.get('sid') === sid);
}

// ---- resolveSubmissionId: prefer deep-link, else derive --------------------
{
  const t = 1_700_000_000_000;
  const fromLink = 's_zzz_111';
  check('resolve prefers valid deep-link sid', resolveSubmissionId({ url: URL_A, fromDeepLink: fromLink, nowMs: t }) === fromLink);
  check('resolve derives when no deep-link sid', resolveSubmissionId({ url: URL_A, fromDeepLink: null, nowMs: t }) === deriveSubmissionIdForUrl(URL_A, t));
  check('resolve derives when deep-link sid malformed', resolveSubmissionId({ url: URL_A, fromDeepLink: '!!bad!!', nowMs: t }) === deriveSubmissionIdForUrl(URL_A, t));
}

// ---- createShareSubmitter guarded behavior ---------------------------------
async function runSubmitterTests(): Promise<void> {
  // 1. Concurrent identical ids share ONE doSubmit call.
  {
    let calls = 0;
    let resolveFn: (r: GuardedSubmitResult) => void = () => {};
    const gate = new Promise<GuardedSubmitResult>((r) => { resolveFn = r; });
    const submitter = createShareSubmitter(async () => { calls += 1; return gate; });
    const p1 = submitter.submit({ url: URL_A, submissionId: 'u_same' });
    const p2 = submitter.submit({ url: URL_A, submissionId: 'u_same' });
    resolveFn({ ok: true, jobId: 'job1' });
    const [r1, r2] = await Promise.all([p1, p2]);
    check('concurrent same-id => single doSubmit call', calls === 1);
    check('both concurrent callers get the job', r1.jobId === 'job1' && r2.jobId === 'job1');
  }

  // 2. Accepted id is never resubmitted (returns duplicate).
  {
    let calls = 0;
    const submitter = createShareSubmitter(async () => { calls += 1; return { ok: true, jobId: 'jobX' }; });
    const first = await submitter.submit({ url: URL_A, submissionId: 'u_accept' });
    const second = await submitter.submit({ url: URL_A, submissionId: 'u_accept' });
    check('accepted id: doSubmit called exactly once', calls === 1);
    check('accepted replay returns same job', second.jobId === 'jobX');
    check('accepted replay flagged duplicate', second.duplicate === true);
    check('hasAccepted true after ok', submitter.hasAccepted('u_accept'));
  }

  // 3. Failed submit (ok:false) is retryable.
  {
    let calls = 0;
    const submitter = createShareSubmitter(async () => {
      calls += 1;
      return calls === 1 ? { ok: false, reason: 'network_failure' } : { ok: true, jobId: 'jobRetry' };
    });
    const first = await submitter.submit({ url: URL_A, submissionId: 'u_retry' });
    const second = await submitter.submit({ url: URL_A, submissionId: 'u_retry' });
    check('failed submit not cached (retry calls doSubmit again)', calls === 2);
    check('first failed', first.ok === false);
    check('retry succeeded', second.ok === true && second.jobId === 'jobRetry');
  }

  // 4. Thrown submit is retryable.
  {
    let calls = 0;
    const submitter = createShareSubmitter(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return { ok: true, jobId: 'jobThrow' };
    });
    let threw = false;
    try {
      await submitter.submit({ url: URL_A, submissionId: 'u_throw' });
    } catch {
      threw = true;
    }
    const retry = await submitter.submit({ url: URL_A, submissionId: 'u_throw' });
    check('thrown submit propagates', threw);
    check('thrown submit is retryable', calls === 2 && retry.ok === true);
  }

  // 5. Distinct ids do not dedupe each other.
  {
    let calls = 0;
    const submitter = createShareSubmitter(async () => { calls += 1; return { ok: true, jobId: `j${calls}` }; });
    await submitter.submit({ url: URL_A, submissionId: 'u_1' });
    await submitter.submit({ url: URL_B, submissionId: 'u_2' });
    check('distinct ids each submit', calls === 2);
  }
}

void runSubmitterTests().then(() => {
  if (failures > 0) {
    console.error(`\n${failures} share-submission test(s) FAILED`);
    process.exit(1);
  }
  console.log('\nALL SHARE SUBMISSION TESTS PASSED');
});
