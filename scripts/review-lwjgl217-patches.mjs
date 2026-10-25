import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {digest,verifiedArtifact} from './research-utils.mjs';
import {historicalClassfile} from './historical-classfile.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';
import {discoverLwjgl217Patch,lwjgl217PatchVersions,lwjgl217PatchRoot,patchSha,originalMethodSection} from './audit-lwjgl217-patches.mjs';
import {bindLwjgl217Patch} from './lwjgl217-patch-bindings.mjs';
import {decodeLwjgl217PatchComponents} from './probe-lwjgl217-patches.mjs';

export {lwjgl217PatchVersions};
export const lwjgl217PatchFacts={
  "decoder": "legacy-jorbis",
  "attenuationModel": "paulscode-linear",
  "attenuationDistance": 16,
  "noteBlockVolume": 3,
  "minPitch": 0.5,
  "maxPitch": 2,
  "volumeRule": "category-before-clamp",
  "masterVolumePlacement": "listener",
  "soundEventArithmetic": "double-event-scalars",
  "gainFormula": "float(clampDouble(double(instanceFloat)*eventVolumeDouble*double(categoryFloat),0,1))",
  "pitchFormula": "float(clampDouble(double(transportedPitchFloat)*eventPitchDouble,.5,2))",
  "pitchTransport": {
    "kind": "unsigned-byte",
    "scale": 63,
    "minimum": 0,
    "maximum": 255
  },
  "pitchTransportDetail": {
    "constructor": "truncate-float-product-to-int32-then-clamp-stored-field-0-to-255",
    "wire": "low-eight-bits-of-already-clamped-field",
    "read": "unsigned-byte-divided-by-float63",
    "overflow": "constructor-clamp",
    "ordinaryNoteDomain": {
      "minimum": 0,
      "maximum": 24,
      "encodedMinimum": 31,
      "encodedMaximum": 126
    }
  },
  "hrtfControl": false,
  "hrtfControlMode": "device-default",
  "originalRequestedVoicePool": {
    "normal": 28,
    "streaming": 4,
    "notePool": "normal",
    "actualAllocatedCapacityMeasured": false
  },
  "broadcastRange": 48,
  "broadcastOrigin": "server-player-entity-position",
  "comparison": "strict-distance-squared-less-than-range-squared",
  "sameDimensionRequired": true,
  "sourceBlockOffset": [
    0.5,
    0.5,
    0.5
  ],
  "standingEyeHeight": 1.62,
  "standingEyeHeightJavaFloat": 1.6200000047683716,
  "listenerPositionModel": "interpolated-client-player-position-already-containing-legacy-y-offset",
  "serverPlayerYOffset": 0,
  "ordinaryClientPlayerYOffsetJavaFloat": 1.6200000047683716,
  "teleportYConversion": "server entity feet Y + widened float32(1.62), assigned directly to client entity Y",
  "materials": [
    {
      "instrument": "harp",
      "eventId": 0,
      "material": "default/dirt"
    },
    {
      "instrument": "basedrum",
      "eventId": 1,
      "material": "stone"
    },
    {
      "instrument": "snare",
      "eventId": 2,
      "material": "sand"
    },
    {
      "instrument": "hat",
      "eventId": 3,
      "material": "glass"
    },
    {
      "instrument": "bass",
      "eventId": 4,
      "material": "wood"
    }
  ],
  "nativeContextEvidence": "not-reviewed-or-normalized-by-this-audit",
  "gameRecording": "pending"
};
const parse=async file=>JSON.parse(await readFile(file)),sourcePath=version=>`docs/evidence/java-${version}-audio-source.json`;
const allowed=library=>{let value=!library.rules;for(const rule of library.rules??[])if(!rule.os||rule.os.name==='windows')value=rule.action==='allow';return value;};
function gameHrtfReferences(found){const classes=[...found.classes.values()].filter(c=>c.archive.filename===found.client),references=classes.flatMap(c=>c.utf8.filter(v=>/HRTF|alcResetDeviceSOFT|ALC_SOFT_HRTF/i.test(v)).map(value=>({owner:c.name,value})));assert.deepEqual(references,[]);return{originalClientClasses:classes.length,references,gameControl:false,nativeCapabilityMeasured:false};}
async function resources(found){const a=found.metadata.assetIndex,root=`${lwjgl217PatchRoot}/assets/${a.sha1}`;await verifiedArtifact(a,`${root}/index.json`);const index=await parse(`${root}/index.json`),def=index.objects['sounds.json'];assert(def);await verifiedArtifact({url:`https://resources.download.minecraft.net/${def.hash.slice(0,2)}/${def.hash}`,sha1:def.hash},`${root}/sounds.json`);const sounds=await parse(`${root}/sounds.json`),samples=[];for(const[instrument,event]of Object.entries({harp:'harp',bass:'bassattack',basedrum:'bd',snare:'snare',hat:'hat'})){const name='note.'+event;assert.equal(sounds[name].category,'record');assert.deepEqual(sounds[name].sounds,[`note/${event}`]);const key=`sounds/note/${event}.ogg`,entry=index.objects[key];assert(entry);await verifiedArtifact({url:`https://resources.download.minecraft.net/${entry.hash.slice(0,2)}/${entry.hash}`,sha1:entry.hash},`${root}/${event}.ogg`);samples.push({instrument,event:name,path:key,sha1:entry.hash,bytes:(await readFile(`${root}/${event}.ogg`)).length,category:'record',volume:1,pitch:1});}return{index:a,definition:{path:'sounds.json',sha1:def.hash},samples};}
async function nativeIdentity(found){const platforms=found.metadata.libraries.filter(l=>allowed(l)&&l.name.startsWith('org.lwjgl.lwjgl:lwjgl-platform:'));assert.equal(platforms.length,1);const artifact=platforms[0].downloads.classifiers['natives-windows'];const filename=path.join('.research/libraries',artifact.path);await verifiedArtifact(artifact,filename);const entries=unzipSync(await readFile(filename));const lwjgl=found.metadata.libraries.filter(l=>allowed(l)&&/^org\.lwjgl\.lwjgl:lwjgl:/.test(l.name));assert.equal(lwjgl.length,1);return{artifact,lwjglArtifact:lwjgl[0].downloads.artifact,openalSha256:patchSha(entries['OpenAL64.dll']),lwjglBridgeSha256:patchSha(entries['lwjgl64.dll']),scope:'Official Windows dependency identity only; no native context, capacity or world measurement inherited or added'};}
export async function reviewLwjgl217PatchNumeric(version,found,bound){const file=`docs/evidence/java-${version}-numeric-components.json`,bytes=await readFile(file),r=JSON.parse(bytes);assert.equal(r.version,version);assert.equal(r.clientSha1,found.metadata.downloads.client.sha1);assert.equal(r.integratedWorldScenesAdded,0);assert.deepEqual(r.adapterConfig,bound.adapterConfig);for(const[file,hash]of Object.entries(r.sources))assert.equal(patchSha(await readFile(file)),hash,file);for(const[file,hash]of Object.entries(r.runtimeCompiledClasses))assert.equal(patchSha(await readFile(file)),hash,file);assert(Object.keys(r.runtimeCompiledClasses).length>=2);
 for(const[key,hash]of Object.entries(r.rawOutputHashes))assert.equal(patchSha(await readFile(r.rawOutputs[key])),hash,key);assert.deepEqual(JSON.parse(await readFile(r.rawOutputs.adapterConfig)),bound.adapterConfig);const expectedProperties=Object.entries(bound.adapterConfig).map(([key,value])=>`${key}=${Array.isArray(value)?value.join(','):value}`).join('\n');assert.equal(await readFile(r.rawOutputs.adapterProperties,'utf8'),expectedProperties);
 const process=await parse(r.process.path);assert.equal(process.running,false);assert.equal(process.exit,0);assert.equal(process.version,version);assert.equal(process.pid,r.process.pid);assert(process.args.includes('studio.nbsx.research.Lwjgl217PatchMethodProbe'));const cp=process.args[process.args.indexOf('-cp')+1].split(path.delimiter);assert(cp.includes(path.resolve(found.client)));assert.equal(cp.filter(f=>/[/\\]clients[/\\][^/\\]+\.jar$/.test(f)).length,1);
 const expectedArtifacts=found.metadata.libraries.filter(allowed).map(l=>l.downloads?.artifact).filter(Boolean);assert.deepEqual(r.classpathArtifacts,expectedArtifacts);for(const a of expectedArtifacts){const file=path.resolve('.research/libraries',a.path);assert(cp.includes(file));assert.equal(digest(await readFile(file)),a.sha1);}
 const inputBytes=await readFile(r.rawOutputs.inputs),inputText=await readFile(r.rawOutputs.inputTsv,'utf8'),inputs=JSON.parse(inputBytes).map(row=>row.map(Number));const tsv=inputText.split(/\r?\n/).map(row=>row.split('\t').map(Number));assert.deepEqual(inputs,tsv);const originBytes=await readFile(r.sharedInputOrigin.path);assert.equal(patchSha(originBytes),r.sharedInputOrigin.sha256);const origin=JSON.parse(originBytes);assert.equal(patchSha(inputBytes),origin.engineMath.inputsSha256);assert.equal(patchSha(Buffer.from(inputText)),origin.rawOutputHashes.inputTsv);assert.equal(patchSha(await readFile(r.rawOutputs.packetInputs)),origin.rawOutputHashes.packetInputs);
 const packetInputs=(await readFile(r.rawOutputs.packetInputs,'utf8')).trim().split(/\r?\n/).map(Number),decoded=decodeLwjgl217PatchComponents(inputs,await readFile(r.rawOutputs.math),await readFile(r.rawOutputs.notes),packetInputs,await readFile(r.rawOutputs.packet),await readFile(r.rawOutputs.console,'utf8'));for(const[key,value]of Object.entries(decoded))assert.deepEqual(r[key],value,key);
 return{path:file,sha256:patchSha(bytes),engineMathCases:decoded.engineMathCases,originalMaterialCases:decoded.originalMaterialSelection.length,originalNoteEvents:decoded.originalNoteBlockToPacketToEngine.length,packetBoundaryCases:decoded.originalPacketBoundaryCases.length,categoryAfterClampDifferences:decoded.categoryAfterClampDifferences,prematureFloatDifferences:decoded.prematureFloatDifferences,originalPoolDefaults:decoded.originalPoolDefaults};}

export async function reviewLwjgl217Patch(version,filename=sourcePath(version)){assert(lwjgl217PatchVersions.includes(version));const report=await parse(filename),found=await discoverLwjgl217Patch(version);assert.equal(report.version,version);assert.equal(report.officialSources.clientSha1,found.metadata.downloads.client.sha1);assert.equal(report.officialSources.metadataSha1,found.metadataSha1);assert.equal(report.officialSources.metadataUrl,found.metadataUrl);assert.deepEqual(report.roles,found.roles);assert.equal(report.mappings.officialClientMappingsAvailable,false);assert.equal(report.integratedWorldScenesAdded,0);assert.deepEqual(report.facts,lwjgl217PatchFacts);assert.equal(report.classes.length,new Set(Object.values(found.roles)).size);
 assert.deepEqual([...new Set(report.classes.map(e=>e.originalName))].sort(),[...new Set(Object.values(found.roles))].sort());
 for(const entry of report.classes){const original=found.classes.get(entry.originalName);assert(original);assert.deepEqual(entry.artifact,original.archive.artifact);assert.equal(digest(original.bytes),entry.bytecodeSha1);assert.equal(patchSha(original.bytes),entry.bytecodeSha256);assert.deepEqual(methodCodeHashes(original.bytes),entry.methods);assert.deepEqual(historicalClassfile(original.bytes).fields.map(({access,name,descriptor})=>({access,name,descriptor})),entry.fields);assert.equal(patchSha(await readFile(entry.rawClass)),entry.bytecodeSha256);assert.equal(patchSha(await readFile(entry.rawDisassembly)),entry.rawDisassemblySha256);}
 const bound=await bindLwjgl217Patch(report);assert.deepEqual(report.bindings,bound.bindings);assert.deepEqual(report.adapterConfig,bound.adapterConfig);assert.deepEqual(report.resources,await resources(found));assert.deepEqual(report.native,await nativeIdentity(found));assert.deepEqual(report.numericComponents,await reviewLwjgl217PatchNumeric(version,found,bound));assert.equal(Object.keys(report.auditSources).length,9);assert.deepEqual(report.gameHrtfReferenceScan,gameHrtfReferences(found));for(const[file,hash]of Object.entries(report.auditSources))assert.equal(patchSha(await readFile(file)),hash,file);return report;
}
async function writeSource(version){const report=await parse(`${lwjgl217PatchRoot}/${version}/inventory.json`),found=await discoverLwjgl217Patch(version),bound=await bindLwjgl217Patch(report);report.bindings=bound.bindings;report.adapterConfig=bound.adapterConfig;report.facts=lwjgl217PatchFacts;report.resources=await resources(found);report.native=await nativeIdentity(found);report.numericComponents=await reviewLwjgl217PatchNumeric(version,found,bound);report.integratedWorldScenesAdded=0;report.gameHrtfReferenceScan=gameHrtfReferences(found);report.gameRecording='pending';report.auditSources={};for(const file of ['scripts/audit-lwjgl217-patches.mjs','scripts/lwjgl217-patch-bindings.mjs','scripts/probe-lwjgl217-patches.mjs','scripts/review-lwjgl217-patches.mjs','scripts/java/Lwjgl217PatchMethodProbe.java','scripts/audit-lwjgl218-patches.mjs','scripts/historical-classfile.mjs','scripts/audit-early-world.mjs','scripts/research-utils.mjs'])report.auditSources[file]=patchSha(await readFile(file));report.limitations=['Each client and caller/field chain is independently bound; equal dependency/class/method bytes are not a whole-engine equivalence claim.','Finite original component inputs only; no native context, allocated voice capacity, waveform or game-world measurement.','Configured 28 normal+4 streaming is not proof that all channels allocate or overflow behaves like an offline renderer.','Only ordinary server note path is packet-quantized; client block event listener is separately checked silent.','No source/recording/measurement status inherited from 1.7.10, 1.8, 1.12.2 or another patch.'];await writeFile(sourcePath(version),JSON.stringify(report,null,2)+'\n');return reviewLwjgl217Patch(version);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const versions=process.argv.find(arg=>lwjgl217PatchVersions.includes(arg))?[process.argv.find(arg=>lwjgl217PatchVersions.includes(arg))]:lwjgl217PatchVersions;for(const version of versions){const r=process.argv.includes('--write')?await writeSource(version):await reviewLwjgl217Patch(version);console.log(JSON.stringify({version,classes:r.classes.length,bindings:r.bindings.length,components:r.numericComponents,verified:true}));}}
