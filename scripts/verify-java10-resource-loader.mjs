import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {digest} from './research-utils.mjs';
import {reviewedJava10Resources} from './review-java10-resources.mjs';

const source=await reviewedJava10Resources(),original=JSON.parse(await readFile(source.sourceEvidence.path));
const root=path.resolve('.local/java10-resource-loader',`run-${Date.now()}`);await mkdir(root,{recursive:true});
const execution={pid:process.pid,parentPid:process.ppid,argv:process.argv,startedAt:new Date().toISOString(),terminal:false};
let report;process.on('exit',code=>{Object.assign(execution,{terminal:true,code,signal:null,finishedAt:new Date().toISOString()});const body={...(report??{schema:1,status:'failed',error:'Loader verification did not complete'}),execution};if(code!==0)body.status='failed';writeFileSync(path.join(root,'node.process.json'),JSON.stringify(execution,null,2));writeFileSync(path.join(root,'report.json'),JSON.stringify(body,null,2));if(code===0&&report&&process.argv.includes('--write-evidence'))writeFileSync('docs/evidence/java-1.0-resource-loader.json',JSON.stringify(body,null,2));});
const ref=async file=>({path:path.relative(process.cwd(),path.resolve(file)).replaceAll('\\','/'),sha256:digest(await readFile(file),'sha256')});
const entry=path.join(root,'loader.mjs');const bundle=await build({stdin:{contents:"export {soundAssetLayout,loadNoteBlockSoundAssets} from './src/core/sound-assets.ts';export {audioProfile} from './src/audio/profiles.ts';export {audioImplementation,clientEmbeddedLegacyCodec} from './src/audio/implementations.ts';",sourcefile:'java10-resource-loader.ts',resolveDir:process.cwd()},outfile:entry,bundle:true,platform:'node',format:'esm',metafile:true});
const api=await import(pathToFileURL(entry).href),index=JSON.parse(await readFile(original.index.path));
const layout=api.soundAssetLayout(source.clientSha1,index);assert.equal(layout,'legacy-newsound');
const reads=[],result=await api.loadNoteBlockSoundAssets(index,layout,async a=>{const f=original.fixtures.find(f=>f.hash===a.hash);assert(f);const bytes=await readFile(f.file);assert.equal(digest(bytes),a.hash);reads.push(a.hash);return bytes;});
const samples=[];for(const[id,eventName]of Object.entries(source.events)){
  const selected=source.samples.find(s=>s.event==='note.'+eventName);assert(selected);
  const actual=result.samples[id];assert.equal(actual.name,source.sourcePrefix+'/'+selected.name);assert.equal(actual.sha1,selected.sha1);assert.equal(actual.bytes.length,selected.bytes);assert.equal(digest(actual.bytes),selected.sha1);
  assert.deepEqual(result.soundEvents[id],{event:selected.event,path:'minecraft/sounds/'+selected.name,volume:1,pitch:1,attenuationDistance:16});samples.push({id,event:selected.event,originalFileUrl:selected.url,path:actual.name,sha1:actual.sha1,bytes:actual.bytes.length,byteIdentical:true});
}
assert.equal(reads.length,6);assert.equal(source.fullAudioProfilePromoted,false);assert.equal(api.audioProfile('java-1.0').status,'code-reviewed');
const identities=JSON.parse(await readFile('src/data/java-releases.json')).versions,release=identities.find(v=>v.id==='1.0');assert.equal(api.audioImplementation(release).decoderKind,'legacy-jorbis');
assert.equal(api.clientEmbeddedLegacyCodec(release),true);assert.equal(api.clientEmbeddedLegacyCodec({...release,clientSha1:'0'.repeat(40)}),false);assert.equal(api.clientEmbeddedLegacyCodec({...release,id:'unreviewed-client'}),false);
const legacy=JSON.parse(await readFile('src/data/legacy-audio-facts.json')).profiles.find(p=>p.id==='java-1.0'),registry=JSON.parse(await readFile('src/data/audio-validation.json'));
assert.equal(legacy.clientSha1,source.clientSha1);assert.equal(legacy.decoder,'legacy-jorbis');assert.equal(legacy.codecContainer,'original-client-embedded');assert.deepEqual(legacy.resourceEvidence,source.sourceEvidence);assert.equal(legacy.gameRecording,'pending');
const coreEvidence={source:{path:legacy.sourceEvidence,sha256:legacy.sourceEvidenceSha256},numeric:legacy.numericEvidence};for(const r of Object.values(coreEvidence))assert.equal(digest(await readFile(r.path),'sha256'),r.sha256);assert(!registry.profiles.some(p=>p.id==='java-1.0'));
assert.throws(()=>api.soundAssetLayout(identities.find(v=>v.id==='b1.8.1').clientSha1,index),/尚未核对/);
const sources={};for(const file of new Set(['scripts/verify-java10-resource-loader.mjs','scripts/review-java10-resources.mjs','scripts/generate-java10-resource-layout.mjs',...Object.keys(bundle.metafile.inputs).filter(file=>file!=='java10-resource-loader.ts')]))sources[file]=digest(await readFile(file),'sha256');
report={schema:1,status:'passed',version:'1.0',scope:'Actual production resource loader versus existing original Java1.0 resource-selected bytes. Current code-reviewed/embedded-codec identity comes from separate core evidence. No decoder execution, worker/native/world measurement or new original sample.',sourceEvidence:source.sourceEvidence,coreEvidence,originalRaw:original.raw,fixtureIndex:original.index,loaderBundle:await ref(entry),reads,samples,sources,worldScenesAdded:0,nativeMeasurementsAdded:0,audioWorkerForks:0,fullAudioProfilesPromotedByResourceCheck:0,originalResourceProofFullAudioProfilePromoted:false,productAudioStatus:'code-reviewed',decoderKind:'legacy-jorbis',embeddedCodecIdentityChecks:3,measurementRegistry:await ref('src/data/audio-validation.json')};
console.log(JSON.stringify({status:'passed',report:path.join(root,'report.json'),sampleByteComparisons:samples.length,profileStatus:'code-reviewed',decoderKind:'legacy-jorbis',pid:process.pid}));
