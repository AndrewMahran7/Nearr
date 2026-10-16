// Actual Android framebuffer evidence; fixtures never write saved-place data.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const command = (...args) => cp.execFileSync(adb, ['-s', 'emulator-5554', ...args], { encoding: 'utf8', timeout: 60000 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const folder = process.argv[2] || 'before';
const theme = process.argv[3] || 'light';
const surfaces = (process.argv[4] || 'map,selected,real-saved,photo-place,real-place,activity,settings').split(',');
const root = path.resolve(__dirname, '../artifacts/fieldnotes-oct15', folder);
if (!root.startsWith(path.resolve(__dirname, '../artifacts/fieldnotes-oct15') + path.sep)) throw Error('Invalid output');
fs.mkdirSync(root, {recursive:true});
(async () => {
  for (const surface of surfaces) {
    const owner = surface === 'selected' || surface === 'expanded' ? 'map' : surface;
    const suffix = surface === 'selected' || surface === 'expanded' ? `&savedPlaceId=demo-saved-bantam&openRequestId=oct15-${Date.now()}${surface === 'expanded' ? '&placeSource=share_job_already_saved' : ''}` : '';
    const route = `nearr://dev-qa?fieldnotes=${owner}&theme=${theme}${suffix}`;
    command('shell','am','start','-W','-a','android.intent.action.VIEW','-d',`'${route}'`);
    await wait(surface === 'map' ? 12000 : 6500);
    const expected = { selected:'Bantam', expanded:'Bantam', 'real-saved':'Search saved places', 'photo-place':'Dorset Quarry', 'real-place':'Directions', activity:'Activity', 'activity-empty':'Activity', settings:'Settings' }[surface];
    let tree = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      command('shell','uiautomator','dump','/sdcard/window.xml');
      tree = command('shell','cat','/sdcard/window.xml');
      if (!tree.includes('error_footer') && (surface === 'map' ? /Show all saved pins|places to remember/.test(tree) : tree.includes(expected))) break;
      if (attempt === 5) throw Error(`Expected native ${surface} surface unavailable; refusing a misleading capture`);
      await wait(5000);
      command('shell','am','start','-W','-a','android.intent.action.VIEW','-d',`'${route}'`);
    }
    const buffer = cp.execFileSync(adb,['-s','emulator-5554','exec-out','screencap','-p'],{maxBuffer:24000000});
    if (buffer.subarray(1,4).toString() !== 'PNG') throw Error('No PNG');
    const target = path.join(root, `${theme}-${surface}.png`);
    fs.writeFileSync(target,buffer);
    fs.writeFileSync(target.replace('.png','.xml'),tree);
    fs.writeFileSync(target.replace('.png','.json'), JSON.stringify({source:'adb framebuffer', route, sourceSha:process.env.QA_SOURCE_SHA || 'working-tree', capturedAt:new Date().toISOString(), width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20),fontScale:command('shell','settings','get','system','font_scale').trim(), platform:'Android debug Pixel 8a AVD',physicalIos:false},null,2));
    console.log(target);
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
