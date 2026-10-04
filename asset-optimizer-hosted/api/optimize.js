import path from 'node:path';
import Busboy from 'busboy';
import sharp from 'sharp';
import { zipSync } from 'fflate';

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

export const config = { api: { bodyParser: false, responseLimit: false } };

export default async function handler(req,res){
  try{
    if(req.method!=='POST'){ res.status(405).json({error:'Method not allowed'}); return; }
    const {fields,files}=await parseMultipart(req);
    const mode=['spine','image','gif'].includes(fields.mode)?fields.mode:'image';
    const beforeBytes=files.reduce((n,f)=>n+f.buffer.length,0);
    const out=await optimizeAssets(files,fields,mode);
    res.setHeader('Cache-Control','no-store');
    res.status(200).json({fileName:out.fileName,contentType:out.contentType,beforeBytes,afterBytes:out.afterBytes,data:out.data.toString('base64'),preview:out.preview,previewOriginalName:out.preview?.originalName});
  }catch(e){ console.error(e); res.status(400).json({error:e?.message||'Optimization failed'}); }
}
