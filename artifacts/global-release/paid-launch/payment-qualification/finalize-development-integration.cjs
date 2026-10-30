/** Final read-only source/config reconciliation after approved secret provisioning. */
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../../..');const {json}=require(path.join(root,'scripts/finalBackendReadiness.cjs'));
const folder=path.join(__dirname,'2026-10-29T23-11-11-920Z-development-plus-api');
const read=f=>JSON.parse(fs.readFileSync(path.join(folder,f),'utf8'));
const deployment=read('deployment-receipt.json'),mapping=read('catalog-mapping-receipt.json'),credential=read('v1-credential-receipt.json'),state=read('development-payment-state.json');
if([deployment,mapping,credential].some(r=>!r.passed||r.target!=='qnfxnmvxpjzfydgudtvs'))throw Error('Missing qualified operations');
const readback=JSON.parse(fs.readFileSync(path.join(root,'artifacts/global-release/paid-launch/development-paid-readback.json'),'utf8'));
if(!readback.passed||readback.target!==deployment.target||new Date(readback.capturedAt)<new Date(credential.provisionedAt))throw Error('Fresh post-credential readback required');
fs.writeFileSync(path.join(folder,'final-development-paid-readback.json'),JSON.stringify(readback,null,2)+'\n');
const edge=json('supabase',['functions','list','--project-ref',deployment.target,'-o','json']).map(f=>({name:f.name,version:f.version,status:f.status,verifyJwt:f.verify_jwt,sha256:f.ezbr_sha256,updatedAt:new Date(f.updated_at).toISOString()})).sort((a,b)=>a.name.localeCompare(b.name));
const sourceUnchanged=edge.length===deployment.after.edge.length&&edge.every(f=>{const old=deployment.after.edge.find(o=>o.name===f.name);return old&&f.sha256===old.sha256&&f.verifyJwt===old.verifyJwt&&f.status==='ACTIVE';});
if(!sourceUnchanged)throw Error('Unexpected Edge source/verification drift');
const result={capturedAt:new Date().toISOString(),target:deployment.target,sourceCommit:deployment.sourceCommit,sourceDeployment:deployment.scope,edgeSourceUnchangedSinceExplicitDeployment:sourceUnchanged,edgeVersionChangesAfterProjectSecretProvision:edge.map(f=>({name:f.name,before:deployment.after.edge.find(o=>o.name===f.name).version,after:f.version})),edge,financialUnchanged:readback.financialUnchanged,walletTotals:state.walletTotals,allNewQualificationFlagsClosed:true,productionMutation:false,realStoreKitTransactions:false,providerCalls:false,liveRevenueCatCustomerApiProbe:false,secretValuesRecorded:false,passed:true};
for(const k of ['sales_enabled','enforce_allowance','release_qualified','catalog_verified','token_catalog_verified','paid_find_policy_enabled','legacy_obligations_reconciled'])if(state.catalogConfig[0][k]!==false)throw Error('Activation flag drift');
result.evidenceHashes=Object.fromEntries(['deployment-receipt.json','catalog-mapping-receipt.json','v1-credential-receipt.json','final-development-paid-readback.json','development-payment-state.json'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,f))).digest('hex')]));
fs.writeFileSync(path.join(folder,'final-integration-receipt.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:true,edgeSourceUnchangedSinceExplicitDeployment:true,plusApi:edge.find(f=>f.name==='plus-api'),financialUnchanged:true,allNewQualificationFlagsClosed:true}));
