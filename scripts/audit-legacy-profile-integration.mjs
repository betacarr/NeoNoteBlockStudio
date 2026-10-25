import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {unzipSync} from 'fflate';
import {digest} from './research-utils.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';

const versions=['1.8.1','1.8.2','1.8.3','1.8.4','1.8.5','1.8.6','1.8.7','1.8.8','1.8.9','1.9'];
const root=path.resolve('.local/legacy-profile-integration',`run-${Date.now()}`);await mkdir(root,{recursive:true});
const parse=async file=>JSON.parse(await readFile(file)),sha=bytes=>digest(bytes,'sha256');
const reference=async file=>({path:path.relative(process.cwd(),path.resolve(file)).replaceAll('\\','/'),sha256:sha(await readFile(file))});
const snapshots=new Map(),artifacts=new Map(),observations=[],differences=[];
const snapshot=async file=>{const bytes=await readFile(file);snapshots.set(path.resolve(file),sha(bytes));return bytes;};
const verify=async(file,hash)=>{const bytes=await snapshot(file);assert.equal(sha(bytes),hash,file);return bytes;};
const floatBits=value=>{const b=Buffer.alloc(4);b.writeFloatLE(value);return b.readUInt32LE();};
const floatFromBits=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b.readFloatLE();};
const equalBits=(actual,expected,context)=>{if(floatBits(actual)!==expected)differences.push({...context,actual,actualBits:floatBits(actual).toString(16).padStart(8,'0'),original:floatFromBits(expected),originalBits:expected.toString(16).padStart(8,'0')});};
async function originalClasses(version,classes){
 const methods=new Map();
 for(const c of classes){const name=c.originalName??c.originalClass,file=c.artifact.path?path.join('.research/libraries',c.artifact.path):`.research/clients/${version}.jar`;
  if(!artifacts.has(file)){const bytes=await readFile(file);assert.equal(digest(bytes),c.artifact.sha1,file);artifacts.set(file,unzipSync(bytes));}
  const bytes=artifacts.get(file)[name+'.class'];assert(bytes,name);assert.equal(sha(bytes),c.bytecodeSha256??c.classSha256,name);assert.deepEqual(methodCodeHashes(bytes),c.methods,name);methods.set(name,c.methods);
  if(c.rawClass)await verify(c.rawClass,c.bytecodeSha256??c.classSha256);await verify(c.rawDisassembly,c.rawDisassemblySha256??c.disassemblySha256);
 }return methods;
}
async function frozenOriginal(version){
 const sourceFile=`docs/evidence/java-${version}-audio-source.json`,numericFile=`docs/evidence/java-${version}-numeric-components.json`,source=JSON.parse(await snapshot(sourceFile)),numeric=JSON.parse(await snapshot(numericFile));assert.equal(source.version,version);assert.equal(numeric.version,version);assert.equal(numeric.integratedWorldScenesAdded,0);
 const is19=version==='1.9',expectedClient=source.officialSources.clientSha1;assert.equal(is19?numeric.officialSources.clientSha1:numeric.clientSha1,expectedClient);
 const sourceHashes=is19?source.reviewSources:source.auditSources;for(const[file,hash]of Object.entries(sourceHashes))await verify(file,hash);for(const[file,hash]of Object.entries(numeric.sources))await verify(file,hash);
 if(numeric.runtimeCompiledClasses)for(const[file,hash]of Object.entries(numeric.runtimeCompiledClasses))await verify(file,hash);
 for(const a of numeric.classpathArtifacts)assert.equal(digest(await readFile(path.join('.research/libraries',a.path))),a.sha1,a.path);
 const metadataPath=is19?`.research/lwjgl219-source/${version}/official-metadata.json`:`.research/lwjgl218-patches/${version}/official-metadata.json`;
 // The source report binds the official metadata. The checked artifact records
 // below bind every actually executed classpath dependency independently.
 const metadata=await readFile(metadataPath);assert.equal(digest(metadata),source.officialSources.metadataSha1,metadataPath);snapshots.set(path.resolve(metadataPath),sha(metadata));
 const classes=is19?source.classes.find(r=>r.version===version).classes:source.classes,methods=await originalClasses(version,classes);
 const bindings=source.bindings.filter(b=>!b.version||b.version===version);for(const b of bindings)assert.equal(methods.get(b.owner)[b.member+b.descriptor],b.codeSha256,b.label);
 const raw={};if(is19){for(const[key,ref]of Object.entries(numeric.rawOutputs))raw[key]=await verify(ref.path,ref.sha256);await verify(source.rawEvidence.path,source.rawEvidence.sha256);}
 else{for(const[key,file]of Object.entries(numeric.rawOutputs))raw[key]=await verify(file,numeric.rawOutputHashes[key]);await verify(numeric.sharedInputOrigin.path,numeric.sharedInputOrigin.sha256);
  const process=await parse(numeric.process.path);assert.equal(process.running,false);assert.equal(process.exit,0);assert.equal(process.version,version);assert.equal(process.pid,numeric.process.pid);await snapshot(numeric.process.path);
 }
 const inputs=JSON.parse((is19?raw['inputs.json']:raw.inputs).toString()).map(row=>row.map(Number));const tsv=(is19?raw['inputs.tsv']:raw.inputTsv).toString().split(/\r?\n/).map(line=>line.split('\t').map(Number));assert.deepEqual(inputs,tsv);
 const math=is19?raw['math.bin']:raw.math,notes=is19?raw['notes.bin']:raw.notes,packet=is19?raw['packet.bin']:raw.packet,packetInputs=(is19?raw['packet-inputs.tsv']:raw.packetInputs).toString().trim().split(/\r?\n/).map(Number);
 assert.equal(math.subarray(0,4).toString(),is19?'NB19':'NB8P');assert.equal(notes.subarray(0,4).toString(),is19?'NBN9':'NBNP');assert.equal(packet.subarray(0,4).toString(),is19?'NBP9':'NBPP');assert.equal(math.readUInt32LE(4),inputs.length);assert.equal(notes.readUInt32LE(4),125);assert.equal(packet.readUInt32LE(4),packetInputs.length);
 assert.equal(math.length,8+inputs.length*(is19?16:8));assert.equal(notes.length,8+125*(is19?20:28));assert.equal(packet.length,8+packetInputs.length*(is19?24:12));
 const pool=is19?{normal:numeric.requestedNormalPool,streaming:numeric.requestedStreamingPool}:numeric.originalPoolDefaults;assert.equal(pool.normal,28);assert.equal(pool.streaming,4);
 let context;
 if(is19){const file='docs/evidence/java-1.9-hrtf-control-source.json';context=JSON.parse(await snapshot(file));for(const[file,hash]of Object.entries(context.sources))await verify(file,hash);await verify(context.rawEvidence.path,context.rawEvidence.sha256);await verify(context.originalAttributeBuilder.rawOutput,context.originalAttributeBuilder.sha256);assert.equal(context.scope.nativeContextCreated,false);assert.deepEqual(context.originalAttributeBuilder.result,[4103,44100,4104,60,4105,0,0]);}
 return{version,is19,sourceFile,numericFile,source,numeric,raw,inputs,math,notes,packet,packetInputs,pool,context};
}

const entry=path.join(root,'production.mjs');
const initialFiles=['src/audio/volume.ts','src/audio/parameters.ts','src/audio/profiles.ts','src/data/legacy-audio-facts.json','src/data/audio-facts.json','src/data/early-audio-facts.json','src/data/world-audio-facts.json','src/data/audio-validation.json'];
for(const file of initialFiles)await snapshot(file);
const contents=`export {gamePitchParameters,gameEventPitchParameters,gameVolumeParameters} from './src/audio/volume.ts';export {audioProfile,gameHrtfControl} from './src/audio/profiles.ts';import {createProject,newNote,flattenNotes} from './src/core/project.ts';import {noteAudioParameters} from './src/audio/parameters.ts';export function projectPitch(profile,note,instrument,mode){const p=createProject();p.audio.profileId=profile;p.audio.mode=mode;p.tracks[0].instrumentId=instrument;p.patterns[0].notes=[newNote(0,54+note)];return noteAudioParameters(p,flattenNotes(p)[0]).pitch;}`;
const report={schema:1,status:'running',root,versions,scope:'Current production helpers and real note-parameter route compared against frozen original Java raw output bits. No Java probe/game/native render rerun; no expected values generated from production.',observations,integratedWorldScenesAdded:0};
const reportFile=path.join(root,'report.json');
try{
 const built=await build({stdin:{contents,resolveDir:process.cwd(),sourcefile:'legacy-profile-production-audit.ts'},outfile:entry,bundle:true,platform:'node',format:'esm',metafile:true});
 for(const file of Object.keys(built.metafile.inputs).filter(file=>file!=='legacy-profile-production-audit.ts'&&!file.startsWith('<'))){const bytes=await readFile(file),old=snapshots.get(path.resolve(file));if(old)assert.equal(sha(bytes),old,`Changed during bundle: ${file}`);else snapshots.set(path.resolve(file),sha(bytes));}
 const product=await import(pathToFileURL(entry).href),legacy=await parse('src/data/legacy-audio-facts.json'),validation=await parse('src/data/audio-validation.json');
 for(const version of versions){
  const original=await frozenOriginal(version),{is19,inputs,math,notes,packet,packetInputs}=original,id='java-'+version,fact=legacy.profiles.find(f=>f.id===id);assert(fact,`Generated production legacy fact missing: ${id}`);
  const expectedTransport=is19?{kind:'unsigned-byte',scale:63.5,minimum:0,maximum:255,overflow:'wrap'}:original.source.facts.pitchTransport;assert.deepEqual(fact.pitchTransport,expectedTransport,id+' transport');
  assert.equal(fact.soundEventArithmetic,is19?'float-event-scalars':'double-event-scalars');assert.equal(fact.volumeRule,is19?'category-before-clamp':'category-after-clamp');if(!is19)assert.equal(fact.categoryVolumeOrder,'float-after-double-instance-event-clamp');
  for(const[i,[volume,pitch,category,eventVolume,eventPitch]]of inputs.entries()){
   equalBits(product.gameVolumeParameters(id,volume,.7,category,eventVolume).gain,math.readUInt32LE(8+i*(is19?16:8)+(is19?8:0)),{version,kind:'engine-gain',case:i});
   equalBits(product.gameEventPitchParameters(id,pitch,eventPitch),math.readUInt32LE(8+i*(is19?16:8)+(is19?12:4)),{version,kind:'engine-event-pitch',case:i});
  }
  const instruments=['harp','basedrum','snare','hat','bass'];
  for(let i=0;i<125;i++){
   const instrument=Math.floor(i/25),note=i%25,offset=8+i*(is19?20:28),emitted=notes.readFloatLE(offset),wirePitch=notes.readFloatLE(offset+(is19?4:8)),enginePitchBits=notes.readUInt32LE(offset+(is19?8:12)),volume=notes.readFloatLE(offset+(is19?12:20)),gainBits=notes.readUInt32LE(offset+(is19?16:24));
   equalBits(product.gamePitchParameters(id,emitted),enginePitchBits,{version,kind:'original-note-pitch',instrument,note});
   equalBits(product.gameEventPitchParameters(id,wirePitch),enginePitchBits,{version,kind:'already-transported-event-pitch',instrument,note});
   equalBits(product.gameVolumeParameters(id,volume,.7,.5).gain,gainBits,{version,kind:'original-note-gain-category-half',instrument,note});
   equalBits(product.projectPitch(id,note,instruments[instrument],'vanilla'),enginePitchBits,{version,kind:'production-note-route-vanilla',instrument,note});
   equalBits(product.projectPitch(id,note,instruments[instrument],'studio'),notes.readUInt32LE(offset),{version,kind:'production-note-route-studio',instrument,note});
  }
  // Production gamePitchParameters models the actual registered note route;
  // the1.9 named packet's separate /63 branch is intentionally not substituted.
  for(const[i,input]of packetInputs.entries())equalBits(product.gamePitchParameters(id,input),packet.readUInt32LE(8+i*(is19?24:12)+(is19?20:8)),{version,kind:'packet-wire-boundary',case:i,input});
  const profile=product.audioProfile(id);assert.equal(profile.status,'code-reviewed',id+' status');assert.equal(profile.voiceWarning,original.pool.normal,id+' voice warning');assert.equal(profile.measurementSummary,undefined,id+' must not inherit world measurements');assert(!validation.profiles.some(p=>p.id===id),id+' must have no world-validation registry entry');
  assert.equal(fact.originalRequestedVoicePool.normal,original.pool.normal);assert.equal(fact.originalRequestedVoicePool.streaming,original.pool.streaming);assert.equal(fact.originalRequestedVoicePool.actualAllocatedCapacityMeasured,false);
  assert.equal(product.gameHrtfControl(id),false);assert.equal(fact.hrtfControlMode,'device-default');assert.equal(fact.masterVolumePlacement,'listener');
  if(is19){assert.deepEqual(original.context.facts,{hrtfControl:false,hrtfControlMode:'device-default'});for(const row of original.numeric.originalMasterOptions){const value=floatFromBits(parseInt(row.inputBits,16));equalBits(product.gameVolumeParameters(id,1,value).listenerGain,parseInt(row.originalOptionsReturnBits,16),{version,kind:'original-master-option-to-listener-parameter'});}}
  else assert.equal(product.gameVolumeParameters(id,1,.7).listenerGain,Math.fround(.7),id+' source-reviewed listener scalar');
  observations.push({version,status:'passed',sourceEvidence:await reference(original.sourceFile),numericEvidence:await reference(original.numericFile),engineCases:inputs.length,engineOutputComparisons:inputs.length*2,originalNotes:125,noteOutputComparisons:125*5,registeredPacketWireCases:packetInputs.length,transportScale:expectedTransport.scale,voiceWarning:profile.voiceWarning,profileStatus:profile.status,hrtfControl:false,hrtfMode:fact.hrtfControlMode,worldScenesAdded:0,rawOutputs:Object.values(is19?original.numeric.rawOutputs:Object.fromEntries(Object.entries(original.numeric.rawOutputs).map(([k,file])=>[k,{path:file,sha256:original.numeric.rawOutputHashes[k]}])))});
 }
 assert.deepEqual(differences,[],`Original Java raw-bit differences: ${JSON.stringify(differences.slice(0,12))}`);
 for(const[file,hash]of snapshots)assert.equal(sha(await readFile(file)),hash,`Input changed during audit: ${file}`);
 report.status='passed';report.totals={profiles:observations.length,engineCases:observations.reduce((s,r)=>s+r.engineCases,0),engineOutputComparisons:observations.reduce((s,r)=>s+r.engineOutputComparisons,0),originalNotes:125*observations.length,noteOutputComparisons:625*observations.length,registeredPacketWireCases:observations.reduce((s,r)=>s+r.registeredPacketWireCases,0),masterOriginalOptionComparisons:5,worldScenesAdded:0};
 report.productionBundle=await reference(entry);report.auditScript=await reference('scripts/audit-legacy-profile-integration.mjs');report.inputSha256=Object.fromEntries([...snapshots].map(([file,hash])=>[path.relative(process.cwd(),file).replaceAll('\\','/'),hash]));report.differences=[];
 report.limitations=['Strict output bits come from prior original-Java raw buffers; source-derived metadata checks are separately stated.','Only1.9 original Options return bits are numerically compared to the listener parameter; no AL listener readback is measured here.','Static requested28voice warning is not a measured allocation limit and must not truncate render output.','No new game, native device/context, codec decode, mixer, world recording or PCM comparison.'];
 await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');if(process.argv.includes('--write-evidence'))await writeFile('docs/evidence/legacy-profile-integration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:'passed',...report.totals,report:reportFile}));
}catch(error){report.status='failed';report.error=String(error);report.differences=differences;await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');console.error(JSON.stringify({status:'failed',error:String(error),differences:differences.slice(0,12),report:reportFile}));throw error;}
