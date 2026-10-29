/** Actual Expo config -> actual Plus client -> inert native SDK boundary. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {paidPreviewFixture} from '../lib/paidPreviewFixtures';
const Module=require('node:module'), originalLoad=Module._load;
const source=readFileSync('app.config.js','utf8');
const base=JSON.parse(readFileSync('app.json','utf8')).expo;
function generate(env:Record<string,string|undefined>={}, extra:Record<string,unknown>={}) {
  const module={exports:null as any};
  vm.runInNewContext(source,{module,process:{env},URL},{filename:'app.config.js',timeout:1000});
  return module.exports({config:{...base,extra:{...base.extra,...extra}}});
}
let config:any, platform='ios', sdkLoads=0, configured:any[]=[];
const status:any={...paidPreviewFixture('free','en-US').status,appUserId:'np_fixture',offeringId:'fixture'};
status.tokenProducts=[20,50,200].map(quantity=>({quantity,productId:`com.nearr.tokens.${quantity}.v2`,packageId:`pack${quantity}`}));
const packages=[{identifier:'monthly',packageType:'MONTHLY',product:{identifier:status.productId,subscriptionPeriod:'P1M',productCategory:'SUBSCRIPTION',productType:'AUTO_RENEWABLE_SUBSCRIPTION',price:1.99,priceString:'STORE FIXTURE',introPrice:null}},
  ...status.tokenProducts.map((p:any)=>({identifier:p.packageId,product:{identifier:p.productId,subscriptionPeriod:null,productCategory:'NON_SUBSCRIPTION',productType:'CONSUMABLE',price:1,priceString:'STORE FIXTURE'}}))];
const sdk={configure:(value:any)=>configured.push(value),getOfferings:async()=>({all:{fixture:{availablePackages:packages}}})};
Module._load=function(request:string,parent:any,isMain:boolean){
  if(request==='expo-constants')return{__esModule:true,default:{expoConfig:config}};
  if(request==='expo-crypto')return{randomUUID:()=> 'fixture-event'};
  if(request==='react-native')return{Platform:{OS:platform}};
  if(request==='@react-native-async-storage/async-storage')return{__esModule:true,default:{getItem:async()=>null}};
  if(request==='react-native-purchases'){sdkLoads++;return{default:sdk};}
  if(request==='./supabase'&&/plusClient/.test(parent?.filename??''))return{
    supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'owner',is_anonymous:false}}}})}}
  };
  return originalLoad(request,parent,isMain);
};
function client(){delete require.cache[require.resolve('../lib/plusClient')];sdkLoads=0;configured=[];return require('../lib/plusClient') as typeof import('../lib/plusClient');}
let checks=0;
async function check(name:string,fn:()=>unknown){await fn();checks++;console.log('PASS '+name);}
async function main(){try{
  await check('actual public env reaches Purchases.configure through generated Expo extra',async()=>{
    config=generate({EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:'  appl_ConfigFixture123  '});
    assert.equal(config.extra.revenueCatIosApiKey,'appl_ConfigFixture123');
    const result=await client().loadPaidCatalog('owner',status);
    assert.equal(sdkLoads,1);assert.deepEqual(configured,[{apiKey:'appl_ConfigFixture123',appUserID:'np_fixture'}]);
    assert.ok(result.subscription);assert.equal(result.tokens.length,3);
  });
  for(const [name,env,extra] of [
    ['missing',{},{}],['empty',{EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:''},{}],
    ['whitespace',{EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:' \n '},{}],
    ['no server credential fallback',{REVENUECAT_SECRET_API_KEY:'sk_ServerFixture',REVENUECAT_V2_SECRET_API_KEY:'sk_V2Fixture',REVENUECAT_WEBHOOK_SECRET:'webhookFixture'},{}],
    ['no stale app.json key fallback',{}, {revenueCatIosApiKey:'appl_StaleFixture'}],
  ] as [string,Record<string,string>,Record<string,unknown>][]){
    await check(name+' leaves StoreKit closed before native SDK load',async()=>{
      config=generate(env,extra);assert.equal(config.extra.revenueCatIosApiKey,'');
      await assert.rejects(client().loadPaidCatalog('owner',status),/plus_store_unavailable/);
      assert.equal(sdkLoads,0);assert.equal(configured.length,0);
      assert.doesNotMatch(JSON.stringify(config),/sk_ServerFixture|sk_V2Fixture|webhookFixture/);
    });
  }
  for(const key of ['sk_SecretFixture','goog_AndroidFixture','test_TestStoreFixture','appl_','appl_has space','appl_embedded\nnewline']){
    await check('wrong or malformed public slot is rejected without value disclosure',()=>{
      let error:any;try{generate({EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:key});}catch(value){error=value;}
      assert.ok(error);assert.match(error.message,/REVENUECAT_CONFIG/);
      // The prefix-only empty key occurs in the explanatory format label.
      if(key!=='appl_')assert.equal(error.message.includes(key),false);
    });
  }
  await check('valid config does not bypass server catalog qualification',async()=>{
    config=generate({EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:'appl_ConfigFixture123'});
    assert.deepEqual(await client().loadPaidCatalog('owner',{...status,catalogVerified:false}),{subscription:null,tokens:[]});assert.equal(sdkLoads,0);
  });
  await check('public Apple config does not enable Android StoreKit',async()=>{
    platform='android';config=generate({EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:'appl_ConfigFixture123'});
    await assert.rejects(client().loadPaidCatalog('owner',status),/plus_store_unavailable/);assert.equal(sdkLoads,0);platform='ios';
  });
  console.log(`${checks} actual Expo-to-RevenueCat SDK configuration checks passed; no live SDK or network.`);
}finally{Module._load=originalLoad;delete require.cache[require.resolve('../lib/plusClient')];}}
main().catch(error=>{console.error(error);process.exitCode=1;});
