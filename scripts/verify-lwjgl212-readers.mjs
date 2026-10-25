import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {digest} from './research-utils.mjs';
import {patchVersions,verifiedLwjgl212Source} from './review-lwjgl212-source.mjs';
import {verifiedLwjgl212ContextControl} from './review-lwjgl212-context-control.mjs';
import {verifiedLwjgl212Components} from './probe-lwjgl212-methods.mjs';
import {reviewedLwjgl212Profile} from './review-lwjgl212-profiles.mjs';

// Isolated damaged evidence exercises the actual read-only readers. No shared
// evidence, client, scalar reference or product file is edited by this script.
const root=path.resolve('.local/lwjgl212-reader-negative',`run-${Date.now()}`);
await mkdir(root,{recursive:true});
const sha=bytes=>digest(bytes,'sha256'),inputHashes={},observations=[],adapters=[];
const ref=async file=>({path:path.relative(process.cwd(),file).replaceAll('\\','/'),sha256:sha(await readFile(file))});
const snapshot=async file=>{const bytes=await readFile(file);inputHashes[file]=sha(bytes);return JSON.parse(bytes);};
for(const version of patchVersions){
 const source=await snapshot(`docs/evidence/java-${version}-audio-source.json`),context=await snapshot(`docs/evidence/java-${version}-hrtf-control-source.json`),numeric=await snapshot(`docs/evidence/java-${version}-numeric-components.json`);
 for(const r of [source,context]){await snapshot(r.rawEvidence.path);for(const file of Object.keys(r.sources))inputHashes[file]=sha(await readFile(file));}
 for(const file of Object.keys(numeric.sources))inputHashes[file]=sha(await readFile(file));
 await verifiedLwjgl212Source(version);await verifiedLwjgl212ContextControl(version);await verifiedLwjgl212Components(version);const adapter=await reviewedLwjgl212Profile(version);assert.equal(adapter.legacy.noteSoundTableSize,10);assert.equal(adapter.legacy.materials.length,10);assert(!('pitchTransport' in adapter.legacy));assert.equal(adapter.legacy.packetPitchEncoding,'float32');assert.equal(adapter.legacy.nestedSoundEventArithmetic,'float-parent-child-multiply');assert.equal(adapter.legacy.gameRecording,'pending');adapters.push(adapter);
 const reject=async(kind,name,original,mutate)=>{
  const fixture=structuredClone(original);await mutate(fixture);
  // Re-hash a matching fake raw JSON too: fact/Code negatives cannot pass merely
  // because the reader notices a shallow public-vs-raw hash disagreement.
  if(fixture.rawEvidence){const raw=path.join(root,`${version}-${name}-raw.json`),value={...fixture};delete value.rawEvidence;await writeFile(raw,JSON.stringify(value,null,2));fixture.rawEvidence={path:raw,sha256:sha(await readFile(raw))};}
  const file=path.join(root,`${version}-${name}.json`);await writeFile(file,JSON.stringify(fixture,null,2));let reason;
  try{await(kind==='source'?verifiedLwjgl212Source(version,{evidenceFile:file}):kind==='context'?verifiedLwjgl212ContextControl(version,{evidenceFile:file}):verifiedLwjgl212Components(version,{evidenceFile:file}));}catch(error){reason=String(error);}
  assert(reason,`Damaged fixture accepted: ${version}/${name}`);observations.push({version,kind,name,rejected:true,reason,fixture:await ref(file)});
 };
 for(const[name,mutate]of [
  ['wrong-release',r=>{r.version=version==='1.12'?'1.12.1':'1.12';}],
  ['foreign-client',r=>{r.officialSources.clientSha1='0'.repeat(40);}],
  ['volume-clamp-order',r=>{r.facts.volumeRule='clamp-before-category';}],
  ['packet-byte-quantizer',r=>{r.facts.pitchTransport={kind:'unsigned-byte',scale:63};}],
  ['master-source-placement',r=>{r.facts.masterVolumePlacement='source';}],
  ['rounded-eye-double',r=>{r.facts.standingEyeHeightJavaFloat=1.62;}],
  ['nested-delegation',r=>{r.facts.nestedSoundEventArithmetic='direct-delegation';}],
  ['missing-new-instrument',r=>{r.instruments.pop();}],
  ['wrong-guitar-material',r=>{r.materialFields.supports[7].block='planks';}],
  ['inclusive-broadcast-edge',r=>{r.facts.comparison='distance-squared-less-than-or-equal';}],
  ['measured-voice-capacity',r=>{r.facts.originalRequestedVoicePool.actualAllocatedCapacityMeasured=true;}],
  ['missing-packet-handler-code',r=>{r.bindings=r.bindings.filter(b=>b.label!=='client-real-registered-handler');}],
  ['wrong-original-code',r=>{r.bindings.find(b=>b.label==='actual-note-pow-record-volume').codeSha256='0'.repeat(64);}],
  ['wrong-class-bytecode',r=>{r.classes[0].classSha256='0'.repeat(64);}],
  ['changed-helper',r=>{r.sources['scripts/review-lwjgl212-source.mjs']='0'.repeat(64);}],
 ])await reject('source',name,source,mutate);
 for(const[name,mutate]of [
  ['invented-hrtf-control',r=>{r.facts.hrtfControl=true;}],
  ['invented-hrtf-attribute',r=>{r.originalAttributeBuilder.result=[6546,1,0];}],
  ['invented-native-observation',r=>{r.scope.actualHrtfStateMeasured=true;}],
  ['wrong-native-artifact',r=>{r.dependencies.find(d=>d.nativeEntries).artifact.sha1='0'.repeat(40);}],
  ['wrong-context-code',r=>{r.bindings.at(-1).codeSha256='0'.repeat(64);}],
 ])await reject('context',name,context,mutate);
 for(const[name,mutate]of [
  ['unexecuted-component',r=>{r.status='running';}],
  ['component-borrowed-source',r=>{r.sourceEvidence.sha256='0'.repeat(64);}],
  ['invented-note-scalar',r=>{r.originalNoteToPacketToInstanceToEngine[249].originalEnginePitch=.5;}],
  ['invented-master-return',r=>{r.originalMasterOptions[3].originalOptionsReturnBits='0';}],
  ['corrupted-math-bits',async r=>{const file=path.join(root,`${version}-wrong-math.bin`),bytes=Buffer.from(await readFile(r.rawOutputs['math.bin'].path));bytes[12]^=1;await writeFile(file,bytes);r.rawOutputs['math.bin']=await ref(file);}],
 ])await reject('numeric',name,numeric,mutate);
}
for(const[file,expected]of Object.entries(inputHashes))assert.equal(sha(await readFile(file)),expected,'Reader mutated input: '+file);
const report={schema:1,status:'passed',scope:'Read-only original-evidence and adapter gates, with isolated aligned-raw negative fixtures. Does not execute a game/native context or add world coverage.',versions:patchVersions,validProfiles:adapters.length,negativeFixtures:observations.length,allRejected:observations.every(o=>o.rejected),inputsUnchanged:true,inputHashes,observations,adapters,worldScenesAdded:0,sources:Object.fromEntries(await Promise.all(['scripts/verify-lwjgl212-readers.mjs','scripts/review-lwjgl212-source.mjs','scripts/review-lwjgl212-context-control.mjs','scripts/probe-lwjgl212-methods.mjs','scripts/review-lwjgl212-profiles.mjs'].map(async f=>[f,sha(await readFile(f))])))};
const raw=path.join(root,'report.json');await writeFile(raw,JSON.stringify(report,null,2)+'\n');report.rawReport=await ref(raw);if(process.argv.includes('--write-evidence'))await writeFile('docs/evidence/java-1.12-family-readers.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:'passed',validProfiles:adapters.length,negativeFixtures:observations.length,allRejected:true,inputsUnchanged:true,raw}));
