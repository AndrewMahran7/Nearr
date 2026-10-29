/** Local-only candidate manifest. Does NOT authorize or execute a cutover. */
const {readFileSync,readdirSync,writeFileSync}=require('node:fs');
const {join,relative}=require('node:path');
const {createHash}=require('node:crypto');
const {output,root}=require('./finalBackendReadiness.cjs');
const dir=join(output,'containment');
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const walk=folder=>readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(folder,e.name)):[join(folder,e.name)]);
const rel=file=>relative(root,file).replaceAll('\\','/');
const sources=[join(dir,'pause-queue.sql'),...walk(join(dir,'edge')),...walk(join(dir,'worker'))];
const receipts=readdirSync(dir).filter(f=>/^restore-tests-.*\.json$/.test(f)).sort();
const latest=JSON.parse(readFileSync(join(dir,receipts.at(-1)),'utf8'));
if(!latest.passed||!latest.containment?.passed||latest.containment.sqlSha256!==sha(join(dir,'pause-queue.sql')))throw new Error('Missing passing exact-SQL restored-copy receipt');
const worker=JSON.parse(readFileSync(join(dir,'worker-tests.json'),'utf8'));
if(!worker.passed||worker.sourceSha256!==sha(join(dir,'worker/server.cjs')))throw new Error('Missing passing exact-worker receipt');
const container=JSON.parse(readFileSync(join(dir,'container-tests.json'),'utf8'));
if(!container.passed||!container.containerRemoved||Object.entries(container.sourceHashes).some(([name,hash])=>hash!==sha(join(dir,'worker',name))))throw new Error('Missing passing exact-container receipt');
const auxiliary=join(output,'.tmp/production-auxiliary-containment/supabase/functions');
const result={
  generatedAt:new Date().toISOString(),status:'LOCAL_TESTED_CANDIDATE_NOT_DEPLOYED',remoteMutations:[],
  authority:'Original tested temporary-recognition-pause approval is recorded. Independent review completed; global client-plus-server zero dispatch is not proved. Revised server-only scope requires separate human authorization. No permission to enable providers or deploy full1.7.',
  target:{supabaseRef:'rlqvxdwtetxsqxhqztkw',railwayProject:'4037a3b5-d66f-409e-b734-56c22c244e3e',railwayEnvironment:'49650a9c-4744-4649-8cd1-4ff38473d22f',railwayService:'59234570-e2ec-4a7e-86de-22826da86c66',expectedActiveDeployment:'6e78ebe9-58f7-4799-a90e-86238a1b14e9',expectedActiveSource:'e9daf499cfb276ea7072b651642a04218b90ccf9',domain:'nearr-production.up.railway.app',port:8080,replicas:{sfo:1}},
  sources:sources.map(file=>({path:rel(file),sha256:sha(file)})),
  databaseTests:{receipt:rel(join(dir,receipts.at(-1))),passed:latest.containment.tests.length,archiveSha256:latest.archiveSha256,scope:latest.containment.scope},
  workerTests:{receipt:rel(join(dir,'worker-tests.json')),passed:worker.tests.length,scope:worker.scope},
  containerTests:{receipt:rel(join(dir,'container-tests.json')),passed:container.probes.length,imageId:container.imageId,baseImage:container.baseImage,scope:container.scope},
  auxiliarySourceClosure:{downloadCompleted:true,files:walk(auxiliary).map(file=>({path:relative(auxiliary,file).replaceAll('\\','/'),sha256:sha(file)}))},
  deploymentPackaging:{edgeDirectory:rel(join(dir,'edge')),workerRootDirectory:'/artifacts/global-release/final-production/backend/containment/worker',railwayConfigFile:'/artifacts/global-release/final-production/backend/containment/worker/railway.toml',requiredSource:'Pin exact reviewed candidate Git commit on release/nearr-1.7-app-store-final in Production; never follow main or reuse legacy image',privateArchiveUploadAllowed:false},
  remainingGates:['Human decision on revised server-only containment with unresolved legacy-client risk; original approval does not waive this scope change','Global closure remains unproved after completed independent review: exact signed IPA unavailable404 and OTA bundle unavailable403; no repeated original-IPA request','Freeze and push exact candidate commit; stage Production-only pinned source/root/config/disabled flags together','Fresh private backup at a new exclusive destination plus aggregate/ownership and deployment-drift preflight','After execution verify all new Edge versions, paused responses, ready503/health200, zero new server claims/dispatch, old deployment/replica retirement and unchanged non-AI contracts; do not claim global client closure'],
  limitations:['Historical backup does not include subsequent live writes','No live Auth/photo/reminder/device end-to-end claim','No Storage object-byte recovery','Existing in-flight external requests cannot be recalled','Recognition-result notifications/receipts pause; attempt markers and at-most-once functions preserved','Old1.4 clients show generic manual help, not explicit pause-message copy','No unsigned-source inference of credential absence in signed iOS bundle'],
};
writeFileSync(join(dir,'candidate-manifest.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,sources:result.sources,databaseTests:result.databaseTests,workerTests:result.workerTests}));
