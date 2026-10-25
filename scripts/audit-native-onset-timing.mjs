import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { build, transformSync } from 'esbuild';

// Independent temporal audit only. No game launches, UI input or product edits.
const output = path.resolve('.local/native-onset-timing', `run-${Date.now()}`);
await mkdir(output, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = {};
for (const file of ['scripts/audit-native-onset-timing.mjs', 'src/ui/App.tsx', 'src/audio/engine.ts', 'electron/audio-worker.ts', 'src/audio/parameters.ts', 'src/core/time.ts', 'src/core/transport.ts', 'src/core/reference.ts', 'src/core/project.ts']) {
  const bytes = await readFile(file); sources[file] = digest(bytes);
  const snapshot = path.join(output, 'source', file); await mkdir(path.dirname(snapshot), { recursive: true }); await copyFile(file, snapshot);
}
const helper = path.join(output, 'production.mjs');
await build({ stdin: { contents: "export {render} from './electron/audio-worker'; export {AudioEngine} from './src/audio/engine'; export {createProject,newNote} from './src/core/project'; export {playbackEndTick} from './src/core/reference'; export {tickToSeconds} from './src/core/time'; export {previewBackendForProject} from './src/audio/preview'; export {audioProfile} from './src/audio/profiles';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', external: ['koffi'], outfile: helper });
const production = await import(pathToFileURL(helper).href);
const fixture = JSON.parse(await readFile('.local/game-fixtures/1.14.4/fixture.json', 'utf8'));
const accepted = JSON.parse(await readFile('docs/evidence/java-1.14.4-single-note-world.json', 'utf8'));
const nativeLibrary = path.join(fixture.nativeDir, 'OpenAL.dll'), nativeDecoder = path.join(fixture.nativeDir, 'lwjgl_stb.dll');
assert.equal(digest(await readFile(nativeLibrary)), accepted.nativeLibraries.openal.sha256);
assert.equal(digest(await readFile(nativeDecoder)), accepted.nativeLibraries.stb.sha256);
const rate = 48000;
const library = { root: fixture.root, version: '1.14.4', profileId: 'java-1.14.4', nativeLibrary, nativeDecoder, attenuationModel: 'openal-linear', samples: {} };
function buffer(channels, sampleRate = rate) {
  return { sampleRate, numberOfChannels: channels.length, length: channels[0].length, duration: channels[0].length / sampleRate, getChannelData: channel => channels[channel], copyToChannel: (data, channel) => channels[channel].set(data) };
}
function readWav(bytes) {
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'RIFF');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), channels = view.getUint16(22, true), sampleRate = view.getUint32(24, true), frames = (bytes.length - 44) / (channels * 2);
  return { channels, sampleRate, frames, pcm: Array.from({ length: channels }, (_, channel) => Float32Array.from({ length: frames }, (_, frame) => view.getInt16(44 + 2 * (frame * channels + channel), true) / 32768)) };
}
function context() {
  return { currentTime: 100, sources: [], destination: {}, resume: async () => {},
    decodeAudioData: async data => { const wav = readWav(new Uint8Array(data)); return buffer(wav.pcm, wav.sampleRate); },
    createBuffer: (channels, frames, sampleRate) => buffer(Array.from({ length: channels }, () => new Float32Array(frames)), sampleRate),
    createAnalyser: () => ({ connect() {}, disconnect() {} }),
    createBufferSource() { const source = { loop: false, loopStart: 0, loopEnd: 0, buffer: undefined, starts: [], stops: [], connect() {}, disconnect() {}, start(...args) { this.starts.push(args); }, stop(...args) { this.stops.push(args); } }; this.sources.push(source); return source; } };
}
function engineFor(sample) { const engine = new production.AudioEngine(); engine.library = library; engine.context = context(); engine.buffers.set('temporal-fixture', buffer([sample])); return engine; }
function projectFor(name, ticks, tempos = [{ tick: 0, bpm: 120 }], length = 3840) {
  const project = production.createProject(name); project.ppq = 960; project.tempos = tempos;
  project.audio.profileId = 'java-1.14.4'; project.audio.mode = 'studio'; project.audio.masterGain = .3;
  project.tracks[0].instrumentId = 'temporal-fixture';
  project.instruments = [{ ...project.instruments[0], id: 'temporal-fixture', rootMidi: 66 }];
  project.patterns[0].length = project.regions[0].length = length;
  project.patterns[0].notes = ticks.map(tick => ({ ...production.newNote(tick, 66, 1), velocity: .6 }));
  return project;
}
const gcd = (a, b) => b ? gcd(b, a % b) : a;
const add = (a, b) => { const n = a[0] * b[1] + b[0] * a[1], d = a[1] * b[1], g = gcd(n, d); return [n / g, d / g]; };
function exactTime(tick, ppq, tempos) {
  let value = [0n, 1n];
  // Fixtures deliberately use sorted integer BPMs. This oracle is exact integer
  // interval integration and never calls the production TempoMap.
  for (let index = 0; index < tempos.length && tempos[index].tick < tick; index++) {
    const event = tempos[index], end = Math.min(tick, tempos[index + 1]?.tick ?? tick);
    value = add(value, [BigInt(end - event.tick) * 60n, BigInt(ppq) * BigInt(event.bpm)]);
  }
  return value;
}
const roundedFrame = fraction => Number((2n * fraction[0] * BigInt(rate) + fraction[1]) / (2n * fraction[1]));
const fractionText = value => `${value[0]}/${value[1]}`;
const outputCases = [];
const pulse = new Float32Array(32); pulse[0] = .5;
for (const definition of [
  { name: 'tempo-boundary-and-block-offsets', ticks: [0, 11, 480, 960, 971, 1920, 2500, 3840], tempos: [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 176 }, { tick: 1920, bpm: 89 }], length: 4800 },
  { name: 'half-frame-rounding', ticks: [11, 33, 55, 77, 99, 121], tempos: [{ tick: 0, bpm: 176 }], length: 960 },
  { name: 'cross-1024-frame-boundaries', ticks: [0, 41, 82, 123, 164, 205], tempos: [{ tick: 0, bpm: 120 }], length: 960 },
  { name: 'floating-half-frame-negative-example', ppq: 480, ticks: [123, 245, 505, 507], tempos: [{ tick: 0, bpm: 96 }], length: 960 },
]) {
  const project = projectFor(definition.name, definition.ticks, definition.tempos, definition.length), engine = engineFor(pulse);
  if (definition.ppq) project.ppq = definition.ppq;
  const request = await engine.nativeRequest(project);
  // Controlled component mode: explicit HRTF off, no regular-device policy claim.
  request.hrtf = 'first-profile'; request.directional = false; request.outputLimiter = false;
  const result = production.render(request), wav = readWav(result.wav), peaks = [];
  for (let frame = 0; frame < wav.frames; frame++) if (Math.abs(wav.pcm[0][frame]) > .001) peaks.push(frame);
  const events = definition.ticks.map((tick, index) => { const exact = exactTime(tick, project.ppq, project.tempos), expectedFrame = roundedFrame(exact), productionFrame = Math.round(request.events[index].time * rate); return { tick, exactSeconds: fractionText(exact), productionSeconds: request.events[index].time, expectedFrame, productionFrame, frameError: productionFrame - expectedFrame, nearestAudibleFrame: peaks.reduce((best, at) => Math.abs(at - expectedFrame) < Math.abs(best - expectedFrame) ? at : best, Infinity) }; });
  const file = path.join(output, definition.name + '.wav'); await writeFile(file, result.wav);
  outputCases.push({ ...definition, events, audiblePeakFrames: peaks, output: { path: file, sha256: digest(result.wav) }, actualHrtf: result.directional, outputLimiter: result.outputLimiter });
  engine.stop();
}

// Execute the exact App loop-construction function with inert state holders and
// the actual AudioEngine/native renderer. No renderer/React state is injected.
const appSource = (await readFile('src/ui/App.tsx', 'utf8')).replaceAll('\r\n', '\n');
const start = appSource.indexOf('  async function togglePlay('), end = appSource.indexOf('\n  function toggleLoop(', start);
assert(start >= 0 && end > start);
const appCode = transformSync(appSource.slice(start, end), { loader: 'ts', target: 'es2022' }).code;
const ringing = Float32Array.from({ length: rate * .3 }, (_, frame) => .3 * Math.cos(2 * Math.PI * 220 * frame / rate));
const loopProject = projectFor('late-onset loop tail', [864], [{ tick: 0, bpm: 120 }], 960);
const loopEngine = engineFor(ringing), loopRequests = [];
const scope = { playing: false, busy: false, loop: true, stop() {}, setBusy() {}, setMessage() {}, setPlaying() {}, stopEpoch: { current: 0 }, projectRef: { current: loopProject }, positionRef: { current: 0 }, revision: 0, renderCache: { current: undefined }, library, engine: loopEngine,
  playbackEndTick: production.playbackEndTick, tickToSeconds: production.tickToSeconds, previewBackendForProject: production.previewBackendForProject, audioProfile: production.audioProfile, PROFILE_STATUS: {}, window: { desktop: { renderNative: async request => { loopRequests.push(structuredClone(request)); return production.render(request); } } } };
await Function(...Object.keys(scope), `${appCode}\nreturn togglePlay(true);`)(...Object.values(scope));
assert.equal(loopRequests.length, 1);
const loopSource = loopEngine.context.sources[0], loopPcm = readWav(scope.renderCache.current.wav);
const warmupStart = Math.round(loopSource.loopStart * rate), warmupEnd = Math.round(loopSource.loopEnd * rate), firstOnset = roundedFrame(exactTime(864, 960, loopProject.tempos));
const maxAbs = data => data.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
const loopObservation = { projectPeriodSeconds: .5, firstOnsetSeconds: .45, warmupStartSeconds: loopSource.loopStart, warmupEndSeconds: loopSource.loopEnd, startArguments: loopSource.starts[0], generatedEventTimes: loopRequests[0].events.map(event => event.time),
  initialColdPrefixPeak: maxAbs(loopPcm.pcm[0].subarray(0, firstOnset)), warmedPrefixPeak: maxAbs(loopPcm.pcm[0].subarray(warmupStart, warmupStart + firstOnset)),
  loopWindowFrames: warmupEnd - warmupStart,
  finding: 'The loop starts at an already-warmed cycle: a late note from the hypothetical previous cycle is audible before the first real onset. This is steady-state loop semantics, not a missing cross-boundary tail; decide whether initial cold playback is required.' };
await writeFile(path.join(output, 'loop-warmup.wav'), scope.renderCache.current.wav); loopEngine.stop();

const tailProject = projectFor('native mid-note seek', [0], [{ tick: 0, bpm: 120 }], 1920), tailEngine = engineFor(ringing);
const tailRequest = await tailEngine.nativeRequest(tailProject); tailRequest.hrtf = 'first-profile'; tailRequest.outputLimiter = false;
const tailOutput = production.render(tailRequest), tailPcm = readWav(tailOutput.wav), seekTick = 240, seekFraction = exactTime(seekTick, 960, tailProject.tempos), seekFrame = roundedFrame(seekFraction);
await tailEngine.playRendered(tailProject, tailOutput.wav, seekTick);
const tailSource = tailEngine.context.sources[0];
const seekObservation = { fromTick: seekTick, exactSeconds: fractionText(seekFraction), expectedFrame: seekFrame, sourceStartArguments: tailSource.starts[0], eventsBeforeSeek: tailRequest.events.filter(event => event.time < Number(seekFraction[0]) / Number(seekFraction[1])).length,
  retainedTailPeak: maxAbs(tailPcm.pcm[0].subarray(seekFrame, seekFrame + 1000)),
  finding: 'Native fromTick reads the complete prior-onset PCM at the requested offset; this probe confirms that earlier sample tail is retained.' };
assert.equal(tailSource.starts[0][1], .125); assert(seekObservation.retainedTailPeak > .001); tailEngine.stop();
const report = { schema: 1, checkedAt: new Date().toISOString(), scope: 'Read-only actual App/AudioEngine functions plus actual production OpenAL worker using a synthetic PCM signal and the hash-verified original 1.14.4 DLL. Exact rational tick/time/frame oracle, no game timing or hardware-output acceptance.', sources,
  native: { version: '1.14.4', library: { path: nativeLibrary, sha256: digest(await readFile(nativeLibrary)) }, nativeDecoder: { path: nativeDecoder, sha256: digest(await readFile(nativeDecoder)) }, signal: 'Independent synthetic mono impulse / 220Hz ringing signal at 48000Hz; original Vorbis decoder is not exercised.', controlledHrtf: false, outputLimiter: false },
  onsetCases: outputCases, nativeSeek: seekObservation, warmedLoop: loopObservation,
  limitations: ['No actual integrated-world musical event recording.', 'AudioEngine playback-node offsets are inert observations; actual native PCM comes from the unmodified production worker.', 'The exact-rational oracle assumes the integer-BPM fixtures listed here; no source helper is reused for expected times.', 'No conclusion about hardware latency, real-time timer starvation or fractional-frame Web Audio loop interpolation.'] };
const file = path.join(output, 'report.json'); await writeFile(file, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, report: file, sha256: digest(await readFile(file)), eventFrameErrors: outputCases.flatMap(test => test.events.filter(event => event.frameError).map(event => ({ name: test.name, ...event }))), nativeSeek: seekObservation, warmedLoop: loopObservation }, null, 2));
