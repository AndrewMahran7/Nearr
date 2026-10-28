// Local, debug-signed release variant: embedded JS, Development backend only.
// Reuses the qualified worktree's ignored native build cache without editing
// its tracked source. This is not a Store-signed production artifact.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const buildRoot = process.env.NEARR_FINAL_ANDROID_BUILD_ROOT;
if (!buildRoot || !path.isAbsolute(buildRoot)) throw new Error('Explicit absolute build root required');
const req = createRequire(path.join(buildRoot, 'package.json'));
const baseline = '3dbf10278368c2074afa095627b71be21f24aaa3';
const git = (...args) => execFileSync('git', args, { cwd: buildRoot, encoding: 'utf8', timeout: 30000 }).trim();
if (git('rev-parse', 'HEAD') !== baseline) throw new Error('Unexpected cached worktree revision');
if (git('status', '--porcelain')) throw new Error('Cached worktree must be clean');
req('@expo/env').load(buildRoot, { silent: true });
process.env.EXPO_PUBLIC_APP_ENV = 'development';
if (process.env.EXPO_PUBLIC_BACKEND_ENV !== 'development' || new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).hostname !== 'qnfxnmvxpjzfydgudtvs.supabase.co') throw new Error('Development backend required');
const config = req('@expo/config').getConfig(buildRoot).exp;
if (config.android.runtimeVersion !== '1.7-onboarding-date-android-v2') throw new Error('Unexpected native runtime');
const out = path.join(root, 'artifacts/global-release/final-production/android');
fs.mkdirSync(out, { recursive: true });
const log = fs.createWriteStream(path.join(out, 'standalone-build.log'));
const startedAt = new Date().toISOString();
// Cached native gradle.properties retains its qualified Windows SQLite/KAPT
// temp paths and a bounded 2048 MiB heap. Avoid passing a spaced -D value
// through Windows cmd quoting, where it can be interpreted as a task name.
const command = 'gradlew.bat :app:assembleRelease -PreactNativeArchitectures=x86_64 --max-workers=1 --no-daemon --console=plain';
const child = spawn('cmd.exe', ['/d', '/c', command], { cwd: path.join(buildRoot, 'android'), windowsHide: true, env: { ...process.env, NODE_ENV: 'production', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
const timer = setTimeout(() => {
  // Only this task's command subtree; do not terminate unrelated Java builds.
  if (child.pid) execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 15000, stdio: 'ignore' });
}, 20 * 60_000);
child.on('close', code => {
  clearTimeout(timer);
  log.end(() => {
    const receipt = { startedAt, finishedAt: new Date().toISOString(), sourceSha: baseline, exitCode: code, buildRoot, buildType: 'release-variant-debug-signed', environment: 'Development', runtime: config.android.runtimeVersion, version: config.version, versionCode: config.android.versionCode ?? 1, abi: 'x86_64', metroRequired: false, storeSigned: false, minification: false, command };
    if (code === 0) {
      receipt.apk = path.join(buildRoot, 'android/app/build/outputs/apk/release/app-release.apk');
      receipt.sha256 = createHash('sha256').update(fs.readFileSync(receipt.apk)).digest('hex');
    }
    fs.writeFileSync(path.join(out, 'standalone-build.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt, null, 2));
    if (code !== 0) console.log(fs.readFileSync(path.join(out, 'standalone-build.log'), 'utf8').slice(-10000));
    process.exitCode = code ?? 1;
  });
});
