const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const out=path.resolve('artifacts/global-release/aso');
const previous=path.resolve('../nearr-1.5-privacy-corrected/artifacts/app-store-international');
const research=path.resolve('../nearr-1.5-app-store-international/artifacts/app-store-international');
const prior=JSON.parse(fs.readFileSync(path.join(previous,'localized-copy-final-candidate.json'),'utf8'));
const english=JSON.parse(fs.readFileSync(path.join(research,'research-global/metadata.json'),'utf8')).locales.find(row=>row.locale==='en-US');
const changes=JSON.parse(fs.readFileSync(path.join(out,'unified-copy-drafts.json'),'utf8'));
const uiLocales={'en-US':'en-US','es-MX':'es-MX','es-ES':'es-ES','pt-BR':'pt-BR','fr-FR':'fr','de-DE':'de',it:'it',ja:'ja',ko:'ko','zh-Hans':'zh-Hans'};
const locales=Object.entries(changes).map(([locale,change])=>{
  const previousCopy=locale==='en-US'?english:prior.locales.find(row=>row.locale===locale || row.locale===({it:'it-IT',ja:'ja-JP',ko:'ko-KR'}[locale]));
  assert.ok(previousCopy,locale);
  const row={locale,uiLocale:uiLocales[locale],title:previousCopy.title,subtitle:previousCopy.subtitle,keywords:previousCopy.keywords,...change,screenshot_headlines:previousCopy.screenshot_headlines,review:'MODEL_DRAFT_NOT_NATIVE_REVIEWED',uploadReady:false};
  assert.ok(row.title.length<=30,locale+' title');assert.ok(row.subtitle.length<=30,locale+' subtitle');
  assert.ok(Buffer.byteLength(row.keywords,'utf8')<=100,locale+' conservative keyword bytes');
  assert.ok(row.description.length<=4000,locale+' description');assert.ok(row.whats_new.length<=4000,locale+' whats_new');
  return row;
});
fs.writeFileSync(path.join(out,'unified-metadata-candidates.json'),JSON.stringify({status:'HOLD: release gates, native translation review and actual Fieldnotes screenshots outstanding',previousSources:[path.join(previous,'localized-copy-final-candidate.json'),path.join(research,'research-global/metadata.json')],noUploadPerformed:true,locales},null,2)+'\n');
fs.writeFileSync(path.join(out,'metadata-validation.json'),JSON.stringify(locales.map(row=>({locale:row.locale,titleCharacters:row.title.length,subtitleCharacters:row.subtitle.length,keywordBytes:Buffer.byteLength(row.keywords,'utf8'),descriptionCharacters:row.description.length,whatsNewCharacters:row.whats_new.length,limitsPass:true,productAndLanguageApproval:false})),null,2)+'\n');
const manifest=JSON.parse(fs.readFileSync(path.join(previous,'screenshots/asset-manifest.json'),'utf8'));
const assets=manifest.assets.map(asset=>{
  const file=path.join(previous,asset.path);const data=fs.readFileSync(file);
  const hash=crypto.createHash('sha256').update(data).digest('hex');
  assert.equal(hash,asset.sha256,asset.path);
  assert.equal(data.readUInt32BE(16),asset.width);assert.equal(data.readUInt32BE(20),asset.height);
  return {path:asset.path,sha256:hash,width:asset.width,height:asset.height,reuseForUnifiedRelease:false,reason:'Reconstructed 1.5 interface, not translated native Fieldnotes runtime capture'};
});
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=walk(path.join(previous,'screenshots'));
fs.writeFileSync(path.join(out,'preserved-screenshot-audit.json'),JSON.stringify({sourceRoot:previous,priorStatus:manifest.status,priorSource:manifest.app_source,verifiedAssets:assets.length,contactSheets:files.filter(f=>f.endsWith('contact-sheet.png')).length,svgSources:files.filter(f=>f.endsWith('.svg')).length,readOnly:true,unifiedRuntimeCaptures:0,assets},null,2)+'\n');
console.log(`PASS ASO drafts: ${locales.length} locale packages fit metadata limits; ${assets.length} prior assets verified by hash/dimensions and held out of release.`);
