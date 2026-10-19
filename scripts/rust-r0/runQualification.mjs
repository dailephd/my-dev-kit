// Validation-only R0 harness. Never imported by production; no Rust compilation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import * as cp from 'node:child_process';
import {performance} from 'node:perf_hooks';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const CORPUS={
  "basic.rs": "//! Independent oracle: five function items, extern declaration, struct, enum,\n//! trait with required method and associated type, inherent and trait impl.\npub fn free() {}\npub async fn fetch() {}\npub const fn fixed() -> u8 { 1 }\npub unsafe fn dangerous() {}\npub extern \"C\" fn exported() {}\nunsafe extern \"C\" { fn foreign(); }\n#[derive(Debug)]\npub struct Widget { pub value: u8 }\npub enum State { Ready, Done(u8) }\npub trait Work { type Output; fn run(&self) -> Self::Output; }\nimpl Widget { pub fn run(&self) -> u8 { self.value } }\nimpl Work for Widget { type Output = u8; fn run(&self) -> u8 { self.value } }\n",
  "conditional.rs": "#[cfg(feature = \"alpha\")]\nfn chosen() {}\n#[cfg(not(feature = \"alpha\"))]\nfn chosen() {}\n#[cfg_attr(test, allow(dead_code))]\nasync fn edition_2018() { async {}.await; }\nfn edition_2021() { let _ = || async {}; }\nfn edition_2024() { let _ = gen { yield 1; }; }\n",
  "impl-collision.rs": "struct A;\nstruct B;\ntrait Runner { fn run(&self); }\nimpl A { fn run(&self) {} }\nimpl A { fn other(&self) {} }\nimpl B { fn run(&self) {} }\nimpl Runner for A { fn run(&self) {} }\n",
  "imports.rs": "extern crate core as legacy;\nuse crate::{left::{self, run as left_run}, right::*};\nuse self::legacy::fmt as formatting;\npub use super::external as public_external;\nfn imports_only() {}\n",
  "macros.rs": "macro_rules! make { () => { fn generated() {} }; }\nmake!();\nfn actual() { let _ = r###\"fn fake() {} impl Fake { fn run() {} }\"###; }\n// fn comment_fake() {}\n",
  "modules.rs": "mod external;\nmod left { pub fn run() {} mod inner { pub fn run() {} } }\nmod right { pub fn run() {} }\nfn r#type() {}\n",
  "unicode-malformed.rs": "/// café 😀 docs must not shift UTF-16 offsets\nfn café() { let 名 = \"😀\"; }\nfn r#async() {}\nfn broken( {\nfn after() {}\n"
};
CORPUS['unsafe-qualifiers.rs']='unsafe extern "C" {\n pub safe fn safe_fn();\n pub unsafe fn unsafe_fn();\n pub safe static VALUE: u8;\n pub static mut STATE: u8;\n}\n';
CORPUS['extern-malformed.rs']='unsafe extern "C" { safe fn broken( ;\n';
CORPUS['multiline.rs']='/// 😀\r\nfn café() {\r\n let _ = "😀";\r\n}\r\nfn next() {}\r\n';
const EXPECTED={
 'basic.rs':['free','fetch','fixed','dangerous','exported','foreign','Widget','State','Work','run','Output'],
 'conditional.rs':['chosen','edition_2018','edition_2021','edition_2024'],
 'impl-collision.rs':['A','B','Runner','run','other'],
 'imports.rs':['imports_only'],
 'macros.rs':['make','actual'],
 'modules.rs':['external','left','inner','right','run','r#type'],
 'unicode-malformed.rs':['café','r#async'],
 'unsafe-qualifiers.rs':['safe_fn','unsafe_fn','VALUE','STATE'],
 'extern-malformed.rs':[],
 'multiline.rs':['café','next'],
};
const sha=b=>createHash('sha256').update(b).digest('hex');
const write=(p,data)=>fs.writeFileSync(p,typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const files=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(p,e.name)):[path.join(p,e.name)]);
const flag=(n,k)=>typeof n[k]==='function'?n[k]():n[k];
const CASES=[
 {id:'official-native',backend:'native',family:'official',runtime:'tree-sitter',runtimeVersion:'0.22.4',grammar:'tree-sitter-rust',grammarVersion:'0.24.0',asset:'tree-sitter-rust.wasm'},
 {id:'official-wasm',backend:'wasm',family:'official',runtime:'web-tree-sitter',runtimeVersion:'0.25.10',grammar:'tree-sitter-rust',grammarVersion:'0.24.0',asset:'tree-sitter-rust.wasm'},
 {id:'official-release-wasm',backend:'wasm',family:'official-release',runtime:'web-tree-sitter',runtimeVersion:'0.25.10',grammar:'tree-sitter-rust',grammarVersion:'0.24.0',asset:'tree-sitter-rust.wasm',loadedGrammarVersion:'0.24.2',loadedGrammarRevision:'77a3747266f4d621d0757825e6b11edcbf991ca5',assetUrl:'https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.2/tree-sitter-rust.wasm',assetSha256:'24c89bd9252255e4aebbcbd7d2d308bd92c86dd95a130fdc80efa49577b8d738'},
 {id:'orchard-wasm',backend:'wasm',family:'orchard',runtime:'web-tree-sitter',runtimeVersion:'0.25.10',grammar:'tree-sitter-rust-orchard',grammarVersion:'0.16.10',asset:'tree-sitter-rust_orchard.wasm'}
];
async function probe(backend,family) {
 // Parsing must use packaged local assets and never launch user/compiler code.
 const child=createRequire(import.meta.url)('node:child_process');
 for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[k]=()=>{throw Error('runtime subprocess prohibited');};
 syncBuiltinESMExports();
 globalThis.fetch=()=>{throw Error('runtime network fetch prohibited');};
 for(const mod of ['node:http','node:https']){const m=createRequire(import.meta.url)(mod);m.request=m.get=()=>{throw Error('runtime HTTP prohibited');};}
 const net=createRequire(import.meta.url)('node:net');net.Socket.prototype.connect=()=>{throw Error('runtime network connect prohibited');};
 const init=performance.now();
 let parser;
 if(backend==='native') {
  const require=createRequire(import.meta.url);
  const Parser=require('tree-sitter'),grammar=require('tree-sitter-rust');
  parser=new Parser();parser.setLanguage(grammar);parser.setTimeoutMicros(1000000);
 } else {
  const require=createRequire(import.meta.url),entry=require.resolve('web-tree-sitter');
  const {Parser,Language}=await import(pathToFileURL(entry).href);
  await Parser.init({locateFile:n=>path.join(path.dirname(entry),n)});
  parser=new Parser();parser.setLanguage(await Language.load(path.join(HERE,'assets','grammar.wasm')));
 }
 const initializationMs=performance.now()-init;
 function parse(source){const until=performance.now()+1000;const tree=backend==='wasm'?parser.parse(source,null,{progressCallback:()=>performance.now()>until}):parser.parse(source);if(!tree)throw Error('parser timeout');return tree;}
 function inspect(tree,source) {
  const kinds={},decls=[],errors=[];
  function walk(n,ancestors=[],tainted=false) {
   kinds[n.type]=(kinds[n.type]??0)+1;
   const erroneous=n.type==='ERROR'||!!flag(n,'isMissing');
   if(erroneous)errors.push({kind:n.type,start:n.startPosition,end:n.endPosition,missing:!!flag(n,'isMissing')});
   const name=n.childForFieldName('name')?.text;
   // Grammar node names differ; observe every named field without pretending to extract production symbols.
   if(name)decls.push({kind:n.type,name,start:n.startIndex,end:n.endIndex,startLine:n.startPosition.row+1,endLine:n.endPosition.row+(n.endPosition.column>0?1:0),owners:ancestors,hasError:!!flag(n,'hasError'),errorAncestor:tainted,sliceMatches:source.slice(n.startIndex,n.endIndex)===n.text});
   const owner=/(impl|trait|mod)/.test(n.type)&&!/(modifier|identifier)/.test(n.type)?[...ancestors,n.type+':'+(name??n.childForFieldName('type')?.text??'?')+'@'+n.startIndex]:ancestors;
   for(const c of n.namedChildren)walk(c,owner,tainted||erroneous);
  }
  walk(tree.rootNode);
  return {root:tree.rootNode.type,hasError:!!flag(tree.rootNode,'hasError'),kinds,decls,errors};
 }
 const observations=[];
 for(const [file,source] of Object.entries(CORPUS)){
  if(Buffer.byteLength(source)>65536)throw Error('fixture size bound');
  const t=parse(source),o=inspect(t,source);t.delete?.();
  const negative=['unicode-malformed.rs','extern-malformed.rs'].includes(file);
  const unsupported=(family==='official'&&['basic.rs','unsafe-qualifiers.rs'].includes(file))||(family==='official-release'&&file==='unsafe-qualifiers.rs');
  const failures=[];
  if(o.hasError!==Boolean(negative||unsupported))failures.push('unexpected error/recovery state');
  // Recovery is never accepted as a trusted boundary, even if a child looks clean.
  const names=o.decls.map(d=>d.name);
  if(!negative&&!unsupported)for(const name of EXPECTED[file])if(!names.includes(name))failures.push('missing name '+name);
  if(file==='macros.rs')for(const name of ['generated','fake','comment_fake'])if(names.includes(name))failures.push('false declaration '+name);
  if(o.decls.some(d=>!d.sliceMatches))failures.push('UTF-16 slice mismatch');
  // Orchard attaches outer documentation/attributes to the item; official grammar leaves them siblings.
  // Both must include the exact closing line, with no spill into next().
  const expectedStart=family==='orchard'?1:2;
  if(file==='multiline.rs'&&!o.decls.some(d=>d.name==='café'&&d.startLine===expectedStart&&d.endLine===4))failures.push('inclusive CRLF range');
  if(family==='orchard'&&['basic.rs','unsafe-qualifiers.rs'].includes(file)&&o.kinds.foreign_mod_item!==1)failures.push('foreign block structure missing');
  if(file==='impl-collision.rs'){
   const runs=o.decls.filter(d=>d.name==='run');
   if(runs.length!==4||new Set(runs.map(d=>d.start)).size!==4)failures.push('ownership/source positions lost');
  }
  observations.push({file,sha256:sha(Buffer.from(source)),bytes:Buffer.byteLength(source),expectedNegative:negative,requiredSyntaxUnsupported:unsupported,failures,...o});
 }
 for(let i=0;i<10;i++)for(const source of Object.values(CORPUS)){const t=parse(source);t.delete?.();}
 const warmBatchMs=[],rssSamples=[];
 for(let s=0;s<5;s++){globalThis.gc?.();const begin=performance.now();for(let j=0;j<50;j++)for(const source of Object.values(CORPUS)){const t=parse(source);t.delete?.();}warmBatchMs.push(performance.now()-begin);rssSamples.push(process.memoryUsage().rss);if(rssSamples.at(-1)>512*1024*1024)throw Error('RSS budget exceeded');}
 parser.delete?.();
 return {backend,family,node:process.version,platform:process.platform,arch:process.arch,os:os.release(),cpu:os.cpus()[0].model,initializationMs,observations,warmBatchMs,rssSamples,memory:process.memoryUsage(),maxRSSKiB:process.resourceUsage().maxRSS,corpusBytes:Object.values(CORPUS).reduce((s,v)=>s+Buffer.byteLength(v),0),method:{warmup:10,samples:5,passesPerSample:50,fixtures:10,incremental:false,runtimeNetworkBlocked:true,runtimeSubprocessBlocked:true,parseDeadlineMs:1000},failures:observations.flatMap(o=>o.failures.map(f=>o.file+': '+f))};
}
function npmCli(){
 const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
 const p=candidates.find(p=>fs.existsSync(p));if(!p)throw Error('npm JS entry not found');return p;
}
async function qualify(root,only,attempt){
 fs.mkdirSync(root,{recursive:true});
 for(const n of ['grammar','results','fixtures','npm-cache'])fs.mkdirSync(path.join(root,n),{recursive:true});
 for(const [name,source] of Object.entries(CORPUS)){const p=path.join(root,'fixtures',name);if(fs.existsSync(p)){if(fs.readFileSync(p,'utf8')!==source)throw Error('fixture collision '+name);}else write(p,source);}
 const all=[];
 for(const base of CASES.filter(c=>!only||c.id===only)){
  const c={...base,id:base.id+(attempt?'-'+attempt:'')};
  const task=path.join(root,'grammar',c.id);if(fs.existsSync(task))throw Error('BLOCKED_OUTPUT_PATH_COLLISION '+task);fs.mkdirSync(task);
  const cache=path.join(root,'npm-cache',c.id);if(fs.existsSync(cache))throw Error('cache collision');fs.mkdirSync(cache);
  const tmp=path.join(task,'tmp');fs.mkdirSync(tmp);
  const env={...process.env,TEMP:tmp,TMP:tmp,TMPDIR:tmp,NODE_DISABLE_COMPILE_CACHE:'1',npm_config_cache:cache,npm_config_logs_max:'10000',npm_config_update_notifier:'false',npm_config_audit:'false',npm_config_fund:'false',npm_config_node_gyp:path.join(task,'deny-tool.cjs'),CC:path.join(task,'deny-tool.cjs'),CXX:path.join(task,'deny-tool.cjs'),RUSTC:path.join(task,'deny-tool.cjs'),CARGO:path.join(task,'deny-tool.cjs')};
  write(path.join(task,'deny-tool.cjs'),"throw Error('Compiler/toolchain invocation prohibited in R0 qualification');\n");
  const logs=[];
  function npm(args,cwd){const p=cp.spawnSync(process.execPath,[npmCli(),...args],{cwd,env,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});logs.push({args,cwd:path.relative(root,cwd),status:p.status,stdout:p.stdout,stderr:p.stderr,error:p.error?.message});if(p.status!==0)throw Error('npm failed '+JSON.stringify(logs.at(-1)));return p.stdout;}
  const stage=path.join(task,'package');fs.mkdirSync(stage);
  const prepDeps={[c.runtime]:c.runtimeVersion,[c.grammar]:c.grammarVersion,'node-addon-api':'8.5.0','node-gyp-build':'4.8.4'};
  write(path.join(stage,'package.json'),{name:'mdk-r0-qualification-'+c.id,version:'0.0.0',private:true,type:'module',dependencies:prepDeps});
  const result={candidate:c,host:{platform:process.platform,arch:process.arch,node:process.version},logs};
  try{
   const start=performance.now();npm(['install','--ignore-scripts','--no-audit','--no-fund'],stage);result.preparationInstallMs=performance.now()-start;
   const grammar=path.join(stage,'node_modules',c.grammar);
   result.grammarAssets=files(grammar).filter(p=>/\.(node|wasm)$/.test(p)).map(p=>({path:path.relative(grammar,p),bytes:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))}));
   result.grammarSource=['grammar.js','src/parser.c','src/scanner.c'].map(p=>({path:p,sha256:sha(fs.readFileSync(path.join(grammar,p)))}));
   result.orchardNativePrebuildPresent=c.family==='orchard'?result.grammarAssets.some(p=>p.path.endsWith('.node')):undefined;
   const assets=path.join(stage,'assets');fs.mkdirSync(assets);
   if(c.assetUrl){
    const response=await fetch(c.assetUrl);if(!response.ok)throw Error('release asset HTTP '+response.status);
    const bytes=Buffer.from(await response.arrayBuffer());if(sha(bytes)!==c.assetSha256)throw Error('release asset integrity mismatch');
    write(path.join(assets,'grammar.wasm'),bytes);
    result.loadedGrammar={version:c.loadedGrammarVersion,revision:c.loadedGrammarRevision,url:c.assetUrl,bytes:bytes.length,sha256:sha(bytes),preparationSourceIsNotLoadedGrammar:true};
   }else fs.copyFileSync(path.join(grammar,c.asset),path.join(assets,'grammar.wasm'));
   const licenses=path.join(stage,'LICENSES');fs.mkdirSync(licenses);
   for(const name of Object.keys(prepDeps)){const p=path.join(stage,'node_modules',name);const j=JSON.parse(fs.readFileSync(path.join(p,'package.json')));const license=fs.readdirSync(p).find(n=>/^license(\.md)?$/i.test(n));if(!license)throw Error('missing license '+name);fs.copyFileSync(path.join(p,license),path.join(licenses,name+'.txt'));(result.licenses??=[]).push({name,version:j.version,declaredLicense:j.license,sha256:sha(fs.readFileSync(path.join(p,license)))});}
   fs.copyFileSync(fileURLToPath(import.meta.url),path.join(stage,'runner.mjs'));
   const deps=c.backend==='native'?prepDeps:{'web-tree-sitter':c.runtimeVersion};
   fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:'mdk-r0-qualification-'+c.id,version:'0.0.0',private:true,type:'module',files:['runner.mjs','assets','LICENSES'],dependencies:deps,bundleDependencies:Object.keys(deps)},null,2));
   const packed=JSON.parse(npm(['pack','--ignore-scripts','--json','--pack-destination',task],stage))[0];
   const tarball=path.join(task,packed.filename);
   result.pack={filename:packed.filename,bytes:fs.statSync(tarball).size,unpackedSize:packed.unpackedSize,sha256:sha(fs.readFileSync(tarball)),files:packed.files.map(f=>({path:f.path,size:f.size}))};
   const consumer=path.join(task,'consumer');fs.mkdirSync(consumer);write(path.join(consumer,'package.json'),{name:'r0-clean-consumer',version:'0.0.0',private:true});
   const install=performance.now();npm(['install','--offline','--ignore-scripts=false','--no-audit','--no-fund',tarball],consumer);result.consumerInstallMs=performance.now()-install;
   const installed=path.join(consumer,'node_modules','mdk-r0-qualification-'+c.id);
   const installedFiles=files(installed);result.installedBytes=installedFiles.reduce((s,p)=>s+fs.statSync(p).size,0);
   result.loadedAssetBytes=c.backend==='wasm'?fs.statSync(path.join(installed,'assets/grammar.wasm')).size+fs.statSync(path.join(installed,'node_modules/web-tree-sitter/tree-sitter.wasm')).size:null;
   result.cold=[];
   for(let n=0;n<3;n++){
    const start=performance.now();const p=cp.spawnSync(process.execPath,['--expose-gc',path.join(installed,'runner.mjs'),'--probe',c.backend,c.family],{env,encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024});
    result.cold.push({wallMs:performance.now()-start,status:p.status,stderr:p.stderr});
    if(p.status!==0)throw Error('consumer failed '+p.stderr);
    const observed=JSON.parse(p.stdout);
    if(n===0)result.observation=observed;
    if(observed.failures.length)throw Error('oracle failure '+observed.failures.join('; '));
    result.cold.at(-1).initializationMs=observed.initializationMs;
   }
   result.status='QUALIFIED_WITH_UNSUPPORTED_SYNTAX';
   if(c.family==='orchard')result.status='QUALIFIED_TESTED_CORPUS';
  }catch(e){result.status='BLOCKED';result.error=String(e);}
  write(path.join(root,'results',c.id+'.json'),result);all.push({candidate:c.id,status:result.status,error:result.error});
  console.log(JSON.stringify(all.at(-1)));
 }
 write(path.join(root,'results','summary'+(only?'-'+only:'')+(attempt?'-'+attempt:'')+'.json'),{createdAt:new Date().toISOString(),corpus:Object.entries(CORPUS).map(([name,text])=>({name,sha256:sha(Buffer.from(text)),bytes:Buffer.byteLength(text)})),all});
 if(all.some(x=>x.status==='BLOCKED'))process.exitCode=1;
}
if(process.argv[2]==='--probe'){console.log(JSON.stringify(await probe(process.argv[3],process.argv[4])));}
else{
 const p=process.argv.indexOf('--out');if(p<0)throw Error('--out required');
 const q=process.argv.indexOf('--candidate');
 const a=process.argv.indexOf('--attempt');
 const attempt=a<0?undefined:process.argv[a+1];if(attempt&&!/^[a-z0-9-]+$/.test(attempt))throw Error('invalid attempt');
 await qualify(path.resolve(process.argv[p+1]),q<0?undefined:process.argv[q+1],attempt);
}
