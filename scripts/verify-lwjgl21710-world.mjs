import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { digest } from './research-utils.mjs';
import { reviewLwjgl21710Source } from './review-lwjgl21710-source.mjs';

const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
// Deliberately excluded from the production world registry. Original pointer semantics
// remain unresolved across allocations; a draft comparison must never publish evidence.
assert(process.argv.includes('--candidate-only'), 'Draft1.7.10 verifier is blocked for acceptance: original native-context pointer equivalence is unresolved. Only explicit candidate inspection is permitted.');
assert(!option('--evidence-name'), 'Unvalidated1.7.10 context normalization cannot publish a world evidence report');
const root = path.resolve('.local/lwjgl21710-world-comparison/1.7.10');
const run = JSON.parse(await readFile(option('--capture') ? path.join(path.resolve(option('--capture')), 'provenance.json') : path.join(root, 'latest.json'), 'utf8'));
assert(path.resolve(run.output).startsWith(root + path.sep)); assert.equal(run.version, '1.7.10'); assert.equal(run.hrtf, false);
await readFile(path.join(run.output, 'complete.txt'));
assert.equal(digest(await readFile(path.join(run.output, 'Lwjgl21710WorldCaptureAgent.java')), 'sha256'), run.agentSourceSha256);
assert.equal(digest(await readFile(path.join(run.output, 'lwjgl21710-world-agent.jar')), 'sha256'), run.agentSha256);
const sourceEvidenceFile = 'docs/evidence/java-1.7.10-audio-world-source.json';
await reviewLwjgl21710Source();
const sourceEvidenceBytes = await readFile(sourceEvidenceFile), sourceFacts = JSON.parse(sourceEvidenceBytes);
assert.equal(digest(sourceEvidenceBytes, 'sha256'), run.sourceEvidenceSha256);
assert.equal(digest(await readFile(path.join(run.output, 'source-evidence.json')), 'sha256'), run.sourceEvidenceSha256);
const fixture = JSON.parse(await readFile('.local/game-fixtures/1.7.10/fixture.json', 'utf8'));
const metadataBytes = await readFile('.research/metadata/1.7.10.json'), metadata = JSON.parse(metadataBytes);
assert.equal(digest(metadataBytes), sourceFacts.officialSources.metadataSha1);
assert.equal(run.clientSha1, metadata.downloads.client.sha1);
assert.equal(digest(await readFile(path.join(fixture.root, 'versions/1.7.10/1.7.10.jar'))), run.clientSha1);
assert.equal(sourceFacts.officialSources.clientSha1, run.clientSha1);
assert.equal(digest(await readFile(path.join(fixture.nativeDir, 'OpenAL64.dll')), 'sha256'), run.nativeDllSha256);
assert.equal(digest(await readFile(path.join(fixture.nativeDir, 'lwjgl64.dll')), 'sha256'), run.lwjglBridgeSha256);
const indexBytes = await readFile(path.join(fixture.root, `assets/indexes/${metadata.assetIndex.id}.json`)); assert.equal(digest(indexBytes), metadata.assetIndex.sha1);
const index = JSON.parse(indexBytes), instruments = ['harp', 'bass', 'basedrum', 'snare', 'hat'];
const soundsAsset = index.objects['minecraft/sounds.json'], soundsBytes = await readFile(path.join(fixture.root, 'assets/objects', soundsAsset.hash.slice(0, 2), soundsAsset.hash)); assert.equal(digest(soundsBytes), soundsAsset.hash);
const decoderClasspath = [];
for (const name of ['com.paulscode:codecjorbis:20101023', 'com.paulscode:soundsystem:20120107']) {
  const artifact = metadata.libraries.find(item => item.name === name)?.downloads.artifact; assert(artifact);
  const filename = path.join(fixture.root, 'libraries', artifact.path); assert.equal(digest(await readFile(filename)), artifact.sha1); decoderClasspath.push(filename);
}
const decoderClasses = path.join(run.output, 'decoder-classes'); await mkdir(decoderClasses, { recursive: true });
const compiled = spawnSync('javac', ['--release', '8', '-d', decoderClasses, 'electron/java/NbsxVorbisDecoder.java'], { windowsHide: true, encoding: 'utf8' }); assert.equal(compiled.status, 0, compiled.stderr);
const rendererFile = path.join(run.output, 'renderer-1710.mjs');
const bundled = await build({ stdin: { contents: "export {render} from './electron/audio-worker.ts';export {legacySourceGain} from './src/audio/legacy.ts';export {resolveNoteBlockSounds} from './src/core/sound-events.ts';export {createProject} from './src/core/project.ts';export {broadcastForProject,withinBroadcastRange} from './src/audio/delivery.ts';export {gameVolumeParameters,gamePitchParameters} from './src/audio/volume.ts';export {outputLimiterForProject} from './src/audio/context.ts';", resolveDir: process.cwd(), sourcefile: 'lwjgl21710-world-compare.ts' }, outfile: rendererFile, platform: 'node', format: 'esm', bundle: true, external: ['koffi'], metafile: true });
const { render, legacySourceGain, resolveNoteBlockSounds, createProject, broadcastForProject, withinBroadcastRange, gameVolumeParameters, gamePitchParameters, outputLimiterForProject } = await import(pathToFileURL(rendererFile).href);
const checkedSounds = resolveNoteBlockSounds(JSON.parse(soundsBytes)); assert.deepEqual(checkedSounds, fixture.sounds, 'Fixture mappings differ from official indexed sounds.json');
const propertyValue = value => value.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (_, hex, character) => hex ? String.fromCharCode(parseInt(hex, 16)) : ({ t: '\t', r: '\r', n: '\n', f: '\f' }[character] ?? character));
const properties = text => Object.fromEntries(text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), propertyValue(line.slice(i + 1))]; }));
const scenes = JSON.parse(await readFile(path.join(run.output, 'cases.json'), 'utf8'));
assert.equal(scenes.length, run.scenes);
if (run.allNotes) { assert.equal(scenes.length, 131); for (let i = 0; i < 5; i++) assert.deepEqual(scenes.slice(i * 25, i * 25 + 25).map(item => item.notes[0].slice(2)), Array.from({ length: 25 }, (_, n) => [n, i])); }
if (run.polyphony) assert.deepEqual(scenes.map(scene => scene.notes.length), [3, 6, 16, 24, 28]);
const records = await Promise.all(scenes.map((_, i) => readFile(path.join(run.output, `case-${i}.properties`), 'utf8').then(properties)));
const f = Math.fround, vector = (record, name, n) => Array.from({ length: n }, (_, i) => f(Number(record[`${name}.${i}`])));
const observations = [], sourceVolume = 3, recordCategoryVolume = 1, master = f(run.master ?? 1);
const productProject = createProject(); productProject.audio.profileId = 'java-1.7.10'; productProject.audio.mode = 'vanilla'; productProject.audio.masterGain = master;
const productBroadcast = broadcastForProject(productProject); assert(productBroadcast, 'Product has no original-world broadcast facts for1.7.10');
assert.equal(productBroadcast.range, 48); assert.deepEqual(productBroadcast.listenerPosition, [0, -1.62, 0]);
const productLimiter = outputLimiterForProject(productProject); assert.equal(productLimiter, undefined);
const productVolume = gameVolumeParameters('java-1.7.10', sourceVolume, master, recordCategoryVolume, 1);
assert.equal(productVolume.gain, 1); assert.equal(productVolume.listenerGain, master);
for (let n = 0; n < scenes.length; n++) {
  const scene = scenes[n], record = records[n];
  const listener = vector(record, 'captureStart.listener', 3), orientation = vector(record, 'captureStart.orientation', 6);
  assert(listener.every(Number.isFinite)); assert(orientation.every(Number.isFinite)); assert.equal(f(Number(record['captureStart.listenerGain'])), master);
  assert.equal(Number(record.requestedNormalPool), 28); assert.equal(Number(record.requestedStreamingPool), 4);
  assert.equal(Number(record.actualNormalPool), 28); assert.equal(Number(record.actualStreamingPool), 4); assert(scene.notes.length <= Number(record.actualNormalPool));
  assert.equal(record.hrtfSupported, 'false'); assert.equal(record.hrtfStatus, 'unsupported');
  assert.equal(record.originalContextAttributes, '[]');
  assert.equal(record.originalContextFullBuffer, '[4103, 44100, 4104, 60, 4105, 0, 0]');
  assert.equal(record.originalContextBufferBounds, 'position=7,limit=7,capacity=7');
  assert.equal(record.originalContextNativeAddressOffsetBytes, '28'); assert.equal(record.originalContextNativeFirstWord, '0'); assert.equal(record.originalContextNativeFirstWordInsideDeclaredBuffer, 'false');
  const actualAttrs = JSON.parse(record.actualContextAttributes), actualPairs = new Map();
  for (let i = 0; i < actualAttrs.length && actualAttrs[i]; i += 2) actualPairs.set(actualAttrs[i], actualAttrs[i + 1]);
  assert.equal(actualPairs.get(0x1007), 48000); assert.equal(actualPairs.get(0x1990), 0x1501); assert.equal(actualPairs.get(0x1991), 0x1406);
  assert.equal(record.serverThread, 'Server thread'); assert.equal(Number(record.serverYOffset), 0); assert.equal(f(Number(record.clientYOffset)), f(1.62));
  const serverEntity = ['X', 'Y', 'Z'].map(k => Number(record[`serverEntity${k}`])), clientEntity = ['X', 'Y', 'Z'].map(k => Number(record[`clientEntity${k}`]));
  assert.deepEqual(serverEntity, [.5, 80, 2.5]); assert.deepEqual(clientEntity, [.5, 80 + f(1.62), 2.5]); assert.deepEqual(listener, clientEntity.map(f));
  // Derive the production delivery position from the observed listener and the independent product helper.
  // AL listener floats lose a few microblocks versus the original server's double entity coordinates.
  const deliveryPosition = listener.map((v, k) => v + productBroadcast.listenerPosition[k]);
  for (let k = 0; k < 3; k++) assert(Math.abs(deliveryPosition[k] - serverEntity[k]) < 4e-6, `Scene${n}: product player/listener conversion differs`);
  const broadcast = { listenerPosition: deliveryPosition, range: productBroadcast.range };
  const blocks = Number(record.renderBlockCount); assert.equal(blocks, 141); let frames = 0;
  for (let i = 0; i < blocks; i++) { assert.deepEqual(vector(record, `renderBlock.${i}.listener`, 3), listener, `Scene${n} block${i}: listener moved`); frames += Number(record[`renderBlock.${i}.frames`]); }
  assert.equal(frames, 144000);
  const played = Array.from({ length: Number(record.voiceCount) }, (_, i) => Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith(`voice.${i}.`)).map(([key, value]) => [key.slice(`voice.${i}.`.length), value])));
  assert.equal(Number(record.serverNoteEvents), scene.notes.length); assert.equal(Number(record.clientNoteEvents), scene.notes.length); assert.equal(Number(record.noteEvents), scene.notes.length * 2);
  const expectedDelivered = scene.notes.filter(([x, y]) => withinBroadcastRange(x + .5, y + 81.5, .5, broadcast)).length;
  assert.equal(played.length, expectedDelivered); assert.equal(record.delivery, expectedDelivered ? 'played' : 'no-source-observed');
  const voices = [], encodedSamples = [];
  for (const [x, y, note, instrumentIndex = 0] of scene.notes) {
    const instrument = instruments[instrumentIndex], source = [x + .5, y + 81.5, .5].map(f), relative = source.map((v, k) => f(v - listener[k]));
    const sound = checkedSounds[instrument]; assert(sound); assert.equal(sound.volume, 1); assert.equal(sound.pitch, 1);
    const range = f(f(sound.attenuationDistance) * f(sourceVolume)), sourcePitch = f(2 ** ((note - 12) / 12));
    // Production preprocessing includes original floatPow -> packet byte63 -> event-double multiplication -> clamp.
    const pitch = gamePitchParameters('java-1.7.10', sourcePitch, sound.pitch);
    const volume = gameVolumeParameters('java-1.7.10', sourceVolume, master, recordCategoryVolume, sound.volume), calculatedGain = legacySourceGain(volume.gain, ...relative, range);
    const original = played.find(voice => vector(voice, 'source', 3).every((v, i) => v === source[i]));
    const delivered = withinBroadcastRange(...source, broadcast); assert.equal(!!original, delivered);
    if (original) {
      assert.equal(f(Number(original.pitch)), pitch, `Scene${n}: packet/event pitch differs`); assert.equal(f(Number(original.gain)), calculatedGain, `Scene${n}: Paulscode gain differs`);
      assert.equal(f(Number(original.listenerGain)), master); assert.equal(f(Number(original.rolloff)), 0); assert.equal(f(Number(original.range)), f(3.4028234663852886e38));
      assert.equal(f(Number(original.sourceVolume)), volume.gain); assert.equal(f(Number(original.attenuationRange)), range); assert.equal(Number(original.attenuationModel), 2);
      assert.equal(original.soundFile, sound.path.replace('/', ':')); assert.deepEqual(vector(original, 'listener', 3), listener); assert.deepEqual(vector(original, 'orientation', 6), orientation);
    }
    if (!encodedSamples.some(sample => sample.id === instrument)) { const sample = index.objects[sound.path], bytes = new Uint8Array(await readFile(path.join(fixture.root, 'assets/objects', sample.hash.slice(0, 2), sample.hash))); assert.equal(digest(bytes), sample.hash); encodedSamples.push({ id: instrument, bytes }); }
    voices.push({ instrument, note, sourcePosition: source, relativePosition: relative, sourcePitch, pitch, eventPitch: sound.pitch, eventVolume: sound.volume, unattenuatedGain: volume.gain, range, calculatedGain, originalGain: original ? f(Number(original.gain)) : null, originalSourceVolume: original ? f(Number(original.sourceVolume)) : null, originalAttenuationRange: original ? f(Number(original.attenuationRange)) : null, originalSoundFile: original?.soundFile ?? null, originalPlayOrder: original ? played.indexOf(original) : null, sampleSha1: index.objects[sound.path].hash });
  }
  const original = await readFile(path.join(run.output, `case-${n}.pcm`)); assert.equal(original.length, 576000);
  const result = render({ nativeLibrary: path.join(fixture.nativeDir, 'OpenAL64.dll'), javaDecoder: { executable: 'java', classpath: [decoderClasses, ...decoderClasspath], kind: 'legacy-jorbis' }, encodedSamples, samples: [], sampleRate: 48000, duration: 3, directional: false, outputLimiter: productLimiter, attenuationModel: 'paulscode-linear', listener: { position: listener, orientation, gain: productVolume.listenerGain }, broadcast,
    events: [...voices].sort((a,b) => (a.originalPlayOrder ?? Infinity) - (b.originalPlayOrder ?? Infinity)).map(voice => ({ time: 0, instrument: voice.instrument, pitch: voice.pitch, gain: voice.unattenuatedGain, x: voice.sourcePosition[0], y: voice.sourcePosition[1], z: voice.sourcePosition[2], maxDistance: voice.range })) });
  assert.equal(result.directional, false); assert.equal(result.outputLimiter, undefined); assert.equal(result.backend, '1.1 ALSOFT 1.15.1');
  const rendered = Buffer.from(result.wav).subarray(44); assert.equal(rendered.length, original.length);
  if (n === 0) { await writeFile(path.join(run.output, 'editor-center.wav'), result.wav); const reference = Buffer.from(result.wav); original.copy(reference, 44); await writeFile(path.join(run.output, 'reference-center.wav'), reference); }
  let changedSamples = 0, maxPcmError = 0, errorEnergy = 0, originalEnergy = 0, renderedEnergy = 0;
  for (let at = 0; at < original.length; at += 2) { const a = original.readInt16LE(at), b = rendered.readInt16LE(at), d = a - b; if (d) changedSamples++; maxPcmError = Math.max(maxPcmError, Math.abs(d)); errorEnergy += d * d; originalEnergy += a * a; renderedEnergy += b * b; }
  if (expectedDelivered) assert(originalEnergy > 0); else assert.equal(originalEnergy, 0);
  observations.push({ case: n, scene: scene.name, voices, deliveredSources: played.length, noteEvents: Number(record.noteEvents), serverNoteEvents: Number(record.serverNoteEvents), clientNoteEvents: Number(record.clientNoteEvents), serverEntityPosition: serverEntity, clientEntityPosition: clientEntity, productDeliveryPosition: deliveryPosition, listenerPosition: listener, listenerOrientation: orientation, listenerGain: master, stableListenerCaptureBlocks: blocks, originalContextAttributes: record.originalContextAttributes, originalContextFullBuffer: record.originalContextFullBuffer, originalContextBufferBounds: record.originalContextBufferBounds, originalContextNativeAddressOffsetBytes: Number(record.originalContextNativeAddressOffsetBytes), originalContextNativeFirstWord: Number(record.originalContextNativeFirstWord), actualContextAttributes: actualAttrs, pool: { requestedNormal: 28, requestedStreaming: 4, actualNormal: Number(record.actualNormalPool), actualStreaming: Number(record.actualStreamingPool) }, hrtfStatus: record.hrtfStatus, hrtfSupported: false, editorHrtfApplied: result.directional, outputLimiterStatus: 'unsupported', editorOutputLimiterApplied: null, recordingSha256: digest(original, 'sha256'), renderedSha256: digest(rendered, 'sha256'), exact: original.equals(rendered), changedSamples, maxPcmError, normalizedRmsError: originalEnergy ? Math.sqrt(errorEnergy / originalEnergy) : errorEnergy ? null : 0, originalEnergy, renderedEnergy });
}
const contextEvidence = 'docs/evidence/java-1.7.10-context-pointer.json';
const report = { schema: 1, version: '1.7.10', status: 'candidate-only-context-normalization-unresolved', integratedWorldScenesAdded: 0, clientSha1: run.clientSha1, metadataSha1: digest(metadataBytes), agentSha256: run.agentSha256, agentSourceSha256: run.agentSourceSha256, nativeDllSha256: run.nativeDllSha256, lwjglBridgeSha256: run.lwjglBridgeSha256, recordingMethod: run.recordingMethod, sourceEvidence: { path: sourceEvidenceFile, sha256: digest(sourceEvidenceBytes, 'sha256') }, contextEvidence: { path: contextEvidence, sha256: digest(await readFile(contextEvidence), 'sha256') }, mappingEvidence: { manualRoles: true, officialMappingsAvailable: false, memberBindings: run.memberBindings }, settings: { sampleRate: 48000, channels: 2, sourceVolume, recordCategoryVolume, unattenuatedSourceGain: productVolume.gain, masterGain: master, masterVolumePlacement: 'listener', soundEventArithmetic: 'double-event-scalars', pitchTransport: { kind: 'unsigned-byte', scale: 63, minimum: 0, maximum: 255 }, productBroadcast, productBroadcastIntegrated: true, originalHrtfSupported: false, hrtf: false, outputLimiter: 'unsupported', captureBlockFrames: 1024, maxActualNormalPool: 28 }, observations, exact: observations.every(item => item.exact), rendererSources: {}, scopeLimitations: ['No accepted world measurement: original native-context equivalence remains unresolved', 'Original DLL exposes neither ALC_SOFT_HRTF nor ALC_SOFT_output_limiter; no enabled measurement is possible', 'Windows x64; officially referenced original OpenAL Soft1.15.1 and distinct LWJGL2.9.1 JNI bridge', run.polyphony ? 'Simultaneous original note-block batches up to unmodified actual28 normal voices; excludes musical onset scheduling and overflow-stealing behavior' : 'Single original note-block event at a time', 'Original game mixer captured by loopback; excludes hardware output and server/network delay', 'Original context buffer position is beyond its declared capacity: stored44100/60 are not submitted. Per-process first native word0 is observed, then loopback explicitly supplies stereo/float/48000. This does not certify arbitrary out-of-buffer memory or another regular-device configuration', 'Semantic class labels manually established from verified original bytecode; official mappings unavailable'] };
const commonSources = ['electron/audio-worker.ts', 'electron/vorbis.ts', 'electron/java-decoder.ts', 'electron/java/NbsxVorbisDecoder.java', 'src/core/project.ts', 'src/core/time.ts', 'src/audio/legacy.ts', 'src/audio/delivery.ts', 'src/audio/parameters.ts', 'src/audio/volume.ts', 'src/audio/context.ts', 'src/audio/profiles.ts', 'src/audio/engine.ts', 'src/core/reference.ts', 'src/core/transport.ts', 'src/core/recording.ts', 'src/data/audio-facts.json', 'src/data/legacy-audio-facts.json', 'src/data/early-audio-facts.json', 'src/data/world-audio-facts.json', 'scripts/verify-lwjgl21710-world.mjs'];
for (const name of new Set([...commonSources, ...Object.keys(bundled.metafile.inputs).filter(name => !name.startsWith('<') && name !== 'lwjgl21710-world-compare.ts')])) report.rendererSources[name] = digest(await readFile(name), 'sha256');
const filename = path.join(run.output, 'comparison-candidate.json'); await writeFile(filename, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cases: observations.length, master, hrtf: false, exact: report.exact, mismatches: observations.filter(item => !item.exact).map(({ scene, changedSamples, maxPcmError, normalizedRmsError }) => ({ scene, changedSamples, maxPcmError, normalizedRmsError })), report: filename }));
assert(report.exact, 'Actual1.7.10 world capture differs from the production renderer');
