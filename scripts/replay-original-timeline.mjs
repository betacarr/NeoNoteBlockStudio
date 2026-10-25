import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {digest} from './research-utils.mjs';

// Consume the frozen original timeline. This does not rerun GameTimelineProbe.
const root=path.resolve('.local/original-timeline-replay','run-'+Date.now());await mkdir(root,{recursive:true});
const sha=b=>digest(b,'sha256'),parse=async f=>JSON.parse(await readFile(f)),json=x=>JSON.stringify(x,null,2)+'\n';
const ref=async f=>({path:f.replaceAll('\\','/'),sha256:sha(await readFile(f))});
const inputFile='docs/evidence/java-1.20.5-original-timeline.json',inputBytes=await readFile(inputFile),originalReport=JSON.parse(inputBytes);
assert.equal(originalReport.status,'passed');assert.equal(originalReport.version,'1.20.5');
const historicalRelocations=[];
const checked=async r=>{
 let file=r.path;
 if(file==='dist-electron/java/NbsxVorbisDecoder.class'){
  const manifestFile='.local/decoder-before-package-fix/manifest.json',manifest=await parse(manifestFile),archived=manifest.refs.find(a=>a.original===file);assert(archived);assert.equal(archived.sha256,r.sha256);file=archived.path;
  historicalRelocations.push({original:r.path,archived:await ref(file),manifest:await ref(manifestFile),reason:'Frozen original-run helper retained byte-for-byte before named-package repair; never used for current decoding'});
 }
 const b=await readFile(file);assert.equal(sha(b),r.sha256,r.path);if(r.bytes!==undefined)assert.equal(b.length,r.bytes);return b;
};
const original=await checked(originalReport.originalPcm),cases=JSON.parse(await checked(originalReport.logicalProjects));assert.equal(cases.length,16);
for(const r of [...originalReport.dependencies,...originalReport.terminals,originalReport.java,originalReport.javaDecoderClass,originalReport.compiledProbe,originalReport.nativeLibrary,originalReport.config,originalReport.input])await checked(r);
for(const p of Object.values(originalReport.processes))assert.equal(p.code,0);
const entry="export {render} from './electron/audio-worker.ts';export {decodeJavaVorbis} from './electron/java-decoder.ts';export {AudioEngine} from './src/audio/engine.ts';export {validateProject} from './src/core/project.ts';";
const bundle=path.join(root,'product.mjs'),built=await build({stdin:{contents:entry,sourcefile:'timeline-replay.ts',resolveDir:process.cwd()},outfile:bundle,bundle:true,platform:'node',format:'esm',external:['koffi'],metafile:true});
const sources={};for(const f of ['scripts/replay-original-timeline.mjs',...Object.keys(built.metafile.inputs).filter(f=>f!=='timeline-replay.ts')])sources[f]=sha(await readFile(f));
const api=await import(pathToFileURL(bundle).href),fixture=await parse('.local/game-fixtures/1.20.5/fixture.json'),runtime=await parse('.local/runtimes/temurin-21/runtime.json');
assert.equal(fixture.clientSha1,originalReport.official.client.sha1);assert.equal(digest(await readFile(fixture.classpath[0])),fixture.clientSha1);
const metadata=await parse('.research/metadata/1.20.5.json'),index=await parse(path.join(fixture.root,'assets/indexes',metadata.assetIndex.id+'.json')),object=index.objects[fixture.sounds.harp.path],sample=await readFile(path.join(fixture.root,'assets/objects',object.hash.slice(0,2),object.hash));
assert.equal(digest(sample),originalReport.sample.sha1);assert.equal(sample.length,originalReport.sample.bytes);
const nativeLibrary=path.join(fixture.nativeDir,'OpenAL.dll');assert.equal(sha(await readFile(nativeLibrary)),originalReport.nativeLibrary.sha256);assert.equal(sha(await readFile(runtime.executable)),originalReport.java.sha256);
const javaDecoder={executable:runtime.executable,kind:'jorbis',classpath:[path.resolve('dist-electron/java'),...fixture.classpath.filter(f=>/jorbis-[^/\\]+\.jar$/.test(f))]},decoded=api.decodeJavaVorbis(javaDecoder,[{id:'harp',bytes:new Uint8Array(sample)}])[0];assert(decoded);
const engine=new api.AudioEngine();engine.library={version:'1.20.5',profileId:'java-1.20.5',nativeLibrary,javaDecoder,attenuationModel:'openal-linear',samples:{harp:{bytes:new Uint8Array(sample)}},soundEvents:{harp:{volume:1,pitch:1,attenuationDistance:16}}};
engine.buffers.set('harp',{sampleRate:decoded.sampleRate,numberOfChannels:decoded.channels,duration:decoded.data[0].length/decoded.sampleRate,getChannelData:i=>decoded.data[i]});
assert.equal(original.toString('ascii',0,4),'NBST');assert.equal(original.readUInt32LE(4),cases.length);let offset=8;const observations=[];
for(const c of cases){
 api.validateProject(c.project);const request=await engine.nativeRequest(c.project);request.duration=c.frames/48000;request.hrtf='first-profile';request.outputLimiter=true;
 assert.equal(request.events.length,c.expected.length);for(const[i,e]of request.events.entries()){const expected=c.expected[i];assert.equal(e.frame,expected.frame);for(const k of ['x','y','z','pitch','gain'])assert.equal(Math.fround(e[k]),Math.fround(expected[k]),c.name+' '+i+' '+k);}
 const [rate,frames,events,hrtf,limiter]=Array.from({length:5},(_,i)=>original.readUInt32LE(offset+i*4));offset+=20;assert.deepEqual([rate,frames,events,hrtf,limiter],[48000,c.frames,c.expected.length,c.hrtf?1:0,1]);
 const pcm=original.subarray(offset,offset+frames*4);offset+=pcm.length;const rendered=Buffer.from(api.render(request).wav),actual=rendered.subarray(44);assert.deepEqual(actual,pcm,c.name+' exact original PCM');assert.equal(sha(pcm),originalReport.observations.find(o=>o.name===c.name).originalPcmSha256);
 const file=path.join(root,c.name+'.wav');await writeFile(file,rendered);observations.push({name:c.name,events,frames,exact:true,changedSamples:0,maxPcmError:0,originalPcmSha256:sha(pcm),rendered:await ref(file)});
}
assert.equal(offset,original.length);for(const[f,h]of Object.entries(sources))assert.equal(sha(await readFile(f)),h,f);assert.equal(sha(await readFile(inputFile)),sha(inputBytes));
await writeFile(path.join(root,'metafile.json'),json(built.metafile));const report={schema:1,status:'passed',nodePid:process.pid,root,scope:'Current actual nativeRequest and worker replay of the frozen16 original-class frame-clock timelines. Current production decoder is exercised; GameTimelineProbe and original timeline JVM are not rerun. This adds no integrated-world, musical server/network or physical timing acceptance.',originalTimelineEvidence:{path:inputFile,sha256:sha(inputBytes)},originalJavaRerun:false,historicalRelocations,currentDecoderClass:await ref('dist-electron/java/studio/nbsx/audio/NbsxVorbisDecoder.class'),originalPcm:originalReport.originalPcm,logicalProjects:originalReport.logicalProjects,bundle:await ref(bundle),metafile:await ref(path.join(root,'metafile.json')),sources,observations,worldScenesAdded:0};
await writeFile(path.join(root,'report.json'),json(report));if(process.argv.includes('--write-evidence'))await writeFile('docs/evidence/original-timeline-current-replay.json',json({...report,rawReport:await ref(path.join(root,'report.json'))}));
console.log(JSON.stringify({status:'passed',root,timelines:observations.length,events:observations.reduce((n,o)=>n+o.events,0),originalJavaRerun:false,worldScenesAdded:0}));
