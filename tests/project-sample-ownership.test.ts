import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/engine';
import { createProject } from '../src/core/project';
import type { Project, SampleLibrary } from '../src/core/types';

const pcm = (tag: string) => ({ tag, duration: 1 } as unknown as AudioBuffer);
function fixture() {
  const decoded: (AudioBuffer | Promise<AudioBuffer>)[] = [];
  const context = { resume: vi.fn(async () => {}), currentTime: 0, decodeAudioData: vi.fn(async (_bytes: ArrayBuffer) => decoded.shift()!) };
  vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  const engine = new AudioEngine(), base = pcm('library-harp'); engine.buffers.set('harp', base);
  return { engine, base, decoded, context };
}
function override(project: Project, data: string) {
  const next = structuredClone(project);
  next.instruments.find(ins => ins.id === 'harp')!.assetId = 'override';
  next.assets = [{ id: 'override', name: 'harp.wav', mime: 'audio/wav', data }];
  return next;
}
afterEach(() => vi.unstubAllGlobals());

describe('project sample ownership and Undo', () => {
  it('restores the untouched base sample as soon as Undo removes the embedded override', async () => {
    const { engine, base, decoded, context } = fixture(), original = createProject(), replacement = pcm('shared-replacement');
    decoded.push(replacement); await engine.loadProjectSamples(override(original, 'AQ=='));
    expect(engine.bufferFor('harp')).toBe(replacement); expect(engine.buffers.get('harp')).toBe(base);
    const undo = engine.loadProjectSamples(original);
    expect(engine.bufferFor('harp')).toBe(base); await undo;
    expect(engine.bufferFor('harp', false)).toBe(base); expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
  });
  it('keeps an independent clone distinct and reuses matching PCM for unrelated resource edits', async () => {
    const { engine, base, decoded, context } = fixture(), project = createProject(), independent = pcm('independent-harp');
    project.instruments.push({ ...project.instruments[0], id: 'independent', assetId: 'local-sample', name: 'Independent harp' });
    project.assets.push({ id: 'local-sample', name: 'local.wav', mime: 'audio/wav', data: 'Ag==' });
    decoded.push(independent); await engine.loadProjectSamples(project);
    expect(engine.bufferFor('harp')).toBe(base); expect(engine.bufferFor('independent')).toBe(independent);
    const unrelated = structuredClone(project); unrelated.assets.push({ id: 'unrelated', name: 'metadata.txt', mime: 'text/plain', data: 'Aw==' });
    await engine.loadProjectSamples(unrelated); expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    await engine.loadProjectSamples(createProject()); expect(engine.bufferFor('independent')).toBeUndefined(); expect(engine.bufferFor('harp')).toBe(base);
  });
  it('does not let an older decode win after a later replacement or Undo', async () => {
    const { engine, base, decoded, context } = fixture(), original = createProject(), stale = pcm('stale'), latest = pcm('latest');
    let resolve!: (value: AudioBuffer) => void;
    decoded.push(new Promise<AudioBuffer>(done => { resolve = done; }), latest);
    const oldLoad = engine.loadProjectSamples(override(original, 'AQ=='));
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(1));
    expect(engine.bufferFor('harp')).toBeUndefined();
    const current = engine.loadProjectSamples(override(original, 'Ag==')); await current;
    expect(engine.bufferFor('harp')).toBe(latest); resolve(stale); await oldLoad;
    expect(engine.bufferFor('harp')).toBe(latest); expect(engine.buffers.get('harp')).toBe(base);
    await engine.loadProjectSamples(original); expect(engine.bufferFor('harp')).toBe(base);
    let finishUndone!: (value: AudioBuffer) => void;
    decoded.push(new Promise<AudioBuffer>(done => { finishUndone = done; }));
    const undoneLoad = engine.loadProjectSamples(override(original, 'Aw=='));
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(3));
    await engine.loadProjectSamples(original); finishUndone(stale); await undoneLoad;
    expect(engine.bufferFor('harp')).toBe(base);
  });
  it('preserves project overrides while replacing the base library and restores the new base after Undo', async () => {
    const { engine, decoded } = fixture(), original = createProject(), embedded = pcm('embedded'), library = pcm('new-library');
    decoded.push(embedded); await engine.loadProjectSamples(override(original, 'AQ=='));
    decoded.push(library);
    await engine.setLibrary({ root: '', version: 'test', profileId: original.audio.profileId, samples: { harp: { name: 'harp.ogg', sha1: '', bytes: Uint8Array.of(2) } } } as SampleLibrary);
    expect(engine.bufferFor('harp')).toBe(embedded); expect(engine.buffers.get('harp')).toBe(library);
    await engine.loadProjectSamples(original); expect(engine.bufferFor('harp', false)).toBe(library);
  });
  it('restores preview fallback after Undo but never uses a fallback for a missing explicit override', async () => {
    const { engine, decoded } = fixture(), original = createProject(), preview = pcm('preview');
    engine.buffers.clear(); decoded.push(preview);
    await engine.setPreviewSamples({ harp: { name: 'harp.ogg', sha1: '', bytes: Uint8Array.of(1) } });
    const missing = structuredClone(original); missing.instruments[0].assetId = 'missing';
    await engine.loadProjectSamples(missing); expect(engine.bufferFor('harp')).toBeUndefined();
    await engine.loadProjectSamples(original); expect(engine.bufferFor('harp')).toBe(preview); expect(engine.bufferFor('harp', false)).toBeUndefined();
  });
});
