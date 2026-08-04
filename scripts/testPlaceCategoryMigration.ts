import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260803000002_place_categories_and_undo.sql'), 'utf8');

for (const column of [
  'google_primary_type', 'google_types', 'google_type_label', 'category_source',
  'category_confidence', 'category_model_version', 'category_user_overridden',
  'categorized_at', 'original_saved_place_id', 'undone_at', 'undo_action',
]) assert.match(sql, new RegExp(`\\b${column}\\b`));

assert.match(sql, /security definer[\s\S]*auth\.uid\(\)/i);
assert.match(sql, /where id = p_saved_place_id and user_id = v_user_id/i);
assert.match(sql, /outcome = 'undone_by_user'/i);
assert.match(sql, /origin = 'automatic'/i);
assert.match(sql, /already_undone/i);
assert.match(sql, /pg_get_constraintdef[\s\S]*saved_place_id IS NOT NULL/i);
assert.match(sql, /alter publication supabase_realtime add table public\.share_job_place_results/i);
assert.match(sql, /grant execute on function public\.undo_auto_saved_place\(uuid, text, uuid\) to authenticated/i);
assert.match(sql, /revoke all on function public\.undo_auto_saved_place\(uuid, text, uuid\) from public, anon, authenticated/i);
assert.doesNotMatch(sql, /delete from public\.share_jobs|delete from public\.share_media_runs/);

console.log('PASS category and undo migration contract');