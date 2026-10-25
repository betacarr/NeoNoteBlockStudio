import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const packaged = process.argv.includes('--packaged') ? path.resolve(process.argv[process.argv.indexOf('--packaged') + 1]) : undefined;
if (packaged && /portable\.exe$/i.test(packaged)) throw new Error('Use scripts/smoke-portable.mjs for the SFX portable launcher; its child does not forward inspector stderr.');
const base = path.resolve('.local/desktop-smoke'); await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, 'run-')), profile = path.join(root, 'profile'), helper = path.join(root, 'smoke-helper.mjs');
await mkdir(profile);
await build({ stdin: { contents: "export { createDemo } from './src/core/project.ts'; export { saveNbsx, openNbsx } from './src/core/container.ts';", resolveDir: process.cwd(), sourcefile: 'smoke-helper.ts' }, outfile: helper, bundle: true, platform: 'node', format: 'esm' });
const { createDemo, saveNbsx, openNbsx } = await import(pathToFileURL(helper).href);
const fixture = saveNbsx(createDemo());
const target = path.join(root, 'desktop-roundtrip.nbsx');
const launchEnvironment = { ...process.env, NBSX_TEST_USER_DATA: profile };
if (!packaged) launchEnvironment.NBSX_DEV_URL = 'http://127.0.0.1:5173/'; else delete launchEnvironment.NBSX_DEV_URL;
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ ...(packaged ? { executablePath: packaged } : {}), args: [...(packaged ? [] : ['.']), '--mute-audio', `--user-data-dir=${profile}`], env: launchEnvironment });
const errors = [];
const report = { status: 'running', packaged: !!packaged, profile, root, nodePid: process.pid, rendererErrors: errors, startedAt: new Date().toISOString() };
try {
  const page = await desktop.firstWindow();
  assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
  assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), !!packaged);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length >= 16, { timeout: 45000 });
  assert.equal(await page.title(), '玻璃庭院 — NeoNBS');
  report.initialTitle = await page.title();
  await desktop.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, target);
  const saved = await page.evaluate(async ({ bytes }) => await window.desktop.saveFile('desktop-roundtrip.nbsx', new Uint8Array(bytes)), { bytes: [...fixture] });
  assert.equal(saved, target);
  const roundTrip = openNbsx(new Uint8Array(await readFile(target)));
  assert.equal(roundTrip.name, '玻璃庭院'); assert.equal(roundTrip.tracks.length, 4);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'play'));
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.position strong').textContent.includes('1.1.00'));
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'play'));
  await page.getByRole('button', { name: '播放', exact: true }).first().waitFor();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'duplicate'));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=region]').length === 5);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'undo'));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=region]').length === 4);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  await page.waitForFunction(() => document.querySelector('.status-message').textContent.includes('已保存'));
  const portable = openNbsx(new Uint8Array(await readFile(target)));
  assert.equal(portable.assets.filter(a => a.data).length, 4);
  const result = await page.evaluate(async () => {
    const roots = await window.desktop.discoverMinecraft();
    const best = roots.find(r => r.versions.includes('1.16.5') && r.indexes.includes('1.16.json'));
    if (!best) throw new Error('No complete 1.16.5 fixture available');
    const library = await window.desktop.loadMinecraft(best.root, '1.16.json', '1.16.5');
    if (!library.samples.harp.name.endsWith('/harp2.ogg') || !library.samples.bass.name.endsWith('/bassattack.ogg')) throw new Error('Wrong game sound-event samples');
    if (!library.nativeLibrary) throw new Error('No native OpenAL library found');
    const context = new AudioContext({ sampleRate: 48000 });
    const sample = await context.decodeAudioData(new Uint8Array(library.samples.harp.bytes).buffer);
    const decoded = { id: 'harp', sampleRate: sample.sampleRate, channels: sample.numberOfChannels, data: Array.from({ length: sample.numberOfChannels }, (_, ch) => sample.getChannelData(ch).slice()) };
    const result = await window.desktop.renderNative({ nativeLibrary: library.nativeLibrary, nativeDecoder: library.nativeDecoder, encodedSamples: [{ id: 'harp', bytes: library.samples.harp.bytes }], sampleRate: 48000, directional: false,
      samples: [decoded], duration: sample.duration + .2,
      events: [{ time: 0, instrument: 'harp', pitch: 1, gain: .7, x: 2, y: 0, z: -2, maxDistance: 48 }] });
    await context.close();
    return { backend: result.backend, warnings: result.warnings, wav: [...result.wav] };
  });
  assert(result.wav.length > 10000);
  const wav = Uint8Array.from(result.wav), pcm = new DataView(wav.buffer); let left = 0, right = 0;
  for (let at = 44; at + 3 < wav.length; at += 4) { left += pcm.getInt16(at, true) ** 2; right += pcm.getInt16(at + 2, true) ** 2; }
  assert(right > left, 'Rightward source must have greater right-channel energy');
  for (const version of ['1.7.10', '1.8', '1.13', '1.20.5', '26.3']) {
    const root = path.resolve('.local/game-fixtures', version);
    if (!await stat(path.join(root, 'fixture.json')).then(() => true).catch(() => false)) continue;
    await desktop.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.evaluate(async () => await window.desktop.selectMinecraftRoot());
  }
  const otherVersions = await page.evaluate(async () => {
    const roots = await window.desktop.discoverMinecraft(), results = [];
    for (const [version, index] of [['1.7.10', '1.7.10.json'], ['1.8', '1.8.json'], ['1.12.2', '1.12.json'], ['1.13', '1.13.json'], ['1.19.2', '1.19.json'], ['1.20.5', '16.json'], ['26.3', '34.json']]) {
      const root = roots.find(r => r.indexes.includes(index) && r.versions.some(v => v === version || v.startsWith(version + '-')));
      if (!root) { results.push({ version, status: 'fixture-unavailable' }); continue; }
      const instance = root.versions.find(v => v === version) ?? root.versions.find(v => v.startsWith(version + '-'));
      try {
        const library = await window.desktop.loadMinecraft(root.root, index, instance);
        const request = { nativeLibrary: library.nativeLibrary, nativeDecoder: library.nativeDecoder, javaDecoder: library.javaDecoder, attenuationModel: library.attenuationModel, encodedSamples: [{ id: 'harp', bytes: library.samples.harp.bytes }], samples: [], sampleRate: 48000, duration: 2, directional: false,
          events: [{ time: 0, instrument: 'harp', pitch: 1, gain: .7, x: 0, y: 0, z: -2, maxDistance: 48 }] };
        const output = await window.desktop.renderNative(request);
        if (output.directional !== false) throw new Error('Non-HRTF request was not applied');
        let directional;
        try { const result = await window.desktop.renderNative({ ...request, directional: true }); directional = result.directional === true ? 'enabled' : 'not-applied'; }
        catch (error) { if (['1.7.10', '1.8', '1.12.2'].includes(version) && String(error).includes('不支持 HRTF')) directional = 'unsupported-explicit-error'; else throw error; }
        if (directional === 'not-applied') throw new Error('HRTF request was silently ignored');
        const pcm = new DataView(output.wav.buffer, output.wav.byteOffset, output.wav.byteLength); let energy = 0; for (let at = 44; at + 1 < output.wav.length; at += 2) energy += pcm.getInt16(at, true) ** 2;
        if (energy <= 0) throw new Error('Rendered silence');
        results.push({ version, status: 'passed', backend: output.backend, decoder: library.decoderKind, directional, warnings: output.warnings });
      } catch (error) { results.push({ version, status: 'failed', error: String(error) }); }
    }
    return results;
  });
  console.log(JSON.stringify({ additionalVersionSmoke: otherVersions }));
  assert(otherVersions.every(v => v.status !== 'failed'), 'An available version failed native render');
  await writeFile(path.join(root, 'native-harp-right.wav'), wav);
  await page.screenshot({ path: path.join(root, 'first-view.png') });
  assert.deepEqual(errors, []);
  Object.assign(report, { status: 'passed', desktop: 'passed', packaged: !!packaged, savedProject: target, tracks: roundTrip.tracks.length, portableSamples: portable.assets.filter(a => a.data).length, realtimeMenuPlayback: 'passed', nativeRenderIPC: 'passed', independentRegionCopyAndUndo: 'passed', loadedSamples: await page.locator('.sample-dot.loaded').count(), backend: result.backend, decoder: result.warnings, rightToLeftEnergy: right / left, rendererErrors: errors, note: 'Default menu Play/Pause exercises realtime Web Audio independently of the explicit native render IPC/WAV checks. Native export rendering is separate from realtime menu playback; neither is in-game recording validation.' });
  console.log(JSON.stringify({ ...report, report: path.join(root, 'report.json') }));
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error); throw error;
} finally {
  await desktop.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
  await desktop.close();
  report.finishedAt = new Date().toISOString(); await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
}
