import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import React from 'react';
import * as translations from '../lib/i18nEngine';
import {paidPreviewFixture} from '../lib/paidPreviewFixtures';
import {paidMonetizationKeys,paidMonetizationTranslations} from '../locales/paidMonetization';
import {paidUsage,receiptMatches} from '../lib/paidClientModel';
import {reconcilePurchaseHint} from '../lib/paidFindPolicy';
import {PLUS_PRODUCT_ID,verifyPaidSubscriber,hasVerifiedPlusAccess} from '../lib/plusEntitlements';
const Module=require('node:module'), originalLoad=Module._load;
const storage=new Map<string,string>(); let owner='alice',status:any,offline=false,verification='verified',sdkError:any=null;
let sdkLoads=0,purchases=0,restores=0,switchDuringPurchase=false,switchAfterMarker=false,packages:any[]=[];
let omitSdkTransaction=false,subscriptionProof:'fresh'|'old'|'stale'|'none'|'legacy'='fresh',storePurchasedAt=0;
let plusState:any; const calls:any[]=[];
const sdk={configure(){},async logIn(){},async getOfferings(){return{all:{fixture:{availablePackages:packages}}};},
  async purchasePackage(){purchases++;storePurchasedAt=Date.now();if(switchDuringPurchase)owner='bob';if(sdkError)throw sdkError;return{transaction:omitSdkTransaction?undefined:{transactionIdentifier:'new-txn'},customerInfo:{entitlements:{active:{nearr_plus:{}}}}};},
  async restorePurchases(){restores++;return{entitlements:{active:{nearr_plus:{}}}};}};
const supabase={auth:{getSession:async()=>({data:{session:{user:{id:owner,is_anonymous:false}}}})},functions:{invoke:async(_name:string,{body}:any)=>{
  calls.push(body);if(offline)return{error:new Error('offline')};if(body.action==='event')return{data:{ok:true}};
  // Exercise the real server reconciler, including its allowlist and actual
  // subscription verification parser. Only native/network/database boundaries
  // are fixtures; never fabricate a successful purchaseVerification response.
  const hint=body.purchase, now=Date.now();let snapshot=null;let records:any[]=[];
  if(hint?.productId===PLUS_PRODUCT_ID && verification!=='pending' && subscriptionProof!=='none'){
    const productId=subscriptionProof==='legacy'?'nearr_plus_monthly_v1':PLUS_PRODUCT_ID;
    const start=new Date(subscriptionProof==='old'?now-86400000:storePurchasedAt||now).toISOString();
    const end=new Date(now+86400000).toISOString();
    const payload={request_date_ms:subscriptionProof==='stale'?now-16*60_000:now,subscriber:{
      entitlements:{nearr_plus:{product_identifier:productId,expires_date:end}},
      subscriptions:{[productId]:{store:'app_store',is_sandbox:true,ownership_type:'PURCHASED',
        store_transaction_id:verification==='wrong'||subscriptionProof==='old'?'old-txn':'new-txn',
        purchase_date:start,expires_date:end,period_type:'normal',...(verification==='revoked'?{refunded_at:new Date(now).toISOString()}:{})}}}};
    try{snapshot=verifyPaidSubscriber(payload,{entitlementId:'nearr_plus',productId:PLUS_PRODUCT_ID,environment:'SANDBOX'},now).snapshot;}
    catch{return{error:new Error('store_verification_unavailable')};}
  }else if(hint&&verification!=='pending')records=[{productId:hint.productId,transactionId:verification==='wrong'?'old-txn':'new-txn',purchasedAt:new Date(now).toISOString(),state:verification==='revoked'?'revoked':'verified'}];
  if(snapshot)status={...status,entitlement:snapshot,usage:{...status.usage,unlimited:hasVerifiedPlusAccess(snapshot,now),paid:hasVerifiedPlusAccess(snapshot,now)}};
  return{data:{...status,purchaseVerification:reconcilePurchaseHint(hint,records,snapshot,now)}};
}}};
Module._load=function(request:string,parent:any,isMain:boolean){
  if(request==='expo-constants')return{__esModule:true,default:{expoConfig:{extra:{revenueCatIosApiKey:'appl_fixture_only'}}}};
  if(request==='expo-crypto')return{randomUUID:()=> 'fixture-event'};
  if(request==='@react-native-async-storage/async-storage')return{__esModule:true,default:{getItem:async(k:string)=>storage.get(k)??null,setItem:async(k:string,v:string)=>{storage.set(k,v);if(switchAfterMarker)owner='bob';},removeItem:async(k:string)=>{storage.delete(k);}}};
  if(request==='react-native-purchases'){sdkLoads++;return{default:sdk};}
  if(request==='./supabase'&&/plusClient/.test(parent?.filename??''))return{supabase};
  if(request==='react-native')return{Platform:{OS:'ios'},AppState:{addEventListener:()=>({remove(){}})},Text:'Text',View:'View',ScrollView:'ScrollView',ActivityIndicator:'ActivityIndicator',Linking:{openURL:async()=>{}}};
  if(request==='./useAuth'&&/usePlus/.test(parent?.filename??''))return{useAuth:()=>({user:{id:owner,is_anonymous:false}})};
  if(request==='expo-router')return{useRouter:()=>({back(){},push(){}})};
  if(request==='@/lib/i18n')return translations;
  if(request==='@/hooks/useLocale')return{useLocale:()=>({locale:translations.i18n.language})};
  if(request==='@/hooks/usePlus')return{usePlus:()=>plusState};
  if(request==='@/lib/theme')return{useTheme:()=>({colors:{text:'#172b22',primary:'#35594b',accent:'#d77343'},typography:{}})};
  if(request==='@/components')return{Screen:'Screen',Card:'Card',Button:(p:any)=>React.createElement('Button',p,p.title)};
  if(request.startsWith('@/'))return originalLoad(require.resolve('../'+request.slice(2)),parent,isMain);
  return originalLoad(request,parent,isMain);
};
const tests:string[]=[];async function test(name:string,fn:()=>any){await fn();tests.push(name);console.log('PASS '+name);}
function reset(){owner='alice';offline=false;verification='verified';sdkError=null;switchDuringPurchase=false;switchAfterMarker=false;storage.clear();calls.length=0;
 omitSdkTransaction=false;subscriptionProof='fresh';storePurchasedAt=0;
 status=paidPreviewFixture('free','en-US').status;status.appUserId='np_fixture';status.offeringId='fixture';
 status.tokenProducts=[20,50,200].map(quantity=>({quantity,productId:`com.nearr.tokens.${quantity}.v2`,packageId:`pack${quantity}`}));
 packages=[{identifier:'monthly',packageType:'MONTHLY',product:{identifier:status.productId,subscriptionPeriod:'P1M',productCategory:'SUBSCRIPTION',productType:'AUTO_RENEWABLE_SUBSCRIPTION',price:1.99,priceString:'1,99 €',introPrice:null}},
 ...status.tokenProducts.map((p:any)=>({identifier:p.packageId,packageType:'CUSTOM',product:{identifier:p.productId,subscriptionPeriod:null,productCategory:'NON_SUBSCRIPTION',productType:'CONSUMABLE',price:p.quantity/20,priceString:`LOCAL ${p.quantity}`}}))];}
async function main(){try{
 const client=require('../lib/plusClient') as typeof import('../lib/plusClient');
 await test('catalog rejects legacy capped, free-only, disabled, unqualified and age-ineligible responses without StoreKit',async()=>{
  for(const patch of [{plusFinds:10},{releaseMode:'free_only'},{catalogVerified:false},{subscriptionBenefit:undefined},{salesEnabled:false},{purchaseEligible:false}]){reset();Object.assign(status,patch);const before=sdkLoads;assert.deepEqual(await client.loadPaidCatalog(owner,status),{subscription:null,tokens:[]});assert.equal(sdkLoads,before);}
 });
 await test('actual Store strings, exact monthly no-trial subscription and all three consumables are required',async()=>{
  reset();let catalog=await client.loadPaidCatalog(owner,status);assert.equal(catalog.subscription?.price,'1,99 €');assert.deepEqual(catalog.tokens.map(p=>[p.quantity,p.price]),[[20,'LOCAL 20'],[50,'LOCAL 50'],[200,'LOCAL 200']]);
  for(const patch of [{introPrice:{}},{productType:'NON_RENEWABLE_SUBSCRIPTION'},{subscriptionPeriod:'P1Y'},{price:0},{priceString:''}]){reset();Object.assign(packages[0].product,patch);assert.equal((await client.loadPaidCatalog(owner,status)).subscription,null);}
  for(const patch of [{productType:'NON_CONSUMABLE'},{productCategory:'SUBSCRIPTION'},{priceString:''}]){reset();Object.assign(packages[1].product,patch);assert.equal((await client.loadPaidCatalog(owner,status)).tokens.length,0);}
  reset();packages.push(packages[1]);assert.equal((await client.loadPaidCatalog(owner,status)).tokens.length,0);
 });
 await test('malformed balances and old same-pack product-only receipts do not prove success',()=>{
  reset();assert.ok(paidUsage(status.usage));assert.equal(paidUsage({...status.usage,canSubmit:1}),null);assert.equal(paidUsage({...status.usage,free:{...status.usage.free,remaining:3}}),null);
  const hint={productId:'pack',attemptedAt:'2026-10-29T00:00:00Z'};
  assert.equal(receiptMatches(hint,{productId:'pack',state:'verified'}),false);
  assert.equal(receiptMatches(hint,{productId:'pack',state:'verified',transactionId:'old'}),false);
  assert.equal(receiptMatches(hint,{...hint,state:'verified',transactionId:'bound-new'}),true);
 });
 await test('Plus succeeds through real server subscriber verification and reconciliation, clearing pending',async()=>{
  reset();const catalog=await client.loadPaidCatalog(owner,status);const before=purchases;assert.equal((await client.purchasePlus(owner,catalog.subscription!)).outcome,'verified');assert.equal(purchases,before+1);assert.equal(await client.pendingPurchase(owner),null);
  assert.ok(calls.some(c=>c.action==='sync'&&c.purchase.transactionId==='new-txn'));
 });
 await test('Plus old, missing, stale, legacy or mismatched server proof remains pending and blocks duplicate StoreKit',async()=>{
  for(const proof of ['old','none','stale','legacy','wrong'] as const){
   reset();if(proof==='wrong')verification='wrong';else subscriptionProof=proof;
   const offer=(await client.loadPaidCatalog(owner,status)).subscription!;const before=purchases;
   assert.equal((await client.purchasePlus(owner,offer)).outcome,'pending',proof);assert.ok(await client.pendingPurchase(owner),proof);
   assert.equal((await client.purchasePlus(owner,offer)).outcome,'pending');assert.equal(purchases,before+1);
   subscriptionProof='fresh';verification='verified';await client.reconcilePurchase(owner);assert.equal(await client.pendingPurchase(owner),null,proof+' recovers from fresh exact server proof');
  }
 });
 await test('Plus callback without transaction ID requires server attempt binding; old active period cannot resolve it',async()=>{
  reset();omitSdkTransaction=true;subscriptionProof='old';const offer=(await client.loadPaidCatalog(owner,status)).subscription!;
  assert.equal((await client.purchasePlus(owner,offer)).outcome,'pending');const hint=await client.pendingPurchase(owner);assert.ok(hint);assert.equal(hint.transactionId,undefined);
  subscriptionProof='fresh';const reconciled=await client.reconcilePurchase(owner);
  assert.equal(reconciled.purchaseVerification?.attemptedAt,hint.attemptedAt);assert.equal(reconciled.purchaseVerification?.transactionId,'new-txn');assert.equal(await client.pendingPurchase(owner),null);
  reset();omitSdkTransaction=true;const fresh=(await client.loadPaidCatalog(owner,status)).subscription!;assert.equal((await client.purchasePlus(owner,fresh)).outcome,'verified');assert.equal(await client.pendingPurchase(owner),null);
 });
 await test('Plus lost SDK callback recovers via restore using real fresh subscriber proof, with no second charge',async()=>{
  reset();sdkError=new Error('lost StoreKit callback');const offer=(await client.loadPaidCatalog(owner,status)).subscription!;const before=purchases;
  assert.equal((await client.purchasePlus(owner,offer)).outcome,'pending');assert.ok(await client.pendingPurchase(owner));
  const recovered=await client.restorePlus(owner);assert.equal(await client.pendingPurchase(owner),null);assert.equal(hasVerifiedPlusAccess(recovered.entitlement),true);assert.equal(purchases,before+1);
 });
 await test('Plus revoked fresh server transaction clears pending without success',async()=>{
  reset();verification='revoked';const offer=(await client.loadPaidCatalog(owner,status)).subscription!;
  assert.equal((await client.purchasePlus(owner,offer)).outcome,'error');assert.equal(await client.pendingPurchase(owner),null);
 });
 await test('SDK success and existing tokens do not grant credit; pending blocks a second charge until reconciliation',async()=>{
  reset();verification='pending';const pack=(await client.loadPaidCatalog(owner,status)).tokens[0];const before=purchases;
  assert.equal((await client.purchaseTokenPack(owner,pack)).outcome,'pending');assert.equal((await client.purchaseTokenPack(owner,pack)).outcome,'pending');assert.equal(purchases,before+1);
  verification='wrong';await client.reconcilePurchase(owner);assert.ok(await client.pendingPurchase(owner));
  verification='verified';await client.reconcilePurchase(owner);assert.equal(await client.pendingPurchase(owner),null);
 });
 await test('cancel clears recovery marker; deferred/lost callback retains it, account switching cannot grant another user access',async()=>{
  reset();sdkError={userCancelled:true};let pack=(await client.loadPaidCatalog(owner,status)).tokens[0];assert.equal((await client.purchaseTokenPack(owner,pack)).outcome,'cancelled');assert.equal(await client.pendingPurchase(owner),null);
  reset();sdkError={code:20};pack=(await client.loadPaidCatalog(owner,status)).tokens[0];assert.equal((await client.purchaseTokenPack(owner,pack)).outcome,'pending');assert.ok(await client.pendingPurchase(owner));
  reset();switchDuringPurchase=true;pack=(await client.loadPaidCatalog(owner,status)).tokens[0];assert.equal((await client.purchaseTokenPack('alice',pack)).outcome,'pending');assert.ok(await client.pendingPurchase('alice'));assert.equal(await client.pendingPurchase('bob'),null);
 });
 await test('an exactly bound revoked transaction resolves recovery without granting credit',async()=>{
  reset();verification='revoked';const pack=(await client.loadPaidCatalog(owner,status)).tokens[0];
  assert.equal((await client.purchaseTokenPack(owner,pack)).outcome,'error');assert.equal(await client.pendingPurchase(owner),null);
 });
 await test('account switch after marker creation but before StoreKit clears the never-started attempt',async()=>{
  reset();switchAfterMarker=true;const pack=(await client.loadPaidCatalog(owner,status)).tokens[0];const before=purchases;
  assert.equal((await client.purchaseTokenPack('alice',pack)).outcome,'error');assert.equal(purchases,before);
  assert.equal(await client.pendingPurchase('alice'),null);assert.equal(await client.pendingPurchase('bob'),null);
 });
 await test('stale prices, offline access and account mismatch cannot start purchase; restore uses server authority',async()=>{
  reset();let pack=(await client.loadPaidCatalog(owner,status)).tokens[0];const before=purchases;pack={...pack,price:'old'};assert.equal((await client.purchaseTokenPack(owner,pack)).outcome,'error');assert.equal(purchases,before);
  offline=true;await assert.rejects(client.fetchPlusStatus(owner),/plus_unavailable/);offline=false;await assert.rejects(client.fetchPlusStatus('bob'),/account_changed/);
  const r=restores;await client.restorePlus(owner);assert.equal(restores,r+1);assert.equal(calls.filter(c=>c.action==='restore').length,2);
 });
 const Renderer=require('react-test-renderer') as typeof import('react-test-renderer');const Screen=require('../app/plus').default;
 await test('real screen purchase action reports cancellation without credit and returns controls to idle',async()=>{
  reset();sdkError={userCancelled:true};await translations.i18n.changeLanguage('en-US');const catalog=await client.loadPaidCatalog(owner,status);let refreshes=0;
  plusState={...paidPreviewFixture('free','en-US'),userId:owner,status,offer:catalog.subscription,tokenOffers:catalog.tokens,refresh:async()=>{refreshes++;}};
  let screen:any;await Renderer.act(async()=>{screen=Renderer.create(React.createElement(Screen));});
  const buy=screen.root.findAllByType('Button').find((n:any)=>n.props.title===translations.t('Get Nearr Plus'));
  await Renderer.act(async()=>{buy.props.onPress();await new Promise(resolve=>setTimeout(resolve,15));});
  assert.ok(JSON.stringify(screen.toJSON()).includes(translations.t('Purchase cancelled. Nothing has changed.')));
  assert.equal(refreshes,1);assert.equal(buy.props.loading,false);assert.equal(await client.pendingPurchase(owner),null);Renderer.act(()=>screen.unmount());
 });
 await test('real hook retains pending recovery offline and clears prior-account presentation on switch',async()=>{
  reset();const useRealPlus=require('../hooks/usePlus').usePlus;let last:any;const observed:any[]=[];let hook:any;
  function Probe(){last=useRealPlus();observed.push({owner,status:last.status});return null;}
  await Renderer.act(async()=>{hook=Renderer.create(React.createElement(Probe));});assert.ok(last.status);
  storage.set('nearr:pending-store-purchase:v1:alice',JSON.stringify({productId:'pack',attemptedAt:new Date().toISOString()}));offline=true;
  await Renderer.act(async()=>{await last.refresh();});assert.equal(last.status,null);assert.equal(last.purchasePending,true);
  owner='bob';await Renderer.act(async()=>{hook.update(React.createElement(Probe));});assert.equal(last.status,null);assert.equal(last.offer,null);assert.equal(last.purchasePending,false);
  assert.ok(observed.filter(x=>x.owner==='bob').every(x=>x.status===null));Renderer.act(()=>hook.unmount());
 });
 let renders=0;const states=['free','active','cancelled','grace','expired','revoked','pending','restricted','unavailable','offline','loading'];
 for(const locale of Object.keys(paidMonetizationTranslations) as (keyof typeof paidMonetizationTranslations)[]){
  await translations.i18n.changeLanguage(locale);
  for(const key of paidMonetizationKeys){const value=paidMonetizationTranslations[locale][key];assert.ok(value);assert.deepEqual(value.match(/{{\w+}}/g)?.sort()??[],key.match(/{{\w+}}/g)?.sort()??[]);assert.equal(translations.i18n.exists(key,{lng:locale}),true);}
  for(const state of states){plusState=paidPreviewFixture(state,locale);let r:any;Renderer.act(()=>{r=Renderer.create(React.createElement(Screen));});const tree=JSON.stringify(r.toJSON());assert.ok(!/{{\w+}}/.test(tree),`${locale}/${state} unresolved placeholder`);
   assert.ok(tree.includes(translations.t('Your saved places stay yours, with or without a subscription.')));
   const buttons=r.root.findAllByType('Button');const buy=buttons.filter((n:any)=>n.props.title===translations.t('Get Nearr Plus')||n.props.title.includes(plusState.tokenOffers[0]?.price??'NO_PRICE'));
   if(state==='pending')assert.ok(buy.every((n:any)=>n.props.disabled));
   if(['restricted','unavailable','offline','loading'].includes(state))assert.equal(buy.length,0);
   if(state==='restricted')assert.ok(tree.includes(translations.t('Purchases are unavailable under this account’s age and country settings.')));
   if(['active','cancelled','grace'].includes(state)){assert.ok(tree.includes(translations.t('Nearr Plus is active')));assert.ok(tree.includes(translations.t('Purchased tokens: {{count}}',{count:47})));}
   assert.equal(r.root.findAllByType('Text').filter((n:any)=>n.props.numberOfLines!=null).length,0,'paid copy must wrap');
   if([['en-US','free'],['de','pending'],['ja','active'],['ko','revoked'],['zh-Hans','unavailable']].some(([l,s])=>l===locale&&s===state)){
    const folder='artifacts/global-release/paid-launch/client/component-trees';mkdirSync(folder,{recursive:true});
    writeFileSync(`${folder}/${locale}-${state}.json`,JSON.stringify({kind:'react-test-renderer component tree, not pixels or native screenshot',locale,state,tree:r.toJSON()},null,2)+'\n');
   }
   Renderer.act(()=>r.unmount());renders++;
  }
 }
 const route=readFileSync('app/dev-qa.tsx','utf8');assert.ok(route.indexOf('if (!isOnboardingV2DevelopmentResetAvailable())')<route.indexOf("if (__DEV__ && typeof params.paid"));
 assert.match(readFileSync('components/PaidFindsNativePreview.tsx','utf8'),/!__DEV__\|\|!isOnboardingV2DevelopmentResetAvailable\(\)/);
 const Content=require('../app/plus').PaidFindsContent;let preview:any;Renderer.act(()=>{preview=Renderer.create(React.createElement(Content,{plus:paidPreviewFixture('free','en-US'),preview:true}));});
 const before=purchases;for(const button of preview.root.findAllByType('Button')){if(button.props.title===translations.t('Get Nearr Plus'))await Renderer.act(async()=>button.props.onPress());}assert.equal(purchases,before);Renderer.act(()=>preview.unmount());
 tests.push(`${renders} real screen locale/state component renders; 10 complete translated catalogs; Development preview gated and inert`);
 mkdirSync('artifacts/global-release/paid-launch/client',{recursive:true});writeFileSync('artifacts/global-release/paid-launch/client/runtime-tests.json',JSON.stringify({createdAt:new Date().toISOString(),kind:'isolated native/network boundary mocks, not StoreKit or device evidence',tests,renders,sdkPurchaseCalls:purchases,realStorePurchases:0},null,2)+'\n');
 console.log(`PASS ${tests.length} groups; ${renders} real-screen renders; no live purchases or network`);
 }finally{Module._load=originalLoad;await translations.i18n.changeLanguage('en-US');}}
void main().catch(e=>{console.error(e);process.exitCode=1;});
