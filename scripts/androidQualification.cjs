// Real Android device actions and unmodified evidence; no app fixture entrypoint.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const adbPath = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const output = path.join(root, 'artifacts/global-release/android-qualification');
async function adb(...args) {
  return (await run(adbPath, ['-s', 'emulator-5554', ...args], { windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' })).stdout.trim();
}
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
async function ui() {
  const dumped = await adb('shell', 'uiautomator', 'dump', '/sdcard/nearr-android-qualification.xml');
  // Android can exit 0 when the new window is not idle. Never read the previous
  // dump in that case (especially across force-stop/relaunch).
  if (!dumped.includes('dumped to:')) throw new Error('Android UI snapshot not ready');
  const xml = await adb('exec-out', 'cat', '/sdcard/nearr-android-qualification.xml');
  return [...xml.matchAll(/<node\b([^>]+)>/g)].map((match, index) => {
    const p = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
    return { index, text: p.text, label: p['content-desc'], id: p['resource-id'], class: p.class, bounds: p.bounds, clickable: p.clickable === 'true', enabled: p.enabled === 'true', focused: p.focused === 'true' };
  });
}
async function tap(node) {
  if (!node?.bounds) throw new Error('Select a node from the latest UI observation');
  const [x1,y1,x2,y2] = node.bounds.match(/\d+/g).map(Number);
  await adb('shell', 'input', 'tap', String(Math.round((x1+x2)/2)), String(Math.round((y1+y2)/2)));
}
async function waitFor(text, timeout = 25000) {
  const start = Date.now();
  do {
    try {
      const nodes = await ui();
      if (nodes.some(n => n.text.includes(text) || n.label.includes(text))) return { elapsedMs: Date.now()-start, nodes };
    } catch (error) { if (error.message !== 'Android UI snapshot not ready') throw error; }
  } while (Date.now()-start < timeout);
  throw new Error(`UI did not contain ${text} within ${timeout}ms`);
}
async function screenshot(name) {
  if (!/^[\w-]+$/.test(name)) throw new Error('Invalid evidence name');
  const directory = path.join(output, 'screenshots'); mkdirSync(directory, { recursive:true });
  const { stdout } = await run(adbPath, ['-s','emulator-5554','exec-out','screencap','-p'], { windowsHide:true, encoding:'buffer', timeout:30000, maxBuffer:16*1024*1024 });
  const file = path.join(directory, `${name}.png`); writeFileSync(file, stdout); return file;
}
module.exports = { adb, ui, tap, waitFor, screenshot, root, output };
