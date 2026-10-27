import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { fromArrayBuffer } from '@nbsjs/core';
import { parseMidi } from 'midi-file';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

// Run against an actual packaged application. Inputs are local test assets,
// deliberately excluded from Git and release packages. File pickers are the
// only mocked product boundary; controls, audio and files use the actual app.
const option = name => process.argv[process.argv.indexOf(name) + 1];
const commandKey = process.platform === 'darwin' ? 'Meta' : 'Control';
assert(process.argv.includes('--packaged'), 'Pass --packaged <executable> and optionally --assets <directory>.');
const executable = path.resolve(option('--packaged'));
const assets = path.resolve(process.argv.includes('--assets') ? option('--assets') : '.local/common-assets');
const base = path.resolve('.local/common-workflows'); await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, 'run-')), profile = path.join(root, 'profile');
const helper = path.join(root, 'helper.mjs');
await build({ stdin: { contents: "export {createDemo,flattenNotes,projectEnd}from'./src/core/project.ts';export {openNbsx}from'./src/core/container.ts';export {wavFromChannels}from'./src/audio/engine.ts';", resolveDir: process.cwd() }, outfile: helper, platform: 'node', format: 'esm', bundle: true });
const { createDemo, openNbsx, flattenNotes, wavFromChannels } = await import(pathToFileURL(helper).href);
const manifest = JSON.parse(await readFile(path.join(assets, 'manifest.json'), 'utf8'));
for (const file of manifest.files) assert.equal(createHash('sha256').update(await readFile(path.join(assets, file.file))).digest('hex'), file.sha256, 'Changed test asset: ' + file.file);
const mapping = { bass: 'dbass', basedrum: 'bdrum', snare: 'sdrum', hat: 'click', chime: 'icechime', xylophone: 'xylobone' };
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
const desktop = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env, timeout: 120000 });
let page; const errors = [], cases = [], audio = [], exports = [];
const report = { status: 'running', root, source: { repository: manifest.source, commit: manifest.commit, files: manifest.files }, cases, audio, exports, rendererErrors: errors,
  limitations: ['Audio measurements tap real Web Audio output before the physical device; no physical speaker/microphone or subjective listening acceptance.', 'Open/Save dialog return values are controlled local fixtures. Public music and samples are not redistributed in the app.'] };
const checkpoint = (name, details = {}) => { cases.push({ name, status: 'passed', ...details }); console.log(name); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const menu = async (group, label) => desktop.evaluate(({ Menu }, { group, label }) => {
  const item = Menu.getApplicationMenu().items.find(item => item.label === group)?.submenu?.items.find(item => item.label === label);
  if (!item?.enabled || typeof item.click !== 'function') throw new Error('Missing menu: ' + label); item.click();
}, { group, label });
const openFixture = async filename => {
  await desktop.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, filename);
  await menu('文件', '打开 / 导入…');
};
const save = async name => {
  const filename = path.join(root, name);
  await desktop.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, filename);
  await menu('文件', '另存为…');
  for (let i = 0; ; i++) { if (await stat(filename).then(() => true).catch(() => false)) break; assert(i < 600, 'Project save timed out'); await sleep(50); }
  await page.waitForFunction(() => !document.title.startsWith('● ') && document.querySelector('.status-message')?.textContent.includes('已保存'));
  return { filename, project: openNbsx(new Uint8Array(await readFile(filename))) };
};
const position = () => page.locator('[data-testid=transport-position]').textContent();
const play = async () => {
  const generation = await page.evaluate(() => window.__audioOutputGeneration ?? 0);
  await page.getByRole('button', { name: '播放', exact: true }).first().click(); await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  // A song may begin with a rest, and WAV export creates an OfflineAudioContext.
  // Wait for this playback's real output graph before attaching its observer.
  await page.waitForFunction(generation => window.__audioOutputGeneration > generation && window.__masterAudioOutput?.context instanceof AudioContext, generation);
};
const pause = async () => { await page.getByRole('button', { name: '暂停', exact: true }).click(); await page.getByRole('button', { name: '播放', exact: true }).first().waitFor(); };
const stop = async () => { await page.getByRole('button', { name: '停止并回到起点', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-testid=transport-position]').textContent === '1.1.00'); };
const setLoop = async enabled => {
  const button = page.getByRole('button', { name: '循环播放工程', exact: true });
  if (await button.getAttribute('aria-pressed') !== String(enabled)) await button.click();
  await page.waitForFunction(enabled => document.querySelector('button[aria-label="循环播放工程"]').getAttribute('aria-pressed') === String(enabled), enabled);
};
async function attachSound(id) {
  const selector = page.getByLabel('轨道默认音色', { exact: true });
  const before = await selector.inputValue();
  await selector.selectOption(id);
  const filename = path.join(assets, `${mapping[id] ?? id}.ogg`);
  await desktop.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, filename);
  await page.getByRole('button', { name: '定位 / 替换乐器采样…', exact: true }).click();
  await page.waitForFunction(name => document.querySelector('.status-message')?.textContent === '已载入 ' + name, path.basename(filename));
  await selector.selectOption(before);
}
async function capture(name, milliseconds, action) {
  await page.evaluate(() => window.__startAudioCapture());
  await sleep(milliseconds); if (action) await action();
  const captured = await page.evaluate(() => window.__stopAudioCapture());
  assert(captured.frames > 0, 'Audio observer received no frames');
  // Decode explicitly: pooled Buffers may have a nonzero byteOffset.
  const actual = captured.channels.map(data => { const bytes = Buffer.from(data, 'base64'); return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); });
  const filename = path.join(root, `${name}.wav`); await writeFile(filename, wavFromChannels(actual, captured.sampleRate));
  const stats = actual.map(samples => { let sum = 0, peak = 0, nonzero = 0; for (const value of samples) { sum += value * value; peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) > 1e-7) nonzero++; } return { rms: Math.sqrt(sum / samples.length), peak, nonzeroFrames: nonzero }; });
  const observation = { name, file: filename, frames: captured.frames, sampleRate: captured.sampleRate, seconds: captured.frames / captured.sampleRate, channels: stats };
  audio.push(observation); return observation;
}
const nbsCount = song => song.layers.all.reduce((sum, layer) => sum + Object.keys(layer.notes.all).length, 0);
async function exportFile(format, name) {
  const filename = path.join(root, name);
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '导出', exact: true }); await modal.waitFor();
  await modal.getByRole('button', { name: new RegExp('^' + format.toUpperCase()) }).click();
  if (format === 'wav') await modal.getByRole('checkbox', { name: '使用已加载版本的原生 OpenAL 离线混音' }).uncheck();
  await desktop.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, filename);
  await modal.getByRole('button', { name: '导出文件…', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.status-message')?.textContent.includes('已导出'), undefined, { timeout: 120000 });
  assert((await stat(filename)).size > 44);
  if (await modal.count()) await page.keyboard.press('Escape');
  exports.push({ format, filename, bytes: (await stat(filename)).size }); return filename;
}
try {
  page = await desktop.firstWindow(); page.setDefaultTimeout(60000); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const nativeConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...args) {
      const result = Reflect.apply(nativeConnect, this, args);
      if (args[0] instanceof AudioDestinationNode) { window.__masterAudioOutput = this; window.__audioOutputGeneration = (window.__audioOutputGeneration ?? 0) + 1; }
      return result;
    };
    window.__startAudioCapture = () => {
      const master = window.__masterAudioOutput; if (!master) throw new Error('No real output node observed');
      const context = master.context, processor = context.createScriptProcessor(4096, 2, 2), silent = context.createGain(); silent.gain.value = 0;
      const chunks = [[], []]; processor.onaudioprocess = event => { for (let ch = 0; ch < 2; ch++) chunks[ch].push(event.inputBuffer.getChannelData(ch).slice()); };
      Reflect.apply(nativeConnect, master, [processor]); Reflect.apply(nativeConnect, processor, [silent]); Reflect.apply(nativeConnect, silent, [context.destination]);
      window.__audioCapture = { master, context, processor, silent, chunks };
    };
    window.__stopAudioCapture = () => {
      const { master, context, processor, silent, chunks } = window.__audioCapture;
      try { master.disconnect(processor); } catch {} processor.disconnect(); silent.disconnect(); processor.onaudioprocess = null;
      const channels = chunks.map(parts => { const result = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const part of parts) { result.set(part, at); at += part.length; } const bytes = new Uint8Array(result.buffer); let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); });
      return { channels, sampleRate: context.sampleRate, frames: chunks[0].reduce((n, p) => n + p.length, 0) };
    };
  });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
  await page.locator('.piano-viewport canvas').waitFor();
  await page.waitForFunction(() => !document.querySelector('.resource-card strong')?.textContent.includes('正在查找'));
  report.runtime = await desktop.evaluate(({ app }) => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged }));
  assert(report.runtime.packaged); assert.equal(report.runtime.version, JSON.parse(await readFile('package.json', 'utf8')).version);
  assert((await page.title()).includes('玻璃庭院')); assert.equal(await page.locator('[data-testid=region]').count(), 4);
  checkpoint('built-in demo opens: four tracks and four regions');
  await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length === 20);
  await play(); const defaults = await capture('default-official-preview', 1200);
  assert(defaults.channels.every(ch => ch.rms > 1e-5)); await stop();
  checkpoint('official bundled samples play without a local game installation');
  for (const id of ['harp', 'bass', 'chime', 'hat']) await attachSound(id);
  const initial = await save('demo-with-local-sounds.nbsx');
  assert.equal(initial.project.assets.length, 4); assert.equal(initial.project.patterns.reduce((n, p) => n + p.notes.length, 0), 48);
  await menu('视图', '混音器'); await page.locator('.mixer-console').waitFor();
  await setLoop(true);
  await play();
  const heard = await capture('demo-preview', 3500); assert(heard.channels.every(ch => ch.rms > 1e-5));
  await page.waitForFunction(() => Number(document.querySelector('.mixer-master .mixer-meter')?.getAttribute('aria-valuenow')) > 0);
  await page.screenshot({ path: path.join(root, 'demo-playing.png') }); await pause();
  const paused = await position(); await sleep(300); assert.equal(await position(), paused);
  const quiet = await capture('paused-output', 650); assert(quiet.channels.every(ch => ch.peak < 1e-7));
  checkpoint('demo playback produces stereo PCM and a real master meter; pause holds position and stops audio', { audio: heard.channels, paused });
  await play(); await sleep(400); assert.notEqual(await position(), paused); await stop();
  await menu('播放', '下一小节'); await page.waitForFunction(() => document.querySelector('[data-testid=transport-position]').textContent === '2.1.00');
  await menu('播放', '上一小节'); await page.waitForFunction(() => document.querySelector('[data-testid=transport-position]').textContent === '1.1.00');
  await page.locator('.arrangement-ruler').click({ position: { x: 120, y: 10 } }); assert.notEqual(await position(), '1.1.00'); await stop();
  checkpoint('resume, stop, previous/next bar and pointer seek');
  const master = page.getByLabel('总输出音量百分比', { exact: true }); await master.fill('0'); await master.press('Enter');
  await play(); const muted = await capture('master-zero', 800); assert(muted.channels.every(ch => ch.peak < 1e-7)); await pause();
  await master.fill('70'); await master.press('Enter'); await stop();
  checkpoint('master zero gain is silent and restores to 70 percent');
  await play();
  const muteButtons = page.locator('.mixer-channel-buttons button[aria-label$=" 静音"]');
  for (const button of await muteButtons.all()) await button.click();
  await sleep(150); const allMuted = await capture('all-tracks-muted', 800); assert(allMuted.channels.every(ch => ch.peak < 1e-7));
  for (const button of await muteButtons.all()) await button.click();
  const restored = await capture('tracks-restored', 1000); assert(restored.channels.some(ch => ch.rms > 1e-5)); await stop();
  checkpoint('track mute applies immediately during playback and unmute restores audio');
  const bpm = page.getByLabel('当前位置速度 BPM', { exact: true }); await bpm.fill('480'); await bpm.press('Tab');
  await setLoop(true); await play();
  const positions = [];
  for (let i = 0; i < 30; i++) { positions.push(await position()); await sleep(100); }
  const numeric = text => text.split('.').reduce((n, v) => n * 1000 + Number(v), 0);
  assert(positions.some((value, i) => i && numeric(value) < numeric(positions[i - 1])), 'Loop did not wrap');
  await stop(); await setLoop(false); await bpm.fill('108'); await bpm.press('Tab');
  checkpoint('tempo change and actual end-to-start loop wrap', { positions });
  await page.locator('.piano-viewport canvas').focus(); await page.keyboard.press(`${commandKey}+a`);
  const beforeEdit = await save('demo-edit-baseline.nbsx'); await page.keyboard.press(`${commandKey}+b`);
  await page.waitForFunction(() => document.title.startsWith('● '));
  const duplicated = await save('demo-duplicated.nbsx');
  const changed = duplicated.project.patterns.filter(pattern => pattern.notes.length !== beforeEdit.project.patterns.find(before => before.id === pattern.id)?.notes.length);
  assert.equal(changed.length, 1); assert.equal(changed[0].notes.length, beforeEdit.project.patterns.find(pattern => pattern.id === changed[0].id).notes.length * 2);
  await page.locator('.piano-viewport canvas').focus(); await page.keyboard.press(`${commandKey}+z`);
  const undone = await save('demo-undone.nbsx'); assert.deepEqual(undone.project.patterns, beforeEdit.project.patterns);
  await menu('编辑', '重做'); const redone = await save('demo-redone.nbsx'); assert.deepEqual(redone.project.patterns, duplicated.project.patterns);
  await menu('编辑', '撤销'); await save('demo-final.nbsx');
  checkpoint('note duplicate, undo and redo preserve the saved project');
  const exportedWav = await exportFile('wav', 'demo-export.wav');
  const wave = await readFile(exportedWav); assert.equal(wave.toString('ascii', 0, 4), 'RIFF'); let peak = 0; for (let at = 44; at < wave.length; at += 2) peak = Math.max(peak, Math.abs(wave.readInt16LE(at))); assert(peak > 10);
  checkpoint('Web Audio WAV export contains real nonzero PCM', { bytes: wave.length, peak });
  await openFixture(path.join(assets, 'Turkish March.nbs'));
  await page.waitForFunction(() => document.title.includes('Turkish March'));
  const imported = await save('turkish-imported.nbsx');
  const independent = fromArrayBuffer(Uint8Array.from(await readFile(path.join(assets, 'Turkish March.nbs'))).buffer);
  const sourceNotes = nbsCount(independent); assert.equal(sourceNotes, 5838); assert.equal(imported.project.tracks.length, 39); assert.equal(imported.project.patterns.reduce((n, p) => n + p.notes.length, 0), sourceNotes);
  const used = [...new Set(flattenNotes(imported.project, true).map(note => note.effectiveInstrument))];
  for (const id of used) await attachSound(id);
  const portable = await save('turkish-with-local-sounds.nbsx');
  await stop(); await play(); const publicAudio = await capture('turkish-preview', 4500); assert(publicAudio.channels.some(ch => ch.rms > 1e-5)); await stop();
  await page.screenshot({ path: path.join(root, 'turkish-imported.png') });
  checkpoint('official NBS example imports and previews: 39 tracks, 5838 notes', { sourceNotes, used, author: independent.author });
  const nbs = await exportFile('nbs', 'turkish-export.nbs');
  const checkedNbs = fromArrayBuffer(Uint8Array.from(await readFile(nbs)).buffer); assert.equal(nbsCount(checkedNbs), sourceNotes);
  const mid = await exportFile('mid', 'turkish-export.mid');
  const midi = parseMidi(await readFile(mid));
  const order = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const expectedMidi = independent.layers.all.flatMap(layer => Object.entries(layer.notes.all).filter(([, note]) => note.velocity > 0).map(([tick, note]) => [Number(tick) * midi.header.ticksPerBeat / 4, note.key + 21, Math.max(1, Math.round(note.velocity * 127 / 100))])).sort(order);
  const actualMidi = midi.tracks.flatMap(track => { let tick = 0; const notes = []; for (const event of track) { tick += event.deltaTime; if (event.type === 'noteOn' && event.velocity > 0) notes.push([tick, event.noteNumber, event.velocity]); } return notes; }).sort(order);
  assert.equal(expectedMidi.length, 5304); assert.deepEqual(actualMidi, expectedMidi);
  report.midiConversion = { sourceNbsNotes: sourceNotes, zeroVelocityNotesPreservedInNbsx: sourceNotes - expectedMidi.length, positiveVelocityMidiNotes: actualMidi.length, onsetPitchVelocityMatchIndependentNbsReader: true };
  await openFixture(nbs); await page.waitForFunction(() => document.title.startsWith('● Turkish March'));
  const nbsRoundtrip = await save('turkish-nbs-roundtrip.nbsx'); assert.equal(nbsRoundtrip.project.patterns.reduce((n, p) => n + p.notes.length, 0), sourceNotes);
  await openFixture(portable.filename); await page.waitForFunction(() => !document.title.startsWith('● ') && document.title.includes('Turkish March'));
  const reopened = await save('turkish-reopened.nbsx'); const normalize = value => { const next = structuredClone(value); delete next.modifiedAt; return next; }; assert.deepEqual(normalize(reopened.project), normalize(portable.project));
  await play(); const reopenAudio = await capture('turkish-reopened-preview', 1200); assert(reopenAudio.channels.some(ch => ch.rms > 1e-5)); await stop();
  checkpoint('NBS retains all 5838 notes; MIDI matches 5304 audible notes, excluding 534 zero-velocity notes by MIDI rules; NBSX reopens with sounds');
  assert.deepEqual(errors, []); report.status = 'passed';
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, root, checks: cases.length, audioCaptures: audio.length, exports: exports.length }));
} catch (error) {
  report.status = 'failed'; report.error = String(error); report.message = await page?.locator('.status-message').textContent().catch(() => '');
  await page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.error(JSON.stringify({ status: 'failed', root, error: String(error), message: report.message })); throw error;
} finally {
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await desktop.close().catch(() => {});
}
