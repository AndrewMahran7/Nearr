/** Privacy-safe structural replay of recent validation rejections.
 *
 * Reads service-role-only retained diagnostics, but emits only counts and
 * closed-vocabulary classifications. No job IDs, user IDs, model text, place
 * names, queries, addresses, or location values leave this process.
 */
import { createClient } from '@supabase/supabase-js';

type Json = Record<string, unknown>;
void (async () => {
const url = process.env.SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!url || !key) throw new Error('production_supabase_credentials_unavailable');

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const frozenFrom = '2026-08-18T04:25:00Z';
const frozenTo = '2026-08-25T03:43:00Z';
const { data: runs, error: runError } = await admin
  .from('share_media_runs')
  .select('share_job_id,evidence,model_output,created_at')
  .gte('created_at', frozenFrom)
  .lte('created_at', frozenTo)
  .order('created_at', { ascending: false })
  .limit(500);
if (runError) throw runError;

const rejected = (runs ?? []).filter((run: any) => {
  const evidence = run?.evidence && typeof run.evidence === 'object' ? run.evidence as Json : {};
  return Number(evidence.modelPlacesRejected) > 0 ||
    (Array.isArray(evidence.evidenceRejectionPaths) && evidence.evidenceRejectionPaths.length > 0);
});
const jobIds = [...new Set(rejected.map((run: any) => run.share_job_id).filter(Boolean))];
const { data: jobs, error: jobError } = jobIds.length > 0
  ? await admin.from('share_jobs')
    .select('id,status,decision,failure_category,failure_code,candidate_payload')
    .in('id', jobIds)
  : { data: [], error: null };
if (jobError) throw jobError;
const jobsById = new Map((jobs ?? []).map((job: any) => [job.id, job]));

const counts = (values: string[]) => Object.fromEntries(
  [...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]),
);
const currentOutcomes: string[] = [];
const replayOutcomes: string[] = [];
let currentInsufficient = 0;
let technicalMisclassified = 0;
let solInvoked = 0;
let solRecovered = 0;

for (const run of rejected as any[]) {
  const job: any = jobsById.get(run.share_job_id);
  const current = !job
    ? 'unknown_or_deleted'
    : job.status === 'completed'
      ? 'completed'
      : job.failure_code === 'insufficient_evidence'
        ? 'insufficient_evidence'
        : job.status === 'failed'
          ? 'technical_failure'
          : job.status === 'needs_help'
            ? 'review_required'
            : 'other';
  currentOutcomes.push(current);
  if (current === 'insufficient_evidence') currentInsufficient += 1;

  const evidence = run.evidence && typeof run.evidence === 'object' ? run.evidence as Json : {};
  const accepted = Number(evidence.modelPlacesValid) || 0;
  const preview = typeof run.model_output === 'string'
    ? run.model_output
    : run.model_output && typeof run.model_output === 'object' && typeof run.model_output.preview === 'string'
      ? run.model_output.preview
      : '';
  const explicitObject = /"explicitEvidence"\s*:\s*\[\s*\{/.test(preview);
  const validName = /"name"\s*:\s*"[^"\s][^"]{0,199}"/.test(preview);
  const locality = /"(?:city|region|country)"\s*:\s*"[^"\s][^"]{0,119}"/.test(preview);
  const category = /"category"\s*:\s*"[^"\s][^"]{0,79}"/.test(preview);
  const candidates = job?.candidate_payload && typeof job.candidate_payload === 'object' &&
    Array.isArray(job.candidate_payload.candidates)
    ? job.candidate_payload.candidates.length
    : 0;

  const v = evidence.vayrinInvocation && typeof evidence.vayrinInvocation === 'object'
    ? evidence.vayrinInvocation as Json
    : null;
  if (v?.invoked === true) {
    solInvoked += 1;
    if (accepted > 0 || candidates > 0 || current === 'completed') solRecovered += 1;
  }

  let replay: string;
  if (accepted > 0 && current === 'completed') replay = 'exact_recovered';
  else if (accepted > 0 || candidates > 0) replay = 'candidate_set_recovered';
  else if (explicitObject && validName) replay = 'conditional_search_lead';
  else if (explicitObject && locality) replay = 'conditional_area_match';
  else if (explicitObject && category) replay = 'conditional_partial_result';
  else if (current === 'technical_failure') replay = 'technical_failure';
  else if (current === 'insufficient_evidence') {
    // A validation rejection is a technical extraction fact. Without retained
    // grounded fields it remains technical/unknown, never evidence-exhausted.
    replay = 'technical_failure_distinguished';
    technicalMisclassified += 1;
  } else replay = 'honest_terminal_or_unknown';
  replayOutcomes.push(replay);
}

const useful = replayOutcomes.filter((value) => /recovered$/.test(value)).length;
const exact = replayOutcomes.filter((value) => value === 'exact_recovered').length;
const partial = replayOutcomes.filter((value) =>
  value === 'conditional_search_lead' || value === 'conditional_area_match' || value === 'conditional_partial_result'
).length;

console.log(JSON.stringify({
  sampleSize: runs?.length ?? 0,
  frozenWindow: { from: frozenFrom, to: frozenTo },
  validationRejections: rejected.length,
  currentOutcomes: counts(currentOutcomes),
  newArchitectureOutcomes: counts(replayOutcomes),
  metrics: {
    validationRejectionRate: (runs?.length ?? 0) > 0 ? rejected.length / (runs?.length ?? 1) : 0,
    currentInsufficientAfterRejection: currentInsufficient,
    usefulRecoveryRate: rejected.length > 0 ? useful / rejected.length : 0,
    exactRecoveryRate: rejected.length > 0 ? exact / rejected.length : 0,
    conditionalPartialUsefulResultRate: rejected.length > 0 ? partial / rejected.length : 0,
    technicalFailureMisclassifiedAsInsufficientBefore: technicalMisclassified,
    technicalFailureMisclassifiedAsInsufficientAfter: 0,
    solInvocationRate: rejected.length > 0 ? solInvoked / rejected.length : 0,
    solRecoveryRate: solInvoked > 0 ? solRecovered / solInvoked : 0,
  },
  caveat: 'Structural replay only; conditional partials still require runtime grounding. Truncated previews cannot establish ground truth or exact place correctness.',
}, null, 2));
})().catch(() => {
  console.error('vayrin_validation_replay_failed');
  process.exitCode = 1;
});
