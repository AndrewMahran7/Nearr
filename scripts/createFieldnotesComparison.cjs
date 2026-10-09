// Layout-only comparison boards. Original reference and ADB pixels are retained.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let sharp;
try { sharp = require('sharp'); } catch { sharp = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')); }
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts/fieldnotes-implementation');
const references = process.argv[2] || path.resolve(root, '../nearr-visual-direction-2026-10/artifacts/nearr-visual-redesign/mockups/winner');
const out = path.join(artifacts, 'reference-vs-native');
const pairs = [
  ['map', 'map'], ['selected', 'selected'], ['photo-place', 'detail'],
  ['real-saved', 'library'], ['activity', 'queue'], ['quick-check', 'review'],
  ['review', 'multi'], ['search', 'search'], ['onboarding', 'onboarding'],
  ['account', 'auth'], ['settings', 'settings'],
];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const xml = value => String(value).replace(/[<>&"]/g, char => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[char]));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  for (const appearance of ['light', 'dark']) {
    for (const [surface, reference] of pairs) {
      const native = path.join(artifacts, `${appearance}-mode/android-${surface}.png`);
      const ref = path.join(references, `${reference}${appearance === 'dark' ? '-dark' : ''}.png`);
      if (!fs.existsSync(native) || !fs.existsSync(ref)) continue;
      const metaFile = native.replace(/\.png$/, '.json');
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (!meta.visuallyVerified) throw new Error(`Missing visual verification: ${native}`);
      const left = await sharp(ref).resize({ width: 440, height: 1100, fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
      const right = await sharp(native).resize({ width: 440, height: 1100, fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
      const h = Math.max(left.info.height, right.info.height) + 160;
      const title = `<svg width="980" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="980" height="${h}" fill="#F7F4EE"/><g font-family="Arial" fill="#242621"><text x="30" y="29" font-size="20">Fieldnotes ${xml(surface)} / ${appearance}</text><text x="30" y="56" font-size="14">Approved design · 368f8e7</text><text x="510" y="56" font-size="14">Actual Android native · ${xml(meta.commit.slice(0,7))}</text><text x="30" y="${h-52}" font-size="13">Content and platform differ; this compares hierarchy and treatment, not identical map/photo pixels.</text><text x="30" y="${h-29}" font-size="13">${xml(meta.width)} × ${xml(meta.height)} · font scale ${xml(meta.fontScale)} · iOS device acceptance remains pending.</text></g></svg>`;
      const name = `${appearance}-${surface}.png`;
      await sharp(Buffer.from(title)).composite([{ input: left.data, left: 30, top: 75 }, { input: right.data, left: 510, top: 75 }]).png().toFile(path.join(out, name));
      results.push({ surface, appearance, board: name, reference: path.relative(references, ref), referenceSha256: hash(ref), native: path.relative(artifacts, native), nativeSha256: hash(native), nativeMetadata: path.relative(artifacts, metaFile), iosEvidence: false });
    }
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), designCommit: '368f8e7daea9714d292a487ace2668aee503bbfb', method: 'Side-by-side resizing for layout only; original screenshots retained, no simulated native frames.', results }, null, 2) + '\n');
  console.log(`Created ${results.length} verified native comparison boards.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
