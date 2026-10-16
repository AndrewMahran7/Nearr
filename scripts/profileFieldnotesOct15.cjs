// Matched Android debug observations. No backend writes; not release/iOS proof.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw Error('Pass before or after.');
const root = path.resolve(__dirname, '../artifacts/fieldnotes-oct15');
const captureRoot = path.join(root, `performance-${phase}`);
fs.mkdirSync(captureRoot, { recursive: true });
const output = path.join(root, `performance-${phase}.json`);
const zoomOnly = process.argv.includes('--zoom-only');
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const device = 'emulator-5554';
const command = (...args) => cp.execFileSync(adb, ['-s', device, ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const decode = value => value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const parseNodes = xml => [...xml.matchAll(/<node\s+([^>]+)>/g)].map(match => {
  const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(part => [part[1], decode(part[2])]));
  const bounds = (attrs.bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  return { ...attrs, rect: bounds ? bounds.slice(1).map(Number) : null };
}).filter(node => node.rect && node.rect[2] > node.rect[0] && node.rect[3] > node.rect[1]);
function tree() {
  command('shell', 'uiautomator', 'dump', '/sdcard/fieldnotes-oct15-performance.xml');
  const xml = command('exec-out', 'cat', '/sdcard/fieldnotes-oct15-performance.xml');
  return { xml, nodes: parseNodes(xml) };
}
const label = node => `${node['content-desc'] || ''} ${node.text || ''}`.trim();
function findNode(predicate, description) {
  const state = tree();
  const node = state.nodes.find(predicate);
  if (!node) throw Error(`Native node missing: ${description}`);
  return node;
}
function tap(node) {
  const [x1, y1, x2, y2] = node.rect;
  command('shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)));
}
async function open(route, required) {
  command('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${route}'`);
  await wait(9000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = tree();
    if (required(state)) return state;
    await wait(2500);
  }
  throw Error(`Expected fixture not verified: ${route}`);
}
const has = (state, text) => state.nodes.some(node => label(node).includes(text));
const summary = raw => raw.split(/\r?\n/).map(line => line.trim()).filter(line => /^(Total frames rendered:|Janky frames:|Janky frames \(legacy\):|\d+th percentile:|Number Missed Vsync:|Number High input latency:|Number Slow UI thread:|Number Slow bitmap uploads:|Number Slow issue draw commands:|Number Frame deadline missed:|Pipeline=)/.test(line));
const report = zoomOnly ? JSON.parse(fs.readFileSync(output, 'utf8')) : {
  phase, platform: 'Android', device, build: 'debug, Hermes, Metro development bundle', physicalIos: false,
  sourceSha: process.env.QA_SOURCE_SHA || cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).trim(),
  caveat: 'Comparable emulator debug observations only. Host load and Metro affect timing; map SurfaceView work is not fully represented by app gfxinfo. Never interpret these as matched release/iPhone measurements.',
  samples: [],
};
const write = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
function capture(name, route) {
  const png = cp.execFileSync(adb, ['-s', device, 'exec-out', 'screencap', '-p'], { timeout: 60000, maxBuffer: 24 * 1024 * 1024 });
  if (png.subarray(1, 4).toString() !== 'PNG') throw Error('ADB did not return PNG');
  const target = path.join(captureRoot, `${name}.png`);
  fs.writeFileSync(target, png);
  fs.writeFileSync(target.replace('.png', '.xml'), tree().xml);
  fs.writeFileSync(target.replace('.png', '.json'), JSON.stringify({ source: 'adb framebuffer', route, sourceSha: process.env.QA_SOURCE_SHA || report.sourceSha, capturedAt: new Date().toISOString(), width: png.readUInt32BE(16), height: png.readUInt32BE(20), physicalIos: false }, null, 2));
  return path.relative(root, target).replace(/\\/g, '/');
}
async function measure(surface, description, action, extra = {}) {
  command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'reset');
  const started = Date.now();
  await action();
  await wait(1200);
  report.samples.push({ surface, action: description, elapsedWallMs: Date.now() - started, summary: summary(command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'framestats')), ...extra });
  write(); console.log(`Measured ${phase} ${surface}`);
}
function swipeIn(node, horizontal, alternate = true) {
  const [x1, y1, x2, y2] = node.rect;
  const width = x2 - x1, height = y2 - y1;
  const start = horizontal ? [x1 + width * .72, y1 + height * .48] : [x1 + width * .5, y1 + height * .78];
  const end = horizontal ? [x1 + width * .28, y1 + height * .48] : [x1 + width * .5, y1 + height * .32];
  for (let index = 0; index < 4; index++) {
    const points = alternate && index % 2 ? [...end, ...start] : [...start, ...end];
    command('shell', 'input', 'swipe', ...points.map(value => String(Math.round(value))), horizontal ? '500' : '550');
  }
}
(async () => {
  report.environment = {
    size: command('shell', 'wm', 'size').trim(), density: command('shell', 'wm', 'density').trim(),
    fontScale: command('shell', 'settings', 'get', 'system', 'font_scale').trim(),
    animatorDurationScale: command('shell', 'settings', 'get', 'global', 'animator_duration_scale').trim(),
  };
  if (zoomOnly) {
    const route = 'nearr://dev-qa?fieldnotes=map&theme=light&fieldnotesCount=20';
    await open(route, state => has(state, 'Open Saved, 20 places'));
    const map = findNode(node => node['content-desc'] === 'Google Map', 'Google Map');
    const [x1, y1, x2, y2] = map.rect;
    const x = Math.round((x1 + x2) / 2), y = Math.round(y1 + (y2 - y1) * .42);
    capture('zoom-start', route);
    await measure('Map zoom', '3 double taps in the measured native map area, 700ms between zoom gestures', async () => {
      for (let i = 0; i < 3; i++) {
        command('shell', `input tap ${x} ${y}; input tap ${x} ${y}`);
        await wait(700);
      }
    }, { savedCount: 20, matchedBefore: false, sourceSha: process.env.QA_SOURCE_SHA || report.sourceSha });
    capture('zoom-end', route);
    report.completedAt = new Date().toISOString(); write(); return;
  }
  for (const count of [1, 5, 20, 100]) {
    const route = `nearr://dev-qa?fieldnotes=map&theme=light&fieldnotesCount=${count}`;
    await open(route, state => has(state, `Open Saved, ${count} places`) || has(state, `${count} ${count === 1 ? 'place' : 'places'} to remember`));
    const map = findNode(node => node['content-desc'] === 'Google Map', 'Google Map');
    const screenshot = capture(`map-${count}`, route);
    await measure('Map pan', '4 alternating horizontal swipes inside measured Google Map bounds, 500ms each', () => swipeIn(map, true), { savedCount: count, screenshot, visibleCountVerified: true, data: 'Explicit synthetic Development density fixture' });
    if (phase === 'after' && count === 20) {
      const showAll = findNode(node => /Show all (saved )?pins/i.test(label(node)) && node.clickable === 'true', 'Show all pins');
      await measure('Show All', '3 repeated taps on accessibility-labeled Show all pins, settled between invocations', async () => { for (let i = 0; i < 3; i++) { tap(showAll); await wait(700); } }, { savedCount: count, matchedBefore: false });
      capture('show-all-20', route);
    }
  }
  if (phase === 'after') {
    await open('nearr://dev-qa?fieldnotes=activity&theme=light', state => has(state, 'Activity'));
    const route = 'nearr://dev-qa?fieldnotes=map&theme=light&fieldnotesCount=1';
    await open(route, state => has(state, 'Open Saved, 1 places'));
    const marker = findNode(node => node['content-desc'] === 'Map Marker' && node.clickable === 'true', 'singleton map marker');
    await measure('Pin selection', 'Tap singleton marker located in native accessibility tree', async () => { tap(marker); await wait(800); }, { savedCount: 1, matchedBefore: false });
    const detail = findNode(node => /^Open .+ details/.test(label(node)) && node.clickable === 'true', 'selected-card details');
    capture('pin-selection', route);
    await measure('Card expansion', 'Tap selected-card details identified by native accessibility label', async () => { tap(detail); await wait(800); }, { matchedBefore: false });
    capture('card-expansion', route);
  }
  for (const sample of [
    { surface: 'Saved scroll', route: 'nearr://dev-qa?fieldnotes=real-saved&theme=light', expected: 'Search saved places', data: '25 read-only public place names', screenshot: 'saved' },
    { surface: 'Activity scroll', route: 'nearr://dev-qa?fieldnotes=activity&theme=light', expected: 'Activity', data: 'Read-only processing/review/recovery/completed fixtures', screenshot: 'activity' },
  ]) {
    await open(sample.route, state => has(state, sample.expected));
    const list = findNode(node => node.scrollable === 'true', `${sample.surface} scroll container`);
    const screenshot = capture(sample.screenshot, sample.route);
    await measure(sample.surface, '4 alternating vertical swipes within measured native scroll-container bounds', () => swipeIn(list, false), { screenshot, data: sample.data });
  }
  const galleryRoute = 'nearr://dev-qa?fieldnotes=photo-place&theme=light';
  await open(galleryRoute, state => has(state, 'Dorset Quarry'));
  tap(findNode(node => /^View photos of Dorset Quarry/.test(label(node)), 'Dorset Quarry gallery button'));
  await wait(1800);
  const photo = findNode(node => /Dorset Quarry, photo 1 of 2/.test(label(node)), 'first gallery photo');
  const galleryShot = capture('gallery', galleryRoute);
  await measure('Gallery swipe', '4 alternating horizontal swipes on native gallery-photo bounds', () => swipeIn(photo, true), { screenshot: galleryShot, data: '2 distinct bundled Dorset Quarry photos; gallery actually opened before measurement' });
  command('shell', 'input', 'keyevent', '4');
  const searchRoute = 'nearr://dev-qa?fieldnotes=map&theme=light';
  await open(searchRoute, state => has(state, 'Search for a place'));
  tap(findNode(node => node['content-desc'] === 'Search for a place', 'map search'));
  await wait(1500);
  tap(findNode(node => node.class === 'android.widget.EditText', 'search text input'));
  await measure('Search typing', 'Type local saved-note query pizza; verify Bantam result', async () => {
    command('shell', 'input', 'text', 'pizza'); await wait(1800);
    if (!has(tree(), 'Bantam')) throw Error('Expected local Bantam result; no discovery/provider search submitted');
  }, { data: 'Bundled saved-note search; no provider request submitted' });
  capture('search', `${searchRoute} (local pizza query)`);
  command('shell', 'input', 'keyevent', '4');
  report.completedAt = new Date().toISOString(); write();
})().catch(error => { report.error = error.message.split('\n')[0]; write(); console.error(report.error); process.exitCode = 1; });
