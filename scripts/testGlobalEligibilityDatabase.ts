/** Actual additive migrations in a disposable local PostgreSQL cluster.
 * This uses no live credentials, users, provider calls or remote services. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { AGE_BANDS, assessDeclaration, ELIGIBILITY_POLICY } from '../lib/globalEligibility';

const pgBin = process.env.NEARR_TEST_POSTGRES_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
const pg = (name: string) => pgBin ? path.join(pgBin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
const directory = mkdtempSync(path.join(tmpdir(), 'nearr-global-eligibility-pg-'));
const dataDir = path.join(directory, 'data');
const passed: string[] = [];
let port = 0;
let started = false;
const u1 = '11111111-1111-1111-1111-111111111111';
const u2 = '22222222-2222-2222-2222-222222222222';
const u3 = '33333333-3333-3333-3333-333333333333';
const command = (name: string, args: string[], input?: string) => spawnSync(pg(name), args, { input, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
function sql(query: string) {
  const result = command('psql', ['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','eligibility_test','-d','postgres'], query);
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout.trim();
}
function userQuery(user: string, query: string) { return `set role authenticated; set request.jwt.claim.sub='${user}'; ${query}`; }
function fails(query: string, expected: RegExp) { assert.throws(() => sql(query), expected); }
function test(name: string, work: () => void) { work(); passed.push(name); }
function qualifiedFixture() {
  sql(`update global_release_policy set legal_approved=true,recognition_qualified=true,purchase_qualified=true,provider_route='openai_only',evidence_reference='LOCAL_TEST_ONLY';
       update eligibility_region_policy set market_qualified=true,evidence_reference='LOCAL_TEST_ONLY';`);
}
function permissions(user: string) {
  sql(userQuery(user, `select record_global_terms('nearr-global-terms-v1'); select record_global_privacy_notice('nearr-global-privacy-v1'); select set_ai_sharing_permission(true,'nearr-ai-openai-v1');`));
}
async function main() {
  const listener = net.createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve,reject) => listener.close(error => error ? reject(error) : resolve()));
  const init = command('initdb', ['-D',dataDir,'-U','eligibility_test','-A','trust','--no-locale','--encoding=UTF8']);
  assert.equal(init.status,0,init.stderr);
  const start = command('pg_ctl',['-D',dataDir,'-l',path.join(directory,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  assert.equal(start.status,0,start.stderr); started = true;
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    create table share_jobs(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,status text);
    create table share_media_tasks(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,status text);
    create table onboarding_account_transfer_grants(id uuid primary key default gen_random_uuid(),source_user_id uuid references auth.users,destination_user_id uuid references auth.users,status text);
    insert into auth.users values('${u1}'),('${u2}'),('${u3}');`);
  for (const migration of ['20261018000001_adult_age_eligibility.sql','20261018000002_adult_dispatch_transition_guard.sql','20261021000001_global_eligibility_and_consent.sql']) sql(readFileSync(path.join('supabase/migrations',migration),'utf8'));
  test('new policy is fail-closed with no automatically approved evidence', () => {
    assert.equal(sql(`select is_account_eligible_for_ai('${u1}'),is_account_eligible_for_purchase('${u1}');`),'f|f');
    fails('update global_release_policy set legal_approved=true;',/check constraint/);
    fails(userQuery(u1,"select record_global_terms('nearr-global-terms-v1');"),/terms_not_qualified/);
  });
  test('60 region and age-band combinations match minimized offline screen policy', () => {
    for (const countryCode of Object.keys(ELIGIBILITY_POLICY.regions)) for (const ageBand of AGE_BANDS) {
      const actual=sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${u1}'; select declare_global_eligibility('${ageBand}','${countryCode}'); rollback;`);
      assert.equal(actual,assessDeclaration({ageBand,countryCode}).status,`${countryCode}/${ageBand}`);
    }
  });
  test('unsupported regions and under13 never become eligible', () => {
    assert.equal(sql(userQuery(u3,"select declare_global_eligibility('18_plus','ZZ');")),'region_unavailable');
    fails(`insert into share_jobs(user_id,status) values('${u3}','queued');`,/global_eligibility_required/);
    assert.equal(sql(`select is_account_eligible_for_ai('${u3}');`),'f');
  });
  test('legacy adult does not waive regional redeclaration or consent', () => {
    sql(userQuery(u1,'select declare_age_eligibility_18_plus(true);'));
    assert.equal(sql(`select is_adult_eligible_for_ai('${u1}'),is_account_eligible_for_ai('${u1}');`),'f|f');
    assert.equal(sql(userQuery(u1,"select declare_global_eligibility('18_plus','US');")),'eligible');
    assert.equal(sql(`select is_account_eligible_for_ai('${u1}');`),'f');
  });
  test('old under18 declaration may establish teen eligibility but not become adult', () => {
    sql(userQuery(u2,'select declare_age_eligibility_18_plus(false);'));
    fails(userQuery(u2,"select declare_global_eligibility('18_plus','US');"),/eligibility_review_required/);
    assert.equal(sql(userQuery(u2,"select declare_global_eligibility('13','US');")),'eligible');
    fails(userQuery(u2,"select declare_global_eligibility('18_plus','US');"),/eligibility_decision_locked/);
  });
  test('role grants and owner RLS prevent forged qualification and permissions', () => {
    fails('set role anon; select declare_global_eligibility(\'18_plus\',\'US\');',/permission denied/);
    fails('set role authenticated; update global_release_policy set recognition_qualified=true;',/permission denied/);
    fails(`set role authenticated; update account_eligibility_v2 set status='eligible';`,/permission denied/);
    fails(`set role authenticated; select is_account_eligible_for_ai('${u1}');`,/permission denied/);
    assert.equal(sql(userQuery(u1,'select count(*) from account_eligibility_v2;')),'1');
    assert.equal(sql(userQuery(u1,`select count(*) from account_eligibility_v2 where user_id='${u2}';`)),'0');
  });
  qualifiedFixture();
  test('terms privacy notice and AI permission are distinct', () => {
    sql(userQuery(u1,"select record_global_privacy_notice('nearr-global-privacy-v1');"));
    assert.equal(sql(`select account_ai_access_reason('${u1}');`),'terms_acceptance_required');
    sql(userQuery(u1,"select record_global_terms('nearr-global-terms-v1');"));
    assert.equal(sql(`select account_ai_access_reason('${u1}');`),'ai_permission_required');
    fails(userQuery(u1,"select set_ai_sharing_permission(true,'stale-notice');"),/ai_notice_not_qualified/);
    permissions(u1); assert.equal(sql(`select is_account_eligible_for_ai('${u1}');`),'t');
    assert.equal(sql(`select is_adult_eligible_for_ai('${u1}');`),'f');
  });
  test('a qualified adult fixture cannot implicitly authorize a minor', () => {
    permissions(u2);
    assert.equal(sql(`select account_ai_access_reason('${u2}');`),'guardian_authorization_required');
    assert.equal(sql(`select is_account_eligible_for_purchase('${u2}');`),'f');
    fails("update eligibility_region_policy set minor_ai_qualified=true where country_code='US';",/check constraint/);
    fails(`insert into share_media_tasks(user_id,status) values('${u2}','processing');`,/global_eligibility_required/);
  });
  test('queued work cannot claim after withdrawal and saved records are preserved', () => {
    sql(`insert into share_jobs(user_id,status) values('${u1}','queued'); insert into share_media_tasks(user_id,status) values('${u1}','queued');`);
    sql(userQuery(u1,"select set_ai_sharing_permission(false,'stale-version-withdrawal');"));
    fails(`update share_jobs set status='processing_metadata' where user_id='${u1}';`,/global_eligibility_required/);
    fails(`update share_media_tasks set status='processing' where user_id='${u1}';`,/global_eligibility_required/);
    assert.equal(sql('select count(*) from share_jobs;'),'1');
    permissions(u1);
  });
  test('legacy administrative revocation still blocks the new policy', () => {
    sql(`update account_age_eligibility set status='revoked' where user_id='${u1}';`);
    assert.equal(sql(`select is_account_eligible_for_ai('${u1}');`),'f');
    sql(`update account_age_eligibility set status='adult_self_declared' where user_id='${u1}';`);
  });
  test('account transfer preserves destination restriction and never copies consent', () => {
    sql(`insert into onboarding_account_transfer_grants(source_user_id,destination_user_id,status) values('${u1}','${u3}','pending'); update onboarding_account_transfer_grants set status='completed';`);
    assert.equal(sql(`select status from account_eligibility_v2 where user_id='${u3}';`),'region_unavailable');
    assert.equal(sql(`select count(*) from account_processing_permissions where user_id='${u3}';`),'0');
  });
  test('policy changes and disabled provider route stop recognition immediately', () => {
    sql("update global_release_policy set provider_route='disabled';");
    assert.equal(sql(`select is_account_eligible_for_ai('${u1}');`),'f');
    sql("update global_release_policy set provider_route='openai_only',ai_notice_version='next';");
    assert.equal(sql(`select account_ai_access_reason('${u1}');`),'ai_permission_required');
    assert.equal(sql(userQuery(u1,"select get_my_global_access()->>'aiAllowed';")),'false');
  });
  mkdirSync('artifacts/global-release',{recursive:true});
  writeFileSync('artifacts/global-release/eligibility-database-tests.json',JSON.stringify({testedAt:new Date().toISOString(),engine:sql('select version();'),scope:'disposable PostgreSQL, actual three age migrations; synthetic qualification only',passed:passed.length,failed:0,tests:passed},null,2)+'\n');
  console.log(`PASS ${passed.length} PostgreSQL eligibility/security suites including 60 age/region combinations`);
}
main().catch(error => { console.error(error.message); process.exitCode=1; }).finally(() => {
  if (started && command('pg_ctl',['-D',dataDir,'-m','fast','-w','stop']).status!==0) { console.error('Local test cluster stop failed: '+directory); process.exitCode=1; }
});
