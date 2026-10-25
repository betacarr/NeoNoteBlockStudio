import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {digest} from './research-utils.mjs';

const option=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined;
const childAt=process.argv.indexOf('--child');
const pairs=text=>text===null?[]:text.replace(/[{}]/g,'').trim().split(/,\s*/).filter(Boolean).flatMap(pair=>pair.split('=').map(Number));
if(childAt>=0){
 const [root,input]=process.argv.slice(childAt+1),row=JSON.parse(await readFile(input,'utf8'));
 const {render,createProject,hrtfContextForProject,outputLimiterForProject}=await import(pathToFileURL(path.join(root,'renderer.mjs')).href);
 const fixture=JSON.parse(await readFile(`.local/game-fixtures/${row.version}/fixture.json`,'utf8'));
 const project=createProject();project.audio.profileId=`java-${row.version}`;project.audio.directional=row.requestedGameOption;
 const tone=Float32Array.from({length:24000},(_,i)=>.18*Math.sin(i*Math.PI*880/48000));
 const base={nativeLibrary:path.join(fixture.nativeDir,'OpenAL.dll'),samples:[{id:'tone',channels:1,sampleRate:48000,data:[tone]}],sampleRate:48000,duration:1,directional:false,outputLimiter:outputLimiterForProject(project),events:[{time:0,instrument:'tone',pitch:1,gain:1,x:3,y:1,z:-2,maxDistance:48},{time:.25,instrument:'tone',pitch:.75,gain:.5,x:-5,y:2,z:1,maxDistance:48}]};
 const policy=hrtfContextForProject(project),game=render({...base,directional:row.requestedGameOption,hrtf:policy}),off=render(base),on=render({...base,directional:true,hrtf:'first-profile'});
 assert.equal(off.directional,false);assert.equal(on.directional,true);assert.notDeepEqual(off.wav,on.wav,'Actual PCM must distinguish independently controlled states');
 assert.equal(game.directional,row.hrtfEnabled,'Production loopback must match original Library effective state');
 const observed=game.hrtfGameDevice;assert(observed,'Missing original game-device observation');assert.equal(observed.directional,row.hrtfEnabled);assert.equal(observed.option,row.requestedGameOption);assert.equal(observed.status,row.hrtfStatus);assert.equal(observed.sampleRate,row.frequency);assert.equal(observed.name,row.actualDeviceName);assert.equal(observed.profile??null,row.selectedProfile);assert.equal(game.hrtfProfile??null,row.selectedProfile);
 assert.deepEqual(observed.contextAttributes,pairs(row.originalContextAttributes));assert.deepEqual(observed.resetAttributes??[],row.originalResetAttributes===null?[]:[...pairs(row.originalResetAttributes),0]);assert.equal(observed.resetSucceeded??null,row.originalResetResult===null?null:row.originalResetResult==='true');
 if(row.originalResetCalls||pairs(row.originalContextAttributes).includes(6550))assert.equal(observed.requestedProfile,row.profileZero);
 assert.equal(Number(game.outputLimiter),row.outputLimiter);assert.deepEqual(game.wav,row.hrtfEnabled?on.wav:off.wav,'Actual production spatial PCM must match original Library measured state');
 if(policy==='device-default')assert.deepEqual(game.hrtfDefaultDevice,observed);else assert.equal(game.hrtfDefaultDevice,undefined);
 if(row.hrtfEnabled!==row.requestedGameOption)assert(game.warnings.some(text=>/覆盖|默认/.test(text)),'Configuration override should be visible to the user');
 const pcm=result=>Buffer.from(result.wav).subarray(44),result={version:row.version,mode:row.mode,gameOption:row.requestedGameOption,originalLibraryEvidence:row.rawEvidence,originalLibraryEvidenceSha256:row.rawEvidenceSha256,backendConfiguration:row.backendConfiguration,policy,originalApplied:row.hrtfEnabled,originalStatus:row.hrtfStatus,productionGameDevice:observed,productionApplied:game.directional,loopbackStatus:game.hrtfStatus,loopbackProfile:game.hrtfProfile??null,outputLimiter:game.outputLimiter,gamePcmSha256:digest(pcm(game),'sha256'),offPcmSha256:digest(pcm(off),'sha256'),onPcmSha256:digest(pcm(on),'sha256'),exact:true,maxPcmError:0,changedSamples:0,warnings:game.warnings};
 await writeFile(input.replace(/\.input\.json$/,'.result.json'),JSON.stringify(result,null,2));
}else{
 const probes=path.resolve(option('--probes')??'docs/evidence/java-hrtf-global-overrides.json'),bytes=await readFile(probes),report=JSON.parse(bytes);
 const root=path.resolve('.local/hrtf-override-production',`run-${Date.now()}`);await mkdir(root,{recursive:true});
 await build({stdin:{contents:"export {render} from './electron/audio-worker.ts';export {createProject} from './src/core/project.ts';export {hrtfContextForProject,outputLimiterForProject} from './src/audio/context.ts';",resolveDir:process.cwd(),sourcefile:'override-comparison.ts'},outfile:path.join(root,'renderer.mjs'),bundle:true,platform:'node',format:'esm',external:['koffi']});
 const observations=[];
 for(const row of report.observations.filter(row=>row.deviceMode==='regular')){
  assert.equal(digest(await readFile(row.rawEvidence),'sha256'),row.rawEvidenceSha256);assert(row.backendConfiguration,'Original probe must retain isolated configuration hash');assert.equal(digest(await readFile(row.backendConfiguration.file),'sha256'),row.backendConfiguration.sha256);
  const native=report.evidence.find(evidence=>evidence.version===row.version),fixture=JSON.parse(await readFile(`.local/game-fixtures/${row.version}/fixture.json`,'utf8'));assert.equal(digest(await readFile(path.join(fixture.nativeDir,'OpenAL.dll')),'sha256'),native.nativeSha256);
  const filename=path.join(root,`${row.version}-${row.mode}-${row.requestedGameOption?'on':'off'}.input.json`);await writeFile(filename,JSON.stringify(row));
  const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--child',root,filename],{env:{...process.env,ALSOFT_CONF:path.resolve(row.backendConfiguration.file)},windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:1e6});await writeFile(filename.replace(/\.input\.json$/,'.log'),(child.stdout??'')+(child.stderr??''));assert.equal(child.status,0,`${row.version}/${row.mode}/${row.requestedGameOption}: ${child.stderr}`);
  const result=JSON.parse(await readFile(filename.replace(/\.input\.json$/,'.result.json'),'utf8'));observations.push(result);console.log(JSON.stringify({version:row.version,mode:row.mode,option:row.requestedGameOption,applied:result.productionApplied,originalStatus:row.hrtfStatus,loopbackStatus:result.loopbackStatus,exact:true}));
 }
 const sources={};for(const file of ['scripts/verify-hrtf-overrides.mjs','electron/audio-worker.ts','src/audio/context.ts','src/audio/engine.ts','src/core/reference.ts','src/core/transport.ts','src/core/recording.ts','src/audio/profiles.ts','src/data/audio-facts.json','src/data/early-audio-facts.json','src/data/legacy-audio-facts.json'])sources[file]=digest(await readFile(file),'sha256');
 const result={schema:1,status:'passed',originalProbeReport:probes,originalProbeReportSha256:digest(bytes,'sha256'),observations,sources,scope:'Original-Library observations independently compared to production native renderer metadata and actual spatial PCM. References explicitly control the same original loopback DLL on/off; observed original regular-device state chooses the required reference. Not new integrated-world scenes or hardware-output recordings.'};
 await writeFile(path.join(root,'report.json'),JSON.stringify(result,null,2));if(process.argv.includes('--write-evidence'))await writeFile('docs/evidence/java-hrtf-global-overrides-production.json',JSON.stringify(result,null,2));console.log(JSON.stringify({root,cases:observations.length,status:'passed'}));
}
