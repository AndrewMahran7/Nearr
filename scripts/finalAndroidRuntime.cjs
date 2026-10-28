// Focused standalone Android checks. No Metro, provider, cloud mutation,
// source fixture entrypoint, or synthetic notification receiver is used.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts/global-release/final-production/android');
const adbPath = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const pkg = 'com.nearr.app';
fs.mkdirSync(output, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n');
async function adb(...args) {
  return (await run(adbPath, ['-s', 'emulator-5554', ...args], { windowsHide: true, timeout: 30000, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' })).stdout.trim();
}
async function ui() {
  const result = await adb('shell', 'uiautomator', 'dump', '/sdcard/nearr-final-android.xml');
  if (!result.includes('dumped to:')) throw new Error('UI not idle; stale dump rejected');
  const xml = await adb('exec-out', 'cat', '/sdcard/nearr-final-android.xml');
  return [...xml.matchAll(/<node\b([^>]+)>/g)].map(m => {
    const p = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(n => [n[1], n[2].replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&apos;', "'")]));
    return { text: p.text, label: p['content-desc'], bounds: p.bounds, id: p['resource-id'], enabled: p.enabled === 'true', clickable: p.clickable === 'true', focused: p.focused === 'true', class: p.class };
  });
}
async function waitFor(text, timeout = 30000) {
  const start = Date.now();
  do {
    try { const nodes = await ui(); if (nodes.some(n => n.text.includes(text) || n.label.includes(text))) return { elapsedMs: Date.now() - start, nodes }; }
    catch (e) { if (e.message !== 'UI not idle; stale dump rejected') throw e; }
  } while (Date.now() - start < timeout);
  throw new Error('Expected UI not found: ' + text);
}
async function tap(node) {
  if (!node?.bounds) throw new Error('Fresh observed target required');
  const [x1,y1,x2,y2] = node.bounds.match(/\d+/g).map(Number);
  await adb('shell', 'input', 'tap', String(Math.round((x1+x2)/2)), String(Math.round((y1+y2)/2)));
}
async function screenshot(name) {
  if (!/^[\w-]+$/.test(name)) throw new Error('Invalid screenshot name');
  const { stdout } = await run(adbPath, ['-s','emulator-5554','exec-out','screencap','-p'], { windowsHide: true, encoding: 'buffer', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const file = path.join(output, name + '.png'); fs.writeFileSync(file, stdout); return file;
}
async function cold(text) {
  await adb('shell', 'am', 'force-stop', pkg);
  const start = Date.now();
  const launch = await adb('shell', 'am', 'start', '-W', '-n', pkg + '/.MainActivity');
  await waitFor(text);
  return { observedAt: new Date().toISOString(), observedReadyMs: Date.now() - start, launch, pid: await adb('shell', 'pidof', pkg) };
}
async function snapshot(name) {
  const lastAnr = await adb('shell', 'dumpsys', 'activity', 'lastanr');
  const appMemory = await adb('shell', 'dumpsys', 'meminfo', pkg);
  const threadInfo = await adb('shell', 'ps', '-T', '-A', '-o', 'PID,TID,NAME,STAT');
  const pid = await adb('shell', 'pidof', pkg).catch(() => '');
  const pressure = async kind => adb('shell','cat','/proc/pressure/'+kind).catch(() => 'Not accessible to shell on this Google Play image');
  const receipt = { observedAt: new Date().toISOString(), lastAnr, hostFreeMiB: Math.round(os.freemem()/1048576), guestMemoryPressure: await pressure('memory'), guestCpuPressure: await pressure('cpu'), appMemory, threads: threadInfo.split('\n').filter(l => (pid && l.trim().startsWith(pid + ' ')) || /PID\s+TID/.test(l)) };
  write(name, receipt); return receipt;
}
function startPressure(durationMs = 45000) {
  if (durationMs > 45000) throw new Error('Pressure is bounded to45seconds');
  const initialFreeMiB = Math.round(os.freemem()/1048576);
  if (initialFreeMiB < 1500) throw new Error('Not enough host headroom for bounded pressure');
  const workers = Array.from({length:2}, () => new Worker(`const {parentPort,workerData}=require('node:worker_threads'); const end=Date.now()+workerData; const memory=Buffer.alloc(64*1024*1024,1); let value=0; (function tick(){if(Date.now()>=end){parentPort.postMessage({done:true,value,bytes:memory.length});return;} const until=Date.now()+60; while(Date.now()<until)value=Math.sqrt(value+Math.random()); setTimeout(tick,40);})();`, { eval:true, workerData:durationMs }));
  let minimumFreeMiB = initialFreeMiB;
  const timer = setInterval(() => { minimumFreeMiB = Math.min(minimumFreeMiB, Math.round(os.freemem()/1048576)); if (minimumFreeMiB < 750) for (const w of workers) void w.terminate(); }, 500);
  const done = Promise.all(workers.map(w => new Promise(resolve => w.on('exit', resolve)))).then(codes => { clearInterval(timer); return { durationLimitMs:durationMs, workerCount:2, dutyCycle:0.6, allocatedMiB:128, initialFreeMiB, minimumFreeMiB, workerExitCodes:codes }; });
  return { done, stop:async()=>{await Promise.all(workers.map(w=>w.terminate()));clearInterval(timer);} };
}
module.exports = { adb, ui, tap, waitFor, screenshot, cold, snapshot, startPressure, output, write };
