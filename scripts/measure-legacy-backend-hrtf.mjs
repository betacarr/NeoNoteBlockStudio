import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {unzipSync} from 'fflate';
import {digest} from './research-utils.mjs';

// This measures the production renderer against each official fixture DLL.
// It never invokes Minecraft or rewrites/intercepts an original game context.
const versions=['1.8.9','1.9'];
const childAt=process.argv.indexOf('--child');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const resultMetadata=result=>Object.fromEntries(Object.entries(result).filter(([key])=>key!=='wav'));
const windowsLibrary=library=>{let allowed=!library.rules;for(const rule of library.rules??[])if(!rule.os||rule.os.name==='windows')allowed=rule.action==='allow';return allowed;};

if(childAt>=0){
 const [root,input]=process.argv.slice(childAt+1),request=await json(input),fixture=await json(`.local/game-fixtures/${request.version}/fixture.json`);
 const nativeLibrary=path.join(fixture.nativeDir,'OpenAL64.dll');
 const trace=stage=>writeFile(path.join(root,`${request.version}-${request.phase}.stages.log`),`${new Date().toISOString()} ${stage}\n`,{flag:'a'});
  const {render,createProject,hrtfContextForProject,outputLimiterForProject,gameHrtfControl}=await import(pathToFileURL(path.join(root,'renderer.mjs')).href);
  const project=createProject();project.audio.profileId=`java-${request.version}`;project.audio.mode='vanilla';project.audio.directional=false;
  const policy=hrtfContextForProject(project);assert.equal(policy,'device-default');assert.equal(gameHrtfControl(project.audio.profileId),false);
  const base={nativeLibrary,sampleRate:48000,duration:.2,samples:[],events:[],directional:request.phase==='controlled-on',outputLimiter:outputLimiterForProject(project),hrtf:request.phase==='production-default'?policy:'first-profile'};
  // No source is created or played, including on a regular default device.
  let observation;
  try{await trace('before-production-render');const result=render(base);await trace('after-production-render');const wave=Buffer.from(result.wav),pcm=wave.subarray(44);assert(pcm.length>0);assert(pcm.every(byte=>byte===0),'Source-free loopback must remain silent');const output=path.join(root,`${request.version}-${request.phase}.wav`);await writeFile(output,wave);observation={version:request.version,phase:request.phase,status:'rendered',productionPolicy:policy,gameHrtfControl:false,request:base,result:resultMetadata(result),pcm:{path:output,wavSha256:digest(wave,'sha256'),pcmSha256:digest(pcm,'sha256'),bytes:pcm.length,allZero:true},sourcesPlayed:0};}
  catch(error){observation={version:request.version,phase:request.phase,status:'rejected',productionPolicy:policy,gameHrtfControl:false,request:base,error:{name:error.name,message:error.message,stack:error.stack},sourcesPlayed:0};}
  await writeFile(request.output,JSON.stringify(observation,null,2)+'\n');
}else{
 const root=path.resolve('.local/legacy-backend-hrtf',`run-${Date.now()}`);await mkdir(root,{recursive:true});
 const bundle=path.join(root,'renderer.mjs');
 await build({stdin:{contents:"export {render} from './electron/audio-worker.ts';export {createProject} from './src/core/project.ts';export {hrtfContextForProject,outputLimiterForProject} from './src/audio/context.ts';export {gameHrtfControl} from './src/audio/profiles.ts';",resolveDir:process.cwd(),sourcefile:'legacy-backend-hrtf.ts'},outfile:bundle,bundle:true,platform:'node',format:'esm',external:['koffi']});
 const files=['scripts/measure-legacy-backend-hrtf.mjs','electron/audio-worker.ts','electron/vorbis.ts','electron/java-decoder.ts','electron/java/NbsxVorbisDecoder.java','src/audio/context.ts','src/audio/engine.ts','src/audio/legacy.ts','src/audio/delivery.ts','src/audio/parameters.ts','src/audio/volume.ts','src/audio/profiles.ts','src/core/project.ts','src/core/time.ts','src/data/audio-facts.json','src/data/early-audio-facts.json','src/data/legacy-audio-facts.json','src/data/world-audio-facts.json'];
 const sources=Object.fromEntries(await Promise.all(files.map(async file=>[file,digest(await readFile(file),'sha256')])));
 const report={schema:1,status:'running',startedAt:new Date().toISOString(),root,rendererBundle:{path:bundle,sha256:digest(await readFile(bundle),'sha256')},sources,versions:[],processes:[],newWorldScenes:0,originalGameContextsInvoked:0,regularDeviceSourcesPlayed:0,limitations:['Production backend component capability only; not an original Library/JNI context-equivalence or game-world measurement.','Each version and phase executes in a separate process. No ability is inherited from equal DLL bytes.','Source-free 48kHz stereo loopback only; no note samples, decoder waveform, source capacity or spatial PCM acceptance.','Backend configuration is isolated to child processes; user profiles and configuration files are unchanged.']};
 const save=()=>writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n');await save();console.log(JSON.stringify({root,status:report.status}));
 try{for(const version of versions){
  const fixtureFile=`.local/game-fixtures/${version}/fixture.json`,fixture=await json(fixtureFile),metadata=await json(`.research/metadata/${version}.json`),clientFile=path.join(fixture.root,'versions',version,`${version}.jar`),client=await readFile(clientFile);
  assert.equal(fixture.version,version);assert.equal(fixture.clientSha1,metadata.downloads.client.sha1);assert.equal(digest(client),metadata.downloads.client.sha1);
  const nativeLibrary=path.join(fixture.nativeDir,'OpenAL64.dll'),nativeBytes=await readFile(nativeLibrary),nativeSha256=digest(nativeBytes,'sha256'),nativeArchives=[];
  for(const library of metadata.libraries.filter(windowsLibrary)){
   const artifact=library.downloads?.artifact;if(artifact){const actual=await readFile(path.join(fixture.root,'libraries',artifact.path));assert.equal(digest(actual),artifact.sha1,artifact.path);}
   for(const artifact of Object.values(library.downloads?.classifiers??{}).filter(a=>a.path.startsWith('org/lwjgl/lwjgl/lwjgl-platform/')&&a.path.includes('natives-windows'))){const archiveFile=path.join(fixture.root,'libraries',artifact.path),bytes=await readFile(archiveFile);assert.equal(digest(bytes),artifact.sha1);for(const[name,entry]of Object.entries(unzipSync(bytes,{filter:e=>path.basename(e.name).toLowerCase()==='openal64.dll'})))if(digest(entry,'sha256')===nativeSha256)nativeArchives.push({library:library.name,artifact,archiveFile,entry:name,sha256:digest(bytes,'sha256')});}
  }
  assert.equal(nativeArchives.length,1,'Each original DLL must independently match one official Windows archive');
  const row={version,clientSha1:digest(client),clientFile,fixture:{path:fixtureFile,sha256:digest(await readFile(fixtureFile),'sha256')},native:{path:nativeLibrary,sha256:nativeSha256,officialArchive:nativeArchives[0]},observations:[]};report.versions.push(row);
  const config=path.join(root,`${version}-alsoft.ini`);await writeFile(config,'[general]\nfrequency = 48000\nhrtf = auto\nstereo-mode = speakers\n');row.backendConfiguration={path:config,content:await readFile(config,'utf8'),sha256:digest(await readFile(config),'sha256')};
  for(const phase of ['production-default','controlled-off','controlled-on']){
   const input=path.join(root,`${version}-${phase}.input.json`),output=path.join(root,`${version}-${phase}.result.json`),logfile=path.join(root,`${version}-${phase}.log`);await writeFile(input,JSON.stringify({version,phase,output}));
   const args=[fileURLToPath(import.meta.url),'--child',root,input],env={...process.env,ALSOFT_CONF:config};
   const child=spawn(process.execPath,args,{windowsHide:true,env,stdio:['ignore','pipe','pipe']}),processRow={version,phase,pid:child.pid,args,logfile,status:'running',startedAt:new Date().toISOString()};report.processes.push(processRow);await save();
   let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});const terminal=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(exit,signal)=>resolve({exit,signal}));});await writeFile(logfile,stdout+stderr);Object.assign(processRow,terminal,{status:terminal.exit===0?'complete':'failed',finishedAt:new Date().toISOString(),logSha256:digest(Buffer.from(stdout+stderr),'sha256')});await save();assert.equal(terminal.exit,0,`${version}/${phase} child failed; see ${logfile}`);
   const observation=await json(output);row.observations.push({path:output,sha256:digest(await readFile(output),'sha256'),...observation});await save();console.log(JSON.stringify({version,phase,terminalExit:terminal.exit,status:observation.status,backend:observation.result?.backend,extensionHrtf:observation.observation?.hrtf,directional:observation.result?.directional,error:observation.error?.message}));
  }
  const normal=row.observations.find(o=>o.phase==='production-default'),off=row.observations.find(o=>o.phase==='controlled-off'),on=row.observations.find(o=>o.phase==='controlled-on');
  assert.equal(normal.status,'rendered');assert.equal(off.status,'rendered');assert.equal(off.result.directional,false);
  if(on.status==='rejected'){assert.equal(on.error.message,'所选版本的音频库不支持 HRTF，请关闭方向音频后重试。');assert.equal(normal.result.directional,false);assert.equal(normal.result.hrtfGameDevice,undefined);assert.equal(normal.result.hrtfDefaultDevice,undefined);assert.equal(normal.result.hrtfStatus,undefined);row.backendHrtfSupported=false;}
  else{assert.equal(on.status,'rendered');assert.equal(on.result.directional,true);assert(on.result.hrtfProfile);row.backendHrtfSupported=true;}
  row.proposedDesktopExpected={cases:0,maxVoices:0,gameHrtfControl:false,backendHrtfSupported:row.backendHrtfSupported,defaultHrtf:'device-default'};await save();
 }
 for(const[file,hash]of Object.entries(sources))assert.equal(digest(await readFile(file),'sha256'),hash,`Source changed during measurement: ${file}`);
 report.status='passed';report.completedAt=new Date().toISOString();await save();console.log(JSON.stringify({status:report.status,report:path.join(root,'report.json'),versions:report.versions.map(r=>({version:r.version,backendHrtfSupported:r.backendHrtfSupported,proposedDesktopExpected:r.proposedDesktopExpected})),newWorldScenes:0}));
 }catch(error){report.status='failed';report.error=error.stack??String(error);report.completedAt=new Date().toISOString();await save();throw error;}
}
