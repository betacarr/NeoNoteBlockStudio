import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { build } from 'esbuild';
import { digest } from './research-utils.mjs';

// A native integration check: a real OpenAL configuration disables the default
// limiter. The game's explicit request must override it, and affect dense PCM.
const childAt=process.argv.indexOf('--child');
if(childAt>=0){
  const root=process.argv[childAt+1],fixture=JSON.parse(await readFile('.local/game-fixtures/1.20.2/fixture.json','utf8'));
  const {render,outputLimiterForProject,createProject}=await import(pathToFileURL(path.join(root,'renderer.mjs')).href);
  const project=createProject();project.audio.profileId='java-1.20.2';
  const index=JSON.parse(await readFile(path.join(fixture.root,'assets/indexes',fixture.assetIndex.id+'.json'),'utf8'));
  const sound=index.objects[fixture.sounds.harp.path];
  const bytes=new Uint8Array(await readFile(path.join(fixture.root,'assets/objects',sound.hash.slice(0,2),sound.hash)));assert.equal(digest(bytes),sound.hash);
  const base={nativeLibrary:path.join(fixture.nativeDir,'OpenAL.dll'),nativeDecoder:path.join(fixture.nativeDir,'lwjgl_stb.dll'),encodedSamples:[{id:'harp',bytes}],samples:[],sampleRate:48000,duration:3,directional:false,
    events:Array.from({length:32},()=>({time:0,instrument:'harp',pitch:1,gain:1,x:0,y:0,z:-2,maxDistance:48}))};
  const defaultResult=render(base),off=render({...base,outputLimiter:false}),on=render({...base,outputLimiter:outputLimiterForProject(project)});
  assert.equal(defaultResult.outputLimiter,false,'The isolated native configuration must really disable the default');
  assert.equal(off.outputLimiter,false);assert.equal(on.outputLimiter,true,'The production version rule must override the disabled default');
  assert.deepEqual(defaultResult.wav,off.wav,'The explicit off control must reproduce the disabled default');
  const a=Buffer.from(off.wav).subarray(44),b=Buffer.from(on.wav).subarray(44);let changedSamples=0,maximumDifference=0;
  for(let at=0;at<a.length;at+=2){const error=Math.abs(a.readInt16LE(at)-b.readInt16LE(at));if(error)changedSamples++;maximumDifference=Math.max(maximumDifference,error);}
  assert(changedSamples>100,'Dense mixing must distinguish the limiter settings in actual PCM');
  await writeFile(path.join(root,'native-result.json'),JSON.stringify({status:'passed',backend:on.backend,sampleSha1:sound.hash,voices:32,defaultLimiter:defaultResult.outputLimiter,explicitOff:off.outputLimiter,gameRequestedLimiter:outputLimiterForProject(project),appliedLimiter:on.outputLimiter,changedSamples,maximumDifference,offPcmSha256:digest(a,'sha256'),onPcmSha256:digest(b,'sha256')},null,2));
}else{
  const root=path.resolve('.local/limiter-comparison',`run-${Date.now()}`);await mkdir(root,{recursive:true});
  const fixture=JSON.parse(await readFile('.local/game-fixtures/1.20.2/fixture.json','utf8')),metadata=JSON.parse(await readFile('.research/metadata/1.20.2.json','utf8'));
  assert.equal(fixture.clientSha1,metadata.downloads.client.sha1);
  const dll=await readFile(path.join(fixture.nativeDir,'OpenAL.dll')),nativeSha256=digest(dll,'sha256');let nativeArtifact;
  for(const artifact of metadata.libraries.flatMap(l=>[l.downloads?.artifact,...Object.values(l.downloads?.classifiers??{})]).filter(a=>a&&/lwjgl-openal.*natives-windows/.test(a.path))){
    const archive=await readFile(path.join(fixture.root,'libraries',artifact.path));assert.equal(digest(archive),artifact.sha1);
    if(Object.values(unzipSync(archive,{filter:e=>path.basename(e.name).toLowerCase()==='openal.dll'})).some(bytes=>digest(bytes,'sha256')===nativeSha256))nativeArtifact={path:artifact.path,sha1:artifact.sha1};
  }
  assert(nativeArtifact,'The tested native DLL must match an official original archive');
  await build({stdin:{contents:"export {render} from './electron/audio-worker.ts'; export {outputLimiterForProject} from './src/audio/context.ts'; export {createProject} from './src/core/project.ts';",resolveDir:process.cwd(),sourcefile:'limiter-check.ts'},outfile:path.join(root,'renderer.mjs'),bundle:true,platform:'node',format:'esm',external:['koffi']});
  const config=path.join(root,'alsoftrc');await writeFile(config,'[general]\noutput-limiter = false\n');
  const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--child',root],{env:{...process.env,ALSOFT_CONF:config},windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:1000000});
  assert.equal(child.status,0,child.stderr||child.stdout);
  const report={schema:1,version:'1.20.2',clientSha1:fixture.clientSha1,nativeArtifact,nativeSha256,...JSON.parse(await readFile(path.join(root,'native-result.json'),'utf8')),
    scope:'Actual original OpenAL Soft in a fresh process with an isolated config disabling its default limiter; explicit game profile request overrides it. This component check does not add integrated-world coverage.',sources:{}};
  for(const file of ['scripts/verify-output-limiter.mjs','electron/audio-worker.ts','src/audio/context.ts','src/audio/engine.ts', 'src/core/reference.ts', 'src/core/transport.ts', 'src/core/recording.ts','src/data/audio-facts.json'])report.sources[file]=digest(await readFile(file),'sha256');
  await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
  if(process.argv.includes('--write-evidence'))await writeFile('docs/evidence/output-limiter.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,sources:undefined,report:path.join(root,'report.json')}));
}
