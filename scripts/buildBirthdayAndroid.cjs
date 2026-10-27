// Local Development APK only; no EAS submission, OTA, or infrastructure change.
const { spawn } = require('node:child_process');
const { mkdirSync, createWriteStream, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
require('@expo/env').load(process.cwd());
if (process.env.EXPO_PUBLIC_BACKEND_ENV !== 'development' || new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).hostname !== 'qnfxnmvxpjzfydgudtvs.supabase.co') throw new Error('Development environment required');
const output = 'artifacts/onboarding-birthday-language';
mkdirSync(output, { recursive: true });
mkdirSync('android/.gradle-java-tmp', { recursive: true });
const stream = createWriteStream(path.join(output, 'android-build.log'));
const child = spawn('cmd.exe', ['/d', '/c', 'gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --max-workers=2 --console=plain'], { cwd: path.resolve('android'), windowsHide: true, env: { ...process.env, EXPO_PUBLIC_APP_ENV: 'development', NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
const timer = setTimeout(() => child.kill(), 20 * 60_000);
child.on('close', code => {
  clearTimeout(timer);
  stream.end(() => {
    console.log('Android build exit:', code);
    if (code === 0) {
      const apk = path.resolve('android/app/build/outputs/apk/debug/app-debug.apk');
      const receipt = { builtAt: new Date().toISOString(), platform: 'Android', environment: 'Development', runtime: '1.7-onboarding-date-v1', abi: 'x86_64', apk, sha256: createHash('sha256').update(readFileSync(apk)).digest('hex') };
      writeFileSync(path.join(output, 'android-build.json'), JSON.stringify(receipt, null, 2) + '\n');
      console.log(JSON.stringify(receipt));
    } else console.log(readFileSync(path.join(output, 'android-build.log'), 'utf8').slice(-12000));
    process.exitCode = code ?? 1;
  });
});
