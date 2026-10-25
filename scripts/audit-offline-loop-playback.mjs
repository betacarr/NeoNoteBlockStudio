import { _electron as electron } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build, transformSync } from 'esbuild';

// Real OfflineAudioContext in a separate hidden Electron component window.
// No application UI, synthesized input or production-source edits.
const index = process.argv.indexOf('--native-run');
assert(index >= 0 && process.argv[index + 1], 'Pass --native-run <audit-native-onset-timing run directory>.');
const nativeRoot = path.resolve(process.argv[index + 1]), root = path.resolve('.local/offline-loop-playback', `run-${Date.now()}`);
await mkdir(root, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const nativeReportBytes = await readFile(path.join(nativeRoot, 'report.json')), nativeReport = JSON.parse(nativeReportBytes);
for (const file of ['src/ui/App.tsx', 'src/audio/engine.ts', 'electron/audio-worker.ts']) assert.equal(hash(await readFile(file)), nativeReport.sources[file]);
const production = await import(pathToFileURL(path.join(nativeRoot, 'production.mjs')).href);
const engineSource = (await readFile('src/audio/engine.ts', 'utf8')).replaceAll('\r\n', '\n');
const from = engineSource.indexOf('  async playRendered('), to = engineSource.indexOf('  async nativeRequest(', from);
assert(from >= 0 && to > from);
const originalMethod = engineSource.slice(from, to), needle = 'source.start(start, (source.loop ? source.loopStart : 0) + from)';
assert.equal(originalMethod.split(needle).length, 2);
const candidateMethod = originalMethod.replace(needle, 'source.start(start, from)').replace('async playRendered(', 'async function playRendered(');
const candidateCode = transformSync(candidateMethod, { loader: 'ts', target: 'es2022' }).code;
await writeFile(path.join(root, 'candidate-playRendered.js'), candidateCode);
await build({ stdin: { contents: "export {AudioEngine} from './src/audio/engine'; export {createTempoMap} from './src/core/time'; export {playbackEndTick} from './src/core/reference';", resolveDir: process.cwd(), loader: 'ts' }, platform: 'browser', format: 'iife', globalName: 'TemporalProbe', bundle: true, outfile: path.join(root, 'engine.js') });
const fixture = JSON.parse(await readFile('.local/game-fixtures/1.14.4/fixture.json', 'utf8'));
const nativeLibrary = path.join(fixture.nativeDir, 'OpenAL.dll'), nativeDecoder = path.join(fixture.nativeDir, 'lwjgl_stb.dll');
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
  const scope = { playing: false, busy: false, loop: true, stop() {}, setBusy() {}, setMessage() {}, setPlaying() {}, stopEpoch: { current: 0 }, projectRef: { current: value }, positionRef: { current: 0 }, revision: 0, renderCache: { current: undefined }, library, engine,
    playbackEndTick: production.playbackEndTick, tickToSeconds: production.tickToSeconds, previewBackendForProject: production.previewBackendForProject, audioProfile: production.audioProfile, PROFILE_STATUS: {}, window: { desktop: { renderNative: async request => production.render(request) } } };
  await Function(...Object.keys(scope), `${appCode}\nreturn togglePlay(true);`)(...Object.values(scope));
  return scope.renderCache.current;
}
const ring = Float32Array.from({ length: rate * .3 }, (_, frame) => .3 * Math.cos(2 * Math.PI * 220 * frame / rate));
const loopProject = project('cold prefix / cross-cycle tail', 864, 120, 960), loop = await loopFixture(loopProject, ring);
const referenceRequest = baseRequest(ring); referenceRequest.duration = 2.5; referenceRequest.events = Array.from({ length: 5 }, (_, cycle) => ({ time: .45 + cycle * .5, instrument: 'temporal-fixture', pitch: 1, gain: .6, x: 0, y: 0, z: -2, maxDistance: 1e9 }));
const linearReference = production.render(referenceRequest).wav;
const seekProject = project('mid-note seek tail', 0, 120, 1920), seekRequest = baseRequest(ring); seekRequest.duration = 1.15; seekRequest.events = [{ ...referenceRequest.events[0], time: 0 }];
const seekWav = production.render(seekRequest).wav;
const seekLoopProject = project('mid-note seek in a loop', 0, 120, 960), seekLoop = await loopFixture(seekLoopProject, ring);
const pulse = new Float32Array(32); pulse[0] = .5;
const fractionalProject = project('137BPM fractional frame period', 768, 137, 960), fractional = await loopFixture(fractionalProject, pulse);
const b64 = bytes => Buffer.from(bytes).toString('base64');
const fixtures = { loop: { project: loopProject, wav: b64(loop.wav), loopStart: loop.loopStart, loopEnd: loop.loopEnd, reference: b64(linearReference) }, seek: { project: seekProject, wav: b64(seekWav) }, seekLoop: { project: seekLoopProject, wav: b64(seekLoop.wav), loopStart: seekLoop.loopStart, loopEnd: seekLoop.loopEnd }, fractional: { project: fractionalProject, wav: b64(fractional.wav), loopStart: fractional.loopStart, loopEnd: fractional.loopEnd } };
for (const [name, bytes] of [['loop.wav', loop.wav], ['linear-reference.wav', linearReference], ['seek.wav', seekWav], ['fractional-loop.wav', fractional.wav]]) await writeFile(path.join(root, name), bytes);
await writeFile(path.join(root, 'fixtures.json'), JSON.stringify({ fixtures, candidateCode }));
await writeFile(path.join(root, 'index.html'), '<!doctype html><meta charset="utf-8"><script src="engine.js"></script><body>Independent offline temporal component</body>');
await writeFile(path.join(root, 'main.cjs'), `const{app,BrowserWindow}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});await w.loadFile(path.join(__dirname,'index.html'));});app.on('window-all-closed',()=>app.quit());`);
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE; delete environment.NBSX_DEV_URL;
const desktop = await electron.launch({ args: [path.join(root, 'main.cjs'), '--mute-audio'], env: environment });
const rendererErrors = [];
try {
  const page = await desktop.firstWindow(); page.on('pageerror', error => rendererErrors.push(error.message));
  const result = await page.evaluate(async ({ fixtures, candidateCode, rate }) => {
    const { AudioEngine, createTempoMap, playbackEndTick } = window.TemporalProbe;
    const bytes = text => Uint8Array.from(atob(text), character => character.charCodeAt(0));
    const peak = data => data.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
    const candidate = Function('createTempoMap', 'playbackEndTick', `${candidateCode};return playRendered;`)(createTempoMap, playbackEndTick);
    async function run(name, fixture, duration, cold, fromTick = 0) {
      const context = new OfflineAudioContext(2, Math.round(duration * rate), rate), engine = new AudioEngine(), trace = [];
      engine.context = context; engine.ensure = async () => context;
      if (cold) engine.playRendered = candidate;
      const create = context.createBufferSource.bind(context);
      context.createBufferSource = () => { const source = create(), start = source.start.bind(source); source.start = (...args) => { trace.push({ args, loopStart: source.loopStart, loopEnd: source.loopEnd, loop: source.loop }); return start(...args); }; return source; };
      await engine.playRendered(fixture.project, bytes(fixture.wav), fromTick, fixture.loopStart, fixture.loopEnd);
      const rendered = await context.startRendering(), data = rendered.getChannelData(0), position = engine.position();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
      const observation = { name, variant: cold ? 'one-line cold-prefix candidate, product unchanged' : 'actual production method', frames: data.length, trace, position, floatChannelSha256: hash };
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
    observations.push(await run('ring-current', fixtures.loop, 2.53, false));
    observations.push(await run('ring-cold-candidate', fixtures.loop, 2.53, true));
    observations.push(await run('seek', fixtures.seek, .23, true, 240));
    observations.push(await run('seek-loop', fixtures.seekLoop, .23, true, 240));
    observations.push(await run('fractional-current', fixtures.fractional, .03 + 300 * 60 / 137, false));
    observations.push(await run('fractional-cold-candidate', fixtures.fractional, .03 + 300 * 60 / 137, true));
    return { observations, offlineAudioContext: true, sampleRate: rate, userAgent: navigator.userAgent };
  }, { fixtures, candidateCode, rate });
  assert.deepEqual(rendererErrors, []);
  const report = { schema: 1, checkedAt: new Date().toISOString(), scope: 'Actual OfflineAudioContext, unmodified production playRendered baseline and a one-line in-memory candidate. App loop cache and PCM rendered by actual production worker with verified original 1.14.4 DLL; independent rational onset oracle. No actual game, UI input, hardware output or product edits.',
    sourceHashes: { ...nativeReport.sources, 'scripts/audit-offline-loop-playback.mjs': hash(await readFile('scripts/audit-offline-loop-playback.mjs')) }, nativeRun: { path: path.join(nativeRoot, 'report.json'), sha256: hash(nativeReportBytes) }, candidate: { onlyChange: `${needle} -> source.start(start, from)`, sha256: hash(candidateCode) }, rendererErrors, ...result };
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ root, report: path.join(root, 'report.json'), sha256: hash(await readFile(path.join(root, 'report.json'))), observations: result.observations.map(({ onsets, ...item }) => ({ ...item, ...(onsets ? { onsetCount: onsets.length, first: onsets.slice(0, 3), last: onsets.slice(-3), maxErrorFrames: Math.max(...onsets.map(value => Math.abs(value.errorFrames))) } : {}) })) }, null, 2));
} finally { await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await desktop.close().catch(() => {}); }
