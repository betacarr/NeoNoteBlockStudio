import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {lwjgl215Versions,sha215} from './audit-lwjgl215-source.mjs';
import {verifiedLwjgl215Source} from './review-lwjgl215-source.mjs';
import {verifiedLwjgl215Components} from './probe-lwjgl215-methods.mjs';
import {reviewedLwjgl215Profile,reviewedLwjgl215Resources} from './review-lwjgl215-profiles.mjs';

const root=path.resolve('.local/lwjgl215-reader-negative',`run-${Date.now()}`);await mkdir(root,{recursive:true});const inputHashes={},observations=[],profiles=[],reports=[];
const fileRef=async file=>({path:path.relative(process.cwd(),file).replaceAll('\\','/'),sha256:sha215(await readFile(file))});
const remember=async file=>{const b=await readFile(file);inputHashes[file]=sha215(b);return b;};
const snapshot=async file=>JSON.parse(await remember(file));
for(const version of lwjgl215Versions){
 const sourceFile=`docs/evidence/java-${version}-audio-source.json`,numericFile=`docs/evidence/java-${version}-numeric-components.json`,resourceFile=`docs/evidence/java-${version}-resource-selection.json`,s=await snapshot(sourceFile),n=await snapshot(numericFile),r=await snapshot(resourceFile);
 for(const report of [s,n]){await remember(report.rawEvidence.path);for(const f of Object.keys(report.sources))await remember(f);}for(const c of s.classes){await remember(c.rawClass);await remember(c.rawDisassembly);}for(const raw of Object.values(n.rawOutputs))await remember(raw.path);for(const f of Object.keys(n.runtimeCompiledClasses))await remember(f);for(const sample of s.resources.samples)await remember(sample.path);for(const pcm of n.checks.decodes)await remember(pcm.path);await remember(`.research/clients/${version}.jar`);await remember(`.research/lwjgl215-source/${version}/official-metadata.json`);await remember(s.resources.indexFile);for(const a of s.audioDependencies.artifacts)await remember(a.file);
 const verified=await verifiedLwjgl215Components(version),resources=await reviewedLwjgl215Resources(version),profile=await reviewedLwjgl215Profile(version);profiles.push(profile);assert.equal(profile.legacy.volumeRule,'clamp-before-global-setting');assert.equal(profile.legacy.materials.length,5);assert.equal(profile.legacy.pitchTransport.scale,63);assert.equal(profile.world.clientRawNoteSoundCallback,'no-op');assert.equal(profile.legacy.gameRecording,'pending');assert.equal(profile.world.standingEyeHeight,1.62);assert.equal(profile.world.standingEyeHeightJavaFloat,Math.fround(1.62));assert(profile.world.listenerReferenceScope.includes('nominal editor ear-to-server-feet delivery reference, not a measured world pose'));
 const reject=async(kind,name,original,mutate)=>{const fixture=structuredClone(original);await mutate(fixture);if(fixture.rawEvidence){const value={...fixture};delete value.rawEvidence;const raw=path.join(root,`${version}-${name}.raw.json`);await writeFile(raw,JSON.stringify(value,null,2));fixture.rawEvidence=await fileRef(raw);}const file=path.join(root,`${version}-${name}.json`);await writeFile(file,JSON.stringify(fixture,null,2));let reason;try{await(kind==='source'?verifiedLwjgl215Source(version,{evidenceFile:file}):kind==='numeric'?verifiedLwjgl215Components(version,{evidenceFile:file}):reviewedLwjgl215Resources(version,{evidenceFile:file}));}catch(e){reason=String(e);}assert(reason,'Damaged evidence accepted: '+version+'/'+name);observations.push({version,kind,name,rejected:true,reason,fixture:await fileRef(file)});};
 for(const[name,mutate]of [
  ['cross-version',r=>r.version=version==='1.5.1'?'1.5.2':'1.5.1'],
  ['foreign-client',r=>r.officialSources.client.sha1='0'.repeat(40)],
  ['category-before-clamp',r=>r.facts.volumeRule='category-before-clamp'],
  ['listener-master',r=>r.facts.masterVolumePlacement='listener'],
  ['wrong-pitch-scale',r=>r.facts.pitchTransport.scale=63.5],
  ['float-note-transport',r=>r.facts.pitchTransport={kind:'float32'}],
  ['client-block-raw-audio',r=>r.facts.clientRawNoteSoundCallback='plays-raw-pitch'],
  ['invented-game-hrtf',r=>r.facts.hrtfControl=true],
  ['invented-capacity',r=>r.facts.originalRequestedVoicePool.actualAllocatedCapacityMeasured=true],
  ['inclusive-delivery',r=>r.facts.comparison='less-than-or-equal'],
  ['missing-noop-binding',r=>r.bindings=r.bindings.filter(b=>b.label!=='original-client-raw-note-audio-noop')],
  ['wrong-code-hash',r=>r.bindings[0].codeSha256='0'.repeat(64)],
  ['forged-adapter-role',r=>r.adapterConfig.packetPitch='i'],
  ['wrong-class',r=>r.classes[0].bytecodeSha256='0'.repeat(64)],
  ['missing-sample',r=>r.resources.samples.pop()],
  ['wrong-prefix',r=>r.resources.acceptedPrefix='newsound'],
  ['wrong-native-artifact',r=>r.audioDependencies.artifacts.at(-1).artifact.sha1='0'.repeat(40)],
  ['invented-native-load',r=>r.audioDependencies.artifacts.at(-1).loaded=true],
  ['invented-world',r=>r.scope.gameWorldStarted=true],
  ['source-helper-hash',r=>r.sources['scripts/review-lwjgl215-source.mjs']='0'.repeat(64)],
 ])await reject('source',name,s,mutate);
 for(const[name,mutate]of [
  ['component-not-executed',r=>r.status='running'],
  ['component-borrowed-source',r=>r.sourceEvidence.sha256='0'.repeat(64)],
  ['invented-note-count',r=>r.checks.notes.notes=126],
  ['invented-gain-boundary',r=>r.checks.boundary.played=200],
  ['invented-raw-path',r=>r.checks.notes.clientRawCallbackSilent=false],
  ['invented-context-hrtf',r=>r.checks.originalContextAttributes=[6546,1,0]],
  ['invented-decode',r=>r.checks.decodes[0].sha1='0'.repeat(40)],
  ['failed-java',r=>r.processes[1].exitCode=1],
  ['native-claim',r=>r.scope.nativeContextOpened=true],
  ['wrong-packet-output',async r=>{const text=(await readFile(r.rawOutputs['java.stdout.log'].path,'utf8')).replace(/PACKET\t([^\r\n]+)/,(_,line)=>'PACKET\t'+line.split('\t').map((s,i)=>i===2?'3f800000':s).join('\t'));const file=path.join(root,version+'-bad-packet.stdout.log');await writeFile(file,text);r.rawOutputs['java.stdout.log']=await fileRef(file);}],
 ])await reject('numeric',name,n,mutate);
 for(const[name,mutate]of [
  ['resource-newsound-layout',r=>r.layout='legacy-newsound'],
  ['resource-missing-selection',r=>r.resources.pop()],
  ['resource-cross-component',r=>r.componentEvidence.sha256='0'.repeat(64)],
  ['resource-unread-url',r=>r.resources[0].originalReadSha1='0'.repeat(40)],
  ['resource-false-world',r=>r.scope.worldStarted=true],
 ])await reject('resource',name,r,mutate);
 reports.push({version,status:'passed',officialSources:s.officialSources,sourceEvidence:verified.sourceEvidence,numericEvidence:verified.componentEvidence,resourceEvidence:resources.resourceEvidence,originalClasses:s.classes.length,sourceCodeBindings:s.bindings.length,componentCounts:{boundary:n.checks.boundary.inputs,packet:n.checks.packet.inputs,noteEvents:n.checks.notes.notes,originalDecodes:n.checks.decodes.length,resourceReads:n.checks.resources.length,dispatchControls:n.checks.dispatchControls},preparedProfile:profile,worldScenesAdded:0});console.log(JSON.stringify({version,status:'passed',negativeFixtures:observations.filter(o=>o.version===version).length}));
}
await assert.rejects(()=>verifiedLwjgl215Source('1.5'));await assert.rejects(()=>reviewedLwjgl215Profile('1.5'));
for(const[f,h]of Object.entries(inputHashes))assert.equal(sha215(await readFile(f)),h,'Reader mutated input: '+f);
const files=['scripts/audit-lwjgl215-source.mjs','scripts/review-lwjgl215-source.mjs','scripts/probe-lwjgl215-methods.mjs','scripts/java/Lwjgl215MethodProbe.java','scripts/review-lwjgl215-profiles.mjs','scripts/verify-lwjgl215-audit.mjs','scripts/run-lwjgl215-stage.mjs'];
const report={schema:1,status:'passed',checkedAt:new Date().toISOString(),versions:lwjgl215Versions,missingOfficialRelease:'1.5',validProfiles:profiles.length,negativeFixtures:observations.length,missingReleaseRejections:2,allRejected:true,inputsUnchanged:true,inputHashes,observations,reports,totals:{versions:2,originalClasses:80,sourceCodeBindings:90,boundaryCases:400,actualPacketStreamCases:88,materialNoteEvents:250,resourceReads:12,actualEmbeddedJOrbisDecodes:12,dispatchControls:16,worldScenesAdded:0},sources:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha215(await readFile(f))]))),scope:'Original-source and actual original-class components, original embedded decoder and resource directory selection only. Independent finite scalar oracle checks float bits without product helpers. World and audio boundaries are inert callbacks. No AL context/native mixer, hardware audio, actual pool capacity or integrated world recording measured.',limitations:['Current official release catalog has no 1.5 client; no substituted artifact is accepted.','Named packet quantization is established on the selected ordinary NoteBlock server path, not inferred merely from a packet class existing. Original client raw block-event listener is executed as a silent negative control.','Finite component inputs are not an all-engine equivalence proof. 200 scalar boundaries per release use global setting [0,1]; SourceLWJGLOpenAL native setVolume/AL gain is not measured.','Configured pool 28/4 is not an observed allocation or maximum. No renderer voice truncation is authorized.','Current official launch metadata identities do not prove historical deployment DLL versions. Native files are hashed but never loaded.','Listener interpolation, original player Y-offset and server teleport stance are source-bound; no actual world standing/camera pose has been recorded.']};const raw=path.join(root,'report.json');await writeFile(raw,JSON.stringify(report,null,2)+'\n');report.rawReport=await fileRef(raw);await writeFile('docs/evidence/java-1.5-family-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:'passed',negativeFixtures:observations.length,allRejected:true,inputsUnchanged:true,raw,report:'docs/evidence/java-1.5-family-audit.json'}));
