// Android debug observations, not an iOS or release-performance benchmark.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const command = (...args) => cp.execFileSync(adb, ['-s', 'emulator-5554', ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve(__dirname, '../artifacts/fieldnotes-implementation/native-performance.json');
const report = { platform: 'Android', device: 'Pixel 8a AVD, Android 16, 1080x2400, density 420', build: 'debug, Hermes, Metro development bundle', iosEvidence: false, deviceBenchmark: false, caveat: 'Windows host experienced memory pressure; this is observed emulator rendering, not release-device performance. SurfaceView map drawing is not fully represented by app gfxinfo.', samples: [] };
report.sourceCommit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: path.resolve(__dirname, '..') }).trim();
report.emulatorConfiguration = { cores: 4, memoryMb: 3072, gpu: 'auto', fontScale: 1, animatorDurationScale: 1 };
const write = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const summarize = raw => raw.split(/\r?\n/).filter(line => /^(Total frames rendered:|Janky frames:|Janky frames \(legacy\):|\d+th percentile:|Number Missed Vsync:|Number High input latency:|Number Slow UI thread:|Number Slow bitmap uploads:|Number Slow issue draw commands:|Number Frame deadline missed:|Pipeline=)/.test(line.trim())).map(line => line.trim());
const assertVisible = text => {
  command('shell', 'uiautomator', 'dump', '/sdcard/fieldnotes-density.xml');
  if (!command('exec-out', 'cat', '/sdcard/fieldnotes-density.xml').includes(text)) throw new Error(`Expected native surface text missing: ${text}`);
};
const capture = (name, route, data) => cp.execFileSync(process.execPath, [path.join(__dirname, 'captureFieldnotesAndroid.cjs'), `performance/android-${name}.png`, route, data], { encoding: 'utf8', timeout: 60000 });
(async () => {
  for (const count of [1, 5, 20, 100]) {
    const route = `nearr://dev-qa?fieldnotes=map&theme=light&fieldnotesCount=${count}`;
    command('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${route}'`);
    await wait(16000);
    const expectedHeader = `${count} ${count === 1 ? 'place' : 'places'} to remember`;
    let visibleCountVerified = false;
    for (let attempt = 0; attempt < 3 && !visibleCountVerified; attempt++) {
      command('shell', 'uiautomator', 'dump', '/sdcard/fieldnotes-density.xml');
      const tree = command('exec-out', 'cat', '/sdcard/fieldnotes-density.xml');
      visibleCountVerified = tree.includes(expectedHeader);
      if (!visibleCountVerified) await wait(3000);
    }
    if (!visibleCountVerified) throw new Error(`Native visible count did not match ${count}; no sample accepted`);
    const screenshot = `performance/android-map-density-${count}.png`;
    cp.execFileSync(process.execPath, [path.join(__dirname, 'captureFieldnotesAndroid.cjs'), screenshot, route, `Synthetic ${count}-save density fixture; visible header verified in native UI tree`], { encoding: 'utf8', timeout: 60000 });
    command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'reset');
    const started = Date.now();
    for (let i = 0; i < 4; i++) command('shell', 'input', 'swipe', ...(i % 2 ? ['320','1050','720','1050','500'] : ['720','1050','320','1050','500']));
    await wait(1500);
    const raw = command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'framestats');
    const summary = raw.split(/\r?\n/).filter(line => /^(Total frames rendered:|Janky frames:|Janky frames \(legacy\):|\d+th percentile:|Number Missed Vsync:|Number High input latency:|Number Slow UI thread:|Number Slow bitmap uploads:|Number Slow issue draw commands:|Number Frame deadline missed:|Pipeline=)/.test(line.trim())).map(line => line.trim());
    report.samples.push({ surface: 'map', savedCount: count, visibleCountVerified, screenshot, data: 'Explicit synthetic Development density fixture', action: '4 alternating horizontal 400px pans, 500ms each', elapsedWallMs: Date.now() - started, summary });
    write(); console.log(`Measured native map with ${count} synthetic saves`);
  }
  command('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', "'nearr://dev-qa?fieldnotes=real-saved&theme=light'");
  await wait(12000); assertVisible('Search saved places'); assertVisible('Oliver');
  capture('saved', 'nearr://dev-qa?fieldnotes=real-saved&theme=light', 'Actual 25-public-name Development component fixture; visible Oliver featured row verified');
  command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'reset');
  for (let i = 0; i < 4; i++) command('shell', 'input', 'swipe', '530','1810','530','750','550');
  const raw = command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'framestats');
  report.samples.push({ surface: 'Saved', savedCount: 25, data: 'Actual public business names from Development, read-only', action: '4 vertical list scroll gestures', summary: raw.split(/\r?\n/).filter(line => /^(Total frames rendered:|Janky frames:|\d+th percentile:|Number Slow UI thread:|Number Slow bitmap uploads:|Number Frame deadline missed:)/.test(line.trim())).map(line => line.trim()) });
  write();
  for (const sample of [
    { surface: 'Activity', route: 'nearr://dev-qa?fieldnotes=activity&theme=light', expected: 'Activity', action: '4 alternating vertical scroll gestures over the read-only fixture queue', data: 'Processing/review/recovery/completed fixtures', swipe: ['530','1750','530','750','550'] },
    { surface: 'Gallery', route: 'nearr://dev-qa?fieldnotes=photo-place&theme=light', expected: 'Dorset Quarry', action: '4 alternating horizontal hero-gallery swipes between 2 bundled photos', data: 'Two distinct bundled Dorset Quarry onboarding photos', swipe: ['850','650','250','650','500'] },
  ]) {
    command('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${sample.route}'`);
    await wait(12000); assertVisible(sample.expected); capture(sample.surface.toLowerCase(), sample.route, sample.data);
    command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'reset');
    const started = Date.now();
    for (let i = 0; i < 4; i++) {
      const swipe = sample.swipe;
      command('shell', 'input', 'swipe', ...(i % 2 ? [swipe[2],swipe[3],swipe[0],swipe[1],swipe[4]] : swipe));
    }
    await wait(1500);
    report.samples.push({ surface: sample.surface, visibleSurfaceVerified: true, action: sample.action, data: sample.data, elapsedWallMs: Date.now() - started, summary: summarize(command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'framestats')) }); write();
  }
  const searchRoute = 'nearr://dev-qa?fieldnotes=map&theme=light';
  command('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${searchRoute}'`);
  await wait(16000); assertVisible('places to remember');
  command('shell', 'input', 'tap', '835', '210'); await wait(3000); assertVisible('Find a place');
  command('shell', 'input', 'tap', '320', '400'); await wait(1500);
  command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'reset');
  const searchStarted = Date.now();
  command('shell', 'input', 'text', 'pizza'); await wait(3000); assertVisible('Bantam');
  report.samples.push({ surface: 'Search', visibleSurfaceVerified: true, action: 'Enter local saved-note query pizza and render Bantam result with native keyboard open', data: 'Bundled saved demo fixtures; no discovery/provider request', elapsedWallMs: Date.now() - searchStarted, summary: summarize(command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'framestats')) });
  capture('search', searchRoute + ' (local search pizza)', 'Local saved-note search; bundled Bantam result; native keyboard');
  command('shell', 'input', 'keyevent', '4');
  report.completedAt = new Date().toISOString(); write(); console.log('Measured native Saved list with 25 real public names');
})().catch(error => { report.error = error.message.split('\n')[0]; write(); console.error(report.error); process.exitCode = 1; });
