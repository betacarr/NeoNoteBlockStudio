import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {inspectSilentMixerPilot,reviewPublishedSilentMixerPilot,pilotRoot,pilotReviewFile,hash} from './review-lwjgl2122-silent-mixer-pilot.mjs';

// No file mutation of raw pilot or frozen preparation: all changes are virtual overlays.
const original=JSON.parse(await readFile(pilotRoot+'/report.json')),negative=[];
async function reject(name,change){const report=structuredClone(original),overlay=new Map(),put=(file,b)=>{b=Buffer.isBuffer(b)?b:Buffer.from(b);overlay.set(path.resolve(file),b);const rel=path.relative(path.resolve(pilotRoot),path.resolve(file)).replaceAll('\\','/');if(Object.hasOwn(report.files,rel))report.files[rel]=hash(b);};await change(report,put);overlay.set(path.resolve(pilotRoot+'/report.json'),Buffer.from(JSON.stringify(report)));let error;try{await inspectSilentMixerPilot({read:async file=>overlay.get(path.resolve(file))??readFile(file)});}catch(e){error=String(e);}assert(error,'Negative accepted: '+name);negative.push({name,rejected:true,error});}
const positive=await reviewPublishedSilentMixerPilot();
const java=(await readFile('scripts/java/Lwjgl2122MixerRuntime.java','utf8')),names=JSON.parse('['+/String\[\] NAMES=\{([^}]+)\}/.exec(java)[1]+']'),counters=['bufferBase','attributePointer','installed','restored','released','armed','inflight','calls','attempted','committed','dropped','invalid','processId'];
const stateChange=(index,value)=>async(r,put)=>{const file=pilotRoot+'/state-complete-silent-candidate.bin',b=await readFile(file);b.writeBigUInt64LE(value,index*8);put(file,b);if(index<77){const key=index<64?'native.'+names[index]:'recorder.'+counters[index-64],source=(await readFile(pilotRoot+'/actual.properties')).toString(),lines=source.split(/\r?\n/);assert(lines.some(l=>l.startsWith(key+'=')));put(pilotRoot+'/actual.properties',lines.map(l=>l.startsWith(key+'=')?key+'='+value:l).join('\n'));}};
await reject('terminal-nonzero',async(r,put)=>{r.process.code=1;put(pilotRoot+'/process.json',JSON.stringify(r.process));});
await reject('terminal-running',async(r,put)=>{r.process.terminal=false;put(pilotRoot+'/process.json',JSON.stringify(r.process));});
await reject('wrong-preparation-identity',r=>r.preparedEvidence.sha256='0'.repeat(64));
await reject('world-promotion-forbidden',r=>r.old49Promoted=true);
await reject('parameter-pointer-not-preserved',stateChange(65,123n));
await reject('context-not-created',stateChange(32,0n));
await reject('native-list-incomplete',stateChange(78,2n));
await reject('native-lists-differ',stateChange(77+261+4,123n));
await reject('join-not-signaled',stateChange(51,258n));
await reject('wrapper-still-inflight',stateChange(70,1n));
await reject('worker-other-process',stateChange(45,999n));
await reject('observer-export-address-differs',stateChange(17,123n));
await reject('code-restore-not-complete',stateChange(57,0n));
await reject('guard-check-failed',stateChange(15,0n));
await reject('canary-check-failed',stateChange(54,0n));
await reject('private-release-incomplete',stateChange(68,0n));
await reject('full-text-restore-byte-changed',async(r,put)=>{const file=pilotRoot+'/restored-mapped-text.bin',b=await readFile(file);b[10]^=1;put(file,b);});
await reject('patch-tail3-changed',async(r,put)=>{const file=pilotRoot+'/installed-mapped-text.bin',b=await readFile(file);b[0x202c8-0x1000+5]^=1;put(file,b);});
await reject('silent-PCM-not-zero',async(r,put)=>{const file=pilotRoot+'/packets/packet-0000.bin',b=await readFile(file);b.writeUInt32LE(1,64);put(file,b);});
await reject('slot-unpublished',async(r,put)=>{const file=pilotRoot+'/packets/packet-0000.bin',b=await readFile(file);b.writeBigUInt64LE(0n);put(file,b);});
await reject('slot-frame-length-mismatch',async(r,put)=>{const file=pilotRoot+'/packets/packet-0000.bin',b=await readFile(file);b.writeUInt32LE(961,32);put(file,b);});
await reject('slot-original-device-differs',async(r,put)=>{const file=pilotRoot+'/packets/packet-0000.bin',b=await readFile(file);b.writeBigUInt64LE(1n,16);put(file,b);});
await reject('SDK-source-call-not-zero',async(r,put)=>put(pilotRoot+'/actual.properties',(await readFile(pilotRoot+'/actual.properties')).toString().replace('sdk.sourceCalls=0','sdk.sourceCalls=1')));
await reject('cleanup-did-not-return',async(r,put)=>put(pilotRoot+'/actual.properties',(await readFile(pilotRoot+'/actual.properties')).toString().replace('original.cleanupReturned=true','original.cleanupReturned=false')));
await reject('native-free-log-before-cleanup',async(r,put)=>{const file=pilotRoot+'/stderr.log',text=(await readFile(file)).toString(),line=/^AL lib: \(II\) FreeContext: [^\r\n]+\r?\n/m.exec(text)[0],changed=text.replace(line,'').replace('NBSX_MIXER_STAGE before-original-cleanup',line+'NBSX_MIXER_STAGE before-original-cleanup');put(file,changed);r.process.stderrSha256=hash(Buffer.from(changed));put(pilotRoot+'/process.json',JSON.stringify(r.process));});
const root=path.resolve('.local/lwjgl2122-mixer-runtime',`review-negative-${Date.now()}`);await mkdir(root,{recursive:true});const result={schema:1,status:'passed',pid:process.pid,positive,negativeCount:negative.length,negative,nativeExecutionsAdded:0,rawFilesModified:false,evidence:{path:pilotReviewFile,sha256:hash(await readFile(pilotReviewFile))}};await writeFile(root+'/report.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'passed',negative:negative.length,report:root+'/report.json',sha256:hash(await readFile(root+'/report.json')),nativeExecuted:false}));
