/** Real PostgreSQL integration tests in a new local-only disposable cluster.
 * No .env, Supabase credentials, existing database or network provider is used. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

const pgBin = process.env.NEARR_TEST_POSTGRES_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
const pg = (name: string) => pgBin ? path.join(pgBin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
const directory = mkdtempSync(path.join(tmpdir(), 'nearr-plus-isolated-pg-'));
const data = path.join(directory, 'data');
const results: string[] = [];
let port: number;
let started = false;
const u1 = '11111111-1111-1111-1111-111111111111';
const u2 = '22222222-2222-2222-2222-222222222222';
const teen = '33333333-3333-3333-3333-333333333333';
const blocked = '44444444-4444-4444-4444-444444444444';
const foreignSave = '99999999-9999-9999-9999-999999999999';

function command(name: string, args: string[], input?: string) {
  return spawnSync(pg(name), args, { input, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
}
const sqlArgs = () => ['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','plus_test','-d','postgres'];
function sql(query: string) {
  const result = command('psql', sqlArgs(), query);
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout.trim();
}
function fails(query: string, expected: RegExp) {
  const result = command('psql', sqlArgs(), query);
  assert.notEqual(result.status, 0); assert.match(result.stderr, expected);
}
function test(name: string, work: () => void) { work(); results.push(name); }
function asUser(user: string, query: string) { return `set role authenticated; set request.jwt.claim.sub='${user}'; ${query}`; }
function permission(user: string, allowed: boolean) {
  sql(asUser(user,`select set_ai_sharing_permission(${allowed},'nearr-ai-openai-v1');`));
}
function parallelSql(query: string): Promise<number> {
  return new Promise((resolve,reject) => {
    const child = spawn(pg('psql'),sqlArgs(),{ windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:30_000 });
    child.on('error',reject); child.stdout.resume(); child.stderr.resume();
    child.on('close',(code,signal) => {
      if(child.killed || signal) reject(new Error(`parallel_sql_terminated:${signal ?? 'timeout'}`));
      else resolve(code ?? -1);
    });
    child.stdin.end("set statement_timeout='10s'; "+query);
  });
}
async function waitForTransactionPause(application: string) {
  const deadline=Date.now()+5_000;
  while(Date.now()<deadline) {
    if(sql(`select count(*) from pg_stat_activity where application_name='${application}' and wait_event='PgSleep';`)==='1') return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error(`transaction_barrier_timeout:${application}`);
}
const count = (where = '') => Number(sql(`select count(*) from nearr_plus_recognitions ${where};`));
const job = (id: number, user = u1) => `insert into share_jobs(id,user_id,status) values('00000000-0000-0000-0000-${String(id).padStart(12,'0')}','${user}','queued');`;
const id = (i: number) => `00000000-0000-0000-0000-${String(i).padStart(12,'0')}`;
function reset() { sql('truncate share_jobs cascade; truncate nearr_plus_entitlements;'); }

async function main() {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0,'127.0.0.1',resolve));
  port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve,reject) => listener.close((error) => error ? reject(error) : resolve()));
  const initialized = command('initdb', ['-D', data, '-U','plus_test','-A','trust','--no-locale','--encoding=UTF8']);
  assert.equal(initialized.status, 0, initialized.stderr || String(initialized.error));
  const launched = command('pg_ctl', ['-D',data,'-l',path.join(directory,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  assert.equal(launched.status, 0, launched.stderr || String(launched.error)); started = true;
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    insert into auth.users values('${u1}'),('${u2}'),('${teen}'),('${blocked}');
    create table saved_places(id uuid primary key,user_id uuid not null references auth.users);
    create table share_jobs(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users,status text not null,decision text,saved_place_id uuid references saved_places,idempotency_key text,
      source_url text,canonical_url text,source_platform text,progress_stage text,created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),attempts integer not null default 0,max_attempts integer not null default 5,locked_until timestamptz,unique(user_id,idempotency_key));
    create table share_media_tasks(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,status text);
    create table onboarding_account_transfer_grants(id uuid primary key default gen_random_uuid(),source_user_id uuid references auth.users,destination_user_id uuid references auth.users,status text);
    create table share_job_place_results(id uuid primary key default gen_random_uuid(),share_job_id uuid references share_jobs on delete cascade,user_id uuid references auth.users,saved_place_id uuid references saved_places,outcome text);
    insert into saved_places values('${foreignSave}','${u2}');`);
  const migrations = ['20261018000001_adult_age_eligibility.sql','20261018000002_adult_dispatch_transition_guard.sql',
    '20261021000001_global_eligibility_and_consent.sql','20261021000002_nearr_plus_verified_entitlements.sql',
    '20261021000003_global_share_ingress.sql','20261021000004_account_ui_locale.sql','20261021000005_global_claim_eligibility.sql',
    '20261028000001_nearr_free_only_release.sql'];
  for (const migration of migrations) sql(readFileSync(path.resolve('supabase/migrations',migration),'utf8'));
  test('all eight migrations coexist with every live qualification disabled', () => {
    fails(job(1),/global_eligibility_required/);
    assert.equal(sql(`select is_account_eligible_for_ai('${u1}'),is_account_eligible_for_purchase('${u1}');`),'f|f');
  });
  test('protected writes reject repeatable-read and serializable snapshots before mutation', () => {
    for(const isolation of ['repeatable read','serializable']) {
      for(const write of [
        'update nearr_plus_config set sales_enabled=false;',
        `insert into nearr_plus_customers(user_id) values('${u1}');`,
        `insert into nearr_plus_entitlements(user_id,state,verified_at,environment) values('${u1}','expired',now(),'SANDBOX');`,
      ]) fails(`begin isolation level ${isolation}; select count(*) from nearr_plus_config; ${write}`,/plus_release_requires_read_committed/);
    }
    assert.equal(sql('select count(*) from nearr_plus_customers;'),'0');
    assert.equal(sql('select count(*) from nearr_plus_entitlements;'),'0');
    assert.equal(sql('select release_mode from nearr_plus_config;'),'paid');
  });
  sql(`update global_release_policy set legal_approved=true,recognition_qualified=true,purchase_qualified=true,provider_route='openai_only',evidence_reference='LOCAL_TEST_ONLY';
    update eligibility_region_policy set market_qualified=true,evidence_reference='LOCAL_TEST_ONLY';`);
  for (const user of [u1,u2,teen]) {
    sql(asUser(user,`select declare_global_eligibility('${user===teen ? '13' : '18_plus'}','US');
      select record_global_terms('nearr-global-terms-v1'); select record_global_privacy_notice('nearr-global-privacy-v1');`));
    permission(user,true);
  }
  sql(asUser(blocked,"select declare_global_eligibility('under_13','US');"));
  sql(`insert into nearr_plus_customers(user_id) values('${u1}'),('${u2}');
    create function test_snapshot(p_state text default 'active', p_key text default 'same-renewal', p_verified timestamptz default now()) returns jsonb language sql as $$
      select jsonb_build_object('state',p_state,'productId',case when p_state='free' then null else 'nearr_plus_monthly_v1' end,
        'periodStart',now()-interval '1 day','expiresAt',now()+interval '29 days','accessUntil',now()+interval '29 days',
        'verifiedAt',p_verified,'environment','SANDBOX','periodKey',p_key) $$;`);
  test('migration defaults keep existing free queue unchanged', () => { sql(job(1)); assert.equal(count(),0); });
  test('allowance cannot activate without product and release qualification', () => fails('update nearr_plus_config set enforce_allowance=true;', /check constraint/));
  sql("update nearr_plus_config set release_qualified=true,catalog_verified=true,revenuecat_app_id='app_test',enforce_allowance=true;");
  test('client roles cannot read billing tables or mint snapshots', () => {
    fails('set role authenticated; select * from nearr_plus_entitlements;', /permission denied/);
    fails(`set role authenticated; select apply_nearr_plus_snapshot('${u1}',test_snapshot());`, /permission denied/);
    fails(`set role anon; select reserve_nearr_plus_recognition('${u1}','${id(2)}');`, /permission denied/);
  });
  test('three free reservations serialize and fourth creates no durable job', () => {
    reset(); sql(job(2)+job(3)+job(4)); assert.equal(count(),3);
    fails(job(5), /plus_allowance_exhausted/); assert.equal(sql(`select count(*) from share_jobs where id='${id(5)}';`),'0');
  });
  test('duplicate idempotency insert cannot orphan or charge another reservation', () => {
    sql(`update share_jobs set idempotency_key='duplicate' where id='${id(2)}';
      insert into share_jobs(id,user_id,status,idempotency_key) values('${id(99)}','${u1}','queued','duplicate') on conflict(user_id,idempotency_key) do nothing;`);
    assert.equal(count(),3);
  });
  test('failed recognition releases once and retry uses same row', () => {
    sql(`update share_jobs set status='failed' where id='${id(2)}';`);
    assert.equal(sql(`select state from nearr_plus_recognitions where job_id='${id(2)}';`),'released');
    sql(`update share_jobs set status='queued' where id='${id(2)}';`); assert.equal(count(),3);
  });
  test('foreign saved-place pointer never consumes successful allowance', () => {
    sql(`update share_jobs set status='completed',saved_place_id='${foreignSave}' where id='${id(2)}';`);
    assert.equal(sql(`select state from nearr_plus_recognitions where job_id='${id(2)}';`),'released');
  });
  test('Quick Check reserves pending confirmation and multi-save consumes once', () => {
    sql(`update share_jobs set status='needs_help',decision='candidate_picker' where id='${id(3)}';`);
    assert.equal(sql(`select state from nearr_plus_recognitions where job_id='${id(3)}';`),'reserved');
    sql(`insert into saved_places values('${id(100)}','${u1}'),('${id(101)}','${u1}');
      insert into share_job_place_results(share_job_id,user_id,saved_place_id,outcome)
      values('${id(3)}','${u1}','${id(100)}','auto_saved'),('${id(3)}','${u1}','${id(101)}','already_saved');
      select settle_nearr_plus_recognition('${id(3)}');`);
    assert.equal(count("where state='consumed'"),1);
  });
  test('stale verification cannot overwrite a later refund', () => {
    sql(`select apply_nearr_plus_snapshot('${u1}',test_snapshot('revoked'));
      select apply_nearr_plus_snapshot('${u1}',test_snapshot('active','same-renewal',now()-interval '1 minute'));`);
    assert.equal(sql(`select state from nearr_plus_entitlements where user_id='${u1}';`),'revoked');
  });
  test('equal-time active API snapshot cannot resurrect a refund', () => {
    sql(`select apply_nearr_plus_snapshot('${u1}',test_snapshot('active','same-renewal',
      (select verified_at from nearr_plus_entitlements where user_id='${u1}')));`);
    assert.equal(sql(`select state from nearr_plus_entitlements where user_id='${u1}';`),'revoked');
  });
  test('webhook exact replay idempotent and event-ID collision rejects', () => {
    assert.equal(sql(`select apply_nearr_plus_webhook('event-1','RENEWAL',repeat('a',64),'[]');`),'t');
    assert.equal(sql(`select apply_nearr_plus_webhook('event-1','RENEWAL',repeat('a',64),'[]');`),'f');
    fails(`select apply_nearr_plus_webhook('event-1','RENEWAL',repeat('b',64),'[]');`,/plus_event_collision/);
  });
  test('transfer snapshot writes and event insertion roll back together on failure', () => {
    fails(`select apply_nearr_plus_webhook('event-rollback','TRANSFER',repeat('a',64),jsonb_build_array(
      jsonb_build_object('userId','${u1}','snapshot',test_snapshot()),
      jsonb_build_object('userId','${u2}','snapshot',test_snapshot()||jsonb_build_object('environment','PRODUCTION'))));`,/plus_snapshot_invalid/);
    assert.equal(sql("select count(*) from nearr_plus_webhook_events where event_id='event-rollback';"),'0');
    assert.equal(sql(`select state from nearr_plus_entitlements where user_id='${u1}';`),'revoked');
  });
  test('refund preserves all existing saved places and recognition history', () => {
    const before = sql('select count(*) from saved_places;');
    sql(`select apply_nearr_plus_snapshot('${u1}',test_snapshot('revoked'));`);
    assert.equal(sql('select count(*) from saved_places;'),before); assert.equal(count(),3);
  });
  test('stale active subscription requires online verification for new work', () => {
    reset(); sql(`select apply_nearr_plus_snapshot('${u1}',test_snapshot()); update nearr_plus_entitlements set verified_at=now()-interval '16 minutes';`);
    fails(job(6),/plus_verification_required/); assert.equal(count(),0);
  });
  test('expired entitlement automatically returns to free allowance', () => {
    sql("update nearr_plus_entitlements set access_until=now()-interval '1 second';");
    assert.equal(sql(`select nearr_plus_usage('${u1}')->>'limit';`),'3'); sql(job(6));
  });
  test('paid renewal allowance follows transfer without resetting usage', () => {
    reset(); sql(`select apply_nearr_plus_snapshot('${u1}',test_snapshot());`);
    for (let i=10;i<20;i++) sql(job(i));
    sql(`select apply_nearr_plus_webhook('transfer-2','TRANSFER',repeat('c',64),jsonb_build_array(
      jsonb_build_object('userId','${u1}','snapshot',test_snapshot('free')),
      jsonb_build_object('userId','${u2}','snapshot',test_snapshot())));`);
    assert.equal(sql(`select nearr_plus_usage('${u2}')->>'remaining';`),'0');
    fails(job(20,u2),/plus_allowance_exhausted/);
  });
  test('revoked AI permission blocks paid users independently of billing', () => {
    permission(u2,false);
    fails(job(21,u2),/global_eligibility_required/);
    permission(u2,true);
  });
  test('first paid period includes earlier current-month free successes', () => {
    reset(); sql(job(22));
    sql(`insert into saved_places values('${id(102)}','${u1}'); update share_jobs set status='completed',saved_place_id='${id(102)}' where id='${id(22)}';
      select apply_nearr_plus_snapshot('${u1}',test_snapshot()||jsonb_build_object('periodStart',now()));`);
    assert.equal(sql(`select nearr_plus_usage('${u1}')->>'used';`),'1');
    assert.equal(sql(`select nearr_plus_usage('${u1}')->>'remaining';`),'9');
  });
  test('paid snapshot cannot authorize teen or under-minimum AI ingress', () => {
    sql(`insert into nearr_plus_customers(user_id) values('${teen}'),('${blocked}');
      select apply_nearr_plus_snapshot('${teen}',test_snapshot('active','teen-purchase'));
      select apply_nearr_plus_snapshot('${blocked}',test_snapshot('active','blocked-purchase'));`);
    for(const user of [teen,blocked]) {
      assert.equal(sql(`select is_account_eligible_for_ai('${user}'),is_account_eligible_for_purchase('${user}');`),'f|f');
      fails(job(23,user),/global_eligibility_required/);
      fails(`insert into share_media_tasks(user_id,status) values('${user}','processing');`,/global_eligibility_required/);
    }
  });
  test('locale is owner scoped and cannot alter age consent or payment', () => {
    sql(asUser(teen,"select set_my_ui_locale('ja');"));
    sql(asUser(u1,"select set_my_ui_locale('ko');"));
    assert.equal(sql(asUser(teen,'select locale from account_ui_preferences;')),'ja');
    assert.equal(sql(`select is_account_eligible_for_ai('${teen}'),is_account_eligible_for_purchase('${teen}');`),'f|f');
    fails(asUser(u1,"select set_my_ui_locale('unsupported');"),/locale_not_supported/);
    fails('set role authenticated; update account_ui_preferences set locale=\'en-US\';',/permission denied/);
  });
  test('withdrawal prevents claiming an already reserved paid job', () => {
    sql(job(24)); permission(u1,false);
    fails(`update share_jobs set status='processing_metadata' where id='${id(24)}';`,/global_eligibility_required/);
    assert.equal(sql(`select state from nearr_plus_recognitions where job_id='${id(24)}';`),'reserved');
    permission(u1,true);
  });
  test('ingress idempotency is owner scoped and creates no awaiting-purchase row', () => {
    reset();
    const ingress=(user:string) => `select job_id,duplicate,requires_purchase from create_global_share_job_for_user('${user}','https://example.com/post','https://example.com/post','other','same-client-key',90,'host_app');`;
    const first=sql(ingress(u1)); const repeated=sql(ingress(u1)); const other=sql(ingress(u2));
    assert.equal(first.split('|')[0],repeated.split('|')[0]); assert.match(repeated,/\|t\|f$/);
    assert.notEqual(first.split('|')[0],other.split('|')[0]); assert.equal(count(),2);
    assert.equal(sql("select count(*) from share_jobs where status='awaiting_purchase';"),'0');
    fails('set role authenticated; '+ingress(u1),/permission denied/);
  });
  test('queue claims skip withdrawn owners without starving eligible reservations', () => {
    reset(); sql(job(25)+job(26,u2)); permission(u1,false);
    assert.equal(sql('select id from claim_share_jobs(1);'),id(26));
    assert.equal(sql(`select status,attempts from share_jobs where id='${id(25)}';`),'queued|0');
    assert.equal(sql(`select state from nearr_plus_recognitions where job_id='${id(25)}';`),'reserved');
    permission(u1,true);
    assert.equal(sql('select id from claim_share_jobs(1);'),id(25));
    assert.equal(count(),2);
  });
  test('private queue claim functions reject both client roles', () => {
    for (const role of ['anon','authenticated']) {
      fails(`set role ${role}; select * from claim_share_jobs();`,/permission denied/);
      fails(`set role ${role}; select * from claim_media_tasks();`,/permission denied/);
    }
  });
  reset();
  const concurrent = await Promise.all(Array.from({length:6},(_,i) => parallelSql(job(30+i))));
  assert.equal(concurrent.filter(code=>code===0).length,3); assert.equal(count(),3);
  results.push('six concurrent enqueues cannot exceed the three-find free quota');
  reset();
  sql(`select apply_nearr_plus_snapshot('${u1}',test_snapshot('active','transfer-race'));
    select apply_nearr_plus_snapshot('${u2}',test_snapshot('active','transfer-race'));`);
  const sharedPeriod=await Promise.all(Array.from({length:16},(_,i)=>parallelSql(job(50+i,i%2 ? u1 : u2))));
  assert.equal(sharedPeriod.filter(code=>code===0).length,10); assert.equal(count(),10);
  results.push('concurrent restored identities share one ten-find renewal allowance');
  reset();
  const ingressRace=await Promise.all(Array.from({length:8},()=>parallelSql(`select * from create_global_share_job_for_user('${u1}','https://example.com/race','https://example.com/race','other','race-key',90,'share_extension');`)));
  assert.ok(ingressRace.every(code=>code===0)); assert.equal(count(),1);
  assert.equal(sql('select count(*) from share_jobs;'),'1');
  results.push('eight concurrent unified ingress retries create one job and one reservation');
  reset();
  test('free-only activation refuses any paid history without modifying saves', () => {
    const before=sql('select count(*) from saved_places;');
    sql(`select apply_nearr_plus_snapshot('${u1}',test_snapshot());`);
    fails("update nearr_plus_config set release_mode='free_only',sales_enabled=false,catalog_verified=false,revenuecat_app_id=null;",/free_only_existing_paid_history/);
    assert.equal(sql('select count(*) from saved_places;'),before);
    assert.equal(sql('select release_mode from nearr_plus_config;'),'paid');
  });
  reset();
  test('even a paid identity without an active receipt prevents free-only downgrade', () => {
    fails("update nearr_plus_config set release_mode='free_only',sales_enabled=false,catalog_verified=false,revenuecat_app_id=null;",/free_only_existing_paid_history/);
    sql('delete from nearr_plus_customers;'); // This disposable test cluster owns every identity.
  });
  test('inactive entitlement-only history also prevents free-only downgrade', () => {
    sql(`insert into nearr_plus_entitlements(user_id,state,verified_at,environment) values('${u1}','expired',now(),'SANDBOX');`);
    fails("update nearr_plus_config set release_mode='free_only',sales_enabled=false,catalog_verified=false,revenuecat_app_id=null;",/free_only_existing_paid_history/);
    assert.equal(sql("select state from nearr_plus_entitlements;"),'expired');
    reset(); // Only this disposable cluster owns the synthetic billing history.
  });
  test('free-only requires release qualification enforced three finds and no sales', () => {
    for(const change of ["release_qualified=false","enforce_allowance=false","free_finds=4","sales_enabled=true"]) {
      fails(`update nearr_plus_config set release_mode='free_only',${change};`,/check constraint/);
    }
    fails("update nearr_plus_config set release_mode='forged';",/check constraint/);
    sql("update nearr_plus_config set release_mode='free_only',sales_enabled=false,catalog_verified=false,revenuecat_app_id=null;");
    assert.equal(sql(`select nearr_plus_usage('${u1}')->>'limit',nearr_plus_usage('${u1}')->>'enforced';`),'3|true');
    fails('set role authenticated; update nearr_plus_config set enforce_allowance=false;',/permission denied/);
  });
  test('free-only keeps consent and provider release checks before queue work', () => {
    permission(u1,false); fails(job(80),/global_eligibility_required/); permission(u1,true);
    sql('update global_release_policy set recognition_qualified=false;');
    fails(job(80),/global_eligibility_required/);
    sql('update global_release_policy set recognition_qualified=true;');
    for(const user of [teen,blocked]) fails(job(80,user),/global_eligibility_required/);
    assert.equal(count(),0);
  });
  test('free-only uses UTC calendar boundary and preserves completed saved places', () => {
    sql(job(80));
    sql(`insert into saved_places values('${id(180)}','${u1}'); update share_jobs set status='completed',saved_place_id='${id(180)}' where id='${id(80)}';`);
    assert.equal(sql(`select nearr_plus_usage('${u1}')->>'used';`),'1');
    sql(`update nearr_plus_recognitions set reserved_at=(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')-interval '1 second';`);
    assert.equal(sql(`set timezone='Pacific/Honolulu'; select (nearr_plus_usage('${u1}')->>'periodStart')::timestamptz = (date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),nearr_plus_usage('${u1}')->>'remaining';`),'t|3');
    assert.equal(sql(`select count(*) from saved_places where id='${id(180)}';`),'1');
  });
  reset();
  test('free-only releases failed work retries once and consumes multi-place only once', () => {
    sql(job(81)); sql(`update share_jobs set status='failed' where id='${id(81)}';`);
    assert.equal(sql(`select nearr_plus_usage('${u1}')->>'remaining';`),'3');
    sql(`update share_jobs set status='queued' where id='${id(81)}';`);
    assert.equal(count(),1);
    sql(`update share_jobs set status='needs_help',decision='candidate_picker' where id='${id(81)}';
      insert into share_job_place_results(share_job_id,user_id,saved_place_id,outcome) values
      ('${id(81)}','${u1}','${id(100)}','auto_saved'),('${id(81)}','${u1}','${id(101)}','already_saved');`);
    assert.equal(sql(`select nearr_plus_usage('${u1}')->>'used',nearr_plus_usage('${u1}')->>'remaining';`),'1|2');
  });
  reset();
  const freeConcurrent=await Promise.all(Array.from({length:6},(_,i)=>parallelSql(job(90+i))));
  assert.equal(freeConcurrent.filter(code=>code===0).length,3); assert.equal(count(),3);
  assert.equal(sql('select catalog_verified,revenuecat_app_id is null,sales_enabled from nearr_plus_config;'),'f|t|f');
  results.push('free-only six concurrent enqueues allow exactly three without paid catalog or RevenueCat');
  reset();
  const paidMode="update nearr_plus_config set release_mode='paid',release_qualified=true,enforce_allowance=true,sales_enabled=false,catalog_verified=true,revenuecat_app_id='app_test';";
  const freeMode="update nearr_plus_config set release_mode='free_only',sales_enabled=false,catalog_verified=false,revenuecat_app_id=null;";
  sql(paidMode);
  const customerFirst=parallelSql(`set application_name='nearr_customer_first'; begin; insert into nearr_plus_customers(user_id) values('${u1}'); select pg_sleep(1); commit;`);
  await waitForTransactionPause('nearr_customer_first');
  fails(freeMode,/free_only_existing_paid_history/);
  assert.equal(await customerFirst,0);assert.equal(sql('select release_mode from nearr_plus_config;'),'paid');
  results.push('concurrent customer-first write prevents free-only activation and preserves checkout identity');
  sql('delete from nearr_plus_customers;');
  const releaseFirst=parallelSql(`set application_name='nearr_release_first'; begin; ${freeMode} select pg_sleep(1); commit;`);
  await waitForTransactionPause('nearr_release_first');
  fails(`insert into nearr_plus_customers(user_id) values('${u1}');`,/plus_free_only_customer_blocked/);
  assert.equal(await releaseFirst,0);assert.equal(sql('select count(*) from nearr_plus_customers;'),'0');
  results.push('concurrent release-first transition blocks late paid customer creation');
  sql(paidMode);
  const directGrantFirst=parallelSql(`set application_name='nearr_direct_grant_first'; begin;
    insert into nearr_plus_entitlements(user_id,state,product_id,period_start,expires_at,access_until,verified_at,environment,period_key)
    values('${u1}','active','nearr_plus_monthly_v1',now(),now()+interval '29 days',now()+interval '29 days',now(),'SANDBOX','direct-grant');
    select pg_sleep(1); commit;`);
  await waitForTransactionPause('nearr_direct_grant_first');
  fails(freeMode,/free_only_existing_paid_history/);
  assert.equal(await directGrantFirst,0);assert.equal(sql(`select nearr_plus_usage('${u1}')->>'limit';`),'10');
  results.push('concurrent direct-grant-first write without customer row prevents free-only activation');
  reset();
  sql(paidMode+`insert into nearr_plus_customers(user_id) values('${u1}');`);
  const grantFirst=parallelSql(`set application_name='nearr_grant_first'; begin; select apply_nearr_plus_snapshot('${u1}',test_snapshot()); select pg_sleep(1); commit;`);
  await waitForTransactionPause('nearr_grant_first');
  fails(freeMode,/free_only_existing_paid_history/);
  assert.equal(await grantFirst,0);assert.equal(sql(`select nearr_plus_usage('${u1}')->>'limit';`),'10');
  results.push('concurrent snapshot-first grant remains paid and prevents release downgrade');
  reset();sql('delete from nearr_plus_customers;');
  const grantReleaseFirst=parallelSql(`set application_name='nearr_grant_release_first'; begin; ${freeMode} select pg_sleep(1); commit;`);
  await waitForTransactionPause('nearr_grant_release_first');
  // This models a late service-role receipt write independently of its transport.
  fails(`insert into nearr_plus_entitlements(user_id,state,product_id,period_start,expires_at,access_until,verified_at,environment,period_key)
    values('${u1}','active','nearr_plus_monthly_v1',now(),now()+interval '29 days',now()+interval '29 days',now(),'SANDBOX','late-grant');`,/plus_free_only_paid_grant_blocked/);
  assert.equal(await grantReleaseFirst,0);assert.equal(sql('select count(*) from nearr_plus_entitlements;'),'0');
  assert.equal(sql(`select nearr_plus_usage('${u1}')->>'limit';`),'3');
  results.push('concurrent release-first transition blocks late active receipt writes atomically');
  sql(paidMode+`insert into nearr_plus_customers(user_id) values('${u1}'),('${u2}');
    create function test_pause_multi_identity_grant() returns trigger language plpgsql as $$
    begin
      if new.user_id='${u1}' and current_setting('application_name')='nearr_multi_identity_grant' then perform pg_sleep(1); end if;
      return new;
    end $$;
    create trigger test_pause_multi_identity_grant after insert on nearr_plus_entitlements
      for each row execute function test_pause_multi_identity_grant();`);
  const multiIdentity=parallelSql(`set statement_timeout='10s'; set application_name='nearr_multi_identity_grant';
    select apply_nearr_plus_webhook('lock-order-transfer','TRANSFER',repeat('d',64),jsonb_build_array(
      jsonb_build_object('userId','${u1}','snapshot',test_snapshot()),
      jsonb_build_object('userId','${u2}','snapshot',test_snapshot())));`);
  await waitForTransactionPause('nearr_multi_identity_grant');
  const singleIdentity=parallelSql(`set statement_timeout='10s'; select apply_nearr_plus_snapshot('${u2}',test_snapshot());`);
  assert.deepEqual(await Promise.all([multiIdentity,singleIdentity]),[0,0]);
  assert.equal(sql("select count(*) from nearr_plus_entitlements where state='active';"),'2');
  results.push('multi-identity webhook and simultaneous single-user sync obey release-before-user lock ordering without deadlock');
  mkdirSync('artifacts/global-release',{recursive:true});
  writeFileSync('artifacts/global-release/monetization-database-tests.json',JSON.stringify({testedAt:new Date().toISOString(),engine:sql('select version();'),scope:'disposable local PostgreSQL; fixture base schema, actual legacy age/global/free-only migrations; synthetic local qualification only; full media-claim regression separately tested against restored Development schema',migrations,passed:results.length,failed:0,tests:results},null,2)+'\n');
  console.log(`PASS: ${results.length} real PostgreSQL entitlement, quota, isolation and concurrent-enqueue cases`);
}
main().catch(error => { console.error(error.message); process.exitCode=1; }).finally(() => {
  if (started) {
    const stopped=command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
    if(stopped.status!==0){ console.error('Disposable local PostgreSQL stop failed: '+directory);process.exitCode=1; }
  }
});
