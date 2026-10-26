// Run the repository's existing prebuild matrix without hiding later failures
// behind an early source-contract assertion. Does not enable live-provider tests.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const requested=process.argv.slice(2);
const scripts=requested.length ? requested : [...new Set(['pretest:prebuild','test:prebuild','test:fieldnotes-oct15'].flatMap(name => [...pkg.scripts[name].matchAll(/npm run ([\w:-]+)/g)].map(match => match[1])).concat(['test:global-eligibility-db','test:global-monetization','test:global-monetization-db']))];
const output='artifacts/global-release/validation';
mkdirSync(output,{recursive:true});
const results=[];
let next=0;
const npmCli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
async function worker() {
  while(next<scripts.length) {
    const name=scripts[next++];
    if(!pkg.scripts[name]) throw new Error('Unknown script '+name);
    const logfile=path.join(output,name.replaceAll(':','-')+'.log');
    const stream=createWriteStream(logfile);
    const started=Date.now();
    const exit=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[npmCli,'run',name],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1'}});
      child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
      child.on('error',reject);child.on('close',code=>resolve(code??-1));
    });
    await new Promise(resolve=>stream.end(resolve));
    results.push({name,exit,durationMs:Date.now()-started,logfile});
    writeFileSync(path.join(output,'matrix-results.json'),JSON.stringify({startedAt:new Date().toISOString(),total:scripts.length,completed:results.length,passed:results.filter(r=>r.exit===0).length,failed:results.filter(r=>r.exit!==0).length,results},null,2)+'\n');
    console.log(`${exit===0?'PASS':'FAIL'} ${name} (${results.length}/${scripts.length})`);
  }
}
await Promise.all([worker(),worker(),worker()]);
process.exitCode=results.some(result=>result.exit!==0)?1:0;
