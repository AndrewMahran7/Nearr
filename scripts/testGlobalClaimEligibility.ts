/** Full restored Development-schema regression, confined to the named local
 * Docker database. All synthetic qualification, rows and DDL are rolled back.
 * The snapshot is a local schema-only backup, never a production connection. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const container = 'nearr-global-schema-qualification';
const image = 'public.ecr.aws/supabase/postgres:17.6.1.155';
const snapshotPath = '.tmp/dev-before-global-schema.sql';
const migrationPath = 'supabase/migrations/20261021000005_global_claim_eligibility.sql';
const snapshot = readFileSync(snapshotPath, 'utf8');
const migration = readFileSync(migrationPath, 'utf8');
function docker(args: string[], input?: string) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout.trim();
}
assert.equal(docker(['inspect', '--format', '{{.Config.Image}}', container]), image);
const sql = (input: string) => docker(['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], input);
const stateQuery = "select (select count(*) from auth.users)||'|'||(select count(*) from share_jobs)||'|'||(select count(*) from share_media_tasks)||'|'||(select row_to_json(p)::text from global_release_policy p);";
const before = sql(stateQuery);
assert.match(before, /^0\|0\|0\|/, 'Use the empty isolated restored schema, never an application database');
function oldFunction(name: string) {
  const start = snapshot.indexOf(`CREATE OR REPLACE FUNCTION "public"."${name}"(`);
  assert.ok(start >= 0, `Missing ${name} in schema backup`);
  const end = snapshot.indexOf('\n$$;', start);
  assert.ok(end > start);
  return snapshot.slice(start, end + 4);
}
const oldJobs = oldFunction('claim_share_jobs');
const oldMedia = oldFunction('claim_media_tasks');
assert.ok(!oldJobs.includes('is_account_eligible_for_ai') && !oldMedia.includes('is_account_eligible_for_ai'));
for (const [name, old] of [['claim_share_jobs',oldJobs],['claim_media_tasks',oldMedia]]) {
  const start=migration.indexOf(`create or replace function public.${name}(`);
  const next=migration.slice(start).match(/\bas \$\$([\s\S]*?)\$\$;/i)?.[1];
  const prior=old.match(/\bas \$\$([\s\S]*?)\$\$;/i)?.[1];
  assert.ok(next && prior);
  assert.equal(next.replace(/where public\.is_account_eligible_for_ai\(c\.user_id\)\s+and /,'where ').replace(/\s+/g,' ').trim(),
    prior.replace(/\s+/g,' ').trim(),`${name} must preserve all existing claim conditions and lease semantics`);
}
const owner = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const withdrawn = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const jobId = (i: number) => `bbbbbbbb-bbbb-bbbb-bbbb-${String(i).padStart(12, '0')}`;
const mediaId = (i: number) => `cccccccc-cccc-cccc-cccc-${String(i).padStart(12, '0')}`;
const query = `begin;
set local statement_timeout='30s';
-- No worker wakes or outbound HTTP from this isolated fixture.
alter table share_jobs disable trigger share_jobs_kick_worker;
alter table share_media_tasks disable trigger share_media_tasks_kick_worker;
create function pg_temp.check_test(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end; $$;
insert into auth.users(id) values('${owner}'),('${withdrawn}');
update global_release_policy set legal_approved=true,recognition_qualified=true,provider_route='openai_only',evidence_reference='LOCAL_TRANSACTION_TEST_ONLY';
update eligibility_region_policy set market_qualified=true,evidence_reference='LOCAL_TRANSACTION_TEST_ONLY' where country_code='US';
insert into account_eligibility_v2(user_id,status,age_band,country_code,policy_version,minimum_age)
select id,'eligible','18_plus','US','nearr-global-13-v1',13 from auth.users;
insert into account_processing_permissions(user_id,terms_version,terms_accepted_at,ai_allowed,ai_notice_version,ai_changed_at)
select u.id,p.terms_version,now(),true,p.ai_notice_version,now() from auth.users u cross join global_release_policy p;
insert into share_jobs(id,user_id,source_url,status,created_at,attempts,max_attempts,locked_until) values
('${jobId(1)}','${withdrawn}','https://example.invalid/1','queued',now()-interval '20 minutes',0,5,null),
('${jobId(2)}','${owner}','https://example.invalid/2','queued',now()-interval '19 minutes',0,5,null),
('${jobId(3)}','${owner}','https://example.invalid/3','processing_metadata',now()-interval '18 minutes',1,5,now()+interval '1 hour'),
('${jobId(4)}','${owner}','https://example.invalid/4','processing_metadata',now()-interval '17 minutes',1,5,now()-interval '1 minute'),
('${jobId(5)}','${owner}','https://example.invalid/5','queued',now()-interval '16 minutes',5,5,null),
('${jobId(6)}','${withdrawn}','https://example.invalid/6','processing_metadata',now()-interval '15 minutes',1,5,now()+interval '1 hour');
insert into share_jobs(id,user_id,source_url,status,locked_until)
select ('bbbbbbbb-bbbb-bbbb-bbbb-'||lpad(i::text,12,'0'))::uuid,'${owner}','https://example.invalid/'||i,'processing_metadata',now()+interval '1 hour' from generate_series(7,10) i;
insert into share_media_tasks(id,user_id,share_job_id,source_url,platform,status,created_at,attempts,max_attempts,locked_until,next_attempt_at) values
('${mediaId(1)}','${withdrawn}','${jobId(6)}','https://example.invalid/6','other','queued',now()-interval '20 minutes',0,3,null,null),
('${mediaId(2)}','${owner}','${jobId(3)}','https://example.invalid/3','other','queued',now()-interval '19 minutes',0,3,null,null),
('${mediaId(3)}','${owner}','${jobId(7)}','https://example.invalid/7','other','queued',now()-interval '18 minutes',0,3,null,now()+interval '1 hour'),
('${mediaId(4)}','${owner}','${jobId(8)}','https://example.invalid/8','other','processing',now()-interval '17 minutes',1,3,now()+interval '1 hour',null),
('${mediaId(5)}','${owner}','${jobId(9)}','https://example.invalid/9','other','processing',now()-interval '16 minutes',1,3,now()-interval '1 minute',null),
('${mediaId(6)}','${owner}','${jobId(10)}','https://example.invalid/10','other','queued',now()-interval '15 minutes',3,3,null,null);
update account_processing_permissions set ai_allowed=false where user_id='${withdrawn}';
${oldJobs}
${oldMedia}
do $$ begin
 begin perform public.claim_share_jobs(1); raise exception 'old job claim unexpectedly succeeded';
 exception when others then if sqlerrm<>'global_eligibility_required' then raise; end if; end;
 begin perform public.claim_media_tasks(1); raise exception 'old media claim unexpectedly succeeded';
 exception when others then if sqlerrm<>'global_eligibility_required' then raise; end if; end;
end; $$;
select 'PASS old claim functions reproduce starvation for both queues';
${migration}
select pg_temp.check_test((select array_agg(id) from claim_share_jobs(1))=array['${jobId(2)}'::uuid],'eligible oldest job skipped');
select pg_temp.check_test((select attempts=1 and status='processing_metadata' and locked_until>=now()+interval '120 seconds' from share_jobs where id='${jobId(2)}'),'job lease or attempt semantics changed');
select 'PASS eligible job claimed despite older withdrawn job';
select pg_temp.check_test((select array_agg(id) from claim_share_jobs(9))=array['${jobId(4)}'::uuid],'job retry filtering changed');
select pg_temp.check_test((select count(*) from claim_share_jobs(9))=0,'active lease or exhausted job reclaimed');
select 'PASS expired job retries claim while active leases and exhausted attempts remain excluded';
select pg_temp.check_test((select array_agg(id) from claim_media_tasks(1))=array['${mediaId(2)}'::uuid],'eligible media task skipped');
select pg_temp.check_test((select attempts=1 and status='processing' and locked_until>=now()+interval '600 seconds' from share_media_tasks where id='${mediaId(2)}'),'media lease or attempt semantics changed');
select 'PASS eligible media task claimed despite older withdrawn task';
select pg_temp.check_test((select array_agg(id) from claim_media_tasks(9))=array['${mediaId(5)}'::uuid],'media retry filtering changed');
select pg_temp.check_test((select count(*) from claim_media_tasks(9))=0,'future retry active lease or exhausted media task reclaimed');
select 'PASS media retry timing active leases and exhausted attempts remain excluded';
select pg_temp.check_test((select status='queued' and attempts=0 from share_jobs where id='${jobId(1)}'),'ineligible job mutated');
select pg_temp.check_test((select status='queued' and attempts=0 from share_media_tasks where id='${mediaId(1)}'),'ineligible media mutated');
do $$ begin
 begin update share_jobs set status='processing_metadata' where id='${jobId(1)}'; raise exception 'job guard bypassed';
 exception when others then if sqlerrm<>'global_eligibility_required' then raise; end if; end;
 begin update share_media_tasks set status='processing' where id='${mediaId(1)}'; raise exception 'media guard bypassed';
 exception when others then if sqlerrm<>'global_eligibility_required' then raise; end if; end;
end; $$;
select 'PASS ineligible rows untouched and direct-update guards retained';
select pg_temp.check_test(not has_function_privilege('anon','claim_share_jobs(integer,integer)','EXECUTE') and not has_function_privilege('authenticated','claim_share_jobs(integer,integer)','EXECUTE') and has_function_privilege('service_role','claim_share_jobs(integer,integer)','EXECUTE'),'job claim ACL unsafe');
select pg_temp.check_test(not has_function_privilege('anon','claim_media_tasks(integer,integer)','EXECUTE') and not has_function_privilege('authenticated','claim_media_tasks(integer,integer)','EXECUTE') and has_function_privilege('service_role','claim_media_tasks(integer,integer)','EXECUTE'),'media claim ACL unsafe');
select 'PASS queue claim RPCs executable only by server role';
rollback;`;
const output = sql(query);
assert.equal(sql(stateQuery), before, 'Transaction must leave qualification and all fixture rows unchanged');
const tests = output.split(/\r?\n/).filter(line => line.startsWith('PASS ')).map(line => line.slice(5));
assert.equal(tests.length, 7);
tests.push('both function bodies preserve all legacy selection and lease conditions except the new eligibility predicate');
writeFileSync('artifacts/global-release/claim-eligibility-database-tests.json', JSON.stringify({
  testedAt:new Date().toISOString(), scope:'isolated local Docker restored Development public schema; transaction rolled back; no remote database',
  container,image,engine:sql('select version();'),schemaBackupSha256:createHash('sha256').update(snapshot).digest('hex'),
  migration:migrationPath,passed:tests.length,failed:0,tests,
  preserved:'real eligibility and owner guards retained; only outbound worker-wake triggers disabled inside rollback transaction',
  rollbackVerified:true,
},null,2)+'\n');
console.log(`PASS: ${tests.length} full-schema claim regressions, including failing-before proof and rollback verification`);
