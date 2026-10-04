import http from 'node:http';
import path from 'node:path';
import Busboy from 'busboy';
import sharp from 'sharp';
import { zipSync } from 'fflate';

const PORT = Number(process.env.PORT || 4780);
const HOST = '0.0.0.0';
const MAX_UPLOAD = 32 * 1024 * 1024;
const MAX_FILES = 80;

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', zip: 'application/zip'
};

function ext(name='') { return path.extname(name).slice(1).toLowerCase(); }
function stem(name='file') { return path.basename(name, path.extname(name)); }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function num(v, d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function safeName(name='file'){ return path.basename(name).replace(/[^a-zA-Z0-9._ -]/g,'_'); }
function sendJson(res, status, body){
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','content-length':data.length,'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(data);
}
function sendHtml(res, html){
  const data=Buffer.from(html);
  res.writeHead(200, {'content-type':'text/html; charset=utf-8','content-length':data.length,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
  res.end(data);
}

function parseMultipart(req){
  return new Promise((resolve,reject)=>{
    let total=0; const files=[]; const fields={};
    let bb;
    try { bb=Busboy({headers:req.headers, limits:{fileSize:MAX_UPLOAD, files:MAX_FILES, fields:80}}); }
    catch(e){ return reject(new Error('Invalid upload')); }
    bb.on('field',(name,val)=>{ fields[name]=val; });
    bb.on('file',(field,stream,info)=>{
      const chunks=[]; let size=0; let truncated=false;
      stream.on('data',c=>{ size+=c.length; total+=c.length; if(total>MAX_UPLOAD){ truncated=true; stream.resume(); return; } chunks.push(c); });
      stream.on('limit',()=>{ truncated=true; });
      stream.on('end',()=>{ if(!truncated && info.filename) files.push({field,name:safeName(info.filename),type:info.mimeType||'application/octet-stream',buffer:Buffer.concat(chunks)}); });
    });
    bb.on('filesLimit',()=>reject(new Error('Too many files')));
    bb.on('error',reject);
    bb.on('close',()=>{
      if(total>MAX_UPLOAD) return reject(new Error('Upload is too large. Keep the total under 32 MB.'));
      resolve({fields,files});
    });
    req.pipe(bb);
  });
}

async function rasterTransform(file, o={}){
  const inputExt=ext(file.name);
  const animated = inputExt==='gif' || (inputExt==='webp' && o.mode==='gif');
  let image=sharp(file.buffer,{animated, limitInputPixels:120_000_000});
  const meta=await image.metadata();
  const scale=clamp(num(o.scale,100),10,100)/100;
  if(scale<0.999){
    const w=Math.max(1,Math.round((meta.width||1)*scale));
    image=image.resize({width:w, withoutEnlargement:true, kernel:'lanczos3'});
  }
  const quality=clamp(Math.round(num(o.quality,78)),20,100);
  const colors=clamp(Math.round(num(o.colors,256)),16,256);
  let format=(o.format||'preserve').toLowerCase();
  if(format==='auto') format = animated ? 'webp' : (inputExt==='png' ? 'webp' : inputExt);
  if(format==='preserve') format=inputExt;
  if(!['png','jpg','jpeg','webp','gif'].includes(format)) format='webp';

  if(format==='png') image=image.png({compressionLevel:9, effort:10, palette:colors<256, colours:colors, dither:0.65});
  else if(format==='jpg'||format==='jpeg') image=image.jpeg({quality, mozjpeg:true, chromaSubsampling:'4:4:4'});
  else if(format==='gif') image=image.gif({effort:9, colours:colors, dither:0.7, interFrameMaxError:2, interPaletteMaxError:3});
  else image=image.webp({quality, alphaQuality:quality, effort:6, smartSubsample:true, nearLossless: quality>=92});

  const {data,info}=await image.toBuffer({resolveWithObject:true});
  const outExt=format==='jpeg'?'jpg':format;
  return {data, name:`${stem(file.name)}.${outExt}`, contentType:MIME[outExt]||'application/octet-stream', info};
}

function scaleCsv(value, scale){
  return value.replace(/-?\d+(?:\.\d+)?/g, m=>{
    const n=Number(m)*scale;
    return Number.isInteger(n)?String(n):String(Math.round(n*1000)/1000);
  });
}

function rewriteAtlas(text, pageMap, scale){
  const pixelKeys=new Set(['size','xy','orig','offset','bounds','offsets','split','pad']);
  const lines=text.replace(/\r\n/g,'\n').split('\n');
  let sectionStart=true, currentPage=null, pageHeader=false;
  return lines.map(line=>{
    if(line.trim()===''){ sectionStart=true; currentPage=null; pageHeader=false; return line; }
    const trimmed=line.trim();
    if(sectionStart && !trimmed.includes(':')){
      sectionStart=false; pageHeader=true; currentPage=trimmed;
      return line.replace(trimmed, pageMap.get(trimmed)?.name || trimmed);
    }
    if(!trimmed.includes(':')){ pageHeader=false; return line; }
    const idx=line.indexOf(':');
    const key=line.slice(0,idx).trim();
    const value=line.slice(idx+1).trim();
    if(pageHeader && key==='size' && currentPage && pageMap.has(currentPage)){
      const p=pageMap.get(currentPage); return `${line.slice(0,idx+1)} ${p.width},${p.height}`;
    }
    if(!pageHeader && pixelKeys.has(key) && scale!==1){ return `${line.slice(0,idx+1)} ${scaleCsv(value,scale)}`; }
    return line;
  }).join('\n');
}

async function optimizeSpine(files, fields){
  const scale=clamp(num(fields.scale,fields.preset==='smallest'?50:fields.preset==='balanced'?75:100),25,100)/100;
  const quality=clamp(num(fields.quality,fields.preset==='smallest'?58:fields.preset==='balanced'?76:92),30,100);
  const colors=clamp(num(fields.colors,fields.preset==='smallest'?64:fields.preset==='balanced'?128:256),16,256);
  const requested=(fields.format|| (fields.preset==='same'?'preserve':'webp')).toLowerCase();
  const textures=files.filter(f=>['png','jpg','jpeg','webp'].includes(ext(f.name)));
  const pageMap=new Map();
  const outputs=new Map();
  let preview=null;

  for(const f of textures){
    const out=await rasterTransform(f,{scale:scale*100,quality,colors,format:requested==='preserve'?'preserve':'webp',mode:'spine'});
    const meta=await sharp(out.data).metadata();
    pageMap.set(f.name,{name:out.name,width:meta.width||1,height:meta.height||1});
    outputs.set(f.name,{name:out.name,data:out.data});
    if(!preview) preview={originalName:f.name,contentType:out.contentType,data:out.data.toString('base64')};
  }

  for(const f of files){
    const e=ext(f.name);
    if(['png','jpg','jpeg','webp'].includes(e)) continue;
    let data=f.buffer; let name=f.name;
    if(e==='atlas') data=Buffer.from(rewriteAtlas(f.buffer.toString('utf8'),pageMap,scale));
    else if(e==='json'){
      try { data=Buffer.from(JSON.stringify(JSON.parse(f.buffer.toString('utf8')))); } catch {}
    }
    outputs.set(f.name,{name,data});
  }

  const entries={}; let afterBytes=0;
  for(const {name,data} of outputs.values()){
    let unique=name, i=2;
    while(entries[unique]){ const x=ext(name); unique=`${stem(name)}-${i++}${x?'.'+x:''}`; }
    entries[unique]=new Uint8Array(data); afterBytes+=data.length;
  }
  const zip=Buffer.from(zipSync(entries,{level:6}));
  return {data:zip,fileName:'optimized-spine.zip',contentType:'application/zip',afterBytes,preview};
}

async function optimizeAssets(files, fields, mode){
  if(!files.length) throw new Error('Choose at least one file.');
  if(mode==='spine') return optimizeSpine(files,fields);
  const outputs=[];
  for(const f of files){
    const out=await rasterTransform(f,{scale:fields.scale,quality:fields.quality,colors:fields.colors,format:fields.format,mode});
    outputs.push(out);
  }
  const afterBytes=outputs.reduce((n,x)=>n+x.data.length,0);
  if(outputs.length===1) return {...outputs[0],afterBytes,preview:{originalName:files[0].name,contentType:outputs[0].contentType,data:outputs[0].data.toString('base64')}};
  const entries={};
  for(const o of outputs) entries[o.name]=new Uint8Array(o.data);
  const zip=Buffer.from(zipSync(entries,{level:6}));
  return {data:zip,fileName:mode==='gif'?'optimized-gifs.zip':'optimized-images.zip',contentType:'application/zip',afterBytes,preview:{originalName:files[0].name,contentType:outputs[0].contentType,data:outputs[0].data.toString('base64')}};
}

const HTML=String.raw`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Asset Optimizer</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171923;background:#f4f6fa}*{box-sizing:border-box}body{margin:0}.top{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.93);backdrop-filter:blur(16px);border-bottom:1px solid #dfe3ea}.nav{max-width:1020px;margin:auto;height:64px;display:flex;align-items:center;gap:16px;padding:0 20px}.brand{font-weight:850;font-size:18px;display:flex;align-items:center;gap:9px}.logo{width:29px;height:29px;border-radius:9px;background:#4b35d6;color:white;display:grid;place-items:center}.tabs{display:flex;background:#eef0f5;border-radius:12px;padding:3px}.tab{border:0;background:transparent;padding:8px 14px;border-radius:9px;font-weight:700;color:#5b6478;cursor:pointer}.tab.active{background:white;color:#171923;box-shadow:0 1px 4px #0001}.new{margin-left:auto;background:#4b35d6;color:#fff;border:0;border-radius:10px;padding:10px 14px;font-weight:800;cursor:pointer}.wrap{max-width:820px;margin:38px auto 80px;padding:0 20px}.heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.heading h1{font-size:32px;margin:0 0 4px}.sub{color:#667085;font-size:16px;line-height:1.5}.clear{background:white;border:1px solid #ccd2dc;border-radius:10px;padding:9px 14px;font-weight:750;cursor:pointer}.card{background:#fff;border:1px solid #dce1e8;border-radius:16px;padding:24px;margin-top:22px;box-shadow:0 1px 2px #10182808}.drop{border:2px dashed #c9d0dc;min-height:150px;border-radius:14px;display:grid;place-items:center;text-align:center;padding:25px;cursor:pointer}.drop.drag{border-color:#4b35d6;background:#f5f3ff}.drop strong{font-size:18px}.muted{color:#667085}.inputrow{display:flex;justify-content:space-between;gap:18px;align-items:center}.big{font-size:36px;font-weight:850;line-height:1}.files{font-size:13px;color:#667085;margin-top:6px}.replace,.download,.run{border:0;border-radius:10px;padding:11px 16px;font-weight:800;cursor:pointer}.replace{background:white;border:1px solid #cbd2df}.run,.download{background:#4b35d6;color:white}.controls h3{margin:0}.qualityline{display:flex;justify-content:space-between;font-weight:800}.qualitynum{font-size:22px}.range{width:100%;accent-color:#4b35d6;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.grid label{font-size:12px;font-weight:800;color:#59647a}.grid select{width:100%;margin-top:6px;padding:8px;border:1px solid #cbd2df;border-radius:8px;background:white}.presets{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.preset{border:0;background:#f3f4f7;border-radius:8px;padding:8px 11px;font-weight:700;color:#475467;cursor:pointer}.preset.active{background:#e8e3ff;color:#3f2eb0}.actions{display:flex;justify-content:flex-end;margin-top:18px}.advanced{margin-top:15px;border-top:1px solid #edf0f4;padding-top:14px}.advanced summary{cursor:pointer;font-weight:800}.result{border-color:#8bc7a4}.resulttop{display:flex;align-items:center;justify-content:space-between;gap:15px}.saving{color:#17783c;font-weight:800}.compare{margin-top:18px;position:relative;aspect-ratio:16/9;overflow:hidden;border-radius:14px;background-color:#e9edf3;background-image:linear-gradient(45deg,#dfe3e8 25%,transparent 25%),linear-gradient(-45deg,#dfe3e8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#dfe3e8 75%),linear-gradient(-45deg,transparent 75%,#dfe3e8 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0}.compare img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.before{clip-path:inset(0 calc(100% - var(--p,50%)) 0 0);z-index:2}.divider{position:absolute;z-index:3;left:var(--p,50%);top:0;bottom:0;width:2px;background:white;box-shadow:0 0 0 1px #0003}.handle{position:absolute;z-index:4;left:var(--p,50%);top:50%;width:40px;height:40px;transform:translate(-50%,-50%);border-radius:50%;background:white;box-shadow:0 3px 12px #0004;display:grid;place-items:center;font-weight:900}.compare input{position:absolute;z-index:5;inset:0;width:100%;height:100%;opacity:0;cursor:ew-resize}.badge{position:absolute;z-index:6;top:12px;padding:6px 9px;border-radius:7px;background:#111827cc;color:white;font-size:12px;font-weight:800}.badge.left{left:12px}.badge.right{right:12px}.status{margin-top:16px;padding:12px 14px;border-radius:10px;background:#f4f2ff;color:#4032a8;font-weight:700;display:none}.status.show{display:block}.footer{color:#7b8496;font-size:12px;margin-top:24px}.hidden{display:none!important}@media(max-width:680px){.brand span{display:none}.nav{gap:8px}.tabs .tab{padding:8px 9px}.new{font-size:12px;padding:9px}.heading h1{font-size:27px}.grid{grid-template-columns:1fr}.inputrow,.resulttop{align-items:flex-start;flex-direction:column}.download{width:100%}}
</style></head><body>
<div class="top"><div class="nav"><div class="brand"><div class="logo">↗</div><span>Asset Optimizer</span></div><div class="tabs"><button class="tab active" data-mode="spine">Spine</button><button class="tab" data-mode="image">Images</button><button class="tab" data-mode="gif">GIF</button></div><button class="new" id="newBtn">＋ New optimization</button></div></div>
<main class="wrap"><div class="heading"><div><h1 id="title">Spine Optimizer</h1><div class="sub" id="subtitle">Shrink atlas textures and Spine exports for web/mobile delivery.</div></div><button class="clear" id="clearBtn">× Clear</button></div>
<div class="card" id="inputCard"><div class="drop" id="drop"><div><strong id="dropTitle">Drop Spine export files here</strong><div class="muted" id="dropHint">JSON + .atlas + texture images</div><div style="margin-top:14px"><span class="replace">Choose files</span></div></div></div><input id="picker" type="file" multiple hidden></div>
<div class="card controls hidden" id="controls"><div class="inputrow"><div><div style="font-size:12px;font-weight:850;color:#667085;letter-spacing:.08em">INPUT</div><div class="big" id="inputSize">0 KB</div><div class="files" id="fileList"></div></div><button class="replace" id="replaceBtn">＋ Replace files</button></div></div>
<div class="card controls hidden" id="settings"><div class="qualityline"><div><h3 id="sliderTitle">Compression</h3><div class="muted" style="font-size:13px" id="sliderHelp">Higher keeps more detail. Lower pushes file size harder.</div></div><div class="qualitynum" id="qualityVal">78</div></div><input class="range" id="quality" type="range" min="30" max="100" value="78"><div class="grid"><label>Output<select id="format"></select></label><label>Scale<select id="scale"><option value="100">100% · original size</option><option value="90">90%</option><option value="75">75%</option><option value="60">60%</option><option value="50">50%</option><option value="35">35%</option><option value="25">25%</option></select></label><label>Palette<select id="colors"><option value="256">256 colors</option><option value="128">128 colors</option><option value="64">64 colors</option><option value="32">32 colors</option></select></label></div><div class="presets" id="presets"></div><details class="advanced" id="advanced"><summary>Advanced squeeze</summary><div class="muted" style="font-size:13px;margin-top:8px">Use scale + palette together only when you need to push the download lower. The before/after preview makes damage easy to spot.</div></details><div class="actions"><button class="run" id="runBtn">Optimize</button></div><div class="status" id="status"></div></div>
<div class="card result hidden" id="result"><div class="resulttop"><div><div style="font-size:12px;font-weight:850;color:#667085;letter-spacing:.08em">OPTIMIZED</div><div class="big" id="outSize">—</div><div class="saving" id="saving"></div></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="download" id="downloadBtn">↓ Download optimized file</button><button class="replace" id="againBtn">Optimize again</button></div></div><div id="previewWrap" class="hidden"><div class="compare" id="compare"><img id="afterImg" alt="Optimized preview"><img id="beforeImg" class="before" alt="Original preview"><div class="divider"></div><div class="handle">↔</div><div class="badge left">Original</div><div class="badge right">Optimized</div><input id="compareRange" type="range" min="0" max="100" value="50" aria-label="Before and after comparison"></div></div></div>
<div class="footer">Files are processed temporarily for this request and are not saved by the optimizer.</div></main>
<script>
const $=s=>document.querySelector(s); let mode='spine', files=[], resultData=null, beforeUrl=null;
const configs={spine:{title:'Spine Optimizer',sub:'Shrink atlas textures and Spine exports for web/mobile delivery.',drop:'Drop Spine export files here',hint:'JSON + .atlas + texture images',accept:'.json,.atlas,.png,.jpg,.jpeg,.webp',formats:[['preserve','Preserve texture format'],['webp','WebP · smallest for web']],presets:[['same','Same Look'],['balanced','Balanced'],['smallest','Smallest']]},image:{title:'Image Optimizer',sub:'Batch-compress game art and export PNG, JPG or WebP.',drop:'Drop images here',hint:'PNG · JPG · WebP · TIFF',accept:'image/png,image/jpeg,image/webp,image/tiff',formats:[['preserve','Preserve format'],['auto','Auto · recommended'],['webp','WebP'],['png','PNG'],['jpg','JPG']],presets:[['high','High quality'],['web','Web game'],['small','Small'],['tiny','Tiny']]},gif:{title:'GIF Optimizer',sub:'Shrink animated GIFs or convert them to animated WebP.',drop:'Drop GIFs here',hint:'GIF · animated WebP',accept:'image/gif,image/webp',formats:[['gif','Keep GIF'],['webp','Animated WebP · recommended']],presets:[['high','High quality'],['web','Web game'],['small','Small'],['tiny','Tiny']]}};
function fmt(n){if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(n<10240?1:0)+' KB';return (n/1048576).toFixed(2)+' MB'}
function renderMode(){const c=configs[mode];$('#title').textContent=c.title;$('#subtitle').textContent=c.sub;$('#dropTitle').textContent=c.drop;$('#dropHint').textContent=c.hint;$('#picker').accept=c.accept;$('#format').innerHTML=c.formats.map(x=>'<option value="'+x[0]+'">'+x[1]+'</option>').join('');$('#presets').innerHTML=c.presets.map(x=>'<button class="preset" data-preset="'+x[0]+'">'+x[1]+'</button>').join('');document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));reset(false)}
function reset(clear=true){if(clear)files=[];resultData=null;$('#result').classList.add('hidden');$('#status').classList.remove('show');$('#status').textContent='';if(beforeUrl){URL.revokeObjectURL(beforeUrl);beforeUrl=null}if(!files.length){$('#controls').classList.add('hidden');$('#settings').classList.add('hidden');$('#inputCard').classList.remove('hidden')}else{showFiles()}}
function showFiles(){const total=files.reduce((n,f)=>n+f.size,0);$('#inputSize').textContent=fmt(total);$('#fileList').textContent=files.length===1?files[0].name:(files.length+' files · '+files.slice(0,3).map(f=>f.name).join(', ')+(files.length>3?'…':''));$('#controls').classList.remove('hidden');$('#settings').classList.remove('hidden');$('#inputCard').classList.add('hidden')}
function setFiles(list){files=[...list];reset(false);if(files.length)showFiles()}
function preset(p){if(mode==='spine'){if(p==='same'){quality.value=94;scale.value=100;colors.value=256;format.value='preserve'}if(p==='balanced'){quality.value=78;scale.value=75;colors.value=128;format.value='webp'}if(p==='smallest'){quality.value=58;scale.value=50;colors.value=64;format.value='webp'}}else{if(p==='high'){quality.value=92;scale.value=100;colors.value=256;format.value=mode==='gif'?'gif':'preserve'}if(p==='web'){quality.value=80;scale.value=100;colors.value=128;format.value='webp'}if(p==='small'){quality.value=68;scale.value=75;colors.value=96;format.value='webp'}if(p==='tiny'){quality.value=52;scale.value=50;colors.value=64;format.value='webp'}}$('#qualityVal').textContent=quality.value}
async function optimize(){if(!files.length)return;const fd=new FormData();files.forEach(f=>fd.append('files',f,f.name));fd.append('mode',mode);fd.append('quality',quality.value);fd.append('scale',scale.value);fd.append('colors',colors.value);fd.append('format',format.value);const active=document.querySelector('.preset.active');if(active)fd.append('preset',active.dataset.preset);$('#runBtn').disabled=true;$('#status').textContent='Optimizing…';$('#status').classList.add('show');try{const r=await fetch('/api/optimize',{method:'POST',body:fd});const j=await r.json();if(!r.ok)throw new Error(j.error||'Optimization failed');resultData=j;$('#outSize').textContent=fmt(j.afterBytes);const before=files.reduce((n,f)=>n+f.size,0),saved=Math.max(0,Math.round((1-j.afterBytes/before)*100));$('#saving').textContent=saved?(saved+'% smaller'):'Optimized';$('#downloadBtn').textContent='↓ Download '+j.fileName;$('#result').classList.remove('hidden');$('#status').classList.remove('show');showPreview(j)}catch(e){$('#status').textContent=e.message;$('#status').classList.add('show')}finally{$('#runBtn').disabled=false}}
function showPreview(j){const target=j.previewOriginalName||j.preview?.originalName;const original=files.find(f=>f.name===target)||files.find(f=>f.type.startsWith('image/'));const p=j.preview;if(!original||!p){$('#previewWrap').classList.add('hidden');return}if(beforeUrl)URL.revokeObjectURL(beforeUrl);beforeUrl=URL.createObjectURL(original);$('#beforeImg').src=beforeUrl;$('#afterImg').src='data:'+p.contentType+';base64,'+p.data;$('#previewWrap').classList.remove('hidden')}
function download(){if(!resultData)return;const raw=atob(resultData.data),u=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([u],{type:resultData.contentType}));a.download=resultData.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
const drop=$('#drop'),picker=$('#picker'),quality=$('#quality'),scale=$('#scale'),colors=$('#colors'),format=$('#format');drop.onclick=()=>picker.click();$('#replaceBtn').onclick=()=>picker.click();picker.onchange=e=>setFiles(e.target.files);['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>setFiles(e.dataTransfer.files));quality.oninput=()=>$('#qualityVal').textContent=quality.value;$('#runBtn').onclick=optimize;$('#downloadBtn').onclick=download;$('#againBtn').onclick=()=>{resultData=null;$('#result').classList.add('hidden');window.scrollTo({top:220,behavior:'smooth'})};$('#clearBtn').onclick=()=>{files=[];picker.value='';reset(true)};$('#newBtn').onclick=()=>{files=[];picker.value='';reset(true);window.scrollTo({top:0,behavior:'smooth'})};document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;picker.value='';files=[];renderMode()});$('#presets').addEventListener('click',e=>{const b=e.target.closest('.preset');if(!b)return;document.querySelectorAll('.preset').forEach(x=>x.classList.remove('active'));b.classList.add('active');preset(b.dataset.preset)});$('#compareRange').oninput=e=>$('#compare').style.setProperty('--p',e.target.value+'%');renderMode();
</script></body></html>`;

const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='GET' && (req.url==='/' || req.url?.startsWith('/?'))) return sendHtml(res,HTML);
    if(req.method==='GET' && req.url==='/health') return sendJson(res,200,{ok:true});
    if(req.method==='POST' && req.url==='/api/optimize'){
      const {fields,files}=await parseMultipart(req); const mode=['spine','image','gif'].includes(fields.mode)?fields.mode:'image';
      const beforeBytes=files.reduce((n,f)=>n+f.buffer.length,0); const out=await optimizeAssets(files,fields,mode);
      return sendJson(res,200,{fileName:out.fileName,contentType:out.contentType,beforeBytes,afterBytes:out.afterBytes,data:out.data.toString('base64'),preview:out.preview,previewOriginalName:out.preview?.originalName});
    }
    sendJson(res,404,{error:'Not found'});
  }catch(e){ console.error(e); sendJson(res,400,{error:e?.message||'Optimization failed'}); }
});
server.listen(PORT,HOST,()=>console.log(`Asset Optimizer listening on ${HOST}:${PORT}`));
