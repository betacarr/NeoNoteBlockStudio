import { _electron as electron } from 'playwright';
import { createServer } from 'vite';
import { build } from 'esbuild';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Real application menu IPC and real Web Audio nodes. No synthetic DOM, keyboard,
// MIDI or mouse input. The computer-keyboard recording flow is checked via CUA.
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const executable = option('--packaged');
if (process.argv.includes('--packaged')) assert(executable && !executable.startsWith('--'), '--packaged requires an unpacked executable path');
const packaged = executable ? path.resolve(executable) : undefined;
if (packaged) {
  assert(!/(?:portable|setup)\.exe$/i.test(packaged), 'Use an unpacked executable, not an installer');
  assert((await stat(path.join(path.dirname(packaged), 'resources/app.asar'))).isFile(), 'Expected an unpacked Electron application');
}
const root = path.resolve('.local/reference-desktop', `run-${Date.now()}`), profile = path.join(root, 'profile');
await mkdir(root, { recursive: true });
await build({ stdin: { contents: "export {createProject,newNote} from './src/core/project'; export {saveNbsx,bytesToBase64} from './src/core/container'; export {wavFromChannels} from './src/audio/engine';", resolveDir: process.cwd(), sourcefile: 'reference-fixture.ts' }, outfile: path.join(root, 'helper.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { createProject, newNote, saveNbsx, bytesToBase64, wavFromChannels } = await import(pathToFileURL(path.join(root, 'helper.mjs')).href);
const p = createProject('参考轨道输送验收'), rate = 48000, silent = new Float32Array(rate * 4), pulse = new Float32Array(rate * 4);
for (let frame = 0; frame < pulse.length; frame++) if (frame % rate < 2400) pulse[frame] = .5 * Math.sin(frame * Math.PI * 880 / rate);
p.audio.previewEngine = 'web'; p.audio.mode = 'studio';
p.tempos = [{ tick: 0, bpm: 120 }, { tick: 1920, bpm: 60 }]; p.timeSignatures.push({ tick: 1920, numerator: 3, denominator: 4 });
p.patterns[0].notes = [newNote(480, 60, 240)]; p.instruments.find(i => i.id === 'harp').assetId = 'sample';
p.assets.push({ id: 'sample', name: 'pulse.wav', mime: 'audio/wav', data: bytesToBase64(wavFromChannels([pulse.subarray(0, 4800)], rate)) }, { id: 'reference', name: 'right-pulses.wav', mime: 'audio/wav', data: bytesToBase64(wavFromChannels([silent, pulse], rate)) });
p.reference = { assetId: 'reference', startTick: 960, gain: .7 };
const bytes = saveNbsx(p), filename = path.join(root, 'workflow.nbsx'); await writeFile(filename, bytes);
const server = packaged ? undefined : await createServer({ server: { host: '127.0.0.1', port: 0 }, clearScreen: false }); await server?.listen();
const env = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
if (server) env.NBSX_DEV_URL = server.resolvedUrls.local[0]; else delete env.NBSX_DEV_URL;
const app = await electron.launch({ ...(packaged ? { executablePath: packaged } : {}), args: [...(packaged ? [] : ['.']), '--mute-audio', `--user-data-dir=${profile}`], env });
const errors = [];
try {
  const application = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, profile: app.getPath('userData') }));
  assert.equal(application.profile, profile); assert.equal(application.packaged, !!packaged);
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__referenceTrace = [];
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function (...args) {
      const source = original.apply(this, args), start = source.start, stop = source.stop, context = this;
      source.start = function (...values) { window.__referenceTrace.push({ action: 'start', values, bufferDuration: this.buffer?.duration, contextTime: context.currentTime }); return start.apply(this, values); };
      source.stop = function (...values) { window.__referenceTrace.push({ action: 'stop', values, bufferDuration: this.buffer?.duration, contextTime: context.currentTime }); return stop.apply(this, values); };
      return source;
    };
  });
  await app.evaluate(({ BrowserWindow }) => new Promise(resolve => { const contents = BrowserWindow.getAllWindows()[0].webContents; contents.once('did-finish-load', () => resolve(true)); contents.reload(); }));
  await page.locator('[aria-label="绘制音符"]').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length >= 16);
  await app.evaluate(({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].webContents.send('file:open-request', { ...file, bytes: Uint8Array.from(file.bytes) }), { name: 'workflow.nbsx', path: filename, bytes: Array.from(bytes) });
  await page.locator('[data-testid="reference-clip"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="reference-clip"]').textContent.includes('4.0 秒'));
  assert.equal(await page.locator('audio').count(), 0);
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu', name), name);
  const starts = () => page.evaluate(() => window.__referenceTrace.filter(event => event.action === 'start'));
  const refs = () => page.evaluate(() => window.__referenceTrace.filter(event => event.action === 'start' && event.bufferDuration === 4));
  await command('play'); await page.locator('button[aria-label="暂停"]').waitFor();
  await page.waitForFunction(() => window.__referenceTrace.filter(event => event.action === 'start').length >= 2);
  const initial = await starts(), first = initial.find(event => event.bufferDuration === 4), note = initial.find(event => event.bufferDuration === .1);
  assert(first && note); assert(Math.abs(first.values[0] - note.values[0] - .25) < 1e-6);
  assert.deepEqual(first.values.slice(1), [0, 4]);
  await command('play'); await page.locator('button[aria-label="播放"]').waitFor();
  const paused = await page.locator('[data-testid="transport-position"]').textContent();
  await page.waitForTimeout(150); assert.equal(await page.locator('[data-testid="transport-position"]').textContent(), paused);
  await command('next-bar'); await command('play'); await page.locator('button[aria-label="暂停"]').waitFor();
  const seek = (await refs()).at(-1); assert.deepEqual(seek.values.slice(1), [.5, 3.5]);
  await command('stop'); await command('loop'); await command('play'); await page.locator('button[aria-label="暂停"]').waitFor();
  await page.waitForFunction(() => window.__referenceTrace.filter(event => event.action === 'start' && event.bufferDuration === 4).length >= 4, null, { timeout: 7500 });
  const loops = (await refs()).slice(-2); assert(Math.abs(loops[1].values[0] - loops[0].values[0] - 4.5) < 1e-6);
  assert.deepEqual(loops.map(event => event.values.slice(1)), [[0, 4], [0, 4]]);
  await command('stop'); await page.locator('button[aria-label="播放"]').waitFor();
  const count = (await starts()).length; await page.waitForTimeout(200); assert.equal((await starts()).length, count);
  assert.equal(await page.locator('[data-testid="transport-position"]').textContent(), '1.1.00');
  assert.deepEqual(errors, []);
  const report = { root, profile, executable: packaged ?? 'development Electron', application, fixture: filename, synthesizedInput: false, observerChangesAudioArguments: false, preview: 'real Web Audio', independentAudioControls: false, stereoReferenceDuration: 4, tempoMap: p.tempos, meterMap: p.timeSignatures, initialReference: first, initialNote: note, pausedPosition: paused, seekReference: seek, loopPeriod: 4.5, loopReferences: loops, stopsPreventFutureStarts: true, trace: await page.evaluate(() => window.__referenceTrace), rendererErrors: errors, limitations: ['Hardware MIDI and acoustic output were not measured; recording interaction is checked separately through CUA. Native PCM is validated separately by the project audio comparison suite.'] };
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ root, passed: true, referencePeriodSeconds: 4.5, rendererErrors: errors }));
} catch (error) {
  const page = await app.firstWindow().catch(() => undefined);
  await writeFile(path.join(root, 'failure.json'), JSON.stringify({ error: String(error), rendererErrors: errors, body: await page?.locator('body').textContent().catch(() => undefined) }, null, 2));
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close().catch(() => {}); await server?.close();
}
