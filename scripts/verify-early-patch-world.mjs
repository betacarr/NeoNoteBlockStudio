import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';

const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const version = '1.14.3';

const root = path.resolve('.local/early-patch-world-comparison', version);
const selected = option('--capture');
if (selected && !/^[\w.-]+$/.test(selected)) throw new Error('Invalid capture name');
const run = JSON.parse(await readFile(selected ? path.join(root, selected, 'provenance.json') : path.join(root, 'latest.json'), 'utf8'));
if (!path.resolve(run.output).startsWith(root + path.sep)) throw new Error('Capture directory escaped research root');
if (run.agentSourceSha256) {
  const sourceFile=run.agentSourceFile??'EarlyPatchWorldCaptureAgent.java',agentFile=run.agentFile??'early-patch-world-agent.jar';
  assert.equal(path.basename(sourceFile),sourceFile);assert.equal(path.basename(agentFile),agentFile);
  assert.equal(digest(await readFile(path.join(run.output, sourceFile)), 'sha256'), run.agentSourceSha256);
  assert.equal(digest(await readFile(path.join(run.output, agentFile)), 'sha256'), run.agentSha256);
}
await readFile(path.join(run.output, 'complete.txt'));
assert.equal(digest(await readFile(path.join(run.output,run.captureScriptFile)),'sha256'),run.captureScriptSha256);assert.equal(digest(await readFile(path.join(run.output,'audit-early-patch-world.mjs')),'sha256'),run.auditScriptSha256);
const fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`, 'utf8'));
const metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`,'utf8'));
assert.equal(run.version,version); assert.equal(run.clientSha1,metadata.downloads.client.sha1); assert.equal(fixture.clientSha1,run.clientSha1);
assert.equal(run.schema,3);assert.equal(run.officialMetadata.sha1,'e21618620e02be5a14543d1d17ffdba941d09aa8');
const archivedMetadata=await readFile(path.join(run.output,'official-metadata.json'));assert.equal(digest(archivedMetadata),run.officialMetadata.sha1);assert.deepEqual(JSON.parse(archivedMetadata),metadata);
assert.equal(digest(await readFile(path.join(run.output,'official-version-manifest.json')),'sha256'),run.manifest.sha256);
const clientBytes=await readFile(path.join(fixture.root,'versions',version,`${version}.jar`));assert.equal(digest(clientBytes),run.clientSha1);assert.equal(clientBytes.length,metadata.downloads.client.size);
const originalArchive=unzipSync(clientBytes,{filter:entry=>entry.name.endsWith('.class')}),archivedAudit=JSON.parse(await readFile(path.join(run.output,'adapter-evidence.json'),'utf8'));assert.deepEqual(archivedAudit,run.mappingEvidence);
for(const source of archivedAudit.sourceReports){const bytes=await readFile(path.join(run.output,path.basename(source.path)));assert.equal(digest(bytes,'sha256'),source.sha256);const report=JSON.parse(bytes);assert.equal(report.version,version);assert.equal(report.clientSha1,run.clientSha1);for(const entry of report.classes){const name=entry.originalName??entry.name,bytes=originalArchive[name+'.class'];assert(bytes,`Original class ${name} is missing`);if(entry.bytecodeSha1)assert.equal(digest(bytes),entry.bytecodeSha1);if(entry.bytecodeSha256)assert.equal(digest(bytes,'sha256'),entry.bytecodeSha256);const methods=methodCodeHashes(bytes);for(const [signature,hash]of Object.entries(entry.methods??{}))assert.equal(methods[signature],hash,`${name}.${signature}`);}for(const binding of report.bindings??[])assert.equal(methodCodeHashes(originalArchive[binding.owner+'.class'])[(binding.member??binding.method)+binding.descriptor],binding.codeSha256);}
const modern = false;
const java = modern ? JSON.parse(await readFile(`.local/runtimes/temurin-${metadata.javaVersion.majorVersion}/runtime.json`,'utf8')).executable : undefined;
const javaDecoder = modern ? { executable: java, classpath: [path.resolve('dist-electron/java'),...fixture.classpath.filter(filename=>/jorbis-[^/\\]+\.jar$/.test(filename))], kind: 'jorbis' } : undefined;
const artifacts=metadata.libraries.flatMap(library=>[library.downloads?.artifact,...Object.values(library.downloads?.classifiers??{})]).filter(Boolean);
async function nativeProvenance(name){
  const bytes=await readFile(path.join(fixture.nativeDir,name)),sha256=digest(bytes,'sha256');
  for(const artifact of artifacts.filter(item=>/natives-windows/.test(item.path)&&/lwjgl-(openal|stb)/.test(item.path))){
    let jar;try{jar=await readFile(path.join(fixture.root,'libraries',artifact.path));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    assert.equal(digest(jar),artifact.sha1,'Native archive no longer matches official metadata');
    const entries=unzipSync(jar,{filter:entry=>path.basename(entry.name).toLowerCase()===name.toLowerCase()});
    if(Object.values(entries).some(entry=>digest(entry,'sha256')===sha256))return{sha256,artifact:artifact.path,artifactSha1:artifact.sha1};
  }throw new Error(`Native ${name} differs from original official archives`);
}
const nativeLibraries={openal:await nativeProvenance('OpenAL.dll'),...(modern?{}:{stb:await nativeProvenance('lwjgl_stb.dll')})};
const decoder={kind:modern?'jorbis':'stb'};
if(modern){
  const filename=javaDecoder.classpath.find(file=>/jorbis-[^/\\]+\.jar$/.test(file)),artifact=artifacts.find(item=>filename.endsWith(item.path.replaceAll('/',path.sep)));
  assert(artifact,'No original JOrbis archive metadata');assert.equal(digest(await readFile(filename)),artifact.sha1);
  Object.assign(decoder,{artifact:artifact.path,artifactSha1:artifact.sha1,javaExecutableSha256:digest(await readFile(java),'sha256'),adapterClassSha256:digest(await readFile('dist-electron/java/studio/nbsx/audio/NbsxVorbisDecoder.class'),'sha256')});
}
const indexBytes=await readFile(path.join(fixture.root,'assets/indexes',fixture.assetIndex.id+'.json'));assert.equal(digest(indexBytes),metadata.assetIndex.sha1,'Asset index differs from official metadata');
const index = JSON.parse(indexBytes);
const instruments = run.instruments??['harp', 'bass', 'basedrum', 'snare', 'hat', 'guitar', 'flute', 'bell', 'chime', 'xylophone', 'iron_xylophone', 'cow_bell', 'didgeridoo', 'bit', 'banjo', 'pling'];
const rendererFile=path.join(run.output,'editor-renderer.mjs');
await build({ stdin: { contents: "export {render} from './electron/audio-worker.ts'; export {gameVolumeParameters} from './src/audio/volume.ts'; export {broadcastForProject} from './src/audio/delivery.ts'; export {outputLimiterForProject} from './src/audio/context.ts'; export {createProject} from './src/core/project.ts';", resolveDir: process.cwd(), sourcefile: 'world-compare.ts' }, outfile: rendererFile, platform: 'node', format: 'esm', bundle: true, external: ['koffi'] });
const { render,gameVolumeParameters,broadcastForProject,outputLimiterForProject,createProject } = await import(pathToFileURL(rendererFile).href);
const project=createProject();project.audio.profileId=`java-${version}`;const outputLimiter=outputLimiterForProject(project);
if(process.argv.includes('--broadcast')){
 const project=createProject();project.audio.profileId=`java-${version}`;const broadcast=broadcastForProject(project);
 assert(broadcast,'The actual project profile must apply the independently reviewed delivery rule');
 assert.equal(broadcast.range,48);assert.deepEqual(broadcast.listenerPosition,[0,-1.62,0]);
}
function properties(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).replace(/\\([:=\\])/g,'$1')]; }));
}
const storedCases = JSON.parse(await readFile(path.join(run.output, 'cases.json'), 'utf8'));
const scenes = storedCases.map((scene, i) => Array.isArray(scene) ? { name: `single-${i}`, notes: [scene] } : scene);
const records = await Promise.all(scenes.map((_, i) => readFile(path.join(run.output, `case-${i}.properties`), 'utf8').then(properties)));
const first = records.find(record => record.delivery === 'played');
assert(first, 'No original game sound was captured');
const master=run.masterGain??run.master??Number(first.listenerGain??1),category=run.recordCategoryVolume??run.records??1;
const volume=gameVolumeParameters(`java-${version}`,3,master,category);
const vector = (record, prefix, count) => Array.from({ length: count }, (_, i) => Math.fround(Number(record[`${prefix}.${i}`])));
const hrtf = !!run.hrtf, observations = [], prepared=[];
for (let n = 0; n < scenes.length; n++) {
  const scene = scenes[n], record = records[n], state = record;
  let listener = vector(state, 'listener', 3), orientation = vector(state, 'orientation', 6);
  const captured = record.voiceCount === undefined ? record.delivery === 'played' ? [record] : [] : Array.from({ length: Number(record.voiceCount) }, (_, i) => Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith(`voice.${i}.`)).map(([key, value]) => [key.slice(`voice.${i}.`.length), value])));
  assert.equal(record.originalGameHrtfControl,'false');assert.equal(record.originalLimiterRequest,'device-default');assert.equal(record.researchHrtfRequest,String(hrtf));assert.equal(record.listenerObservation,'capture-start-al-observation');assert.equal(record.listenerStableAcrossBlocks,'true');assert.equal(Number(record.listenerStabilityChecks),142);assert.equal(record.originalContextAttributes,'{}');assert.equal(Number(record.actualSampleRate),48000);assert.equal(Number(record.hrtfEnabled),hrtf?1:0);
  assert(Number(record.actualMonoSources)>0,'Original context did not report its actual mono-source capacity');
  const poolCounts=/^Sounds: (\d+)\/(\d+) \+ (\d+)\/(\d+)$/.exec(record.originalSourcePools??'');assert(poolCounts,'Original Library pool state was not observed');assert(Number(poolCounts[2])>=captured.length,'Captured voices exceed the original static-source pool capacity');
  const explicitCapturePose=record.listenerObservation==='capture-start-al-observation';
  const firstPoseDiagnostic=process.argv.includes('--first-observed-listener');
  const listenerObservation={kind:firstPoseDiagnostic?'archived-first-voice-diagnostic':explicitCapturePose?'capture-start-al-observation':captured.length?'archived-last-voice-observation':'archived-no-source-reference',poseRecordedPerBlock:explicitCapturePose&&record.listenerStableAcrossBlocks==='true',timing:firstPoseDiagnostic?'Historical first voice snapshot; intentionally retains the old observation point for failure diagnosis.':explicitCapturePose?'AL listener read at saveCapture entry before rendering.':'Archived final voice snapshot immediately before saveCapture rendered; this archive has no per-block listener observations.'};
  if(!process.argv.includes('--first-observed-listener')&&!explicitCapturePose&&captured.length){listener=vector(captured.at(-1),'listener',3);orientation=vector(captured.at(-1),'orientation',6);}
  const expected = scene.notes.filter(([x, y]) => x * x + (y + 1.5) ** 2 + 4 < 48 ** 2).length;
  assert.equal(captured.length, expected, `Scene ${n} lost an original game voice`);
  assert(Number(record.noteEvents) >= scene.notes.length, `Scene ${n} lacks original note-block events`);
  if (record.hrtfStatus !== undefined) assert.equal(Number(record.hrtfStatus), hrtf ? 1 : 0, 'Actual HRTF status differs from the request');
  if (record.outputLimiter !== undefined && outputLimiter !== undefined) assert.equal(Number(record.outputLimiter),outputLimiter?1:0,'Original game did not apply its output limiter request');
  if(version==='1.20.2'){
    assert.equal(record.outputLimiterAvailable,'true');assert.equal(record.outputLimiter,'1');
    assert(record.originalContextAttributes.includes('6554=1'),'Original game must explicitly request its limiter before loopback overrides');
    assert(record.captureContextAttributes.includes('6554=1'),'Capture must retain the original limiter request');
  }
  const voices = captured.map(voice => ({ instrument: voice.instrument ?? 'harp', note: Number(voice.note), sourcePosition: vector(voice, 'source', 3), pitch: Math.fround(Number(voice.pitch)), gain: Math.fround(Number(voice.gain)), maxDistance: Math.fround(Number(voice.range)), originalSourceId: voice.sourceId === undefined ? undefined : Number(voice.sourceId) }));
  // Retain undelivered notes so the editor must apply the broadcast rule.
  // Delivered notes follow their actual original play order.
  for (const [x, y, note, instrument = 0] of (process.argv.includes('--preflight')?[]:scene.notes)) {
    const position = [x + .5, y + 81.5, .5];
    if (!voices.some(voice => voice.sourcePosition.every((v, i) => v === position[i]))) voices.push({ instrument: instruments[instrument], note, sourcePosition: position, pitch: Math.fround(2 ** ((note - 12) / 12)), gain: volume.gain, maxDistance: 48 });
  }
  for (const voice of voices) {
    assert.equal(voice.pitch, Math.fround(2 ** ((voice.note - 12) / 12)), 'Original note pitch differs from the checked formula');
    assert.equal(voice.gain, volume.gain, 'Original source gain differs from the independently calculated editor volume model');
    assert.equal(voice.maxDistance,48,'Unexpected original note-block attenuation range');
  }
  assert.equal(Math.fround(Number(state.listenerGain??1)),volume.listenerGain,'Original listener master gain differs from the editor volume model');
  const encodedSamples = [];
  for (const instrument of new Set(voices.map(voice => voice.instrument))) {
    const sample = index.objects[fixture.sounds[instrument].path];
    const bytes = new Uint8Array(await readFile(path.join(fixture.root, 'assets/objects', sample.hash.slice(0, 2), sample.hash)));
    assert.equal(digest(bytes), sample.hash, 'Original sample checksum changed');
    encodedSamples.push({ id: instrument, bytes });
    for (const voice of voices.filter(voice => voice.instrument === instrument)) voice.sampleSha1 = sample.hash;
  }
  const original = await readFile(path.join(run.output, `case-${n}.pcm`));
  const request = { nativeLibrary: path.join(fixture.nativeDir, 'OpenAL.dll'), nativeDecoder: modern ? undefined : path.join(fixture.nativeDir, 'lwjgl_stb.dll'), javaDecoder, encodedSamples, samples: [], sampleRate: 48000, duration: original.length / (48000 * 4), directional: hrtf,
    listener: { position: listener, orientation, gain: volume.listenerGain }, outputLimiter,
    events: voices.map(voice => ({ time: 0, instrument: voice.instrument, pitch: Math.fround(2 ** ((voice.note - 12) / 12)), gain: volume.gain, x: voice.sourcePosition[0], y: voice.sourcePosition[1], z: voice.sourcePosition[2], maxDistance: 48 })) };
  if (process.argv.includes('--broadcast')) request.broadcast = { listenerPosition: [.5, 80, 2.5], range: 48 };
  prepared.push({n,scene,record,listener,orientation,listenerObservation,captured,voices,expected,original,request});
}
let sequenceResult,sequencePcm,sequenceCursor=0;
if(process.argv.includes('--continuous')){
  const first=prepared[0].request,samples=new Map(),events=[];let frames=0;
  for(const item of prepared){
    assert.deepEqual(item.request.listener,first.listener,'Continuous context requires the original fixed listener pose');
    for(const sample of item.request.encodedSamples){if(samples.has(sample.id))assert.equal(digest(samples.get(sample.id).bytes),digest(sample.bytes));else samples.set(sample.id,sample);}
    events.push(...item.request.events.map(event=>({...event,time:frames/48000+event.time})));frames+=item.original.length/4;
  }
  sequenceResult=render({...first,encodedSamples:[...samples.values()],events,duration:frames/48000});
  sequencePcm=Buffer.from(sequenceResult.wav).subarray(44);assert.equal(sequencePcm.length,frames*4);
}
for(const item of prepared){
  const {n,scene,record,listener,orientation,listenerObservation,captured,voices,expected,original,request}=item;
  const nativeResult = sequenceResult??render(request);
  assert.equal(nativeResult.directional, hrtf, 'Editor did not apply the captured HRTF state');
  if(hrtf)assert.equal(nativeResult.hrtfProfile,record.selectedHrtfProfile,'Original and renderer selected HRTF profiles differ');
  if(record.outputLimiter!==undefined)assert.equal(nativeResult.outputLimiter,record.outputLimiter==='1','Original and editor actual output limiter states differ');
  if(outputLimiter!==undefined)assert.equal(nativeResult.outputLimiter,outputLimiter,'Editor did not apply the version-specific output limiter');
  const rendered = sequencePcm?sequencePcm.subarray(sequenceCursor,sequenceCursor+original.length):Buffer.from(nativeResult.wav).subarray(44);sequenceCursor+=original.length;
  assert.equal(rendered.length, original.length, 'Capture and editor durations differ');
  if (n === 0) {
    const wav = pcm => { const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(48000, 24); header.writeUInt32LE(192000, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40); return Buffer.concat([header, pcm]); };
    await writeFile(path.join(run.output, 'reference-center.wav'), wav(original));
    await writeFile(path.join(run.output, 'editor-center.wav'), wav(rendered));
  }
  let changed = 0, maxError = 0, errorEnergy = 0, originalEnergy = 0, renderedEnergy = 0;
  for (let at = 0; at + 1 < original.length; at += 2) {
    const a = original.readInt16LE(at), b = rendered.readInt16LE(at), error = Math.abs(a - b);
    if (error) changed++;
    maxError = Math.max(maxError, error); errorEnergy += error * error; originalEnergy += a * a; renderedEnergy += b * b;
  }
  if (expected) assert(originalEnergy > 0, 'Original game voices produced silence');
  observations.push({ case: n, scene: scene.name, voices, deliveredSources: captured.length, originalSourcePools:record.originalSourcePools,actualMonoSources:Number(record.actualMonoSources),listenerPosition: listener, listenerOrientation: orientation, listenerObservation, listenerStableAcrossBlocks:true,listenerStabilityChecks:Number(record.listenerStabilityChecks),actualContextAttributes:record.actualContextAttributes,actualBackend:record.backend,actualSampleRate:Number(record.actualSampleRate),originalGameHrtfControl:false,researchHrtfRequest:record.researchHrtfRequest,selectedHrtfProfile:record.selectedHrtfProfile??null,hrtfProfileCount:Number(record.hrtfProfileCount),hrtfProfileZero:record['hrtfProfile.0']??null,editorHrtfProfile:nativeResult.hrtfProfile??null,editorHrtfPolicy:'controlled-loopback-backend',originalMaterialSelection:Object.fromEntries(Object.entries(record).filter(([key])=>key.startsWith("material."))),listenerGain: request.listener.gain, hrtfStatus: record.hrtfStatus === undefined ? undefined : Number(record.hrtfStatus), editorHrtfApplied: nativeResult.directional, originalOptions:{master:Number(record['options.master']),records:Number(record['options.records']),blocks:Number(record['options.blocks'])},originalContextAttributes:record.originalContextAttributes,captureContextAttributes:record.captureContextAttributes,outputLimiter:record.outputLimiter===undefined?undefined:Number(record.outputLimiter),editorOutputLimiter:nativeResult.outputLimiter,delivery: record.delivery, noteEvents: Number(record.noteEvents), recordingSha256: digest(original, 'sha256'), renderedSha256: digest(rendered, 'sha256'), exact: original.equals(rendered), changedSamples: changed, maxPcmError: maxError, normalizedRmsError: originalEnergy ? Math.sqrt(errorEnergy / originalEnergy) : errorEnergy ? null : 0, originalEnergy, renderedEnergy });
}
const mappingEvidence = JSON.parse(await readFile(path.join(run.output,'adapter-evidence.json'),'utf8'));assert.equal(mappingEvidence.clientSha1,run.clientSha1);
const captureArchive={directory:path.relative(process.cwd(),run.output).replaceAll('\\','/'),provenanceSha256:digest(await readFile(path.join(run.output,'provenance.json')),'sha256'),casesSha256:digest(await readFile(path.join(run.output,'cases.json')),'sha256'),agentConfigSha256:digest(await readFile(path.join(run.output,'agent.properties')),'sha256'),artifacts:await Promise.all(scenes.map(async(_,n)=>({case:n,pcmSha256:digest(await readFile(path.join(run.output,`case-${n}.pcm`)),'sha256'),propertiesSha256:digest(await readFile(path.join(run.output,`case-${n}.properties`)),'sha256')})))};
const report = { schema: 3, captureArchive, contextComparison:sequenceResult?'One continuous production-renderer context in original scene/play order; exact PCM requirement unchanged.':'Independent renderer context per scene.', mappingEvidence, researchConditions: { hrtf:'controlled original backend; original 1.14.3 game has no HRTF toggle', originalContext:'null attributes in original bytecode; capture records merged attributes and actual limiter state', processors:run.processors, java:run.java }, version, clientSha1: run.clientSha1, agentSha256: run.agentSha256, agentSourceSha256: run.agentSourceSha256, recordingMethod: run.recordingMethod, context: 'actual integrated world and original note-block events', nativeLibraries, decoder, broadcast: process.argv.includes('--broadcast'), rendererSha256: digest(await readFile('electron/audio-worker.ts'), 'sha256'), observations, exact: observations.every(o => o.exact),
  settings: { sampleRate: 48000, channels: 2, hrtf,hrtfComparison:'controlled-loopback-backend',gameHrtfControl:false,preflight:process.argv.includes('--preflight'), masterGain: master, recordCategoryVolume: category, listenerPose: 'standing', standingEyeHeight: 1.62, sourceVolume: 3, captureBlockFrames: 1024 },
  parameterEvidence:'Source/listener gain and source pitch/range independently derived by editor code then asserted against the original client; original play order and camera pose retained for deterministic spatial comparison.',
  scopeLimitations: [`Windows x64 / Java ${version}`, run.polyphony ? 'simultaneous batches, up to 64 note blocks; excludes musical onset scheduling' : 'single note at a time', 'loopback capture from the actual game mixer, not hardware-output recording', 'aligned after original Channel.play calls; excludes server/network scheduling latency'], rendererSources: {} };
for (const file of ['electron/audio-worker.ts', 'electron/vorbis.ts', 'electron/java-decoder.ts', 'electron/java/NbsxVorbisDecoder.java', 'src/core/project.ts', 'src/core/time.ts', 'src/audio/legacy.ts', 'src/audio/delivery.ts', 'src/audio/parameters.ts', 'src/audio/volume.ts', 'src/audio/context.ts', 'src/audio/profiles.ts', 'src/audio/engine.ts', 'src/core/reference.ts', 'src/core/transport.ts', 'src/core/recording.ts', 'src/data/audio-facts.json', 'src/data/early-audio-facts.json', 'src/data/legacy-audio-facts.json', 'src/data/world-audio-facts.json','scripts/verify-early-patch-world.mjs']) report.rendererSources[file] = digest(await readFile(file), 'sha256');
const name = process.argv.includes('--first-observed-listener') ? 'comparison-first-observed-listener.json' : process.argv.includes('--continuous') ? 'comparison-continuous.json' : process.argv.includes('--broadcast') ? 'comparison-with-broadcast.json' : 'comparison-baseline.json';
await writeFile(path.join(run.output, name), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cases: observations.length, hrtf, maxVoices: Math.max(...observations.map(o => o.deliveredSources)), exact: report.exact, mismatches: observations.filter(o => !o.exact).map(o => ({ scene: o.scene, changedSamples: o.changedSamples, maxPcmError: o.maxPcmError, normalizedRmsError: o.normalizedRmsError })), report: path.join(run.output, name) }));
assert(report.exact, 'Actual in-game note-block recording differs from editor rendering');
if (process.argv.includes('--write-evidence')) {
  assert(!process.argv.includes('--preflight'),'Preflight cannot write accepted public world evidence');assert(process.argv.includes('--broadcast'),'Final public evidence must use actual product broadcast policy');
  const custom = option('--evidence-name') ?? `java-${version}-single-note-world`;
  if (!/^[\w.-]+$/.test(custom)) throw new Error('Invalid evidence name');
  await mkdir('docs/evidence', { recursive: true });
  await writeFile(`docs/evidence/${custom}.json`, JSON.stringify(report, null, 2));
}
