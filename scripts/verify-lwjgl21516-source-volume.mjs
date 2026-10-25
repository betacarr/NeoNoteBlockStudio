import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {reviewLwjgl21516SourceVolume} from './review-lwjgl21516-source-volume.mjs';
import {reportFile,hash} from './lwjgl21516-volume-common.mjs';

// All negative edits are virtual read overlays. Original archives, raw Java output and public evidence remain untouched.
const original=JSON.parse(await readFile(reportFile)),negative=[];
async function reject(label,mutate){
 const report=structuredClone(original),overlay=new Map(),put=(file,b)=>overlay.set(path.resolve(file),Buffer.isBuffer(b)?b:Buffer.from(b));
 await mutate(report,put);const{rawReport,...body}=report,raw=Buffer.from(JSON.stringify(body,null,2)+'\n');put(rawReport.path,raw);report.rawReport.sha256=hash(raw);put(reportFile,JSON.stringify(report,null,2)+'\n');
 let error;try{await reviewLwjgl21516SourceVolume({read:async file=>overlay.get(path.resolve(file))??readFile(file)});}catch(e){error=String(e);}assert(error,'Negative accepted: '+label);negative.push({label,rejected:true,error});
}
const positive=await reviewLwjgl21516SourceVolume();
await reject('no-world-scope',r=>r.scope.worldScenesAdded=1);
await reject('all-five-versions-required',r=>r.entries.pop());
await reject('ordered-official-version',r=>r.entries[0].version='1.5.2');
await reject('exact-official-client',r=>r.entries[0].official.client.sha1='0'.repeat(40));
await reject('exact-library-class',r=>r.entries[0].classes.find(c=>c.role==='Library').classSha256='0'.repeat(64));
await reject('exact-library-code',r=>r.entries[0].classes.find(c=>c.role==='Library').code['setVolume(Ljava/lang/String;F)V']='0'.repeat(64));
await reject('positionChanged-code-binding',r=>r.entries[0].bindings.find(b=>b.role==='Source').codeSha256='0'.repeat(64));
await reject('command14-caller-binding',r=>r.entries[0].bindings.find(b=>b.label==='public-set-volume-enqueues14').tokens=['bipush        15']);
await reject('no-classpath-subclass-injection',r=>r.entries[0].classpath+=';fake-openal.jar');
await reject('no-extra-shadow-compiled-class',r=>r.entries[0].compiledClasses['fake/paulscode/sound/Library.class']='0'.repeat(64));
await reject('compiled-helper-hash',(r,put)=>put(Object.keys(r.entries[0].compiledClasses)[0],Buffer.from('changed')));
await reject('source-closure',(r,put)=>put('scripts/java/Lwjgl21516SourceVolumeProbe.java',Buffer.from('changed')));
await reject('java-terminal-required',async(r,put)=>{const ref=r.entries[0].processes.at(-1),p=JSON.parse(await readFile(ref.path));p.terminal=false;const b=Buffer.from(JSON.stringify(p));put(ref.path,b);ref.sha256=hash(b);});
await reject('java-exit-zero-required',async(r,put)=>{const ref=r.entries[0].processes.at(-1),p=JSON.parse(await readFile(ref.path));p.code=1;const b=Buffer.from(JSON.stringify(p));put(ref.path,b);ref.sha256=hash(b);});
await reject('java-original-main-args',async(r,put)=>{const ref=r.entries[0].processes.at(-1),p=JSON.parse(await readFile(ref.path));p.args[3]='DifferentProbe';const b=Buffer.from(JSON.stringify(p));put(ref.path,b);ref.sha256=hash(b);});
await reject('exact-input-bits',async(r,put)=>{const ref=r.entries[0].input,b=Buffer.from((await readFile(ref.path)).toString().replace('ff7fffff','bf800000'));put(ref.path,b);ref.sha256=hash(b);});
await reject('raw-output-hash',async(r,put)=>put(r.entries[0].javaOutput.path,Buffer.from('changed')));
await reject('actual-downstream-clamp-bit',async(r,put)=>{const e=r.entries[0],ref=e.javaOutput,b=Buffer.from((await readFile(ref.path)).toString().replace('pipeline-14-10\t40000000\t3f800000','pipeline-14-10\t40000000\t40000000'));assert.notEqual(hash(b),ref.sha256);put(ref.path,b);ref.sha256=hash(b);});
await reject('fixed-actual-counts',r=>r.entries[0].checks.bitComparisons--);
await reject('aggregate-comparison-count',r=>r.totals.bitComparisons++);
const root=path.resolve('.local/lwjgl21516-source-volume',`validation-${Date.now()}`);await mkdir(root,{recursive:true});const result={status:'passed',pid:process.pid,positive,negative,negativeCount:negative.length,originalEvidenceSha256:hash(await readFile(reportFile)),nativeExecuted:false,worldScenesAdded:0};await writeFile(root+'/report.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'passed',positive:positive.totals,negative:negative.length,report:root+'/report.json',sha256:hash(await readFile(root+'/report.json'))}));
