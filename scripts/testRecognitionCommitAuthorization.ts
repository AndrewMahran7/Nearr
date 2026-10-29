/** Real PostgreSQL policy/consent + actual gate migration. Delegate probes test
 * entry ordering/atomic rollback; they do not simulate Places or replace full
 * existing save/source/geography regression tests. No cloud credentials used. */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';import net from 'node:net';
const bin=process.env.NEARR_TEST_POSTGRES_BIN||(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin':'');
const exe=(n:string)=>bin?path.join(bin,n+(process.platform==='win32'?'.exe':'')):n;
const dir=mkdtempSync(path.join(tmpdir(),'nearr-commit-auth-')),data=path.join(dir,'data');
const owner='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',job='33333333-3333-3333-3333-333333333333';
let port=0,started=false;const tests:string[]=[];
const run=(n:string,a:string[],input?:string)=>spawnSync(exe(n),a,{input,encoding:'utf8',windowsHide:true,timeout:60000});
const args=()=>['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','guard_test','-d','postgres'];
function sql(q:string){const r=run('psql',args(),q);if(r.status!==0)throw Error(r.stderr||String(r.error));return r.stdout.trim();}
const as=(u:string,q:string)=>`set role authenticated; set request.jwt.claim.sub='${u}'; ${q}`;
function fails(q:string,re:RegExp){assert.throws(()=>sql(q),re);}
function test(n:string,fn:()=>void){fn();tests.push(n);}
function parallel(q:string):Promise<number>{return new Promise((resolve,reject)=>{const c=spawn(exe('psql'),args(),{windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:15000});c.stdout.resume();c.stderr.resume();c.on('error',reject);c.on('close',(code,signal)=>c.killed||signal?reject(Error('parallel_terminated')):resolve(code??-1));c.stdin.end("set statement_timeout='8s'; "+q);});}
async function paused(name:string){const end=Date.now()+4000;while(Date.now()<end){if(sql(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event='PgSleep';`)==='1')return;await new Promise(r=>setTimeout(r,20));}throw Error('barrier_timeout');}
const calls=[`select * from auto_complete_named_lead('${job}','slot','${job}','google','name','address',1,2,'museum','{}',1,'rule');`,`select * from promote_share_job_soft_alternative('${job}',true);`,`select resolve_share_job('${job}','${job}');`];
const count=()=>Number(sql('select count(*) from commit_probe;'));
async function main(){const listener=net.createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));port=(listener.address() as net.AddressInfo).port;await new Promise<void>((r,j)=>listener.close(e=>e?j(e):r()));
 assert.equal(run('initdb',['-D',data,'-U','guard_test','-A','trust','--no-locale','--encoding=UTF8']).status,0);
 assert.equal(run('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']).status,0);started=true;
 sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated,service_role;
 create table share_jobs(id uuid primary key,user_id uuid references auth.users,status text);
 create table share_media_tasks(id uuid primary key,user_id uuid references auth.users,status text);
 create table onboarding_account_transfer_grants(id uuid primary key,source_user_id uuid references auth.users,destination_user_id uuid references auth.users,status text);
 insert into auth.users values('${owner}'),('${other}');
 create table commit_probe(kind text,user_id uuid,created_at timestamptz default clock_timestamp());
 revoke all on commit_probe from public,anon,authenticated;
 create function probe_commit(kind text,j uuid) returns void language plpgsql security definer as $$begin
 if not exists(select 1 from share_jobs where id=j and user_id=auth.uid()) then raise exception 'not_owned'; end if;
 perform pg_sleep(coalesce(nullif(current_setting('test.commit_delay',true),''),'0')::numeric);
 insert into commit_probe values(kind,auth.uid(),clock_timestamp()); end$$;
 create function auto_complete_named_lead(p_job_id uuid,p_logical_result_id text,p_attempt_token uuid,p_google_place_id text,p_name text,p_formatted_address text,p_latitude numeric,p_longitude numeric,p_category text,p_candidate_snapshot jsonb,p_confidence_score numeric default 1,p_rule_version text default 'named-lead-auto-v2')
 returns table(saved_place_id uuid,place_id uuid,reused boolean,completed boolean,idempotent boolean) language plpgsql security definer as $$begin perform probe_commit('named',p_job_id);return query select p_job_id,p_job_id,false,true,false;end$$;
 create function promote_share_job_soft_alternative(p_result_id uuid,p_make_primary boolean default true) returns table(saved_place_id uuid,place_id uuid,reused boolean,primary_replaced boolean)
 language plpgsql security definer as $$begin perform probe_commit('promote',p_result_id);return query select p_result_id,p_result_id,false,p_make_primary;end$$;
 create function resolve_share_job(p_job_id uuid,p_saved_place_id uuid) returns boolean language plpgsql security definer as $$begin perform probe_commit('resolve',p_job_id);return true;end$$;`);
 const originalBodies=sql("select md5(string_agg(prosrc,'|' order by proname)) from pg_proc where proname in ('auto_complete_named_lead','promote_share_job_soft_alternative','resolve_share_job');");
 for(const m of ['20261018000001_adult_age_eligibility.sql','20261018000002_adult_dispatch_transition_guard.sql','20261021000001_global_eligibility_and_consent.sql','20261029000001_atomic_terms_privacy_acceptance.sql','20261029000002_revision_bound_legal_acceptance.sql','20261029000004_recognition_commit_authorization.sql'])sql(readFileSync(path.join('supabase/migrations',m),'utf8'));
 sql(`insert into share_jobs values('${job}','${owner}','needs_help');`);
 test('original delegate bodies are unchanged and inaccessible to client roles',()=>{assert.equal(sql("select md5(string_agg(prosrc,'|' order by proname)) from pg_proc where proname in ('auto_complete_named_lead_pre_commit_guard','promote_share_job_soft_alternative_pre_commit_guard','resolve_share_job_pre_commit_guard');"),originalBodies);for(const call of calls)fails(as(owner,call.replace('auto_complete_named_lead(','auto_complete_named_lead_pre_commit_guard(').replace('promote_share_job_soft_alternative(','promote_share_job_soft_alternative_pre_commit_guard(').replace('resolve_share_job(','resolve_share_job_pre_commit_guard(')),/permission denied/);});
 test('unqualified caller reaches none of the three mutation delegates',()=>{for(const call of calls)fails(as(owner,call),/global_eligibility_required/);assert.equal(count(),0);});
 sql("update global_release_policy set legal_approved=true,recognition_qualified=true,provider_route='openai_only',evidence_reference='LOCAL_TEST_ONLY';update eligibility_region_policy set market_qualified=true,evidence_reference='LOCAL_TEST_ONLY';");
 for(const u of [owner,other])sql(as(u,`select declare_global_eligibility('18_plus','US');select record_global_terms_and_privacy('nearr-global-terms-v1','nearr-global-privacy-v1','${u}');select set_ai_sharing_permission(true,'nearr-ai-openai-v1');`));
 test('qualified owner retains original RPC return contracts and writes',()=>{for(const call of calls)sql(as(owner,call));assert.equal(count(),3);});
 test('original owner validation remains effective after authorization',()=>{for(const call of calls)fails(as(other,call),/not_owned/);assert.equal(count(),3);});
 test('withdrawn AI permission rejects all mutation entrypoints without a write',()=>{sql(as(owner,"select set_ai_sharing_permission(false,'nearr-ai-openai-v1');"));for(const call of calls)fails(as(owner,call),/global_eligibility_required/);assert.equal(count(),3);});
 sql(as(owner,"select set_ai_sharing_permission(true,'nearr-ai-openai-v1');"));
 test('new legal revision invalidates stale acceptance before writes',()=>{sql("update global_release_policy set terms_version='terms-revised';");for(const call of calls)fails(as(owner,call),/global_eligibility_required/);assert.equal(count(),3);sql("update global_release_policy set terms_version='nearr-global-terms-v1';");});
 test('fixed-snapshot isolation is rejected',()=>{for(const level of ['repeatable read','serializable'])fails(`begin isolation level ${level};${as(owner,calls[0])}`,/requires_read_committed/);});
 test('anonymous direct execution and helper bypass are denied',()=>{fails('set role anon;'+calls[0],/permission denied/);fails(as(owner,`select require_current_recognition_commit('${owner}');`),/permission denied/);});
 const before=count();const save=parallel(as(owner,`begin;set local application_name='save-first';set local test.commit_delay='1.2';${calls[0]}commit;`));await paused('save-first');const revoke=parallel(as(owner,"select set_ai_sharing_permission(false,'nearr-ai-openai-v1');"));assert.deepEqual(await Promise.all([save,revoke]),[0,0]);assert.equal(count(),before+1);assert.equal(sql(`select ai_allowed from account_processing_permissions where user_id='${owner}';`),'f');tests.push('save first locks consent through commit; concurrent withdrawal commits afterward');
 sql(as(owner,"select set_ai_sharing_permission(true,'nearr-ai-openai-v1');"));const at=count();const withdrawal=parallel(as(owner,"begin;set local application_name='withdraw-first';select set_ai_sharing_permission(false,'nearr-ai-openai-v1');select pg_sleep(1.2);commit;"));await paused('withdraw-first');const denied=parallel(as(owner,calls[1]));const races=await Promise.all([withdrawal,denied]);assert.equal(races[0],0);assert.notEqual(races[1],0);assert.equal(count(),at);tests.push('withdrawal first makes a waiting save recheck current consent and write nothing');
}
main().then(()=>{mkdirSync('artifacts/global-release/paid-launch/tests',{recursive:true});writeFileSync('artifacts/global-release/paid-launch/tests/recognition-commit-authorization.json',JSON.stringify({testedAt:new Date().toISOString(),passed:tests.length,failed:0,scope:'Actual PostgreSQL authorization migration + real consent policy + delegate boundary probes; not a complete Places/save integration',tests},null,2)+'\n');console.log(`${tests.length} recognition commit authorization PostgreSQL checks passed`);}).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{if(started&&run('pg_ctl',['-D',data,'-m','fast','-w','stop']).status!==0)process.exitCode=1;});
