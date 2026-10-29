// Local Development Metro + actual emulator framebuffer; no backend credentials printed.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/global-release/paid-launch/client/android');
const adb=path.join(process.env.LOCALAPPDATA,'Android/Sdk/platform-tools/adb.exe');
const run=(...args)=>cp.execFileSync(adb,['-s','emulator-5554',...args],{encoding:'utf8',windowsHide:true,timeout:30000}).trim();
fs.mkdirSync(out,{recursive:true});
const mode=process.argv[2];
if(mode==='metro'){
 const cache='C:/Users/andre/.codex/worktrees/nearr-android-qualification/Nearr';
 require('@expo/env').load(cache,{silent:true});
 if(process.env.EXPO_PUBLIC_BACKEND_ENV!=='development'||new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).hostname!=='qnfxnmvxpjzfydgudtvs.supabase.co')throw Error('Development backend required');
 Object.assign(process.env,{EXPO_PUBLIC_APP_ENV:'development',EXPO_PUBLIC_MAP_PREVIEW_MODE:'true',CI:'1',EXPO_OFFLINE:'1',EXPO_NO_DOCTOR:'1'});
 // Only this QA process sees the actual target of the ignored dependency junction.
 // Do not modify Metro configuration or installed packages for shipping builds.
 const hook=path.join(root,'.tmp/paid-metro-resolver.cjs');
 fs.writeFileSync(hook,`const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
 const original=Module._load,root=${JSON.stringify(root)},target=fs.realpathSync(path.join(root,'node_modules'));
 Module._load=function(request,parent,isMain){const result=original.apply(this,arguments);
 if(request===path.join(root,'metro.config.js')){result.watchFolders=[...new Set([...(result.watchFolders||[]),target])];result.resolver.nodeModulesPaths=[target,...(result.resolver.nodeModulesPaths||[])];result.resolver.unstable_enableSymlinks=true;}return result;};\n`);
 const log=fs.openSync(path.join(root,'.tmp/paid-preview-metro.log'),'w');
 const child=cp.spawn(process.execPath,['--require',hook,require.resolve('expo/bin/cli'),'start','--dev-client','--localhost','--port','8082','--max-workers','2'],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore',log,log]});
 fs.writeFileSync(path.join(out,'metro-process.json'),JSON.stringify({pid:child.pid,sourceRoot:root,development:true,fixtureMode:true,startedAt:new Date().toISOString()},null,2));
 console.log('Development Metro started, process '+child.pid);child.on('exit',code=>{process.exitCode=code??1;});
}else if(mode==='capture'){
 const name=process.argv[3];if(!/^[\w-]+$/.test(name))throw Error('Safe capture name required');
 const buffer=cp.execFileSync(adb,['-s','emulator-5554','exec-out','screencap','-p'],{windowsHide:true,timeout:30000,maxBuffer:24*1024*1024});
 if(buffer.subarray(1,4).toString()!=='PNG')throw Error('Not PNG');
 fs.writeFileSync(path.join(out,name+'.png'),buffer);
 fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify({capturedAt:new Date().toISOString(),source:'adb exec-out screencap -p',platform:'Android',device:'existing Pixel 8a API36 emulator',width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20),fontScale:run('shell','settings','get','system','font_scale'),density:run('shell','wm','density'),fixture:true,livePurchaseProof:false,iosEvidence:false,appSource:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),workingTreeEdits:true,sha256:crypto.createHash('sha256').update(buffer).digest('hex')},null,2)+'\n');
 console.log(path.join(out,name+'.png'));
}else throw Error('metro | capture NAME');
