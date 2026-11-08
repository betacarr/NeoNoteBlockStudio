import { build } from 'esbuild';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = process.cwd();
const output = await mkdtemp(path.join(root, '.local', 'audio-assist-backend-run-'));
await build({ entryPoints: ['electron/audio-assist.ts'], outfile: path.join(output, 'backend.mjs'), platform: 'node', format: 'esm', bundle: true });
const { registerAudioAssist } = await import(pathToFileURL(path.join(output, 'backend.mjs')));
const handlers = new Map();
const ipc = { handle: (k, v) => handlers.set(k, v), removeHandler: k => handlers.delete(k) };
const sender = new EventEmitter(); sender.id = 100; sender.isDestroyed = () => false;
const progress = [];
let cancelOnProgress = false;
sender.send = (_channel, value) => { progress.push(value); if (cancelOnProgress) { cancelOnProgress = false; handlers.get('audio-assist:cancel')({ sender }, value.id); } };
const dispose = registerAudioAssist(ipc, root, output, () => true, { publishAsset: async (_owner, filename, meta) => {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(filename)) hash.update(chunk);
  const sha256 = hash.digest('hex'); return { ...meta, sha256, bytes: (await stat(filename)).size, file: `audio/${sha256}.wav` };
} });
const bytes = await readFile(path.join(root, '.local/audio-assist-worker-check/input.wav'));
const invoke = (id, bytes, name = 'Backend isolated QA') => handlers.get('audio-assist:start')({ sender }, { id, name, bytes, separation: false });
try {
  cancelOnProgress = true;
  await assert.rejects(invoke('cancel-test', bytes), /取消/);
  assert.equal((await readdir(path.join(output, 'audio-assist'))).filter(n => n.startsWith('pending-')).length, 0);
  await assert.rejects(invoke('invalid-test', new Uint8Array(100)), /失败|无法解码/);
  const result = await invoke('complete-test', bytes);
  assert.equal(result.workspace.frames, 352800);
  assert.equal(result.workspace.stems.length, 1);
  assert.equal(result.workspace.stems[0].role, 'original');
  assert.ok(Math.abs(result.workspace.bpm - 120) < 1);
  assert.equal(result.workspace.chords[0].name, 'C');
  const before = progress.length;
  const cached = await invoke('cache-test', bytes);
  assert.equal(cached.workspace.id, result.workspace.id);
  assert.ok(progress.slice(before).some(p => p.phase === 'cache'));
  const m4a = await readFile(path.join(root, '.local/audio-assist-worker-check/input.m4a'));
  const decoded = await invoke('aac-test', m4a, 'Local AAC QA');
  assert.ok(Math.abs(decoded.workspace.duration - 8) < .1);
  assert.ok(progress.some(p => p.message.includes('本地解码器')));
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, tests: ['real-cancel-cleanup', 'invalid-file-failure', 'real-librosa-C-120-analysis', 'cache-reuse', 'local-AAC-FFmpeg-decode'], bpm: result.workspace.bpm, frames: result.workspace.frames, aacFrames: decoded.workspace.frames, stems: result.workspace.stems.map(s => s.role), sixStemInference: 'not run: model authorization pending', progress }, null, 2));
  console.log(JSON.stringify({ passed: true, report: path.join(output, 'report.json') }));
} finally { dispose(); }
