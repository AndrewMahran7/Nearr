// Runs only development read-only routes and captures the real Android framebuffer.
const cp = require('node:child_process');
const path = require('node:path');
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const command = (...args) => cp.execFileSync(adb, ['-s', 'emulator-5554', ...args], { encoding: 'utf8', timeout: 60000 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const theme = process.argv[2] || 'light';
const folder = process.argv[3] || `${theme}-mode`;
const requested = (process.argv[4] || 'map,real-saved,photo-place,real-place,activity,review,account,onboarding,settings,practice-place,practice-receipt').split(',');
const descriptions = {
  map: '10 bundled demo saved places; native Google map; signed-out Activity guard active',
  'real-saved': '25 real public place records from verified Development, presented as read-only saved rows; no user identities; no photos invented',
  'real-place': 'Longest real public business name; unavailable image state; read-only component',
  'photo-place': 'Bundled Dorset Quarry onboarding fixture with two distinct bundled photos; read-only actual detail component',
  activity: 'Read-only Activity fixture: processing, review, recovery, and completed states',
  review: 'Read-only phase2-preview-mixed-5 fixture; candidate source thumbnails are synthetic fixture evidence',
  'quick-check': 'Read-only vayrin-confirm-neutral single-candidate fixture; no place photo',
  selected: 'Actual native map selection for bundled Bantam demo saved place; unavailable imagery',
  account: 'Actual account screen; no sign-in submission', onboarding: 'Actual onboarding entry screen; no mutation',
  settings: 'Actual Settings screen; no account or notification changes',
  'practice-place': 'Actual Fieldnotes practice component; scripted bundled onboarding place',
  'practice-receipt': 'Actual Fieldnotes practice component; scripted bundled onboarding receipt',
};
(async () => {
  for (const surface of requested) {
    if (!(surface in descriptions)) throw new Error(`Unknown read-only surface ${surface}`);
    const owner = surface === 'quick-check' ? 'review' : surface === 'selected' ? 'map' : surface;
    const suffix = surface === 'review' ? '&jobId=phase2-preview-mixed-5' : surface === 'quick-check' ? '&jobId=vayrin-confirm-neutral' : surface === 'selected' ? `&savedPlaceId=demo-saved-bantam&openRequestId=fieldnotes-${Date.now()}` : '';
    const route = `nearr://dev-qa?fieldnotes=${owner}&theme=${theme}${suffix}`;
    command('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${route}'`);
    // Cold native tiles and bundled images can take several seconds on a debug emulator.
    await wait(surface === 'map' ? 16000 : 9000);
    const file = `${folder}/android-${surface}.png`;
    cp.execFileSync(process.execPath, [path.join(__dirname, 'captureFieldnotesAndroid.cjs'), file, route, descriptions[surface]], { encoding: 'utf8', timeout: 60000 });
    console.log(`Captured ${file}`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
