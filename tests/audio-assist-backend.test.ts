import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readResult, registerAudioAssist } from '../electron/audio-assist';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';

describe('local audio assistant backend', () => {
  it('rejects untrusted frames and invalid requests without spawning a worker', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const ipc = { handle: (key: string, handler: any) => handlers.set(key, handler), removeHandler: (key: string) => handlers.delete(key) } as unknown as IpcMain;
    const event = { sender: { id: 1 } } as IpcMainInvokeEvent;
    const unregister = registerAudioAssist(ipc, '.', '.', () => false);
    expect(() => handlers.get('audio-assist:status')!(event)).toThrow('来源');
    await expect(handlers.get('audio-assist:start')!(event, {})).rejects.toThrow('来源');
    unregister(); expect(handlers.size).toBe(0);
    registerAudioAssist(ipc, '.', '.', () => true);
    await expect(handlers.get('audio-assist:start')!(event, { id: '../escape', name: 'a', bytes: new Uint8Array(44) })).rejects.toThrow('请求无效');
    await expect(handlers.get('audio-assist:start')!(event, { id: 'test', name: 'a', bytes: new Uint8Array(44), separation: true })).rejects.toThrow('六轨模型未就绪');
  });
  it('refuses incomplete caches and traversal in a generated file list', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'neonbs-audio-backend-'));
    try {
      await expect(readResult(directory)).rejects.toThrow();
      await writeFile(path.join(directory, 'result.json'), JSON.stringify({ algorithm: 'neonbs-audio-assist-2', files: [{ id: 'safe', file: '../escape.wav', mime: 'audio/wav', name: 'x' }] }));
      await expect(readResult(directory)).rejects.toThrow('路径');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('publishes a file descriptor without loading audio into the result or inventing stems', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'neonbs-audio-backend-'));
    const wav = Buffer.alloc(44 + 44100 * 2 * 4); wav.write('RIFF', 0); wav.write('WAVE', 8);
    wav.writeUInt32LE(wav.length - 8, 4); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(3, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(44100 * 8, 28); wav.writeUInt16LE(8, 32); wav.writeUInt16LE(32, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    try {
      const workspace = { id: 'workspace', name: 'test', sourceAssetId: 'original', duration: 1, sampleRate: 44100, frames: 44100,
        stems: [{ id: 'stem', role: 'original', name: '原始音频', assetId: 'original', gain: 1, muted: false, solo: false }], bpm: 120, firstBeat: 0, beats: [0, .5], chords: [{ id: 'chord', name: 'C', start: 0, end: 1, confidence: .4 }], model: { id: 'librosa-analysis', version: '0.11.0' }, loop: { enabled: false, start: 0, end: 1 } };
      await writeFile(path.join(directory, 'original.wav'), wav);
      await writeFile(path.join(directory, 'result.json'), JSON.stringify({ algorithm: 'neonbs-audio-assist-2', workspace, files: [{ id: 'original', file: 'original.wav', mime: 'audio/wav', name: 'original.wav' }] }));
      const sha256 = createHash('sha256').update(wav).digest('hex');
      const result = await readResult(directory, async (filename, meta) => {
        expect(filename).toBe(path.join(directory, 'original.wav'));
        return { ...meta, sha256, bytes: wav.length, file: `audio/${sha256}.wav` };
      });
      expect(result.workspace.stems.map(s => s.role)).toEqual(['original']);
      expect(result.assets[0].data).toBeUndefined();
      expect(result.assets[0].audioFile).toMatchObject({ sha256, frames: 44100, bytes: wav.length });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
