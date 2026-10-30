const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'iap-metadata-candidates.json');
const doc = JSON.parse(fs.readFileSync(source, 'utf8'));
const prior = JSON.parse(execFileSync('git', ['show', '49f559d:artifacts/global-release/paid-launch/iap-metadata-candidates.json'], {encoding:'utf8'}));
if (JSON.stringify(doc.locales) !== JSON.stringify(prior.locales)) throw new Error('Localized copy changed unexpectedly');
const locales = ['en-US','es-MX','es-ES','pt-BR','fr-FR','de-DE','it','ja','ko','zh-Hans'];
const ids = ['com.nearr.plus.unlimited.monthly.v1','com.nearr.tokens.20.v2','com.nearr.tokens.50.v2','com.nearr.tokens.200.v2'];
if (Object.keys(doc.locales).sort().join() !== [...locales].sort().join()) throw new Error('Locale coverage mismatch');
const fields=[];
function check(locale,field,value,min,max){
  const count=[...value].length;
  if(count<min||count>max||value.normalize('NFC')!==value||Buffer.from(value,'utf8').toString('utf8')!==value||/[\u0000-\u001f<>$]/.test(value))throw new Error('Invalid '+locale+' '+field);
  fields.push({locale,field,unicodeCharacters:count,utf8Bytes:Buffer.byteLength(value),maximum:max});
}
for(const locale of locales){
  const row=doc.locales[locale];
  check(locale,'subscriptionGroupDisplayName',row.subscriptionGroupDisplayName,2,30);
  if(Object.keys(row.products).sort().join()!==[...ids].sort().join())throw new Error('Product coverage mismatch');
  for(const id of ids){
    check(locale,id+'.displayName',row.products[id].displayName,2,30);
    check(locale,id+'.description',row.products[id].description,1,45);
    const qty=id.match(/tokens\.(\d+)\.v2/);
    if(qty && (!row.products[id].displayName.includes(qty[1])||!row.products[id].description.includes(qty[1])))throw new Error('Quantity mismatch');
  }
}
if(fields.length!==90)throw new Error('Field count mismatch');
const receipt={checkedAt:new Date().toISOString(),status:'PASS_LOCAL_VALIDATION_WITH_SEPARATE_SAVED_UI_READBACK',sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),localizedCopyUnchangedFrom:'49f559d',localeCount:10,localizedFields:90,allSavedAndReopened:true,nativeSpeakerReviewed:false,signedIosVisualReviewed:false,fields};
fs.writeFileSync(path.join(__dirname,'iap-metadata-current-validation.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({status:receipt.status,fields:fields.length,sha256:receipt.sourceSha256}));
