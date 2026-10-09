const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const sharp = require('C:/Users/andre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const out = __dirname;
const rc = 'C:/Users/andre/Desktop/Nearr-worktrees/Nearr-worktrees/nearr-1.5-ios';
for (const dir of ['candidates','sizes','sources','evidence','contexts']) fs.mkdirSync(path.join(out,dir),{recursive:true});
const pal = {ivory:'#F7F4EE', bot:'#263A32', orange:'#FF9957', red:'#FF6048'};
const outer='M512 170C356 170 244 281 244 429C244 557 352 698 478 822Q512 855 546 822C672 698 780 557 780 429C780 281 668 170 512 170Z';
const inner='M512 263C407 263 337 334 337 429C337 525 425 642 512 733C599 642 687 525 687 429C687 334 617 263 512 263Z';
const spark=(x,y,w,h,fill)=>`<path d="M${x} ${y-h/2}C${x+15} ${y-26} ${x+22} ${y-16} ${x+w/2} ${y}C${x+22} ${y+16} ${x+15} ${y+26} ${x} ${y+h/2}C${x-15} ${y+26} ${x-22} ${y+16} ${x-w/2} ${y}C${x-22} ${y-16} ${x-15} ${y-26} ${x} ${y-h/2}Z" fill="${fill}"/>`;
const defs='<defs><linearGradient id="brand" x1="0" y1="0" x2="0.65" y2="1"><stop stop-color="#FF9957"/><stop offset="1" stop-color="#FF6048"/></linearGradient></defs>';
const shell=(bg,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${defs}<rect width="1024" height="1024" fill="${bg}"/>${body}</svg>`;
const candidates=[
 {id:'a-fieldnotes-pin',name:'A · Fieldnotes Pin',desc:'Botanical outline · warm spark',svg:shell(pal.ivory,`<path d="${outer}${inner}" fill="${pal.bot}" fill-rule="evenodd"/>${spark(512,431,244,284,'url(#brand)')}`)},
 {id:'b-botanical-frame',name:'B · Botanical Frame',desc:'Quiet dark field · orange contour',svg:shell('#20352C',`<path d="${outer}${inner}" fill="url(#brand)" fill-rule="evenodd"/>${spark(512,431,244,284,pal.ivory)}`)},
 {id:'c-light-fieldnotes',name:'C · Light Fieldnotes',desc:'WINNER · botanical pin, landing spark',svg:shell(pal.ivory,`<path d="${outer}" fill="${pal.bot}"/>${spark(512,429,312,346,'url(#brand)')}`)},
 {id:'d-reduced-symbol',name:'D · Reduced Symbol',desc:'Bold brand field · one carved sparkle',svg:shell('url(#brand)',`<path d="${outer}" fill="${pal.ivory}"/>${spark(512,429,312,346,pal.bot)}`)},
];
const bufSvg=s=>Buffer.from(s);
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const text=(x,y,t,size=20,color='#242621',weight=400)=>`<text x="${x}" y="${y}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(t)}</text>`;
const img=(data,x,y,s,r=0)=>`<image x="${x}" y="${y}" width="${s}" height="${s}" href="data:image/png;base64,${data}" ${r?`clip-path="url(#mask-${s})"`:''}/>`;
const all={};
async function masked(data,size){const mask=bufSvg(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size*.224}" fill="white"/></svg>`);return sharp(data).resize(size,size).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();}
async function renderSvg(s,file){await sharp(bufSvg(s),{density:72}).png().toFile(path.join(out,file));}
const sizes=[1024,180,120,60,40,29];
(async()=>{
 const checks=[];
 for(const c of candidates){
  fs.writeFileSync(path.join(out,'sources',c.id+'.svg'),c.svg);
  const p=path.join(out,'candidates',c.id+'-1024.png');
  await sharp(bufSvg(c.svg)).flatten({background:pal.ivory}).removeAlpha().toColourspace('srgb').png().toFile(p);
  const meta=await sharp(p).metadata(),data=fs.readFileSync(p);
  const stats=await sharp(p).stats();
  all[c.id]={data,base64:data.toString('base64'),masked:{}};
  for(const size of sizes){
   await sharp(data).resize(size,size,{kernel:'lanczos3'}).removeAlpha().png().toFile(path.join(out,'sizes',`${c.id}-${size}.png`));
   all[c.id].masked[size]=(await masked(data,size)).toString('base64');
  }
  all[c.id].masked[256]=(await masked(data,256)).toString('base64');
  all[c.id].masked[88]=(await masked(data,88)).toString('base64');
  checks.push({candidate:c.id,width:meta.width,height:meta.height,channels:meta.channels,space:meta.space,hasAlpha:meta.hasAlpha,isOpaque:stats.isOpaque,sha256:crypto.createHash('sha256').update(data).digest('hex'),masterPath:'candidates/'+c.id+'-1024.png'});
 }
 fs.copyFileSync(path.join(out,'candidates/c-light-fieldnotes-1024.png'),path.join(out,'winner-icon-1024.png'));
 fs.copyFileSync(path.join(out,'sources/c-light-fieldnotes.svg'),path.join(out,'winner-icon.svg'));
 const old=fs.readFileSync(path.join(rc,'assets/icon.png'));
 fs.writeFileSync(path.join(out,'evidence/previous-icon.png'),old);
 for(const rev of ['3468488','c648369','18f237e']){
  try{const blob=cp.execFileSync('git',['show',`${rev}:assets/icon.png`],{cwd:rc,maxBuffer:10000000});fs.writeFileSync(path.join(out,'evidence',`icon-${rev}.png`),blob);}catch(e){console.error('history extraction',rev,e.message);}
 }
 let board=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1760" height="1520"><rect width="1760" height="1520" fill="#EEEBE3"/>${text(48,60,'NEARR / FIELDNOTES',18,'#62675B',700)}${text(48,108,'Four directions. One recognizable place.',38,'#242621',600)}${text(48,144,'Original vector studies · 1024px opaque square masters · masking simulated only for presentation',18,'#62675B')}`;
 for(let i=0;i<candidates.length;i++){
  const c=candidates[i],x=48+i*428,d=all[c.id];
  board+=`<rect x="${x}" y="185" width="380" height="1275" rx="18" fill="${i===2?'#FFFDF8':'#F7F4EE'}" ${i===2?'stroke="#263A32" stroke-width="3"':''}/>${img(d.masked[256],x+62,219,256)}${text(x+24,520,c.name,24,'#242621',600)}${text(x+24,552,c.desc,16,'#62675B')}${text(x+24,595,'1024 master shown at 256 above',15,'#62675B')}`;
  let yy=625;
  for(const sz of [180,120,60,40,29]){board+=img(d.masked[sz],x+24,yy,sz)+text(x+230,yy+Math.min(sz/2+6,94),sz+' px',18,'#62675B');yy+=sz+26;}
  board+=text(x+24,yy+5,i===2?'CHOSEN FOR IMPLEMENTATION':'ALTERNATIVE',13,i===2?'#AD3A16':'#62675B',700);
 }
 board+=text(48,1494,'All small examples are shown at their labeled pixel dimensions. This board is not a native iPhone screenshot.',16,'#62675B')+'</svg>';
 await renderSvg(board,'app-icon-study.png');
 let ctx=`<svg xmlns="http://www.w3.org/2000/svg" width="1680" height="1250"><defs><linearGradient id="light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#E7EDE4"/><stop offset="1" stop-color="#D4DED1"/></linearGradient><linearGradient id="dark" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#344B4B"/><stop offset="1" stop-color="#101915"/></linearGradient></defs><rect width="1680" height="1250" fill="#EEEBE3"/>${text(48,63,'WALLPAPER + SYSTEM CONTEXT',30,'#242621',600)}${text(48,98,'Concept previews, not system captures · every candidate on the same backgrounds',18,'#62675B')}`;
 for(let k=0;k<3;k++){
  const x=48+k*544,fill=k===0?'url(#light)':k===1?'url(#dark)':'#CA9E7C';
  ctx+=`<svg x="${x}" y="132" width="496" height="434" viewBox="0 0 496 434"><defs><clipPath id="phone"><rect width="496" height="434" rx="32"/></clipPath></defs><g clip-path="url(#phone)"><rect width="496" height="434" fill="${fill}"/>`;
  if(k===2)ctx+='<path d="M-90 170L280 -20L380 30L-70 300Z" fill="#31584B"/><path d="M90 470L530 80L540 250L290 480Z" fill="#DED6C4"/><circle cx="380" cy="100" r="120" fill="#A4BDC1"/><path d="M-30 390L320 160L510 375" fill="none" stroke="#734E38" stroke-width="48"/>';
  ctx+=text(28,46,['LIGHT WALLPAPER','DARK WALLPAPER','BUSY WALLPAPER'][k],15,k===1?'#F7F4EE':'#242621',700);
  for(let j=0;j<4;j++){
   const c=candidates[j],xx=46+j*111;
   ctx+=img(all[c.id].masked[60],xx,112,60)+text(xx+8,202,String.fromCharCode(65+j),17,k===1?'#F7F4EE':'#242621',600);
   ctx+=img(all[c.id].masked[40],xx+10,258,40)+text(xx+13,324,'40',15,k===1?'#F7F4EE':'#242621');
  }
  ctx+='</g></svg>';
 }
 ctx+=text(48,622,'Settings · 29px visual / equivalent 1× preview',23,'#242621',600)+text(885,622,'App Store · 120px visual / concept listing',23,'#242621',600);
 for(let j=0;j<4;j++){
  const y=650+j*120,c=candidates[j];
  ctx+=`<rect x="48" y="${y}" width="780" height="96" rx="12" fill="#FFFDF8"/>${img(all[c.id].masked[29],70,y+33,29)}${text(115,y+56,'Nearr',20,'#242621',500)}${text(750,y+56,String.fromCharCode(65+j),18,'#62675B')}`;
  const sx=884+(j%2)*384,sy=652+Math.floor(j/2)*226;
  ctx+=`<rect x="${sx}" y="${sy}" width="344" height="204" rx="18" fill="#FFFDF8"/>${img(all[c.id].masked[120],sx+20,sy+20,120)}${text(sx+156,sy+51,'Nearr',23,'#242621',600)}${text(sx+156,sy+79,'Your places,',16,'#62675B')}${text(sx+156,sy+101,'remembered.',16,'#62675B')}${text(sx+22,sy+174,c.name,18,'#242621',500)}`;
 }
 ctx+=text(48,1186,'Winner C keeps the flagship light canvas, botanical silhouette and orange landing spark at every size.',20,'#242621',500)+text(48,1220,'Rounded masks are visual approximations. Device installation remains the final check for actual iOS masking and effects.',16,'#62675B')+'</svg>';
 await renderSvg(ctx,'app-icon-contexts.png');
 // The top-level winner remains the full square; only previews above are masked.
 fs.writeFileSync(path.join(out,'evidence/validation.json'),JSON.stringify({date:'2026-10-09',sizes,candidates:checks,winner:'c-light-fieldnotes',winnerSha256:checks[2].sha256,safeArtworkBounds:{left:244,top:170,right:780,bottom:839},minimumInsetPx:170,nativeBuildVerified:false},null,2));
 console.log(JSON.stringify(checks,null,2));
})();
