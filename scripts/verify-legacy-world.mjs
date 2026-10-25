import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { digest } from './research-utils.mjs';

const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const root = path.resolve('.local/legacy-world-comparison/1.13');
const run = JSON.parse(await readFile(option('--capture') ? path.join(path.resolve(option('--capture')), 'provenance.json') : path.join(root, 'latest.json'), 'utf8'));
assert(path.resolve(run.output).startsWith(root + path.sep)); assert.equal(run.version, '1.13');
await readFile(path.join(run.output, 'complete.txt'));
assert.equal(digest(await readFile(path.join(run.output, 'LegacyWorldCaptureAgent.java')), 'sha256'), run.agentSourceSha256);
assert.equal(digest(await readFile(path.join(run.output, 'legacy-world-capture-agent.jar')), 'sha256'), run.agentSha256);
const fixture = JSON.parse(await readFile('.local/game-fixtures/1.13/fixture.json', 'utf8'));
const metadata = JSON.parse(await readFile('.research/metadata/1.13.json', 'utf8'));
assert.equal(run.clientSha1, metadata.downloads.client.sha1); assert.equal(digest(await readFile(path.join(fixture.root, 'versions/1.13/1.13.jar'))), run.clientSha1);
assert.equal(digest(await readFile(path.join(fixture.nativeDir, 'OpenAL.dll')), 'sha256'), run.nativeDllSha256);
const indexBytes = await readFile(path.join(fixture.root, 'assets/indexes/1.13.json')); assert.equal(digest(indexBytes), metadata.assetIndex.sha1);
const index = JSON.parse(indexBytes), instruments = ['harp', 'bass', 'basedrum', 'snare', 'hat', 'guitar', 'flute', 'bell', 'chime', 'xylophone'];
const soundsAsset = index.objects['minecraft/sounds.json'], soundsBytes = await readFile(path.join(fixture.root, 'assets/objects', soundsAsset.hash.slice(0, 2), soundsAsset.hash)); assert.equal(digest(soundsBytes), soundsAsset.hash);
const decoderClasspath = [];
for (const name of ['com.paulscode:codecjorbis:20101023', 'com.paulscode:soundsystem:20120107']) {
  const artifact = metadata.libraries.find(item => item.name === name)?.downloads.artifact; assert(artifact);
  const filename = path.join(fixture.root, 'libraries', artifact.path); assert.equal(digest(await readFile(filename)), artifact.sha1); decoderClasspath.push(filename);
}
const decoderClasses = path.join(run.output, 'decoder-classes'); await mkdir(decoderClasses, { recursive: true });
const compiled = spawnSync('javac', ['--release', '8', '-d', decoderClasses, 'electron/java/NbsxVorbisDecoder.java'], { windowsHide: true, encoding: 'utf8' }); assert.equal(compiled.status, 0, compiled.stderr);
const rendererFile = path.join(run.output, 'renderer.mjs');
await build({ stdin: { contents: "export {render} from './electron/audio-worker.ts';export {legacySourceGain} from './src/audio/legacy.ts';export {resolveNoteBlockSounds} from './src/core/sound-events.ts';export {createProject} from './src/core/project.ts';export {broadcastForProject} from './src/audio/delivery.ts';export {gameVolumeParameters} from './src/audio/volume.ts';", resolveDir: process.cwd(), sourcefile: 'legacy-world-compare.ts' }, outfile: rendererFile, platform: 'node', format: 'esm', bundle: true, external: ['koffi'] });
const { render, legacySourceGain, resolveNoteBlockSounds, createProject, broadcastForProject, gameVolumeParameters } = await import(pathToFileURL(rendererFile).href);
const checkedSounds = resolveNoteBlockSounds(JSON.parse(soundsBytes)); assert.deepEqual(checkedSounds, fixture.sounds, 'Fixture sound mappings differ from the official indexed sounds.json');
const propertyValue = value => value.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (_, hex, character) => hex ? String.fromCharCode(parseInt(hex, 16)) : ({ t: '\t', r: '\r', n: '\n', f: '\f' }[character] ?? character));
const properties = text => Object.fromEntries(text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), propertyValue(line.slice(i + 1))]; }));
const scenes = JSON.parse(await readFile(path.join(run.output, 'cases.json'), 'utf8'));
const records = await Promise.all(scenes.map((_, i) => readFile(path.join(run.output, `case-${i}.properties`), 'utf8').then(properties)));
const first = records.find(record => record.delivery === 'played'); assert(first);
const vector = (record, name, n) => Array.from({ length: n }, (_, i) => Math.fround(Number(record[`${name}.${i}`])));
const originalFloat = value => Math.fround(Number(value));
const observations = [], sourceVolume = 3, recordCategoryVolume = 1;
// Independent original-code inputs: bfw emits 3.0; dgh clamps source*category to [0,1].
// Original sounds.json attenuation_distance defaults to 16; dgh multiplies this by unclamped volume 3.
const rawSourceGain = Math.fround(Math.max(0, Math.min(1, Math.fround(Math.fround(sourceVolume) * Math.fround(recordCategoryVolume)))));
const master = Math.fround(run.master ?? 1);
const productProject = createProject(); productProject.audio.profileId = 'java-1.13'; productProject.audio.mode = 'vanilla'; productProject.audio.masterGain = master;
const productBroadcast = broadcastForProject(productProject); assert(productBroadcast, 'Product has no original-world broadcast model for Java1.13');
assert.equal(productBroadcast.range, 48); assert.deepEqual(productBroadcast.listenerPosition, [0, -1.62, 0]);
const productVolume = gameVolumeParameters('java-1.13', sourceVolume, master, recordCategoryVolume);
assert.equal(productVolume.gain, rawSourceGain, 'Product source-volume clamp differs from original Java1.13'); assert.equal(productVolume.listenerGain, master, 'Product master-volume placement differs from original Java1.13');
for (let n = 0; n < scenes.length; n++) {
  const scene = scenes[n], record = records[n], state = record.delivery === 'played' ? record : first;
  const listener = vector(state, 'listener', 3), orientation = vector(state, 'orientation', 6);
  assert.equal(originalFloat(state.listenerGain), master, `Scene ${n}: original master was not applied to listener`);
  const played = Array.from({ length: Number(record.voiceCount) }, (_, i) => Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith(`voice.${i}.`)).map(([key, value]) => [key.slice(`voice.${i}.`.length), value])));
  const expectedDelivered = scene.notes.filter(([x, y]) => x * x + (y + 1.5) ** 2 + 4 < 48 * 48).length;
  assert.equal(played.length, expectedDelivered); assert(Number(record.noteEvents) >= scene.notes.length);
  assert.equal(Number(record.hrtfStatus), run.hrtf ? 1 : 0);
  const voices = [], encodedSamples = [];
  for (const [x, y, note, instrumentIndex = 0] of scene.notes) {
    const instrument = instruments[instrumentIndex], source = [x + .5, y + 81.5, .5].map(Math.fround);
    const relative = source.map((position, i) => Math.fround(position - listener[i]));
    const sound = checkedSounds[instrument]; assert(sound); assert.equal(sound.volume, 1); assert.equal(sound.pitch, 1);
    const range = Math.fround(Math.fround(sound.attenuationDistance) * Math.fround(sourceVolume));
    const pitch = Math.fround(2 ** ((note - 12) / 12)), calculatedGain = legacySourceGain(rawSourceGain, ...relative, range);
    const original = played.find(voice => vector(voice, 'source', 3).every((v, i) => v === source[i]));
    if (original) {
      assert.equal(originalFloat(original.pitch), pitch); assert.equal(originalFloat(original.gain), calculatedGain, `Scene ${n}: product Paulscode gain differs from original AL_GAIN`);
      assert.equal(originalFloat(original.listenerGain), master); assert.equal(originalFloat(original.rolloff), 0);
      assert.equal(originalFloat(original.range), Math.fround(3.4028234663852886e38));
      if (original.sourceVolume !== undefined) {
        assert.equal(originalFloat(original.sourceVolume), rawSourceGain); assert.equal(originalFloat(original.attenuationRange), range); assert.equal(Number(original.attenuationModel), 2);
        assert.equal(original.soundFile, sound.path.replace('/', ':'), 'Actual original source sample differs from support-block scene');
      }
    }
    if (!encodedSamples.some(sample => sample.id === instrument)) {
      const sample = index.objects[sound.path], bytes = new Uint8Array(await readFile(path.join(fixture.root, 'assets/objects', sample.hash.slice(0, 2), sample.hash)));
      assert.equal(digest(bytes), sample.hash); encodedSamples.push({ id: instrument, bytes });
    }
    voices.push({ instrument, note, sourcePosition: source, relativePosition: relative, pitch, unattenuatedGain: rawSourceGain, range, calculatedGain, originalGain: original ? originalFloat(original.gain) : null, originalSourceVolume: original?.sourceVolume === undefined ? null : originalFloat(original.sourceVolume), originalAttenuationRange: original?.attenuationRange === undefined ? null : originalFloat(original.attenuationRange), originalSoundFile: original?.soundFile ?? null, originalPlayOrder: original ? played.indexOf(original) : null, sampleSha1: index.objects[sound.path].hash });
  }
  const original = await readFile(path.join(run.output, `case-${n}.pcm`));
  const result = render({ nativeLibrary: path.join(fixture.nativeDir, 'OpenAL.dll'), javaDecoder: { executable: 'java', classpath: [decoderClasses, ...decoderClasspath], kind: 'legacy-jorbis' }, encodedSamples, samples: [], sampleRate: 48000, duration: original.length / (48000 * 4), directional: !!run.hrtf, attenuationModel: 'paulscode-linear',
    listener: { position: listener, orientation, gain: productVolume.listenerGain }, broadcast: { listenerPosition: [.5, 80, 2.5], range: productBroadcast.range },
    events: [...voices].sort((a,b) => (a.originalPlayOrder ?? Infinity) - (b.originalPlayOrder ?? Infinity)).map(voice => ({ time: 0, instrument: voice.instrument, pitch: voice.pitch, gain: productVolume.gain, x: voice.sourcePosition[0], y: voice.sourcePosition[1], z: voice.sourcePosition[2], maxDistance: voice.range })) });
  assert.equal(result.directional, !!run.hrtf);
  const rendered = Buffer.from(result.wav).subarray(44); assert.equal(rendered.length, original.length);
  if (n === 0) {
    await writeFile(path.join(run.output, 'editor-center.wav'), result.wav);
    const reference = Buffer.from(result.wav); original.copy(reference, 44); await writeFile(path.join(run.output, 'reference-center.wav'), reference);
  }
  let changedSamples = 0, maxPcmError = 0, errorEnergy = 0, originalEnergy = 0, renderedEnergy = 0;
  for (let at = 0; at < original.length; at += 2) { const a = original.readInt16LE(at), b = rendered.readInt16LE(at), d = a - b; if (d) changedSamples++; maxPcmError = Math.max(maxPcmError, Math.abs(d)); errorEnergy += d * d; originalEnergy += a * a; renderedEnergy += b * b; }
  if (expectedDelivered) assert(originalEnergy > 0);
  observations.push({ case: n, scene: scene.name, voices, deliveredSources: played.length, noteEvents: Number(record.noteEvents), listenerPosition: listener, listenerOrientation: orientation, listenerGain: master, hrtfStatus: Number(record.hrtfStatus), editorHrtfApplied: result.directional, recordingSha256: digest(original, 'sha256'), renderedSha256: digest(rendered, 'sha256'), exact: original.equals(rendered), changedSamples, maxPcmError, normalizedRmsError: originalEnergy ? Math.sqrt(errorEnergy / originalEnergy) : errorEnergy ? null : 0, originalEnergy, renderedEnergy });
}
const report = { schema: 1, version: '1.13', clientSha1: run.clientSha1, metadataSha1: run.metadataSha1, agentSha256: run.agentSha256, agentSourceSha256: run.agentSourceSha256, nativeDllSha256: run.nativeDllSha256, recordingMethod: run.recordingMethod, mappingEvidence: JSON.parse(await readFile(path.join(run.output, 'adapter-evidence.json'), 'utf8')), settings: { sampleRate: 48000, channels: 2, sourceVolume, recordCategoryVolume, unattenuatedSourceGain: rawSourceGain, masterGain: master, masterVolumePlacement: 'listener', productBroadcast, hrtf: !!run.hrtf, captureBlockFrames: 1024 }, observations, exact: observations.every(item => item.exact), rendererSources: {}, scopeLimitations: ['Windows x64, original 1.13 OpenAL Soft 1.18.2', run.polyphony ? 'simultaneous note-block batches; excludes musical onset scheduling' : 'single original note-block event at a time', 'original game mixer captured by loopback; excludes hardware output and server/network delay', 'semantic class labels manually established from verified original bytecode; official mappings unavailable'] };
for (const name of ['electron/audio-worker.ts', 'electron/vorbis.ts', 'electron/java-decoder.ts', 'src/core/project.ts', 'src/core/time.ts', 'electron/java/NbsxVorbisDecoder.java', 'src/audio/legacy.ts', 'src/audio/delivery.ts', 'src/audio/parameters.ts', 'src/audio/volume.ts', 'src/audio/context.ts', 'src/audio/profiles.ts', 'src/audio/engine.ts', 'src/core/reference.ts', 'src/core/transport.ts', 'src/core/recording.ts', 'src/data/audio-facts.json', 'src/data/early-audio-facts.json', 'src/data/legacy-audio-facts.json', 'src/data/world-audio-facts.json', 'scripts/verify-legacy-world.mjs']) report.rendererSources[name] = digest(await readFile(name), 'sha256');
const filename = path.join(run.output, 'comparison.json'); await writeFile(filename, JSON.stringify(report, null, 2));
if (option('--evidence-name')) { const name = option('--evidence-name'); assert(/^[\w.-]+$/.test(name)); await mkdir('docs/evidence', { recursive: true }); await writeFile(`docs/evidence/${name}.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ cases: observations.length, master, hrtf: !!run.hrtf, exact: report.exact, mismatches: observations.filter(item => !item.exact).map(({ scene, changedSamples, maxPcmError, normalizedRmsError }) => ({ scene, changedSamples, maxPcmError, normalizedRmsError })), report: filename }));
assert(report.exact, 'Actual legacy world capture differs from the product renderer');
