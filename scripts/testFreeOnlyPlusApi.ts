/** Executes the actual Edge handler against explicit auth/DB/HTTP boundaries. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { plusReleasePolicy } from '../lib/plusReleasePolicy';
import { plusWebhookIdentities, plusWebhookMatchesConfiguration, verifyPlusSubscriber } from '../lib/plusEntitlements';

async function request(config: Record<string, unknown>, action='status', authenticated=true, endpoint='plus-api') {
  let handler!: (request: Request) => Promise<Response>;
  let externalCalls=0, customerWrites=0;
  const table=(name:string) => {
    const result=() => ({ data:name==='nearr_plus_config' ? config : null, error:null });
    const query:any={ select:()=>query,eq:()=>query,single:async()=>result(),maybeSingle:async()=>result(),
      insert:()=>{customerWrites++;return query;} };
    return query;
  };
  const admin={auth:{getUser:async()=>({data:{user:authenticated ? {id:'fixture-owner',is_anonymous:false} : null},error:null})},
    from:table,rpc:async(name:string)=>({data:name==='is_account_eligible_for_purchase' ? false : {
      limit:3,used:1,reserved:1,remaining:1,paid:false,enforced:true,periodStart:'2026-10-01T00:00:00.000Z'},error:null})};
  const source=readFileSync(`supabase/functions/${endpoint}/index.ts`,'utf8').replace(/^import .*;\r?\n/gm,'');
  const executable=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const context=vm.createContext({serve:(value:typeof handler)=>{handler=value;},createClient:()=>admin,
    Deno:{env:{get:(name:string)=>name==='SUPABASE_URL' ? 'https://local-fixture.invalid' : 'OFFLINE_FIXTURE_ONLY'}},
    plusReleasePolicy,verifyPlusSubscriber,plusWebhookIdentities,plusWebhookMatchesConfiguration,TextEncoder,Response,Request,AbortSignal,console,
    fetch:async()=>{externalCalls++;throw new Error('unexpected external network');}});
  vm.runInContext(executable,context,{timeout:1000});
  const response=await handler(new Request('https://fixture.invalid/plus-api',{method:'POST',
    headers:{authorization:'Bearer OFFLINE_FIXTURE_ONLY','content-type':'application/json'},body:JSON.stringify(endpoint==='plus-api' ? {action} : {event:{id:'fixture-event',type:'RENEWAL'}})}));
  return {status:response.status,body:await response.json(),externalCalls,customerWrites};
}
async function main() {
  const free={release_mode:'free_only',release_qualified:true,enforce_allowance:true,sales_enabled:false,
    catalog_verified:false,revenuecat_app_id:null,free_finds:3,plus_finds:10,offering_id:'nearr_plus_v1',product_id:'nearr_plus_monthly_v1'};
  const status=await request(free);
  assert.equal(status.status,200); assert.equal(status.body.releaseMode,'free_only');
  assert.equal(status.body.salesEnabled,false);assert.equal(status.body.restoreAvailable,false);
  assert.equal(status.body.purchaseEligible,false);assert.equal(status.body.appUserId,null);assert.equal(status.body.entitlement,null);
  assert.equal(status.body.usage.limit,3);assert.equal(status.body.usage.enforced,true);
  assert.equal(status.externalCalls,0);assert.equal(status.customerWrites,0);
  for(const action of ['sync','restore']) {
    const result=await request(free,action); assert.equal(result.status,409);
    assert.equal(result.body.error,'purchases_deferred');assert.equal(result.externalCalls,0);assert.equal(result.customerWrites,0);
  }
  for(const change of [{release_qualified:false},{enforce_allowance:false},{sales_enabled:true},{free_finds:10}]) {
    const result=await request({...free,...change});assert.equal(result.status,503);assert.equal(result.externalCalls,0);
  }
  for(const mode of [undefined,'forged','paid']) {
    const result=await request({...free,release_mode:mode});assert.equal(result.body.releaseMode,'unavailable');
    assert.equal(result.body.salesEnabled,false);assert.equal(result.externalCalls,0);
  }
  assert.equal((await request(free,'status',false)).status,401);
  const webhook=await request(free,'status',true,'revenuecat-plus-webhook');
  assert.equal(webhook.status,409);assert.equal(webhook.body.error,'purchases_deferred');assert.equal(webhook.externalCalls,0);
  console.log('PASS actual Plus Edge handlers: authenticated free-only status; no catalog/customer/RevenueCat dependency; sync/restore/webhook reject; invalid release states fail closed; zero external calls.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
