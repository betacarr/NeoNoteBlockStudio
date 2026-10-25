import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {versions,sources,reportFile,hash,originalInventory,bindings,inputTsv,verifyOutput,scope} from './lwjgl21516-volume-common.mjs';

/** Local-only strict consumer: no compiler, process, network, device, native or game invocation. */
export async function reviewLwjgl21516SourceVolume({read=readFile,file=reportFile}={}){
 const bytes=await read(file),r=JSON.parse(bytes);assert.equal(r.schema,1);assert.equal(r.status,'passed');assert.equal(r.classification,'original-java-base-library-source-volume-components-only');assert.deepEqual(r.versions,versions);assert.deepEqual(r.scope,scope);assert.equal(r.entries.length,5);
 assert.deepEqual(Object.keys(r.sources),sources);for(const[f,h]of Object.entries(r.sources))assert.equal(hash(await read(f)),h,f);
 const raw=await read(r.rawReport.path);assert.equal(hash(raw),r.rawReport.sha256);const{rawReport,...body}=r;assert.deepEqual(body,JSON.parse(raw));
 const node=JSON.parse(await read(r.nodeProcess.path));assert.equal(hash(await read(r.nodeProcess.path)),r.nodeProcess.sha256);assert.equal(node.terminal,true);assert.equal(node.code,0);assert.equal(node.signal,null);assert(node.pid>0);assert.equal(hash(await read(node.executable)),node.executableSha256);assert.equal(path.resolve(node.argv[1]),path.resolve('scripts/audit-lwjgl21516-source-volume.mjs'));
 for(const[i,e]of r.entries.entries()){
  assert.equal(e.version,versions[i]);assert.deepEqual(e.scope,scope);const current=await originalInventory(e.version,{read});for(const[k,v]of Object.entries(current))assert.deepEqual(e[k],v,e.version+' '+k);
  const texts={};assert.deepEqual(Object.keys(e.disassembly),current.classes.map(c=>c.name));for(const[name,d]of Object.entries(e.disassembly)){const b=await read(d.path);assert.equal(hash(b),d.sha256);texts[name]=b.toString();}assert.deepEqual(e.bindings,bindings(current,texts));
  const expectedCp=[e.output,...current.artifacts.map(a=>path.resolve(a.file))].join(path.delimiter);assert.equal(e.classpath,expectedCp);assert.equal(e.processes.length,8);
  for(const[j,ref]of e.processes.entries()){
   const pb=await read(ref.path);assert.equal(hash(pb),ref.sha256);const p=JSON.parse(pb);assert.equal(p.terminal,true);assert.equal(p.code,0);assert.equal(p.signal,null);assert(p.pid>0);assert.equal(hash(await read(p.executable)),p.executableSha256);assert.equal(p.cwd,process.cwd());assert.equal((await read(p.stderrFile)).length,0);
   if(j<6){const c=current.classes[j];assert.equal(path.basename(p.executable).toLowerCase(),'javap.exe');assert.deepEqual(p.args,['-J-XX:ActiveProcessorCount=2','-p','-s','-c','-classpath',c.archive,c.name.replaceAll('/','.')]);assert.equal(hash(await read(p.stdoutFile)),e.disassembly[c.name].sha256);}
   else if(j===6){assert.equal(path.basename(p.executable).toLowerCase(),'javac.exe');assert.deepEqual(p.args,['--release','8','-cp',e.classpath,'-d',e.output,'scripts/java/Lwjgl21516SourceVolumeProbe.java']);}
   else{assert.equal(path.basename(p.executable).toLowerCase(),'java.exe');assert.deepEqual(p.args,['-XX:ActiveProcessorCount=2','-cp',e.classpath,'studio.nbsx.research.Lwjgl21516SourceVolumeProbe',e.output+'/inputs.tsv']);assert.equal(path.resolve(p.args.at(-1)),path.resolve(e.input.path));assert.equal(hash(await read(p.stdoutFile)),e.javaOutput.sha256);}
  }
  assert.equal(hash(await read(e.input.path)),e.input.sha256);assert.equal((await read(e.input.path)).toString(),inputTsv());assert.equal(hash(await read(e.javaOutput.path)),e.javaOutput.sha256);assert.deepEqual(e.checks,verifyOutput((await read(e.javaOutput.path)).toString()));
  const expectedClass=path.relative(process.cwd(),e.output).replaceAll('\\','/')+'/studio/nbsx/research/Lwjgl21516SourceVolumeProbe.class';assert.deepEqual(Object.keys(e.compiledClasses),[expectedClass]);assert.equal(hash(await read(expectedClass)),e.compiledClasses[expectedClass]);
 }
 assert.deepEqual(r.totals,{versions:5,rows:1320,bitComparisons:3960});
 return{status:'passed',evidence:{path:file,sha256:hash(bytes)},totals:r.totals,scope,versions:r.entries.map(e=>({version:e.version,checks:e.checks,clientSha1:e.official.client.sha1,libraryCode:e.bindings.find(b=>b.label==='library-source-clamp').codeSha256}))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await reviewLwjgl21516SourceVolume()));
