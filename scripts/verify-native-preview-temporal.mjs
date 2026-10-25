import { _electron as electron } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build, transformSync } from 'esbuild';

// Final production verification, separate from dated baseline/candidate audits.
// Real OfflineAudioContext, no UI input or replacement production methods.
const root = path.resolve('.local/native-preview-temporal', `run-${Date.now()}`);
await mkdir(root, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const nodeBuild = await build({ stdin: { contents: "export {render} from './electron/audio-worker'; export {AudioEngine} from './src/audio/engine'; export {createProject,newNote} from './src/core/project'; export {playbackEndTick} from './src/core/reference'; export {createTempoMap,tickToSeconds} from './src/core/time'; export {previewBackendForProject} from './src/audio/preview'; export {audioProfile} from './src/audio/profiles';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', external: ['koffi'], metafile: true, outfile: path.join(root, 'production.mjs') });
const production = await import(pathToFileURL(path.join(root, 'production.mjs')).href);
const browserBuild = await build({ stdin: { contents: "export {AudioEngine} from './src/audio/engine';", resolveDir: process.cwd(), loader: 'ts' }, platform: 'browser', format: 'iife', globalName: 'TemporalProbe', bundle: true, metafile: true, outfile: path.join(root, 'engine.js') });
const sourceHashes = {};
for (const file of new Set(['scripts/verify-native-preview-temporal.mjs', 'src/ui/App.tsx', 'src/core/types.ts', ...Object.keys(nodeBuild.metafile.inputs), ...Object.keys(browserBuild.metafile.inputs)].filter(file => /^(?:src\/|electron\/|scripts\/)/.test(file.replaceAll('\\', '/'))))) sourceHashes[file] = hash(await readFile(file));
const fixture = JSON.parse(await readFile('.local/game-fixtures/1.14.4/fixture.json', 'utf8'));
const nativeLibrary = path.join(fixture.nativeDir, 'OpenAL.dll'), nativeDecoder = path.join(fixture.nativeDir, 'lwjgl_stb.dll');
const nativeIdentity = JSON.parse(await readFile('docs/evidence/java-1.14.4-single-note-world.json', 'utf8')).nativeLibraries;
assert.equal(hash(await readFile(nativeLibrary)), nativeIdentity.openal.sha256); assert.equal(hash(await readFile(nativeDecoder)), nativeIdentity.stb.sha256);
const rate = 48000, library = { root: fixture.root, version: '1.14.4', profileId: 'java-1.14.4', nativeLibrary, nativeDecoder, attenuationModel: 'openal-linear', samples: {} };
function project(name, tick, bpm, length) {
  const value = production.createProject(name); value.ppq = 960; value.tempos = [{ tick: 0, bpm }]; value.audio.profileId = 'java-1.14.4'; value.audio.mode = 'studio'; value.audio.masterGain = .3;
  value.instruments = [{ ...value.instruments[0], id: 'temporal-fixture', rootMidi: 66 }]; value.tracks[0].instrumentId = 'temporal-fixture';
  value.patterns[0].length = value.regions[0].length = length; value.patterns[0].notes = [{ ...production.newNote(tick, 66, 1), velocity: .6 }]; return value;
}
const appSource = (await readFile('src/ui/App.tsx', 'utf8')).replaceAll('\r\n', '\n');
const appStart = appSource.indexOf('  async function togglePlay('), appEnd = appSource.indexOf('\n  function toggleLoop(', appStart);
assert(appStart >= 0 && appEnd > appStart);
const appCode = transformSync(appSource.slice(appStart, appEnd), { loader: 'ts', target: 'es2022' }).code;
function baseRequest(sample) { return { nativeLibrary, nativeDecoder, sampleRate: rate, duration: 1, samples: [{ id: 'temporal-fixture', channels: 1, sampleRate: rate, data: [sample] }], events: [], hrtf: 'first-profile', directional: false, outputLimiter: false, listener: { position: [0, 0, 0], orientation: [0, 0, -1, 0, 1, 0], gain: .3 } }; }
async function loopFixture(value, sample) {
  const engine = new production.AudioEngine(); engine.library = library;
  engine.buffers.set('temporal-fixture', { numberOfChannels: 1, sampleRate: rate, duration: sample.length / rate, getChannelData: () => sample });
  const nativeRequest = engine.nativeRequest.bind(engine);
  engine.nativeRequest = async p => ({ ...await nativeRequest(p), hrtf: 'first-profile', outputLimiter: false });
  engine.playRendered = async () => true;
  const messages = [];
  const scope = { playing: false, busy: false, loop: true, stop() {}, setBusy() {}, setMessage(message) { messages.push(message); }, setPlaying() {}, stopEpoch: { current: 0 }, projectRef: { current: value }, positionRef: { current: 0 }, revision: 0, renderCache: { current: undefined }, library, engine,
    playbackEndTick: production.playbackEndTick, createTempoMap: production.createTempoMap, tickToSeconds: production.tickToSeconds, previewBackendForProject: production.previewBackendForProject, audioProfile: production.audioProfile, PROFILE_STATUS: {}, window: { desktop: { renderNative: async request => production.render(request) } } };
  await Function(...Object.keys(scope), `${appCode}\nreturn togglePlay(true);`)(...Object.values(scope));
  assert(scope.renderCache.current, `Actual App render preparation failed: ${messages.join(' | ')}`);
  return scope.renderCache.current;
}
const ring = Float32Array.from({ length: rate * .3 }, (_, frame) => .3 * Math.cos(2 * Math.PI * 220 * frame / rate));
const loopProject = project('cold prefix / cross-cycle tail', 864, 120, 960), loop = await loopFixture(loopProject, ring);
const referenceRequest = baseRequest(ring); referenceRequest.duration = 2.5; referenceRequest.events = Array.from({ length: 5 }, (_, cycle) => ({ time: .45 + cycle * .5, frame: 21600 + cycle * 24000, instrument: 'temporal-fixture', pitch: 1, gain: .6, x: 0, y: 0, z: -2, maxDistance: 1e9 }));
const linearReference = production.render(referenceRequest).wav;
const seekProject = project('mid-note seek tail', 0, 120, 1920), seekRequest = baseRequest(ring); seekRequest.duration = 1.15; seekRequest.events = [{ ...referenceRequest.events[0], time: 0, frame: 0 }];
const seekWav = production.render(seekRequest).wav;
const seekLoopProject = project('mid-note seek in a loop', 0, 120, 960), seekLoop = await loopFixture(seekLoopProject, ring);
const pulse = new Float32Array(32); pulse[0] = .5;
const fractionalProject = project('137BPM fractional frame period', 768, 137, 960), fractional = await loopFixture(fractionalProject, pulse);
const halfProject = project('Exact frame metadata regression', 123, 96, 960); halfProject.ppq = 480;
halfProject.patterns[0].notes = [123, 245, 505, 507].map(tick => ({ ...production.newNote(tick, 66, 1), velocity: .6 }));
const halfEngine = new production.AudioEngine(); halfEngine.library = library; halfEngine.buffers.set('temporal-fixture', { numberOfChannels: 1, sampleRate: rate, duration: pulse.length / rate, getChannelData: () => pulse });
const halfRequest = { ...await halfEngine.nativeRequest(halfProject), hrtf: 'first-profile', outputLimiter: false }, halfPcm = production.render(halfRequest).wav;
const pcmView = new DataView(halfPcm.buffer, halfPcm.byteOffset, halfPcm.byteLength), audibleFrames = [];
for (let frame = 0; frame < (halfPcm.length - 44) / 4; frame++) if (Math.abs(pcmView.getInt16(44 + frame * 4, true)) > 32) audibleFrames.push(frame);
assert.deepEqual(halfRequest.events.map(event => event.frame), [7688, 15313, 31563, 31688]); assert.deepEqual(audibleFrames, [7688, 15313, 31563, 31688]);
const nativeFrameRegression = { ticks: [123, 245, 505, 507], ppq: 480, bpm: 96, expectedFrames: [7688, 15313, 31563, 31688], eventFrames: halfRequest.events.map(event => event.frame), actualPcmPulseFrames: audibleFrames };
const b64 = bytes => Buffer.from(bytes).toString('base64');
const fixtures = { loop: { project: loopProject, wav: b64(loop.wav), loopStart: loop.loopStart, loopEnd: loop.loopEnd, reference: b64(linearReference) }, seek: { project: seekProject, wav: b64(seekWav) }, seekLoop: { project: seekLoopProject, wav: b64(seekLoop.wav), loopStart: seekLoop.loopStart, loopEnd: seekLoop.loopEnd }, fractional: { project: fractionalProject, wav: b64(fractional.wav), loopStart: fractional.loopStart, loopEnd: fractional.loopEnd } };
for (const [name, bytes] of [['loop.wav', loop.wav], ['linear-reference.wav', linearReference], ['seek.wav', seekWav], ['fractional-loop.wav', fractional.wav]]) await writeFile(path.join(root, name), bytes);
await writeFile(path.join(root, 'fixtures.json'), JSON.stringify({ fixtures, nativeFrameRegression }));
await writeFile(path.join(root, 'index.html'), '<!doctype html><meta charset="utf-8"><script src="engine.js"></script><body>Independent offline temporal component</body>');
await writeFile(path.join(root, 'main.cjs'), `const{app,BrowserWindow}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});await w.loadFile(path.join(__dirname,'index.html'));});app.on('window-all-closed',()=>app.quit());`);
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
const desktop = await electron.launch({ args: [path.join(root, 'main.cjs'), '--mute-audio'], env: environment });
const rendererErrors = [];
try {
  const page = await desktop.firstWindow(); page.on('pageerror', error => rendererErrors.push(error.message));
  const result = await page.evaluate(async ({ fixtures, rate }) => {
    const { AudioEngine } = window.TemporalProbe;
    const bytes = text => Uint8Array.from(atob(text), character => character.charCodeAt(0));
    const peak = data => data.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
    async function run(name, fixture, duration, fromTick = 0) {
      const context = new OfflineAudioContext(2, Math.round(duration * rate), rate), engine = new AudioEngine(), trace = [];
      engine.context = context; engine.ensure = async () => context;
      const create = context.createBufferSource.bind(context);
      context.createBufferSource = () => { const source = create(), start = source.start.bind(source); source.start = (...args) => { trace.push({ args, loopStart: source.loopStart, loopEnd: source.loopEnd, loop: source.loop }); return start(...args); }; return source; };
      await engine.playRendered(fixture.project, bytes(fixture.wav), fromTick, fixture.loopStart, fixture.loopEnd);
      const rendered = await context.startRendering(), data = rendered.getChannelData(0), position = engine.position();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
      const observation = { name, variant: 'unmodified final production playRendered', frames: data.length, trace, position, contextTime: context.currentTime, floatChannelSha256: hash };
      const lead = Math.round(.03 * rate);
      if (name.includes('fractional')) {
        const clusters = [];
        for (let at = lead; at < data.length; at++) if (Math.abs(data[at]) > .001) {
          const last = clusters.at(-1);
          if (!last || at > last.end + 1) clusters.push({ first: at, end: at, peak: at, amplitude: Math.abs(data[at]) });
          else { last.end = at; if (Math.abs(data[at]) > last.amplitude) { last.peak = at; last.amplitude = Math.abs(data[at]); } }
        }
        observation.onsets = clusters.map((cluster, cycle) => {
          const numerator = BigInt(cycle * 960 + 768) * 60n * BigInt(rate), denominator = 960n * 137n;
          const expectedFrame = Number((2n * numerator + denominator) / (2n * denominator)) + lead;
          return { cycle, frame: cluster.peak, expectedFrame, errorFrames: cluster.peak - expectedFrame };
        });
      } else if (name.startsWith('seek')) {
        observation.prefixTailPeak = peak(data.subarray(lead, lead + 1000));
        const reference = await context.decodeAudioData(bytes(fixture.wav).buffer), expected = reference.getChannelData(0);
        let maxError = 0;
        for (let frame = 0; frame < 1000; frame++) maxError = Math.max(maxError, Math.abs(data[lead + frame] - expected[6000 + frame]));
        observation.sameCycleSeekComparison = { fromTick: 240, exactSeconds: '1/8', expectedFrame: 6000, comparedFrames: 1000, maxFloatError: maxError };
      } else {
        const reference = await context.decodeAudioData(bytes(fixture.reference).buffer), expected = reference.getChannelData(0);
        observation.coldPrefixPeak = peak(data.subarray(lead, lead + 21600));
        observation.seams = [1, 2, 3, 4].map(cycle => { const center = lead + cycle * 24000; return { cycle, beforePeak: peak(data.subarray(center - 1200, center)), afterPeak: peak(data.subarray(center, center + 1200)) }; });
        let maxError = 0, changedFrames = 0;
        for (let frame = 0; frame < expected.length && frame + lead < data.length; frame++) { const error = Math.abs(data[frame + lead] - expected[frame]); maxError = Math.max(maxError, error); if (error) changedFrames++; }
        observation.continuousRenderComparison = { maxFloatError: maxError, changedFrames };
      }
      engine.stop(); return observation;
    }
    const observations = [];
    observations.push(await run('ring-final', fixtures.loop, 2.53));
    observations.push(await run('seek', fixtures.seek, .23, 240));
    observations.push(await run('seek-loop', fixtures.seekLoop, .23, 240));
    observations.push(await run('fractional-final', fixtures.fractional, .03 + 300 * 60 / 137));
    return { observations, offlineAudioContext: true, sampleRate: rate, userAgent: navigator.userAgent };
  }, { fixtures, rate });
  assert.deepEqual(rendererErrors, []);
  const [ringFinal, seekFinal, seekLoopFinal, fractionalFinal] = result.observations;
  assert.equal(ringFinal.trace[0].args[1], 0); assert.equal(ringFinal.trace[0].loopStart, .5); assert.equal(ringFinal.trace[0].loopEnd, 1);
  assert.equal(ringFinal.coldPrefixPeak, 0); assert.equal(ringFinal.continuousRenderComparison.maxFloatError, 0); assert.equal(ringFinal.continuousRenderComparison.changedFrames, 0);
  assert(ringFinal.seams.every(seam => seam.beforePeak > .001 && seam.afterPeak > .001));
  for (const value of [seekFinal, seekLoopFinal]) { assert.equal(value.trace[0].args[1], .125); assert(value.prefixTailPeak > .001); assert.equal(value.sameCycleSeekComparison.maxFloatError, 0); }
  assert.equal(fractionalFinal.onsets.length, 300); assert(fractionalFinal.onsets.every(onset => Math.abs(onset.errorFrames) <= 1));
  for (const value of result.observations) {
    const period = value.name === 'seek' ? 1 : value.name.startsWith('fractional') ? 60 / 137 : .5;
    const seekSeconds = value.name.startsWith('seek') ? .125 : 0;
    const expectedPhase = (value.contextTime - .03 + seekSeconds) % period;
    const expectedTick = expectedPhase * (value.name === 'seek' ? 1920 : 960) / period;
    assert(Math.abs(value.position.tick - expectedTick) < 1e-7, `${value.name}: transport phase differs from independently calculated fixture phase`);
  }
  for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(hash(await readFile(file)), expected, `Source changed during verification: ${file}`);
  const artifacts = {};
  for (const file of ['loop.wav', 'linear-reference.wav', 'seek.wav', 'fractional-loop.wav', 'fixtures.json', 'production.mjs', 'engine.js']) { const bytes = await readFile(path.join(root, file)); artifacts[file] = { path: path.relative(process.cwd(), path.join(root, file)).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) }; }
  const report = { schema: 1, status: 'passed', checkedAt: new Date().toISOString(), scope: 'Actual OfflineAudioContext with unmodified final production playRendered. Actual App loop cache/nativeRequest and production worker using verified original 1.14.4 DLL plus synthetic PCM; independent exact/rational fixture onset oracle. This is not game musical timing, hardware output, real-time UI, or packaged application acceptance.',
    sourceHashes, native: { version: '1.14.4', openal: nativeIdentity.openal, stb: nativeIdentity.stb, hrtf: 'controlled off / first-profile', outputLimiter: false, vorbisDecoderExercised: false }, nativeFrameRegression, artifacts,
    rendererErrors, ...result,
    fractionalPeriodObservation: { bpm: 137, cycles: 300, seconds: 300 * 60 / 137, maxPulsePeakErrorFrames: Math.max(...fractionalFinal.onsets.map(onset => Math.abs(onset.errorFrames))), firstErrorFrames: fractionalFinal.onsets[0].errorFrames, lastErrorFrames: fractionalFinal.onsets.at(-1).errorFrames, meaning: 'Bounded one-frame peak interpolation/loop resampling residual observed; not strict original-game PCM or evidence for arbitrary hardware duration.' },
    precisionNote: 'Native event.frame is tested exactly at the four previously failing BPM96/tick cases. The one-frame fractional Web Audio peak bound is a separate component observation, not an epsilon or relaxed game PCM threshold.',
    limitations: ['No actual integrated-world musical recording; original-class timeline evidence is separate.', 'OfflineAudioContext does not measure real-time timer starvation or sound-device latency.', 'The browser audio context is a fixture host; ensure() only returns that offline context. Actual playRendered implementation and source.start arguments are unmodified.', 'No mid-drag editor input, hardware MIDI or macOS test.'] };
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const rawReport = { path: path.relative(process.cwd(), path.join(root, 'report.json')).replaceAll('\\', '/'), sha256: hash(await readFile(path.join(root, 'report.json'))) };
  if (process.argv.includes('--write-evidence')) await writeFile('docs/evidence/native-preview-temporal.json', JSON.stringify({ ...report, rawReport }, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, report: path.join(root, 'report.json'), sha256: rawReport.sha256, writtenEvidence: process.argv.includes('--write-evidence') ? 'docs/evidence/native-preview-temporal.json' : undefined, nativeFrameRegression, fractionalPeriodObservation: report.fractionalPeriodObservation }, null, 2));
} finally { await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await desktop.close().catch(() => {}); }
