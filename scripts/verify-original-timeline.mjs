import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {unzipSync} from 'fflate';
import {digest} from './research-utils.mjs';

// Frame-clock component evidence. Does not advance a world, server tick, network
// or playback device; the original classes share a deliberately controlled context.
const version='1.20.5',rate=48000,root=path.resolve('.local/original-timeline',version,`run-${Date.now()}`);
await mkdir(root,{recursive:true});
const parse=async f=>JSON.parse(await readFile(f)),sha=b=>digest(b,'sha256');
const ref=async f=>{const b=await readFile(f);return{path:path.relative(process.cwd(),path.resolve(f)).replaceAll('\\','/'),bytes:b.length,sha256:sha(b)}};
const metadata=await parse(`.research/metadata/${version}.json`),fixture=await parse(`.local/game-fixtures/${version}/fixture.json`);
assert.equal(fixture.clientSha1,metadata.downloads.client.sha1);
const client=await readFile(fixture.classpath[0]);assert.equal(digest(client),metadata.downloads.client.sha1);
const artifacts=metadata.libraries.flatMap(l=>[l.downloads?.artifact,...Object.values(l.downloads?.classifiers??{})]).filter(Boolean),dependencies=[];
for(const f of new Set(fixture.classpath.slice(1))){const relative=path.relative(path.join(fixture.root,'libraries'),f).replaceAll('\\','/'),a=artifacts.find(a=>a.path===relative);assert(a,relative);assert.equal(digest(await readFile(f)),a.sha1);dependencies.push(await ref(f));}
const mappingFile=`.research/source-comparison/${version}/mappings.txt`,mapping=await readFile(mappingFile,'utf8');assert.equal(digest(Buffer.from(mapping)),metadata.downloads.client_mappings.sha1);
const className=name=>{const line=mapping.split(/\r?\n/).find(l=>l.startsWith(name+' -> '));assert(line,name);return line.slice(line.indexOf(' -> ')+4,-1)};
const methodName=(owner,signature)=>{const at=mapping.indexOf(owner+' -> ');assert(at>=0,owner);const block=mapping.slice(at).split(/\r?\n(?=\S[^\n]* -> )/)[0],line=block.split(/\r?\n/).find(l=>l.includes(signature+' -> '));assert(line,owner+'.'+signature);return line.slice(line.lastIndexOf(' -> ')+4)};
const names={channel:'com.mojang.blaze3d.audio.Channel',buffer:'com.mojang.blaze3d.audio.SoundBuffer',listener:'com.mojang.blaze3d.audio.Listener',vector:'net.minecraft.world.phys.Vec3',codec:'net.minecraft.client.sounds.JOrbisAudioStream',readAllOwner:'net.minecraft.client.sounds.FloatSampleSource'};
const selectedClasses=new Set(Object.values(names).map(n=>className(n)+'.class'));
const archive=unzipSync(client,{filter:e=>selectedClasses.has(e.name)}),originalClasses=[];
for(const[role,name]of Object.entries(names)){const original=className(name),bytes=archive[original+'.class'];assert(bytes);originalClasses.push({role,mapped:name,original,classSha256:sha(bytes)});}
const indexFile=path.join(fixture.root,'assets/indexes',metadata.assetIndex.id+'.json'),indexBytes=await readFile(indexFile);assert.equal(digest(indexBytes),metadata.assetIndex.sha1);const index=JSON.parse(indexBytes);
const object=index.objects[fixture.sounds.harp.path],sampleFile=path.join(fixture.root,'assets/objects',object.hash.slice(0,2),object.hash),sample=await readFile(sampleFile);assert.equal(digest(sample),object.hash);
const nativeLibrary=path.join(fixture.nativeDir,'OpenAL.dll'),nativeArchive=artifacts.find(a=>/lwjgl-openal/.test(a.path)&&/natives-windows\.jar$/.test(a.path));assert(nativeArchive);
const nativeBytes=await readFile(path.join(fixture.root,'libraries',nativeArchive.path)),nativeLibrarySha=sha(await readFile(nativeLibrary));assert.equal(digest(nativeBytes),nativeArchive.sha1);assert(Object.values(unzipSync(nativeBytes,{filter:e=>path.basename(e.name).toLowerCase()==='openal.dll'})).some(b=>sha(b)===nativeLibrarySha));
const config={...Object.fromEntries(Object.entries(names).filter(([role])=>role!=='readAllOwner').map(([role,name])=>[role,className(name)])),sample:sampleFile.replaceAll('\\','/'),
 format:methodName(names.codec,'javax.sound.sampled.AudioFormat getFormat()'),readAll:methodName(names.readAllOwner,'java.nio.ByteBuffer readAll()'),
 resetListener:methodName(names.listener,'void reset()'),listenerGain:methodName(names.listener,'void setGain(float)'),createChannel:methodName(names.channel,'com.mojang.blaze3d.audio.Channel create()'),
 attach:methodName(names.channel,'void attachStaticBuffer(com.mojang.blaze3d.audio.SoundBuffer)'),position:methodName(names.channel,'void setSelfPosition(net.minecraft.world.phys.Vec3)'),pitch:methodName(names.channel,'void setPitch(float)'),gain:methodName(names.channel,'void setVolume(float)'),attenuation:methodName(names.channel,'void linearAttenuation(float)'),play:methodName(names.channel,'void play()'),destroyChannel:methodName(names.channel,'void destroy()'),discardBuffer:methodName(names.buffer,'void discardAlBuffer()')};
const configFile=path.join(root,'probe.properties');await writeFile(configFile,Object.entries(config).map(([k,v])=>`${k}=${v}`).join('\n'));
const bundleFile=path.join(root,'production.mjs'),bundle=await build({stdin:{contents:"export {render} from './electron/audio-worker.ts';export {decodeJavaVorbis} from './electron/java-decoder.ts';export {AudioEngine} from './src/audio/engine.ts';export {createProject,newNote} from './src/core/project.ts';",resolveDir:process.cwd(),sourcefile:'timeline-production.ts'},outfile:bundleFile,bundle:true,platform:'node',format:'esm',external:['koffi'],metafile:true});
const api=await import(pathToFileURL(bundleFile).href),runtime=await parse('.local/runtimes/temurin-21/runtime.json'),javaDecoder={executable:runtime.executable,kind:'jorbis',classpath:[path.resolve('dist-electron/java'),...fixture.classpath.filter(f=>/jorbis-[^/\\]+\.jar$/.test(f))]};
const decoded=api.decodeJavaVorbis(javaDecoder,[{id:'harp',bytes:new Uint8Array(sample)}])[0];assert(decoded);
const library={version,profileId:'java-'+version,nativeLibrary,javaDecoder,attenuationModel:'openal-linear',samples:{harp:{bytes:new Uint8Array(sample)}},soundEvents:{harp:{volume:1,pitch:1,attenuationDistance:16}}};
const engine=new api.AudioEngine();engine.library=library;engine.buffers.set('harp',{sampleRate:decoded.sampleRate,numberOfChannels:decoded.channels,duration:decoded.data[0].length/decoded.sampleRate,getChannelData:i=>decoded.data[i]});
const gcd=(a,b)=>b?gcd(b,a%b):a,add=(a,b)=>{const n=a[0]*b[1]+b[0]*a[1],d=a[1]*b[1],g=gcd(n,d);return[n/g,d/g]};
function exactFrame(tick,ppq,tempos){let total=[0n,1n];for(let i=0;i<tempos.length;i++){const begin=tempos[i].tick,end=Math.min(tick,tempos[i+1]?.tick??tick);if(end>begin)total=add(total,[BigInt(end-begin)*60n*BigInt(rate),BigInt(ppq)*BigInt(tempos[i].bpm)]);if(end===tick)break;}return Number((2n*total[0]+total[1])/(2n*total[1]));}
const specs=[
 {name:'one-frame-and-1024-boundaries',bpm:6000,ticks:[1023,1024,1025,2047,2048,2049],ppq:480,frames:96000},
 {name:'half-frame-rounding',bpm:128,ticks:[1,3,4,5,11,12],ppq:480,frames:96000},
 {name:'exact-half-frame-regression',bpm:96,ticks:[123,307,425,683],ppq:480,frames:144000},
 {name:'repeated-tempo-prefix-half-frame',tempos:Array.from({length:55},(_,tick)=>({tick,bpm:176})),ticks:[55],ppq:960,frames:96000},
 {name:'tempo-changes',tempos:[{tick:0,bpm:120},{tick:480,bpm:137},{tick:960,bpm:91}],ticks:[0,239,240,479,480,481,959,960,961,1440],ppq:480,frames:192000},
 {name:'late-source-reuse',bpm:120,ticks:[0,2400,4800],ppq:480,frames:384000},
 {name:'overlapping-64-voice-chord',bpm:120,ticks:Array(64).fill(480),ppq:480,frames:144000,velocity:.025},
 {name:'dense-repeated-phrase',bpm:700,ticks:Array.from({length:40},(_,i)=>i*240),ppq:480,frames:192000},
];
const cases=[],frameDifferences=[];
for(const spec of specs)for(const hrtf of [false,true]){
 const p=api.createProject(spec.name),tempos=spec.tempos??[{tick:0,bpm:spec.bpm}];p.ppq=spec.ppq;p.tempos=tempos;p.audio.profileId='java-'+version;p.audio.directional=hrtf;p.audio.mode='vanilla';p.audio.masterGain=.7;p.audio.sampleRate=rate;
 p.patterns[0].notes=spec.ticks.map((tick,i)=>({...api.newNote(tick,[54,66,78][i%3],1),velocity:spec.velocity??.12,pan:[-.75,0,.75][i%3],height:i%2?0:3}));p.patterns[0].length=p.regions[0].length=Math.max(...spec.ticks)+480;
 const request=await engine.nativeRequest(p);request.duration=spec.frames/rate;request.hrtf='first-profile';request.outputLimiter=true;
 const expected=[...p.patterns[0].notes].sort((a,b)=>a.tick-b.tick||a.midi-b.midi).map(n=>({frame:exactFrame(n.tick,p.ppq,tempos),x:Math.fround(n.pan*2),y:n.height,z:-2,pitch:({54:.5,66:1,78:2})[n.midi],gain:Math.fround(n.velocity)}));
 assert.equal(request.events.length,expected.length);for(let i=0;i<expected.length;i++){const e=request.events[i],x=expected[i],actualFrame=e.frame??Math.round(e.time*rate);if(actualFrame!==x.frame)frameDifferences.push({case:spec.name,hrtf,event:i,expectedFrame:x.frame,actualFrame});for(const k of ['x','y','z','pitch','gain'])assert.equal(Math.fround(e[k]),Math.fround(x[k]),`${spec.name} ${i} ${k}`);}
 cases.push({name:spec.name+(hrtf?'-hrtf':'-off'),hrtf,frames:spec.frames,project:p,expected,request});
}
const casesFile=path.join(root,'cases.tsv');await writeFile(casesFile,cases.map(c=>[c.name,c.hrtf,c.frames,Math.fround(.7),c.expected.map(e=>[e.frame,e.x,e.y,e.z,e.pitch,e.gain].join(',')).join(';')].join('|')).join('\n'));
await writeFile(path.join(root,'cases.json'),JSON.stringify(cases.map(({request,...c})=>c),null,2));
async function runProcess(name,executable,args){const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const code=await new Promise((res,rej)=>{child.on('error',rej);child.on('close',res)});const r={name,pid:child.pid,executable,args,code,running:false,stdout,stderr};await writeFile(path.join(root,name+'-terminal.json'),JSON.stringify(r,null,2));assert.equal(code,0,`${name}: ${stdout}\n${stderr}`);return r;}
const compiled=await runProcess('compile','javac',['--release','8','-cp',fixture.classpath.join(path.delimiter),'-d',root,'scripts/java/GameTimelineProbe.java']);
const originalFile=path.join(root,'original.pcm'),executed=await runProcess('original',runtime.executable,[`-Dorg.lwjgl.librarypath=${fixture.nativeDir}`,'-cp',[root,...fixture.classpath].join(path.delimiter),'studio.nbsx.research.GameTimelineProbe',configFile,casesFile,originalFile]);
const original=await readFile(originalFile);assert.equal(original.toString('ascii',0,4),'NBST');assert.equal(original.readUInt32LE(4),cases.length);let offset=8;const observations=[];
for(const c of cases){const sampleRate=original.readUInt32LE(offset),frames=original.readUInt32LE(offset+4),events=original.readUInt32LE(offset+8),hrtfStatus=original.readUInt32LE(offset+12),limiter=original.readUInt32LE(offset+16);offset+=20;assert.equal(sampleRate,rate);assert.equal(frames,c.frames);assert.equal(events,c.expected.length);assert.equal(limiter,1);assert.equal(hrtfStatus,c.hrtf?1:0);
 const expected=original.subarray(offset,offset+frames*4);offset+=expected.length;const result=api.render(c.request),pcm=Buffer.from(result.wav).subarray(44);assert.equal(pcm.length,expected.length);let changed=0,maxError=0;for(let i=0;i<pcm.length;i+=2){const difference=Math.abs(pcm.readInt16LE(i)-expected.readInt16LE(i));if(difference)changed++;maxError=Math.max(maxError,difference);}
 const out=path.join(root,c.name+'.wav');await writeFile(out,result.wav);observations.push({name:c.name,events,frames,hrtf:c.hrtf,hrtfStatus,limiter,exact:expected.equals(pcm),changedSamples:changed,maxPcmError:maxError,originalPcmSha256:sha(expected),renderedPcmSha256:sha(pcm),rendered:await ref(out),backend:result.backend,onsetFrames:c.expected.map(e=>e.frame)});
}
assert.equal(offset,original.length);const sources={};for(const f of new Set(['scripts/verify-original-timeline.mjs','scripts/java/GameTimelineProbe.java',...Object.keys(bundle.metafile.inputs).filter(f=>f!=='timeline-production.ts')]))sources[f]=sha(await readFile(f));
const report={schema:1,status:observations.every(o=>o.exact)?'passed':'failed',version,scope:'Controlled loopback frame-clock component comparison: original client codec, SoundBuffer, Channel and Listener versus actual AudioEngine.nativeRequest and production native renderer. BigInt piecewise tempo integration supplies independent integer frame onsets. Synthetic timelines, not integrated-world/redstone/server/network or physical playback timing acceptance.',worldScenesAdded:0,sampleRate:rate,originalClasses,official:{client:metadata.downloads.client,mappings:metadata.downloads.client_mappings,assetIndex:metadata.assetIndex,nativeArchive},sample:{sha1:object.hash,bytes:sample.length},dependencies,java:await ref(runtime.executable),javaDecoderClass:await ref('dist-electron/java/studio/nbsx/audio/NbsxVorbisDecoder.class'),compiledProbe:await ref(path.join(root,'studio/nbsx/research/GameTimelineProbe.class')),nativeLibrary:await ref(nativeLibrary),config:await ref(configFile),input:await ref(casesFile),logicalProjects:await ref(path.join(root,'cases.json')),originalPcm:await ref(originalFile),productionBundle:await ref(bundleFile),terminals:[await ref(path.join(root,'compile-terminal.json')),await ref(path.join(root,'original-terminal.json'))],processes:{compile:{pid:compiled.pid,code:compiled.code},original:{pid:executed.pid,code:executed.code}},observations,sources};
report.frameDifferences=frameDifferences;if(frameDifferences.length)report.status='failed';
const reportFile=path.join(root,'report.json');await writeFile(reportFile,JSON.stringify(report,null,2));if(report.status==='passed'&&process.argv.includes('--write-evidence'))await writeFile('docs/evidence/java-1.20.5-original-timeline.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,version,timelines:observations.length,events:observations.reduce((n,o)=>n+o.events,0),mismatches:observations.filter(o=>!o.exact).map(({name,changedSamples,maxPcmError})=>({name,changedSamples,maxPcmError})),worldScenesAdded:0,report:reportFile}));assert.equal(report.status,'passed','Preserve exact PCM differences; do not loosen the threshold');
