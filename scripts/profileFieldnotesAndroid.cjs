// Android debug observations, not an iOS or release-performance benchmark.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const command = (...args) => cp.execFileSync(adb, ['-s', 'emulator-5554', ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve(__dirname, '../artifacts/fieldnotes-implementation/native-performance.json');
const report = { platform: 'Android', device: 'Pixel 8a AVD, Android 16, 1080x2400, density 420', build: 'debug, Hermes, Metro development bundle', iosEvidence: false, deviceBenchmark: false, caveat: 'Windows host experienced memory pressure; this is observed emulator rendering, not release-device performance. SurfaceView map drawing is not fully represented by app gfxinfo.', samples: [] };
const write = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
(async () => {
  for (const count of [1, 5, 20, 100]) {
    const route = `nearr://dev-qa?fieldnotes=map&theme=light&fieldnotesCount=${count}`;
    command('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${route}'`);
    await wait(16000);
    command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'reset');
    const started = Date.now();
    for (let i = 0; i < 4; i++) command('shell', 'input', 'swipe', ...(i % 2 ? ['320','1050','720','1050','500'] : ['720','1050','320','1050','500']));
    await wait(1500);
    const raw = command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'framestats');
    const summary = raw.split(/\r?\n/).filter(line => /^(Total frames rendered:|Janky frames:|Janky frames \(legacy\):|\d+th percentile:|Number Missed Vsync:|Number High input latency:|Number Slow UI thread:|Number Slow bitmap uploads:|Number Slow issue draw commands:|Number Frame deadline missed:|Pipeline=)/.test(line.trim())).map(line => line.trim());
    report.samples.push({ surface: 'map', savedCount: count, data: 'Explicit synthetic Development density fixture', action: '4 alternating horizontal 400px pans, 500ms each', elapsedWallMs: Date.now() - started, summary });
    write(); console.log(`Measured native map with ${count} synthetic saves`);
  }
  command('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', "'nearr://dev-qa?fieldnotes=real-saved&theme=light'");
  await wait(12000); command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'reset');
  for (let i = 0; i < 4; i++) command('shell', 'input', 'swipe', '530','1810','530','750','550');
  const raw = command('shell', 'dumpsys', 'gfxinfo', 'com.nearr.app', 'framestats');
  report.samples.push({ surface: 'Saved', savedCount: 25, data: 'Actual public business names from Development, read-only', action: '4 vertical list scroll gestures', summary: raw.split(/\r?\n/).filter(line => /^(Total frames rendered:|Janky frames:|\d+th percentile:|Number Slow UI thread:|Number Slow bitmap uploads:|Number Frame deadline missed:)/.test(line.trim())).map(line => line.trim()) });
  report.completedAt = new Date().toISOString(); write(); console.log('Measured native Saved list with 25 real public names');
})().catch(error => { report.error = error.message.split('\n')[0]; write(); console.error(report.error); process.exitCode = 1; });
