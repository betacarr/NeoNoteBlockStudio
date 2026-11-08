import { build } from 'esbuild';
import { EventEmitter } from 'node:events';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, stat, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = process.cwd(), directory = await mkdtemp(path.join(root, '.local', 'audio-assist-fullsong-backend-'));
await build({ entryPoints: ['electron/audio-assist.ts'], outfile: path.join(directory, 'backend.mjs'), platform: 'node', format: 'esm', bundle: true });
const { registerAudioAssist } = await import(pathToFileURL(path.join(directory, 'backend.mjs')));
const inputPath = path.join(root, '.local/audio-assist-fullsong-check/input-5min.wav');
const handlers = new Map(), progress = [], registered = [];
const ipc = { handle: (key, callback) => handlers.set(key, callback), removeHandler: key => handlers.delete(key) };
const sender = new EventEmitter(); sender.id = 700; sender.isDestroyed = () => false; sender.send = (_channel, value) => progress.push(value);
const dispose = registerAudioAssist(ipc, root, directory, () => true, {
  resolveInput: async (owner, handle) => { assert.equal(owner, 700); assert.equal(handle, 'trusted-chooser-handle'); return { path: inputPath, name: 'five-minute.wav', size: (await stat(inputPath)).size }; },
  publishAsset: async (_owner, filename, meta) => {
    assert.ok(!filename.includes('pending-'));
    const hash = createHash('sha256'); for await (const chunk of createReadStream(filename)) hash.update(chunk);
    const sha256 = hash.digest('hex'), bytes = (await stat(filename)).size;
    registered.push({ filename, bytes, ...meta });
    return { ...meta, sha256, bytes, file: `audio/${sha256}.wav` };
  },
});
const invoke = id => handlers.get('audio-assist:start')({ sender }, { id, name: '完整五分钟歌曲 QA', sourceHandle: 'trusted-chooser-handle', separation: false });
try {
  const promise = invoke('cancel-source-copy');
  const timer = setTimeout(() => handlers.get('audio-assist:cancel')({ sender }, 'cancel-source-copy'), 10);
  await assert.rejects(promise, /取消/); clearTimeout(timer);
  assert.equal((await readdir(path.join(directory, 'audio-assist'))).filter(n => n.startsWith('pending-')).length, 0);
  const result = await invoke('full-song');
  assert.equal(result.workspace.duration, 300); assert.equal(result.workspace.frames, 13230000);
  assert.ok(Math.abs(result.workspace.bpm - 120) < 1);
  assert.equal(result.workspace.chords.at(-1).end, 300);
  assert.ok(result.assets[0].audioFile.bytes > 64 * 1024 * 1024);
  assert.equal(result.assets[0].data, undefined);
  assert.ok(JSON.stringify(result).length < 65536);
  const cached = await invoke('cached-full-song'); assert.equal(cached.workspace.id, result.workspace.id);
  const report = { passed: true, inputBytes: (await stat(inputPath)).size, outputBytes: result.assets[0].audioFile.bytes, returnedJsonBytes: JSON.stringify(result).length, duration: result.workspace.duration, frames: result.workspace.frames, bpm: result.workspace.bpm, lastChordEnd: result.workspace.chords.at(-1).end, registered, checks: ['source-handle-over-64MB', 'cancel-stream-copy', 'no-partial-cache', 'real-300s-librosa-analysis', 'no-base64-or-full-PCM-result', 'publish-after-atomic-cache-rename', 'cache-reuse'], sixStemInference: 'not run: model authorization pending', progress };
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: true, report: path.join(directory, 'report.json') }));
} finally { dispose(); }
