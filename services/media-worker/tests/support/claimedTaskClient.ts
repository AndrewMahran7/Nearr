import type { MediaTask } from '../../src/types/media.js';

/** In-memory lease snapshot for pipeline tests. Unlike the old no-op writer,
 * supports the authoritative reads and compare-and-swap writes used in production. */
export function claimedTaskClient(task: MediaTask): any {
  const rows: Record<string, any> = {
    share_media_tasks: { ...task },
    share_jobs: { id: task.share_job_id, status: 'processing_metadata', saved_place_id: null, attempts: 1 },
  };
  return { from(table: string) {
    const row = rows[table];
    const filters: [string, unknown][] = [];
    let patch: any = null;
    const result = () => {
      const matched = row && filters.every(([key, value]) => row[key] === value);
      if (matched && patch) Object.assign(row, patch);
      return { data: matched ? { ...row } : null, error: null };
    };
    const chain: any = {
      eq(key: string, value: unknown) { filters.push([key, value]); return chain; },
      select() { return chain; }, update(value: any) { patch = value; return chain; },
      maybeSingle: async () => result(),
      then(resolve: (value: any) => unknown, reject: (value: any) => unknown) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return chain;
  } };
}
