/** Execute the actual Edge handler; only auth, DB and external SDK/API boundaries are inert. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {verifyPaidSubscriber} from '../lib/plusEntitlements';
import {plusReleasePolicy} from '../lib/plusReleasePolicy';
import {PAID_TOKEN_PRODUCTS,reconcilePurchaseHint} from '../lib/paidFindPolicy';
const owner='11111111-1111-1111-1111-111111111111';
const product=PAID_TOKEN_PRODUCTS[0].productId;
const config={release_mode:'paid',release_qualified:true,enforce_allowance:true,catalog_verified:true,sales_enabled:true,
  subscription_benefit:'unlimited',token_catalog_verified:true,paid_find_policy_enabled:true,
  revenuecat_app_id:'app_fixture',revenuecat_project_id:'project_fixture',environment:'SANDBOX',entitlement_id:'nearr_plus',
  offering_id:'nearr_paid_v1',product_id:'com.nearr.plus.unlimited.monthly.v1',free_finds:3,
  revenuecat_token_product_ids:Object.fromEntries(PAID_TOKEN_PRODUCTS.map(p=>[p.productId,'rc_'+p.quantity]))};
async function request(env:Record<string,string>,action='sync',hint?:Record<string,unknown>){
  let handler!:(r:Request)=>Promise<Response>,entitlement:any=null;
  const gets:any[]=[],recoveries:any[]=[],writes:string[]=[],refreshes:any[]=[];
  const ledger=[{productId:product,transactionId:'verified-tx',purchasedAt:new Date().toISOString(),state:'verified'}];
  const initialLedger=JSON.stringify(ledger),balance={available:17,reserved:0};
  const admin={auth:{getUser:async()=>({data:{user:{id:owner,is_anonymous:false}},error:null})},
    from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>result(),single:async()=>result()};
      const result=()=>({data:table==='nearr_plus_config'?config:table==='nearr_plus_customers'?{app_user_id:'np_'+owner}:entitlement,error:null});return q;},
    rpc:async(name:string,args:any)=>{
      if(name==='is_account_eligible_for_purchase')return{data:true,error:null};
      if(name==='reap_nearr_paid_reservations')return{data:0,error:null};
      if(name==='nearr_plus_usage')return{data:{paid:false,periodStart:'2026-10-01T00:00:00.000Z',tokens:balance},error:null};
      if(name==='nearr_paid_recent_purchases')return{data:ledger,error:null};
      if(name==='apply_nearr_paid_subscriber'){
        writes.push(name);const s=args.p_snapshot;
        entitlement={state:s.state,product_id:s.productId,period_start:s.periodStart,expires_at:s.expiresAt,access_until:s.accessUntil,verified_at:s.verifiedAt,environment:s.environment,period_key:s.periodKey};
        return{error:null};
      }
      if(name==='apply_nearr_paid_recovery'){writes.push(name);return{error:null};}
      throw Error('unexpected fixture RPC: '+name);
    }};
  const code=ts.transpileModule(readFileSync('supabase/functions/plus-api/index.ts','utf8').replace(/^import .*;\r?\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{serve:(value:typeof handler)=>{handler=value;},createClient:()=>admin,Response,Request,AbortSignal,console,
    Deno:{env:{get:(key:string)=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',...env})[key]}},
    plusReleasePolicy,verifyPaidSubscriber,PAID_TOKEN_PRODUCTS,reconcilePurchaseHint,
    refreshStalePaidEntitlements:async(_db:any,_owner:string,options:any)=>{refreshes.push(options);return{refreshed:false};},
    fetchPaidPurchaseRecovery:async(c:any,tx:string,key:string)=>{recoveries.push({config:c,tx,key});return{source:'revenuecat_v2',transactionId:tx,productId:product,state:'verified'};},
    fetch:async(url:string,options:any)=>{gets.push({url,authorization:options.headers.Authorization});return Response.json({request_date_ms:Date.now(),subscriber:{entitlements:{},subscriptions:{}}});}
  },{timeout:1000});
  const response=await handler(new Request('https://fixture.invalid/plus-api',{method:'POST',headers:{authorization:'Bearer fixture-user','content-type':'application/json'},body:JSON.stringify({action,...(hint?{purchase:hint}:{})})}));
  assert.equal(JSON.stringify(ledger),initialLedger);assert.deepEqual(balance,{available:17,reserved:0});
  return{status:response.status,body:await response.json(),gets,recoveries,writes,refreshes};
}
async function main(){
  const both={REVENUECAT_SECRET_API_KEY:'v1-fixture',REVENUECAT_V2_SECRET_API_KEY:'v2-fixture'};
  const hint={productId:product,transactionId:'verified-tx',attemptedAt:new Date().toISOString()};
  for(const action of ['sync','restore']){
    const subscriber=await request({REVENUECAT_SECRET_API_KEY:both.REVENUECAT_SECRET_API_KEY},action);
    assert.equal(subscriber.status,200);assert.equal(subscriber.gets.length,1);assert.equal(subscriber.gets[0].authorization,'Bearer v1-fixture');assert.match(subscriber.gets[0].url,/\/v1\/subscribers\//);assert.equal(subscriber.recoveries.length,0);
    const recovered=await request(both,action,hint);assert.equal(recovered.status,200);assert.equal(recovered.recoveries.length,1);assert.equal(recovered.recoveries[0].key,'v2-fixture');assert.equal(recovered.gets[0].authorization,'Bearer v1-fixture');assert.deepEqual(recovered.writes,['apply_nearr_paid_recovery','apply_nearr_paid_subscriber']);assert.equal(recovered.body.purchaseVerification.state,'verified');
    const missing=await request({REVENUECAT_SECRET_API_KEY:both.REVENUECAT_SECRET_API_KEY},action,hint);assert.equal(missing.status,503);assert.equal(missing.body.error,'purchase_verification_pending');assert.equal(missing.gets.length,0);assert.equal(missing.recoveries.length,0);assert.equal(missing.writes.length,0);
  }
  const v2only=await request({REVENUECAT_V2_SECRET_API_KEY:both.REVENUECAT_V2_SECRET_API_KEY});assert.equal(v2only.status,503);assert.equal(v2only.body.error,'store_verification_unavailable');assert.equal(v2only.gets.length,0);assert.equal(v2only.recoveries.length,0);assert.equal(v2only.writes.length,0);
  const status=await request(both,'status');assert.equal(status.status,200);assert.equal(status.refreshes[0].revenueCatSecret,'v1-fixture');assert.equal(status.gets.length,0);assert.equal(status.recoveries.length,0);
  console.log('8 actual paid API credential-routing scenarios passed: v1/v2 separation, sync/restore, missing-key denial, unchanged existing ledger; no live requests.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
