import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pre13Versions,shaPre13,executePre13} from './audit-pre13-audio.mjs';
import {reviewedPre13Components} from './review-pre13-components.mjs';
import {reviewedPre13Profile} from './review-pre13-profiles.mjs';
import {digest} from './research-utils.mjs';
const self='scripts/verify-pre13-product.mjs',json=x=>JSON.stringify(x,null,2)+'\n';
const bits=n=>{const b=Buffer.alloc(4);b.writeFloatLE(n);return b.toString('hex').match(/../g).reverse().join('');};
const value=h=>{const b=Buffer.alloc(4);b.writeUInt32LE(parseInt(h,16));return b.readFloatLE();};
const entry=`
export {gamePitchParameters,gameEventPitchParameters,gameVolumeParameters} from './src/audio/volume.ts';
export {audioProfile} from './src/audio/profiles.ts';
export {audioImplementation,clientEmbeddedLegacyCodec} from './src/audio/implementations.ts';
export {releaseById} from './src/core/releases.ts';
export {loadNoteBlockSoundAssets,soundAssetLayout} from './src/core/sound-assets.ts';
export {legacyLinearAttenuation} from './src/audio/legacy.ts';
export {withinBroadcastRange} from './src/audio/delivery.ts';
import {createProject,newNote,validateProject,flattenNotes} from './src/core/project.ts';
import {noteAudioParameters,listenerForProject} from './src/audio/parameters.ts';
import {AudioEngine} from './src/audio/engine.ts';
export async function route(id,midi,instrument,master,volume,mode,assets){
 const p=createProject();p.audio.profileId=id;p.audio.masterGain=master;p.audio.mode=mode;p.audio.directional=false;
 p.tracks[0].instrumentId=instrument;p.tracks[0].volume=volume;p.patterns[0].notes=[{...newNote(0,midi),velocity:1}];validateProject(p);
 const library={root:'request-only-frozen-object-fixture',version:id.slice(5),profileId:id,attenuationModel:'paulscode-linear',nativeLibrary:'not-opened',nativeDecoder:'not-opened',...assets};
 const engine=new AudioEngine();engine.library=library;const data=new Float32Array(32);
 engine.buffers.set(instrument,{duration:32/48000,length:32,sampleRate:48000,numberOfChannels:1,getChannelData:()=>data});
 return {parameters:noteAudioParameters(p,flattenNotes(p)[0],library),listener:listenerForProject(p),request:await engine.nativeRequest(p),validated:true};
}`;
export async function verifyPre13Product(root){
 await mkdir(root,{recursive:true});const hashes={},comparisons=[],observations=[],contracts=[],parse=async f=>JSON.parse(await readFile(f));
 const snapshot=async(f,h)=>{const b=await readFile(f),actual=shaPre13(b);if(h)assert.equal(actual,h,f);if(hashes[f])assert.equal(actual,hashes[f],f);hashes[f]=actual;return b;};
 const ref=async f=>({path:f.replaceAll('\\','/'),sha256:shaPre13(await readFile(f))});
 const eq=(actual,expected,context,evidenceKind='frozen-original-component-float-bits')=>{assert.equal(bits(actual),expected,JSON.stringify(context));comparisons.push({...context,evidenceKind,expectedBits:expected,actualBits:bits(actual)});};
 const report={schema:1,status:'running',root,nodePid:process.pid,versions:pre13Versions,scope:'Actual production helpers, official-object loader, validated projects and AudioEngine.nativeRequest versus frozen original pre13 components. Request construction uses an explicitly unopened native fixture and a32-frame in-memory sample buffer. No Java/resource probe rerun, decoder, audio worker, AL or world execution.',nativeExecutionsAdded:0,worldScenesAdded:0,originalJavaRerun:false};
 try{
  for(const f of [self,'scripts/review-pre13-profiles.mjs','scripts/review-pre13-components.mjs','scripts/review-pre13-audio-source.mjs','scripts/audit-pre13-audio.mjs','scripts/probe-pre13-audio.mjs','scripts/research-utils.mjs','package.json','package-lock.json'])await snapshot(f);
  const legacy=await parse('src/data/legacy-audio-facts.json'),world=await parse('src/data/world-audio-facts.json'),validation=await parse('src/data/audio-validation.json');
  for(const v of pre13Versions){assert(legacy.profiles.some(p=>p.id==='java-'+v),'Registration required: '+v);assert(world.profiles.some(p=>p.id==='java-'+v),'World/client gate registration required: '+v);assert(!validation.profiles.some(p=>p.id==='java-'+v),'No new world acceptance is claimed');}
  await writeFile(path.join(root,'entry.ts'),entry);const bundle=path.join(root,'product.mjs');const built=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'pre13-product.ts'},outfile:bundle,bundle:true,platform:'node',format:'esm',metafile:true});
  await writeFile(path.join(root,'metafile.json'),json(built.metafile));for(const f of Object.keys(built.metafile.inputs).filter(f=>f!=='pre13-product.ts'))await snapshot(f);const api=await import(pathToFileURL(bundle).href);
  for(const version of pre13Versions){
   const n=await reviewedPre13Components(version),p=await reviewedPre13Profile(version),id='java-'+version;
   assert.deepEqual(legacy.profiles.find(f=>f.id===id),p.legacy);assert.deepEqual(world.profiles.find(f=>f.id===id),p.world);
   for(const r of [n.sourceEvidence,n.numericEvidence,n.resourceEvidence,n.outputs.java])await snapshot(r.path,r.sha256);
   assert.equal(api.audioProfile(id).status,'code-reviewed');assert.equal(api.audioProfile(id).voiceWarning,28);assert.equal(api.audioImplementation(api.releaseById(version)).decoderKind,'legacy-jorbis');assert(api.clientEmbeddedLegacyCodec(api.releaseById(version)));assert(!api.clientEmbeddedLegacyCodec({...api.releaseById(version),clientSha1:'0'.repeat(40)}));
   const rs=await parse(p.resources.sourceEvidence.path),index=JSON.parse(await snapshot(rs.index.path)),byHash=new Map();for(const sample of p.resources.samples){const fixture=rs.fixtures.find(f=>f.key==='newsound/'+sample.name);assert(fixture);byHash.set(sample.sha1,await snapshot(fixture.file));}
   assert.equal(api.soundAssetLayout(n.clientSha1,index),'legacy-newsound');const reads=[];
   const assets=await api.loadNoteBlockSoundAssets(index,'legacy-newsound',async o=>{assert(byHash.has(o.hash));const b=byHash.get(o.hash);assert.equal(digest(b),o.hash);reads.push(o.hash);return b;});assert.equal(reads.length,6);assert.equal(new Set(reads).size,6);
   const stdout=(await readFile(n.outputs.java.path,'utf8')).trim().split(/\r?\n/).map(l=>l.split('\t')),rows=k=>stdout.filter(r=>r[0]===k).map(r=>r.slice(1));
   let suppressed=0,scalarRows=0,projectRows=0,materialRows=0;
   for(const row of rows('BOUNDARY')){
    const[v,m,pitch]=row.slice(0,3).map(value);if(row[3]!=='true'){suppressed++;continue;}
    const actual=api.gameVolumeParameters(id,v,m);eq(actual.gain,row[5],{version,kind:'manager-final-gain',inputBits:row.slice(0,3)});eq(actual.listenerGain,bits(1),{version,kind:'source-default-unity-listener'},'source-and-editor-contract-float-bits');eq(api.gameEventPitchParameters(id,pitch),row[7],{version,kind:'direct-source-final-pitch'});scalarRows++;
    if(v<0||v>4||m<0||m>2)continue;
    const midi=66+12*Math.log2(pitch);assert(Number.isInteger(midi));const r=await api.route(id,midi,'harp',m,v,'vanilla',assets);assert(r.validated);assert.equal(r.request.events.length,1);
    for(const [kind,result]of [['noteAudioParameters',r.parameters],['nativeRequest',r.request.events[0]]]){eq(result.gain,row[5],{version,kind:kind+'-boundary-gain',midi});eq(result.pitch,row[7],{version,kind:kind+'-boundary-pitch',midi});}
    assert.equal(r.listener.gain,1);assert.equal(r.request.listener.gain,1);assert.deepEqual(r.request.broadcast,{listenerPosition:[0,-p.world.standingEyeHeight,0],range:48});projectRows++;
   }
   assert.equal(suppressed,165);assert.equal(scalarRows,150);assert.equal(projectRows,150);
   for(const row of rows('NOTE')){
    const[material,note]=row.slice(0,2).map(Number),instrument=p.legacy.materials[material].instrument;
    assert.equal(row[2],'note/'+p.legacy.materials[material].event.slice(5)+'.ogg');eq(api.gamePitchParameters(id,value(row[6])),row[7],{version,kind:'raw-note-no-quantization',material,note});
    for(const mode of ['vanilla','studio']){
     const r=await api.route(id,54+note,instrument,.7,3,mode,assets);assert.equal(r.request.events.length,1);assert.equal(r.request.encodedSamples.length,1);assert.deepEqual(Buffer.from(r.request.encodedSamples[0].bytes),Buffer.from(assets.samples[instrument].bytes));
     const evidenceKind=mode==='vanilla'?'frozen-original-component-float-bits':'source-and-editor-contract-float-bits';
     for(const[kind,result]of [['noteAudioParameters',r.parameters],['nativeRequest',r.request.events[0]]]){eq(result.pitch,row[7],{version,kind:kind+'-material-pitch',material,note,mode},evidenceKind);eq(result.gain,mode==='vanilla'?row[5]:bits(3),{version,kind:kind+'-material-gain',material,note,mode},evidenceKind);}
     assert.equal(r.request.listener.gain,mode==='vanilla'?1:.7);assert.equal(r.request.hrtf,mode==='vanilla'?'device-default':undefined);assert.equal(r.request.events[0].maxDistance,mode==='vanilla'?48:1e9);if(mode==='studio')assert.equal(r.request.broadcast,undefined);materialRows++;
    }
   }
   for(const row of rows('PACKET_NOTE'))eq(api.gamePitchParameters(id,value(row[6])),row[7],{version,kind:'original-integer-note-packet-pitch',material:Number(row[0]),note:Number(row[1])});
   for(const [d,gain]of rows('ATTENUATION'))eq(api.legacyLinearAttenuation(0,0,value(d),48),gain,{version,kind:'original-linear-attenuation',distanceBits:d});
   for(const [dx,dy,played]of rows('GATE')){const x=.5+Number(dx)-.5,y=80.5+Number(dy)-80.5;assert.equal(api.withinBroadcastRange(x,y,0,{listenerPosition:[0,0,0],range:48}),played==='true');contracts.push({version,kind:'stationary-client-audibility-gate',dx,dy,played:played==='true',serverBroadcastMeasured:false});}
   for(const[instrument,name]of Object.entries(p.resources.events)){const sample=p.resources.samples.find(s=>s.event==='note.'+name),actual=assets.samples[instrument];assert.equal(actual.name,'newsound/'+sample.name);assert.equal(actual.sha1,sample.sha1);assert.equal(digest(actual.bytes),sample.sha1);assert.equal(assets.soundEvents[instrument].event,sample.event);}
   assert.equal(materialRows,250);observations.push({version,clientSha1:n.clientSha1,sourceEvidence:n.sourceEvidence,numericEvidence:n.numericEvidence,resourceEvidence:n.resourceEvidence,scalarPlayedRows:scalarRows,suppressedNotComparedAsZero:suppressed,validatedBoundaryProjectRequests:projectRows,validatedMaterialProjectRequests:materialRows,sourcePitchNote1:n.checks.normalNote1RawBits,later63PitchNotUsed:n.checks.normalNote1Later63Bits,resourcesRead:reads.length});
  }
  for(const[f,h]of Object.entries(hashes))assert.equal(shaPre13(await readFile(f)),h,f+' changed during comparison');
  await writeFile(path.join(root,'comparisons.json'),json(comparisons));await writeFile(path.join(root,'contracts.json'),json(contracts));
  const directOriginalFloatComparisons=comparisons.filter(c=>c.evidenceKind==='frozen-original-component-float-bits').length,sourceEditorContractFloatComparisons=comparisons.length-directOriginalFloatComparisons;assert.equal(directOriginalFloatComparisons,11599);assert.equal(sourceEditorContractFloatComparisons,4550);
  Object.assign(report,{status:'passed',observations,comparisons:await ref(path.join(root,'comparisons.json')),contracts:await ref(path.join(root,'contracts.json')),totals:{versions:7,bitComparisons:comparisons.length,directOriginalFloatComparisons,sourceEditorContractFloatComparisons,validatedProjectRequests:2800,clientGateContracts:contracts.length,resourceObjectReads:42},bundle:await ref(bundle),metafile:await ref(path.join(root,'metafile.json')),inputs:hashes,limitations:['Only the finite frozen component rows and legal constructed projects are compared; no exhaustive IEEE-754 or all-project proof.','The1050 unity-listener defaults are source constants, not observed original numeric outputs; the3500 studio-mode float checks describe the editor contract. They are partitioned from11599 direct original-output comparisons.','Synthetic unopened library/32-frame buffer proves request construction only. Native audio workers, decoders and mixer output are not executed.','Client current-position versus interpolated listener equivalence is limited to the stationary editor reference; standalone server delivery and moving pose remain unreviewed.']});
 }catch(error){Object.assign(report,{status:'failed',error:error.stack??String(error),inputs:hashes,partialBitComparisons:comparisons.length});throw error;}
 finally{report.finishedAt=new Date().toISOString();await writeFile(path.join(root,'report.json'),json(report));}
 return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='--execute')await verifyPre13Product(process.argv[3]);
 else{
  const root=path.resolve('.local/pre13-product','run-'+Date.now()),run=await executePre13(process.execPath,[fileURLToPath(import.meta.url),'--execute',root],root,'node'),r=JSON.parse(await readFile(path.join(root,'report.json')));
  const publicReport={...r,rawReport:{path:path.join(root,'report.json'),sha256:shaPre13(await readFile(path.join(root,'report.json')))},execution:{path:run.file,sha256:shaPre13(await readFile(run.file))}};
  assert.equal(r.status,'passed');await writeFile('docs/evidence/pre13-production-comparison.json',json(publicReport));console.log(JSON.stringify({status:r.status,root,totals:r.totals,pid:run.record.pid,exit:run.record.code}));
 }
}
