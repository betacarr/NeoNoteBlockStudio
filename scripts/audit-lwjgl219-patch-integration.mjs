import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {digest} from './research-utils.mjs';
import {patchVersions} from './review-lwjgl219-patches-complete.mjs';
import {verifiedLwjgl219PatchComponents} from './probe-lwjgl219-patches.mjs';

// Original Java buffers are the only numeric expectation oracle. The first two
// math columns are unclamped instance/event getters, not helper return values.
const mathColumns=[
 {column:0,role:'original-instance-event-volume-getter',productionComparison:false,reason:'Intermediate original getter; no corresponding public production return'},
 {column:1,role:'original-instance-event-pitch-getter',productionComparison:false,reason:'Intermediate original getter; no corresponding public production return'},
 {column:2,role:'original-engine-source-gain',productionComparison:'gameVolumeParameters(...).gain'},
 {column:3,role:'original-engine-pitch',productionComparison:'gameEventPitchParameters(...)'},
];
const sha=bytes=>digest(bytes,'sha256'),parse=async file=>JSON.parse(await readFile(file));
const root=path.resolve('.local/lwjgl219-patch-integration',`run-${Date.now()}`);await mkdir(root,{recursive:true});
const observations=[],differences=[],snapshots=new Map();
const snapshot=async(file,expected)=>{const absolute=path.resolve(file),bytes=await readFile(absolute),hash=sha(bytes),previous=snapshots.get(absolute);if(expected)assert.equal(hash,expected,file);if(previous)assert.equal(hash,previous,'Input changed: '+file);snapshots.set(absolute,hash);return bytes;};
const ref=async file=>({path:path.relative(process.cwd(),path.resolve(file)).replaceAll('\\','/'),sha256:sha(await readFile(file))});
const floatBits=value=>{const b=Buffer.alloc(4);b.writeFloatLE(value);return b.readUInt32LE();},fromBits=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b.readFloatLE();};
const hex=value=>value.toString(16).padStart(8,'0');
const equalBits=(actual,expected,context)=>{if(floatBits(actual)!==expected)differences.push({...context,actual,actualBits:hex(floatBits(actual)),original:fromBits(expected),originalBits:hex(expected)});};

async function frozenOriginal(version){
 const verified=await verifiedLwjgl219PatchComponents(version),source=JSON.parse(await snapshot(verified.sourceEvidence.path,verified.sourceEvidence.sha256)),numeric=JSON.parse(await snapshot(verified.numericEvidence.path,verified.numericEvidence.sha256)),context=JSON.parse(await snapshot(verified.contextEvidence.path,verified.contextEvidence.sha256));
 assert.equal(source.officialSources.clientSha1,numeric.officialSources.clientSha1);assert.equal(source.version,version);assert.equal(numeric.version,version);assert.equal(numeric.integratedWorldScenesAdded,0);assert.equal(context.scope.nativeContextCreated,false);
 for(const r of [source,numeric,context]){for(const[file,hash]of Object.entries(r.sources))await snapshot(file,hash);if(r.rawEvidence)await snapshot(r.rawEvidence.path,r.rawEvidence.sha256);}
 await snapshot(source.baseEvidence.path,source.baseEvidence.sha256);await snapshot(context.originalAttributeBuilder.rawOutput,context.originalAttributeBuilder.sha256);
 for(const c of [...source.classes,...context.classes])await snapshot(c.rawDisassembly,c.disassemblySha256);
 await snapshot(`.research/clients/${version}.jar`);await snapshot(`.research/lwjgl219-source/${version}/official-metadata.json`);await snapshot(`.research/lwjgl219-patch-chains/${version}/assets/index.json`);await snapshot(`.research/lwjgl219-patch-chains/${version}/assets/sounds.json`);
 for(const item of source.instruments)await snapshot(item.originalSample.path,item.originalSample.sha256);
 for(const[file,hash]of Object.entries(numeric.runtimeCompiledClasses))await snapshot(file,hash);for(const a of numeric.classpathArtifacts)await snapshot(path.join('.research/libraries',a.path));await snapshot('.research/tools/asm-9.7.1.jar',numeric.tools.asmSha256);
 const raw={};for(const[key,r]of Object.entries(numeric.rawOutputs))raw[key]=await snapshot(r.path,r.sha256);await snapshot(numeric.sharedInputOrigin.path,numeric.sharedInputOrigin.sha256);
 const inputs=JSON.parse(raw['inputs.json']).map(row=>row.map(Number)),tsv=raw['inputs.tsv'].toString().split(/\r?\n/).map(row=>row.split('\t').map(Number));assert.deepEqual(inputs,tsv);
 const packetInputs=raw['packet-inputs.tsv'].toString().trim().split(/\r?\n/).map(Number);assert.equal(inputs.length,1249);assert.equal(packetInputs.length,75);
 for(const[name,magic,count,stride]of [['math.bin','NB9P',1249,16],['packet.bin','N9PP',75,24],['notes.bin','N9NP',125,20]]){assert.equal(raw[name].subarray(0,4).toString(),magic);assert.equal(raw[name].readUInt32LE(4),count);assert.equal(raw[name].length,8+count*stride);}
 assert.deepEqual(context.originalAttributeBuilder.result,[4103,44100,4104,60,4105,0,0]);
 return{verified,source,numeric,context,raw,inputs,packetInputs};
}

const entry=path.join(root,'production.mjs'),script='scripts/audit-lwjgl219-patch-integration.mjs';
const report={schema:1,status:'running',root,versions:patchVersions,mathColumns,observations,integratedWorldScenesAdded:0,scope:'Current production helpers and real noteAudioParameters/listenerForProject route versus frozen per-release original-Java raw bits. No numeric expectations are computed from production or reconstructed game formulas. No Java/native/game rerun.'},reportFile=path.join(root,'report.json');
try{
 const initialFiles=[script,'scripts/research-utils.mjs','src/audio/volume.ts','src/audio/parameters.ts','src/audio/profiles.ts','src/core/project.ts','src/core/time.ts','src/data/legacy-audio-facts.json','src/data/world-audio-facts.json','src/data/audio-facts.json','src/data/early-audio-facts.json','src/data/audio-validation.json'];for(const file of initialFiles)await snapshot(file);
 const contents=`export {gamePitchParameters,gameEventPitchParameters,gameVolumeParameters} from './src/audio/volume.ts';export {audioProfile,gameHrtfControl} from './src/audio/profiles.ts';import {createProject,newNote,flattenNotes} from './src/core/project.ts';import {noteAudioParameters,listenerForProject} from './src/audio/parameters.ts';export function projectNote(profile,note,instrument,mode){const p=createProject();p.audio.profileId=profile;p.audio.mode=mode;p.tracks[0].instrumentId=instrument;p.patterns[0].notes=[newNote(0,54+note)];return noteAudioParameters(p,flattenNotes(p)[0]);}export function projectListener(profile,master){const p=createProject();p.audio.profileId=profile;p.audio.mode='vanilla';p.audio.masterGain=master;return listenerForProject(p);}`;
 const built=await build({stdin:{contents,resolveDir:process.cwd(),sourcefile:'lwjgl219-patch-production-audit.ts'},outfile:entry,bundle:true,platform:'node',format:'esm',metafile:true});for(const file of Object.keys(built.metafile.inputs).filter(file=>file!=='lwjgl219-patch-production-audit.ts'&&!file.startsWith('<')))await snapshot(file);
 const product=await import(pathToFileURL(entry).href),legacy=await parse('src/data/legacy-audio-facts.json'),world=await parse('src/data/world-audio-facts.json'),validation=await parse('src/data/audio-validation.json');
 for(const version of patchVersions){
  const original=await frozenOriginal(version),{verified,source,numeric,inputs,raw,packetInputs}=original,id='java-'+version,fact=legacy.profiles.find(p=>p.id===id),worldFact=world.profiles.find(p=>p.id===id);assert(fact,'Production facts are not ready: '+id);assert(worldFact,'Production world source facts are not ready: '+id);
  const expectedScale=['1.9.1','1.9.2'].includes(version)?63.5:63;assert.equal(verified.facts.pitchTransport.scale,expectedScale);assert.deepEqual(fact.pitchTransport,verified.facts.pitchTransport);assert.deepEqual(fact.namedPitchTransport,verified.facts.namedPitchTransport);assert.equal(fact.soundEventArithmetic,'float-event-scalars');assert.equal(fact.volumeRule,'category-before-clamp');assert.equal(fact.masterVolumePlacement,'listener');assert.equal(fact.clientSha1,source.officialSources.clientSha1);assert.equal(fact.sourceEvidenceSha256,verified.sourceEvidence.sha256);assert.deepEqual(fact.numericEvidence,verified.numericEvidence);
  assert.equal(worldFact.clientSha1,source.officialSources.clientSha1);assert.equal(worldFact.standingEyeHeight,verified.facts.standingEyeHeightJavaFloat);assert.equal(worldFact.broadcastOrigin,verified.facts.broadcastOrigin);assert.equal(worldFact.sameDimensionRequired,true);assert.equal(worldFact.comparison,verified.facts.comparison);assert.equal(worldFact.gameRecording,'pending');
  const math=raw['math.bin'],notes=raw['notes.bin'],packet=raw['packet.bin'];
  for(const[i,[volume,pitch,category,eventVolume,eventPitch]]of inputs.entries()){
   equalBits(product.gameVolumeParameters(id,volume,.7,category,eventVolume).gain,math.readUInt32LE(8+i*16+8),{version,kind:'engine-source-gain',originalColumn:2,case:i});
   equalBits(product.gameEventPitchParameters(id,pitch,eventPitch),math.readUInt32LE(8+i*16+12),{version,kind:'engine-event-pitch',originalColumn:3,case:i});
  }
  const instruments=source.instruments.map(s=>s.instrument);assert.deepEqual(instruments,['harp','basedrum','snare','hat','bass']);
  for(let i=0;i<125;i++){
   const instrument=Math.floor(i/25),note=i%25,offset=8+i*20,emitted=notes.readFloatLE(offset),wire=notes.readFloatLE(offset+4),pitchBits=notes.readUInt32LE(offset+8),volume=notes.readFloatLE(offset+12),gainBits=notes.readUInt32LE(offset+16);
   equalBits(product.gamePitchParameters(id,emitted),pitchBits,{version,kind:'material-note-helper',instrument,note});
   equalBits(product.gameEventPitchParameters(id,wire),pitchBits,{version,kind:'already-transported-event-helper',instrument,note});
   equalBits(product.gameVolumeParameters(id,volume,.7,.5).gain,gainBits,{version,kind:'original-note-gain-category-half',instrument,note});
   equalBits(product.projectNote(id,note,instruments[instrument],'vanilla').pitch,pitchBits,{version,kind:'noteAudioParameters-vanilla',instrument,note});
   equalBits(product.projectNote(id,note,instruments[instrument],'studio').pitch,notes.readUInt32LE(offset),{version,kind:'noteAudioParameters-studio',instrument,note});
  }
  // Each row stores named at offsets0/4/8, registered at12/16/20. This
  // production helper models registered note transport, so use offset20 only.
  for(const[i,input]of packetInputs.entries())equalBits(product.gamePitchParameters(id,input),packet.readUInt32LE(8+i*24+20),{version,kind:'registered-wire-boundary',case:i,input});
  for(const row of numeric.originalMasterOptions){const input=fromBits(parseInt(row.inputBits,16)),expected=parseInt(row.originalOptionsReturnBits,16);equalBits(product.gameVolumeParameters(id,1,input).listenerGain,expected,{version,kind:'original-master-to-helper-listener',inputBits:row.inputBits});equalBits(product.projectListener(id,input).gain,expected,{version,kind:'original-master-to-listenerForProject',inputBits:row.inputBits});}
  const profile=product.audioProfile(id);assert.equal(profile.status,'code-reviewed');assert.equal(profile.voiceWarning,numeric.requestedNormalPool);assert.equal(profile.measurementSummary,undefined);assert(!validation.profiles.some(p=>p.id===id),id+' must not gain a world measurement entry');assert.equal(fact.gameRecording,'pending');assert.equal(fact.originalRequestedVoicePool.normal,28);assert.equal(fact.originalRequestedVoicePool.streaming,4);assert.equal(fact.originalRequestedVoicePool.actualAllocatedCapacityMeasured,false);assert.equal(product.gameHrtfControl(id),false);assert.equal(fact.hrtfControlMode,'device-default');
  observations.push({version,status:'passed',sourceEvidence:verified.sourceEvidence,numericEvidence:verified.numericEvidence,contextEvidence:verified.contextEvidence,registeredScale:expectedScale,namedScale:63,engineCases:inputs.length,originalMathFloatColumns:4,engineOutputComparisons:inputs.length*2,originalGetterOutputsRetainedWithoutPublicReturnComparison:inputs.length*2,mathColumnSamples:inputs.slice(0,3).map((input,i)=>({input,originalOutputBits:mathColumns.map(({column})=>hex(math.readUInt32LE(8+i*16+column*4)))})),materialNoteEvents:125,noteOutputComparisons:625,registeredWireCases:packetInputs.length,masterOriginalOptions:5,masterOutputComparisons:10,profileStatus:profile.status,voiceWarning:profile.voiceWarning,measurementSummaryPresent:false,worldMeasurementEntryPresent:false,gameRecording:'pending',worldScenesAdded:0,rawOutputs:numeric.rawOutputs});
 }
 assert.deepEqual(differences,[],`Original Java raw-bit differences: ${JSON.stringify(differences.slice(0,12))}`);
 for(const[file,hash]of snapshots)assert.equal(sha(await readFile(file)),hash,'Input changed during audit: '+file);
 report.status='passed';report.differences=[];report.totals={profiles:observations.length,engineCases:observations.reduce((n,r)=>n+r.engineCases,0),engineOutputComparisons:observations.reduce((n,r)=>n+r.engineOutputComparisons,0),originalGetterOutputsRetainedWithoutPublicReturnComparison:observations.reduce((n,r)=>n+r.originalGetterOutputsRetainedWithoutPublicReturnComparison,0),materialNoteEvents:500,noteOutputComparisons:2500,registeredWireCases:300,masterOriginalOptions:20,masterOutputComparisons:40,worldScenesAdded:0};report.productionBundle=await ref(entry);report.auditScript=await ref(script);report.inputSha256=Object.fromEntries([...snapshots].map(([file,hash])=>[path.relative(process.cwd(),file).replaceAll('\\','/'),hash]));
 report.limitations=['The two original intermediate instance/event getter columns have no matching public production return and are not counted as output comparisons. Final source gain/pitch use original columns2/3.','noteAudioParameters pitch is compared in real vanilla/studio project routes. Raw original note volume3 is compared through the gain helper; it is not substituted for the editor normalized velocity.','Original Options return bits are compared to helper listenerGain and listenerForProject; no AL listener readback is measured.','Static requested28voice warning is not a measured capacity and does not justify truncating render output.','No new Java process, game, native device/context, codec decode, mixer or world PCM measurement.'];
 await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');if(process.argv.includes('--write-evidence'))await writeFile('docs/evidence/java-1.9-patch-production-integration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:'passed',...report.totals,report:reportFile}));
}catch(error){report.status='failed';report.error=String(error);report.differences=differences;report.inputSha256=Object.fromEntries([...snapshots].map(([file,hash])=>[path.relative(process.cwd(),file).replaceAll('\\','/'),hash]));await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');console.error(JSON.stringify({status:'failed',error:String(error),differences:differences.slice(0,12),report:reportFile}));throw error;}
