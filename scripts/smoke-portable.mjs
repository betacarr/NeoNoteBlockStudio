import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
const flag = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const attaching = !!flag('--node-port');
const freePort = () => new Promise((resolve, reject) => { const server = net.createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const nodePort = Number(flag('--node-port') ?? await freePort()), browserPort = Number(flag('--browser-port') ?? await freePort());
const version = JSON.parse(await readFile('package.json')).version;
const executable = path.resolve(flag('--exe') ?? `release/${version}/EX-NoteBlock-Studio-${version}-x64-portable.exe`);
const profile = path.resolve('.local/portable-test-profile'); await mkdir(profile, { recursive: true });
let processHandle;
if (!attaching) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
  processHandle = spawn(executable, [`--inspect=${nodePort}`, `--remote-debugging-port=${browserPort}`, '--mute-audio', `--user-data-dir=${profile}`], { env, windowsHide: true, stdio: 'ignore' });
}
async function discover(port, type) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { const list = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) }).then(r => r.json()); const item = list.find(item => item.type === type); if (item) return item; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Portable debug endpoint ${type} did not become ready`);
}
const node = await discover(nodePort, 'node'), socket = new WebSocket(node.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let sequence = 0; const pending = new Map();
socket.addEventListener('message', event => { const message = JSON.parse(String(event.data)); if (!message.id) return; const request = pending.get(message.id); if (!request) return; pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result); });
socket.addEventListener('close', () => { for (const request of pending.values()) request.reject(new Error('Portable main process connection closed')); pending.clear(); });
const evaluateMain = expression => new Promise((resolve, reject) => {
  const id = ++sequence, timeout = setTimeout(() => { pending.delete(id); reject(new Error('Portable main process request timed out')); }, 15000);
  pending.set(id, { resolve: response => { clearTimeout(timeout); response.exceptionDetails ? reject(new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)) : resolve(response.result.value); }, reject: error => { clearTimeout(timeout); reject(error); } });
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(function(require){return (${expression});})(process.mainModule.require.bind(process.mainModule))`, awaitPromise: true, returnByValue: true } }));
});
await discover(browserPort, 'page');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${browserPort}`), page = browser.contexts()[0].pages().find(p => p.url().startsWith('nbsx://app/'));
assert(page, 'Portable process did not load its packaged renderer');
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  const runtime = await evaluateMain(`({packaged:require('electron').app.isPackaged,userData:require('electron').app.getPath('userData'),appPath:require('electron').app.getAppPath()})`);
  assert(runtime.packaged); assert.equal(path.resolve(runtime.userData), profile); assert(runtime.appPath.includes('app.asar'));
  console.log(JSON.stringify({ stage: 'portable-main-connected' }));
  await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length >= 16);
  console.log(JSON.stringify({ stage: 'portable-samples-loaded' }));
  const command = name => evaluateMain(`require('electron').BrowserWindow.getAllWindows()[0].webContents.send('menu',${JSON.stringify(name)})`);
  await command('duplicate'); await page.waitForFunction(() => document.querySelectorAll('[data-testid=region]').length === 5);
  await command('undo'); await page.waitForFunction(() => document.querySelectorAll('[data-testid=region]').length === 4);
  const target = path.resolve('.local/portable-roundtrip.nbsx');
  await evaluateMain(`require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(target)}})`);
  await command('save'); await page.waitForFunction(() => document.querySelector('.status-message').textContent.includes('已保存'));
  assert((await readFile(target)).length > 1000);
  const fixtureRoot = path.resolve('.local/game-fixtures/1.20.5');
  await evaluateMain(`require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(fixtureRoot)}]})`);
  const native = await page.evaluate(async () => {
    const root = await window.desktop.selectMinecraftRoot(), library = await window.desktop.loadMinecraft(root.root, '16.json', '1.20.5');
    const result = await window.desktop.renderNative({ nativeLibrary: library.nativeLibrary, javaDecoder: library.javaDecoder, samples: [], encodedSamples: [{ id: 'harp', bytes: library.samples.harp.bytes }], sampleRate: 48000, directional: false, duration: 2,
      events: [{ time: 0, instrument: 'harp', pitch: 1, gain: .7, x: 2, y: 0, z: -2, maxDistance: 48 }] });
    const pcm = new DataView(result.wav.buffer, result.wav.byteOffset, result.wav.byteLength); let energy = 0; for (let at = 44; at + 1 < result.wav.length; at += 2) energy += pcm.getInt16(at, true) ** 2;
    return { backend: result.backend, warnings: result.warnings, energy };
  });
  assert(native.energy > 0); assert(native.warnings.some(w => w.includes('JOrbis')));
  assert.deepEqual(errors, []); await page.screenshot({ path: '.local/portable-first-view.png' });
  console.log(JSON.stringify({ portableLauncher: 'passed', packagedProtocol: 'passed', projectSaveAndIndependentCopyUndo: 'passed', unpackedJavaAndNativeAudio: 'passed', backend: native.backend, rendererErrors: errors }));
} finally {
  await evaluateMain(`require('electron').BrowserWindow.getAllWindows().forEach(window=>window.destroy())`).catch(() => {});
  socket.close(); await browser.close().catch(() => {});
}
