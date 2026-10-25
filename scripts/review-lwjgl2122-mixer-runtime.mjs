import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runtimeSources,evidenceFile,sha,reviewedRuntimeInputs,runtimeMemoryTests} from './prepare-lwjgl2122-mixer-runtime.mjs';
import {verifyControllerOriginalIdentity,controllerIdentityNegativeTests} from './lwjgl2122-mixer-identity.mjs';
const parse=async f=>JSON.parse(await readFile(f));
function methodInstructions(text){const begin=text.indexOf('public static org.lwjgl.openal.ALCcontext alcCreateContext('),end=text.indexOf('static native long nalcCreateContext',begin);assert(begin>=0&&end>begin);return text.slice(begin,end).split(/\r?\n/).map(l=>l.match(/^\s*(\d+):\s+([a-z][a-z0-9_]*)(.*)$/)).filter(Boolean).map(m=>({offset:Number(m[1]),opcode:m[2],rest:m[3].trim()}));}
export function reviewRuntimeHook(originalText,observedText){
 const a=methodInstructions(originalText),b=methodInstructions(observedText),filtered=[],hooks={entry:0,beforeNative:0,afterNative:0};
 for(let i=0;i<b.length;i++){const next=b[i+1],hook=next?.rest.match(/studio\/nbsx\/research\/Lwjgl2122MixerRuntime\.(entry|beforeNative|afterNative):/);if(hook){assert.equal(next.opcode,'invokestatic');assert.equal(b[i].opcode,hook[1]==='entry'?'aload_1':'dup2');hooks[hook[1]]++;i++;}else filtered.push(b[i]);}
 const normalize=list=>list.map(x=>{let rest=x.rest.replace(/#\d+/g,'#').replace(/\s+/g,' ');if(/^if|^goto/.test(x.opcode)){const j=list.findIndex(y=>y.offset===Number(rest));assert(j>=0);rest='instruction:'+j;}return x.opcode+' '+rest;});
 assert.equal(a.length,42);assert.equal(b.length,48);assert.deepEqual(hooks,{entry:1,beforeNative:1,afterNative:1});assert.deepEqual(normalize(a),normalize(filtered));return{original:42,observed:48,onlyThreeHookPairs:true,originalArgumentsAndNativeInstructionRetained:true};
}
/** Local-only: no compiler, Java, controller/observer loading, OpenAL or process execution. */
export async function reviewMixerRuntimePreparation(file=evidenceFile){
 const bytes=await readFile(file),r=JSON.parse(bytes);assert.equal(r.status,'prepared-not-executed');assert.equal(r.classification,'regular-mixer-runtime-static-preparation-only');assert.equal(r.version,'1.12.2');
 for(const k of ['controllerLoaded','observerLoaded','originalALCreateExecuted','old49Promoted','pcmEquivalenceProven'])assert.equal(r[k],false);for(const k of ['nativeExecutionsAdded','sourceBufferRenderCalls','worldScenesAdded','sourceInstructionsRelocated'])assert.equal(r[k],0);
 assert.equal(r.physicalStoreBytes,8);assert.equal(r.logicalChangedBytes,5);assert.equal(r.unchangedTailBytes,3);assert.deepEqual(r.inputs,await reviewedRuntimeInputs());
 assert.deepEqual(Object.keys(r.sources),runtimeSources);for(const[f,h]of Object.entries(r.sources)){assert.equal(sha(await readFile(f)),h,f);assert.equal(sha(await readFile(path.join(r.root,path.basename(f)))),h);}
 const cpp=await readFile('scripts/native/Lwjgl2122MixerRuntime.cpp','utf8'),originalDll=await readFile(r.inputs.binary.file),compiled=await readFile(r.controller);assert.deepEqual(r.controllerIdentity,verifyControllerOriginalIdentity(cpp,r.inputs.binary.sha256,originalDll,compiled));assert.deepEqual(r.identityNegativeTests,controllerIdentityNegativeTests(cpp,r.inputs.binary.sha256,originalDll,compiled));assert.equal(r.identityNegativeTests.length,7);
 for(const[f,h]of Object.entries({...r.files,...r.headerHashes,...r.compiledClasses}))assert.equal(sha(await readFile(f)),h,f);assert.equal(sha(await readFile(r.asm.path)),r.asm.sha256);
 assert.deepEqual(await parse(path.join(r.root,'report.json')),r);const original=await readFile(r.inputs.binary.file),plan=await parse(r.inputs.planEvidence.path);assert.deepEqual(r.memoryTests,runtimeMemoryTests(original.subarray(plan.binding.patchFileOffset,plan.binding.patchFileOffset+8)));assert.equal(r.memoryTests.length,22);
 const processes=[];for(const ref of r.processes){const p=await parse(ref.path);assert.equal(sha(await readFile(ref.path)),ref.sha256);assert(p.pid>0);assert.equal(p.terminal,true);assert.equal(p.code,0);assert.equal(p.signal,null);assert.equal(sha(await readFile(p.command)),p.toolSha256);processes.push(p);}
 const labels=processes.map(p=>path.basename(p.stdout).replace('.stdout.log',''));assert.deepEqual(labels,['compile-runtime','link-runtime','inspect-runtime','disassemble-runtime','compile-java','pure-java-transform','javap-ALC10.original','javap-ALC10.observed','javap-AL10.observed','javap-AL11.observed','javap-studio_nbsx_research_Lwjgl2122MixerRuntime','pack-agent']);
 const pure=processes.find(p=>p.args.includes('--transform-only'));assert(pure);assert(!pure.args.some(a=>a.startsWith('-javaagent:')||a.includes('librarypath')));assert.equal((await readFile(pure.stdout)).toString().trim(),'TRANSFORM_ONLY_NO_NATIVE');
 const dump=(await readFile(processes[2].stdout)).toString(),asm=(await readFile(processes[3].stdout)).toString();assert(dump.includes('0 entry point'));assert(/KERNEL32.dll/i.test(dump));assert(/bcrypt.dll/i.test(dump));assert(!/OpenAL64\.dll|lwjgl64\.dll|VCRUNTIME\d+\.dll|ucrtbase\.dll/i.test(dump));assert(asm.includes('lock cmpxchg'));
 const header=(await readFile(path.join(r.root,'studio_nbsx_research_Lwjgl2122MixerRuntime.h'))).toString(),exports=[...header.matchAll(/JNIEXPORT[^\n]+JNICALL (Java_\w+)/g)].map(m=>m[1]);assert.equal(exports.length,12);for(const e of exports)assert(dump.includes(e),e);
 const hook=reviewRuntimeHook((await readFile(processes[6].stdout)).toString(),(await readFile(processes[7].stdout)).toString());
 const runtime=(await readFile(processes[10].stdout)).toString();assert(runtime.includes('Method java/lang/System.load:'));assert(runtime.indexOf('String --transform-only')<runtime.indexOf('Reviewed javaagent and explicit isolated root required'));
 const noNativeClass=Object.keys(r.compiledClasses).filter(f=>f.includes('/studio/'));assert(noNativeClass.length>=4);assert(noNativeClass.every(f=>/\/Lwjgl2122MixerRuntime(?:\$[0-9]+)*\.class$/.test(f)));
 const report={status:'passed',evidence:{path:file,sha256:sha(bytes)},runtimeLoaded:false,nativeExecutionsAdded:0,memoryTests:r.memoryTests.length,identityNegativeTests:r.identityNegativeTests.length,controllerOriginalHash:r.controllerIdentity.cppOriginalHashBytesHex,staticProcesses:processes.length,headerFiles:Object.keys(r.headerHashes).length,hook,physicalStoreBytes:8,logicalChangedBytes:5,worldScenesAdded:0,old49Promoted:false};return{...report,prepared:r};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const{prepared,...r}=await reviewMixerRuntimePreparation();console.log(JSON.stringify(r));}
