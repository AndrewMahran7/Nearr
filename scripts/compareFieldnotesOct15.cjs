// Layout-only boards from untouched ADB frames; no generated UI or retouching.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
let sharp; try { sharp = require('sharp'); } catch { sharp = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')); }
const root = path.resolve(__dirname, '../artifacts/fieldnotes-oct15');
const out = path.join(root, 'comparisons'); fs.mkdirSync(out,{recursive:true});
const manifest = [];
(async()=>{
  // Baseline hot-configuration large-text captures did not restart React Native.
  // Keep those raw records, but never present them as matched font comparisons.
  for (const [suffix,theme] of [['','light'],['-dark','dark']]) {
    for (const screen of ['map','selected','real-saved','photo-place','real-place','activity','settings']) {
      const paths=['before','after'].map(phase=>path.join(root,phase+suffix,`${theme}-${screen}.png`));
      if (!paths.every(file=>fs.existsSync(file))) continue;
      const images=await Promise.all(paths.map(file=>sharp(file).resize({width:360}).png().toBuffer()));
      const header=Buffer.from(`<svg width="760" height="840"><rect width="760" height="840" fill="#F7F4EE"/><g fill="#242621" font-size="15" font-family="Arial"><text x="10" y="20">Before / ${screen} ${theme}${suffix}</text><text x="390" y="20">After / actual Android debug</text></g></svg>`);
      const name=`${theme}${suffix}-${screen}.png`;
      await sharp(header).composite([{input:images[0],left:10,top:30},{input:images[1],left:390,top:30}]).png().toFile(path.join(out,name));
      manifest.push({board:name, originals:paths.map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})),method:'Resized side by side only; original framebuffer pixels retained.'});
    }
  }
  for (const screen of ['search', 'gallery']) {
    const paths = ['before', 'after'].map(phase => path.join(root, `performance-${phase}`, `${screen}.png`));
    if (!paths.every(file => fs.existsSync(file))) continue;
    const images = await Promise.all(paths.map(file => sharp(file).resize({ width: 360 }).png().toBuffer()));
    const header = Buffer.from(`<svg width="760" height="840"><rect width="760" height="840" fill="#F7F4EE"/><g fill="#242621" font-size="15" font-family="Arial"><text x="10" y="20">Before / ${screen} light</text><text x="390" y="20">After / actual Android debug</text></g></svg>`);
    const name = `light-${screen}.png`;
    await sharp(header).composite([{ input: images[0], left: 10, top: 30 }, { input: images[1], left: 390, top: 30 }]).png().toFile(path.join(out, name));
    manifest.push({ board: name, originals: paths.map(file => ({ path: path.relative(root, file), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })), method: 'Resized side by side only; original framebuffer pixels retained.' });
  }
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(`Created ${manifest.length} comparison boards`);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
