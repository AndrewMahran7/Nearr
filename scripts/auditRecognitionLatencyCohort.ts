import { openSession } from './e2e/session';

type JobRow = {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  updated_at: string | null;
  idempotency_key: string | null;
  recognition_run_mode: string | null;
};

type TaskRow = {
  id: string;
  share_job_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  updated_at: string | null;
  attempts: number | null;
};

type RunRow = {
  share_job_id: string | null;
  duration_ms: number | null;
  created_at: string;
};

const WINDOW_DAYS = 7;
const MAX_JOBS = 500;

function millis(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const value = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const value = lower === upper
    ? sorted[lower]!
    : sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
  return Math.round(value);
}

function summary(values: Array<number | null>) {
  const usable = values.filter((value): value is number => value != null);
  return {
    count: usable.length,
    p50Ms: quantile(usable, 0.5),
    p75Ms: quantile(usable, 0.75),
    p90Ms: quantile(usable, 0.9),
    p95Ms: quantile(usable, 0.95),
    minMs: usable.length ? Math.min(...usable) : null,
    maxMs: usable.length ? Math.max(...usable) : null,
  };
}

async function main(): Promise<void> {
  const session = await openSession({ withIdentity: false, withEdgeSecrets: false });
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data: rawJobs, error: jobsError } = await session.admin
    .from('share_jobs')
    .select('id,status,created_at,completed_at,updated_at,idempotency_key,recognition_run_mode')
    .gte('created_at', since)
    .in('status', ['completed', 'needs_help', 'failed'])
    .order('created_at', { ascending: false })
    .limit(MAX_JOBS);
  if (jobsError) throw new Error(`share_jobs: ${jobsError.message}`);

  const jobs = ((rawJobs ?? []) as JobRow[]).filter((job) =>
    !job.idempotency_key?.startsWith('nearr-e2e') &&
    job.recognition_run_mode !== 'tutorial_fixture'
  );
  const jobIds = jobs.map((job) => job.id);
  const [{ data: rawTasks, error: tasksError }, { data: rawRuns, error: runsError }] = jobIds.length
    ? await Promise.all([
        session.admin
          .from('share_media_tasks')
          .select('id,share_job_id,status,created_at,completed_at,updated_at,attempts')
          .in('share_job_id', jobIds),
        session.admin
          .from('share_media_runs')
          .select('share_job_id,duration_ms,created_at')
          .in('share_job_id', jobIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (tasksError) throw new Error(`share_media_tasks: ${tasksError.message}`);
  if (runsError) throw new Error(`share_media_runs: ${runsError.message}`);

  const tasks = (rawTasks ?? []) as TaskRow[];
  const runs = (rawRuns ?? []) as RunRow[];
  const taskByJob = new Map(tasks.map((task) => [task.share_job_id, task]));
  const runByJob = new Map(runs.filter((run) => run.share_job_id).map((run) => [run.share_job_id!, run]));
  const terminalEnd = (job: JobRow) => job.completed_at ?? job.updated_at;
  const jobDuration = (job: JobRow) => millis(job.created_at, terminalEnd(job));
  const freshTerminalDurations = jobs.map(jobDuration).filter((value): value is number => value != null && value <= 600_000);
  const jobsWithTask = jobs.filter((job) => taskByJob.has(job.id));

  const output = {
    target: session.config.supabaseRef,
    environment: 'development',
    generatedAt: new Date().toISOString(),
    window: { since, days: WINDOW_DAYS, maxJobs: MAX_JOBS },
    exclusions: ['idempotency_key starts nearr-e2e', 'recognition_run_mode tutorial_fixture'],
    cohort: {
      jobs: jobs.length,
      tasks: tasks.length,
      runs: runs.length,
      statusCounts: Object.fromEntries([...new Set(jobs.map((job) => job.status))].sort().map(
        (status) => [status, jobs.filter((job) => job.status === status).length],
      )),
    },
    distributions: {
      totalTerminalJob: summary(jobs.map((job) => millis(job.created_at, terminalEnd(job)))),
      totalTerminalJobUnder10Minutes: summary(freshTerminalDurations),
      totalTerminalJobWithMediaTask: summary(jobsWithTask.map(jobDuration)),
      totalTerminalJobByStatus: Object.fromEntries(['completed', 'needs_help', 'failed'].map((status) => [
        status,
        summary(jobs.filter((job) => job.status === status).map(jobDuration)),
      ])),
      jobToMediaTaskCreated: summary(jobs.map((job) => {
        const task = taskByJob.get(job.id);
        return task ? millis(job.created_at, task.created_at) : null;
      })),
      mediaTaskTerminal: summary(tasks.map((task) => millis(task.created_at, task.completed_at ?? task.updated_at))),
      retainedMediaRunActive: summary(runs.map((run) =>
        typeof run.duration_ms === 'number' && run.duration_ms >= 0 ? run.duration_ms : null
      )),
      mediaTaskNonRunOverhead: summary(tasks.map((task) => {
        const total = millis(task.created_at, task.completed_at ?? task.updated_at);
        const active = runByJob.get(task.share_job_id)?.duration_ms;
        return total != null && typeof active === 'number' && active >= 0 ? Math.max(0, total - active) : null;
      })),
    },
    dataCompleteness: {
      terminalTimestampJobs: jobs.filter((job) => terminalEnd(job)).length,
      jobsWithMediaTask: jobs.filter((job) => taskByJob.has(job.id)).length,
      jobsWithMediaRun: jobs.filter((job) => runByJob.has(job.id)).length,
      jobsTerminalizedAfter10Minutes: jobs.map(jobDuration).filter((value) => value != null && value > 600_000).length,
      note: 'Only persisted lifecycle timestamps are measured; provider sub-stage timings were not retained for this historical cohort.',
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
