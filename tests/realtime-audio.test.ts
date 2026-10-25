import { afterEach, describe, expect, it, vi } from 'vitest';
import { produce } from 'immer';
import { AudioEngine } from '../src/audio/engine';
import { createDefaultDelay } from '../src/core/delay';
import { createProject, newNote, newTrack } from '../src/core/project';
import { moveRegion } from '../src/core/region-transfer';
import { applyRegionGroupMove } from '../src/core/region-batch';
import { createRegionClipboard, planRegionPaste } from '../src/core/region-clipboard';
import type { Project } from '../src/core/types';
import type { TransportPosition } from '../src/core/transport';

// Real engine APIs and scheduling, with an independent PCM/gain connection
// graph at the Web Audio boundary. Panners are transparent signal nodes: their
// live position changes are checked separately, without claiming browser DSP.
class Parameter {
  value = 1;
  setValueAtTime(value: number, _time: number) { this.value = value; return this; }
  setTargetAtTime(value: number, _time: number, _constant: number) { this.value = value; return this; }
  linearRampToValueAtTime(value: number, _time: number) { this.value = value; return this; }
  cancelScheduledValues(_time: number) { return this; }
  cancelAndHoldAtTime(_time: number) { return this; }
}
class Pcm {
  readonly data: Float32Array;
  numberOfChannels = 1; sampleRate = 100;
  constructor(readonly tag: string, value: number, readonly duration = 3) { this.data = new Float32Array(Math.round(duration * this.sampleRate)).fill(value); }
  get length() { return this.data.length; }
  getChannelData(_channel: number) { return this.data; }
  copyToChannel(source: Float32Array, _channel: number) { this.data.set(source); }
}
class Node {
  outputs = new Set<Node>(); disconnectCount = 0;
  constructor(readonly context: Context, readonly kind: string) { context.nodes.push(this); }
  connect(node: Node) { this.outputs.add(node); return node; }
  disconnect() { this.disconnectCount++; this.outputs.clear(); }
  signal(time: number, seen = new Set<Node>()): number {
    if (seen.has(this)) throw new Error('Audio graph contains a cycle'); seen.add(this);
    try { let sum = 0; for (const node of this.context.nodes) if (node.outputs.has(this)) sum += node.signal(time, seen); return sum; }
    finally { seen.delete(this); }
  }
}
class Gain extends Node {
  gain = new Parameter();
  constructor(context: Context) { super(context, 'gain'); }
  signal(time: number, seen?: Set<Node>) { return super.signal(time, seen) * this.gain.value; }
}
class Panner extends Node {
  positionX = new Parameter(); positionY = new Parameter(); positionZ = new Parameter();
  panningModel = ''; distanceModel = ''; refDistance = 0; maxDistance = 0; rolloffFactor = 0;
  constructor(context: Context) { super(context, 'panner'); }
  setPosition(x: number, y: number, z: number) { this.positionX.value = x; this.positionY.value = y; this.positionZ.value = z; }
}
class Analyser extends Node {
  fftSize = 256;
  constructor(context: Context) { super(context, 'analyser'); }
  getFloatTimeDomainData(data: Float32Array) { data.fill(this.signal(this.context.currentTime)); }
}
class Source extends Node {
  buffer?: Pcm; playbackRate = new Parameter(); onended?: () => void;
  loop = false; loopStart = 0; loopEnd = 0; when = Infinity; offset = 0; duration = Infinity;
  startTimes: number[] = []; stopTimes: number[] = []; private queuedEnd = false;
  constructor(context: Context) { super(context, 'source'); }
  start(when = this.context.currentTime, offset = 0, duration = Infinity) { this.startTimes.push(when); this.when = when; this.offset = offset; this.duration = duration; }
  stop(when = this.context.currentTime) { this.stopTimes.push(when); if (!this.queuedEnd) { this.queuedEnd = true; this.context.ended.push(() => this.onended?.()); } }
  signal(time: number) {
    if (!this.buffer || time < this.when || this.stopTimes.some(stop => time >= stop) || time >= this.when + this.duration) return 0;
    const frame = Math.floor((this.offset + (time - this.when) * this.playbackRate.value) * this.buffer.sampleRate);
    return this.buffer.data[frame] ?? 0;
  }
}
class Context {
  currentTime = 0; sampleRate = 100; nodes: Node[] = []; sources: Source[] = []; panners: Panner[] = []; ended: (() => void)[] = [];
  decoded: (Pcm | Promise<Pcm>)[] = [];
  destination = new Node(this, 'destination'); resume = vi.fn(async () => {});
  createBufferSource() { const source = new Source(this); this.sources.push(source); return source; }
  createGain() { return new Gain(this); }
  createPanner() { const panner = new Panner(this); this.panners.push(panner); return panner; }
  createAnalyser() { return new Analyser(this); }
  decodeAudioData = vi.fn(async (_bytes: ArrayBuffer) => this.decoded.shift() ?? new Pcm('decoded-rendered', .25, 4));
  createBuffer(_channels: number, frames: number, rate: number) { return new Pcm('padding', 0, frames / rate); }
  flushEnded() { while (this.ended.length) this.ended.shift()!(); }
}
function fixture({ twoTracks = true, period = 200 } = {}) {
  vi.useFakeTimers(); const context = new Context(); vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  const project = createProject('Live mix'), engine = new AudioEngine();
  project.ppq = 100; project.tempos = [{ tick: 0, bpm: 60 }]; project.audio.mode = 'studio'; project.audio.masterGain = .5;
  project.tracks[0].id = 'track-a'; project.patterns[0].id = 'pattern-a'; project.regions[0].trackId = 'track-a'; project.regions[0].patternId = 'pattern-a';
  project.patterns[0].length = project.regions[0].length = period;
  project.patterns[0].notes = [{ ...newNote(0, 66, 5), id: 'dry-a', velocity: .5, pan: .25 }];
  if (twoTracks) {
    const track = { ...newTrack('B', 1, 'bass'), id: 'track-b' };
    project.tracks.push(track); project.patterns.push({ id: 'pattern-b', name: 'B', length: period, notes: [{ ...newNote(0, 66, 5), id: 'dry-b', velocity: .5 }] });
    project.regions.push({ id: 'region-b', trackId: track.id, patternId: 'pattern-b', start: 0, length: period, offset: 0, loop: false });
  }
  engine.buffers.set('harp', new Pcm('a', .5) as unknown as AudioBuffer); engine.buffers.set('bass', new Pcm('b', .25) as unknown as AudioBuffer);
  engine.buffers.set('bell', new Pcm('old-future', .125, .2) as unknown as AudioBuffer); engine.buffers.set('flute', new Pcm('new-future', .0625, .2) as unknown as AudioBuffer);
  const advance = (time: number) => { context.currentTime = time; vi.advanceTimersByTime(25); context.flushEnded(); };
  const apply = (next: Project) => { const before = structuredClone(next); expect(engine.updateProject(next)).toBe(true); expect(next).toEqual(before); };
  const stop = () => { engine.stop(); context.flushEnded(); };
  return { engine, project, context, advance, apply, stop };
}
function withEmbeddedFuture(project: Project, data = 'AQID'): Project {
  return produce(project, draft => {
    draft.instruments.push({ ...draft.instruments[0], id: 'pending-sample', name: 'Pending embedded sample', assetId: 'pending-wave' });
    draft.assets.push({ id: 'pending-wave', name: 'pending.wav', mime: 'audio/wav', data });
    draft.patterns[0].notes.push({ ...newNote(50, 66, 5), id: 'pending-future-note', velocity: .5, instrumentId: 'pending-sample' });
  });
}
const timesClose = (actual: number[], expected: number[]) => { expect(actual).toHaveLength(expected.length); actual.forEach((time, index) => expect(time).toBeCloseTo(expected[index], 10)); };
const positionUnchanged = (actual: TransportPosition | undefined, expected: TransportPosition | undefined) => {
  expect(actual).toBeDefined(); expect(expected).toBeDefined();
  for (const field of ['tick', 'linearTick', 'seconds'] as const) expect(actual![field]).toBeCloseTo(expected![field], 10);
};
function addReference(project: Project, startTick = 0, gain = 1) {
  project.reference = { assetId: 'reference', startTick, gain };
  project.assets.push({ id: 'reference', name: 'reference.wav', mime: 'audio/wav', data: 'AA==' });
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('real-time Web mix updates through the actual engine', () => {
  it('waits without a missing-sample error when the exact embedded decode started before the model update', async () => {
    const test = fixture({ twoTracks: false }), { engine, project, context, stop } = test;
    await engine.play(project, 0, true); test.advance(.2); const tail = context.sources[0], position = engine.position(), stopped = vi.spyOn(engine, 'stop'), next = withEmbeddedFuture(project), before = structuredClone(next);
    let resolve!: (value: Pcm) => void; const pcm = new Pcm('pending-loaded', .25); context.decoded.push(new Promise<Pcm>(done => { resolve = done; }));
    const loading = engine.loadProjectSamples(next);
    // Also covers the await ensure boundary before the first decode begins.
    expect(engine.updateProject(next)).toBe(false); positionUnchanged(engine.position(), position);
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(1));
    test.advance(.25); expect(context.sources).toEqual([tail]); expect(engine.meterLevels().master).toBe(.125); const beforeReady = engine.position();
    resolve(pcm); await loading; positionUnchanged(engine.position(), beforeReady);
    test.advance(.5); test.advance(.56);
    expect(context.sources.map(source => source.buffer?.tag)).toEqual(['a', 'pending-loaded']); timesClose(context.sources.map(source => source.when), [.05, .55]);
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': .1875 }, master: .1875 });
    expect(stopped).not.toHaveBeenCalled(); expect(tail.stopTimes).toEqual([]); expect(next).toEqual(before); stop();
  });

  it.each(['different-data', 'external-only', 'mixed-pending-external'] as const)('does not suppress the real missing-sample error for %s during another decode', async missing => {
    const test = fixture({ twoTracks: false }), { engine, project, context, stop } = test;
    await engine.play(project, 0, true); test.advance(.2); const next = withEmbeddedFuture(project), tail = context.sources[0], position = engine.position();
    let resolve!: (value: Pcm) => void; context.decoded.push(new Promise<Pcm>(done => { resolve = done; })); const loading = engine.loadProjectSamples(next);
    const requested = missing === 'different-data' ? produce(next, draft => { draft.assets[0].data = 'BAUG'; }) : produce(next, draft => {
      if (missing === 'external-only') { delete draft.assets[0].data; draft.assets[0].path = 'not-loaded.wav'; return; }
      draft.instruments.push({ ...draft.instruments[0], id: 'unloaded-external', assetId: 'external-wave' });
      draft.assets.push({ id: 'external-wave', name: 'external.wav', mime: 'audio/wav', path: 'not-loaded.wav' });
      draft.patterns[0].notes.push({ ...newNote(60, 66, 5), id: 'external-future', instrumentId: 'unloaded-external' });
    });
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(1));
    try {
      expect(() => engine.updateProject(requested)).toThrow('实时试听缺少采样'); positionUnchanged(engine.position(), position); expect(context.sources).toEqual([tail]); expect(tail.stopTimes).toEqual([]);
    } finally { stop(); resolve(new Pcm('unused-pending', .25)); await loading; }
  });

  it('clears a failed decode wait and can retry the same model without stopping its already sounding tail', async () => {
    const test = fixture({ twoTracks: false }), { engine, project, context, stop } = test;
    await engine.play(project, 0, true); test.advance(.2); const next = withEmbeddedFuture(project), tail = context.sources[0], position = engine.position(), stopped = vi.spyOn(engine, 'stop');
    let reject!: (error: Error) => void; context.decoded.push(new Promise<Pcm>((_done, fail) => { reject = fail; }));
    const loading = engine.loadProjectSamples(next), failed = expect(loading).rejects.toThrow('decoder failure');
    expect(engine.updateProject(next)).toBe(false); await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(1));
    reject(new Error('decoder failure')); await failed;
    expect(() => engine.updateProject(next)).toThrow('实时试听缺少采样'); positionUnchanged(engine.position(), position); expect(context.sources).toEqual([tail]);
    const pcm = new Pcm('successful-retry', .25); context.decoded.push(pcm); const retry = engine.loadProjectSamples(next);
    expect(engine.updateProject(next)).toBe(false); await retry;
    test.advance(.5); test.advance(.56); expect(engine.buffers.get('pending-sample')).toBe(pcm);
    timesClose(context.sources.map(source => source.when), [.05, .55]); expect(engine.meterLevels().master).toBe(.1875);
    expect(stopped).not.toHaveBeenCalled(); expect(tail.stopTimes).toEqual([]); stop();
  });

  it('does not let an older completed load clear the newer pending ticket or install its stale bytes', async () => {
    const test = fixture({ twoTracks: false }), { engine, project, context, stop } = test;
    await engine.play(project, 0, true); test.advance(.2); const old = withEmbeddedFuture(project), latest = withEmbeddedFuture(project, 'BAUG'), tail = context.sources[0], position = engine.position();
    let resolveOld!: (value: Pcm) => void, resolveLatest!: (value: Pcm) => void;
    context.decoded.push(new Promise<Pcm>(done => { resolveOld = done; }), new Promise<Pcm>(done => { resolveLatest = done; }));
    const first = engine.loadProjectSamples(old); await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(1));
    const second = engine.loadProjectSamples(latest); expect(engine.updateProject(latest)).toBe(false); await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(2));
    resolveOld(new Pcm('stale-old', .5)); await first;
    expect(engine.buffers.has('pending-sample')).toBe(false); expect(engine.updateProject(latest)).toBe(false); positionUnchanged(engine.position(), position); expect(context.sources).toEqual([tail]);
    const fresh = new Pcm('latest-loaded', .25); resolveLatest(fresh); await second;
    expect(engine.buffers.get('pending-sample')).toBe(fresh); test.advance(.5); test.advance(.56);
    expect(context.sources.map(source => source.buffer?.tag)).toEqual(['a', 'latest-loaded']); timesClose(context.sources.map(source => source.when), [.05, .55]);
    expect(tail.stopTimes).toEqual([]); expect(engine.playing).toBe(true); stop();
  });

  it('loads newly pasted track samples asynchronously and adopts their future events without restarting old tails or transport', async () => {
    const test = fixture({ twoTracks: false }), { engine, project, context, stop } = test, original = structuredClone(project);
    await engine.play(project, 0, true); test.advance(.2); const tail = context.sources[0], beforeLoad = engine.position(), stopped = vi.spyOn(engine, 'stop');
    const source = createProject('Other document'); source.ppq = 100;
    source.instruments.push({ ...source.instruments[0], id: 'fresh-default', name: 'New default', assetId: 'default-wave' }, { ...source.instruments[0], id: 'fresh-explicit', name: 'New override', assetId: 'explicit-wave' });
    source.assets = [{ id: 'default-wave', name: 'default.wav', mime: 'audio/wav', data: 'AQID' }, { id: 'explicit-wave', name: 'explicit.wav', mime: 'audio/wav', data: 'BAUG' }];
    source.tracks = [{ ...newTrack('Source top'), id: 'source-top', volume: .3 }, { ...newTrack('New tail track', 1, 'fresh-default'), id: 'source-bottom', volume: 2, pan: .25 }];
    source.patterns = [
      { id: 'source-top-pattern', name: 'Top override', length: 100, notes: [{ ...newNote(0, 66, 5), id: 'source-top-note', velocity: .5, pan: -.25, instrumentId: 'fresh-explicit' }] },
      { id: 'source-bottom-pattern', name: 'New default and override', length: 100, notes: [{ ...newNote(0, 66, 5), id: 'source-bottom-note', velocity: .5, pan: .125 }, { ...newNote(10, 66, 5), id: 'source-bottom-override', velocity: .5, pan: -.5, instrumentId: 'fresh-explicit' }] },
    ];
    source.regions = [{ id: 'source-top-region', trackId: 'source-top', patternId: 'source-top-pattern', start: 0, length: 100, offset: 0, loop: false }, { id: 'source-bottom-region', trackId: 'source-bottom', patternId: 'source-bottom-pattern', start: 0, length: 100, offset: 0, loop: false }];
    const sourceBefore = structuredClone(source), clipboard = createRegionClipboard(source, new Set(source.regions.map(region => region.id)), 11), plan = planRegionPaste(project, clipboard, 30, 'track-a', 22);
    expect(plan.tracks).toHaveLength(1); expect(plan.instruments.map(instrument => instrument.id)).toEqual(['fresh-default', 'fresh-explicit']);
    const next = produce(project, draft => { draft.tracks.push(...plan.tracks); draft.patterns.push(...plan.patterns); draft.regions.push(...plan.regions); draft.instruments.push(...plan.instruments); draft.assets.push(...plan.assets); });
    const newTrackId = plan.tracks[0].id, nextBefore = structuredClone(next);
    // A deliberately delayed browser decode leaves the existing graph intact.
    // updateProject remembers the latest model; loadProjectSamples re-applies
    // that model through the real engine once its requested bytes are decoded.
    expect(() => engine.updateProject(next)).toThrow('实时试听缺少采样'); positionUnchanged(engine.position(), beforeLoad);
    const defaultPcm = new Pcm('loaded-default', .25), explicitPcm = new Pcm('loaded-explicit', .125);
    let resolve!: (buffer: Pcm) => void; context.decoded.push(new Promise<Pcm>(done => { resolve = done; }), explicitPcm);
    const loading = engine.loadProjectSamples(next); await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(1));
    test.advance(.25); const beforeAdopt = engine.position(); expect(context.sources).toEqual([tail]); expect(engine.meterLevels().master).toBe(.125);
    resolve(defaultPcm); await loading; positionUnchanged(engine.position(), beforeAdopt);
    expect(engine.buffers.get('fresh-default')).toBe(defaultPcm); expect(engine.buffers.get('fresh-explicit')).toBe(explicitPcm);
    expect(context.decodeAudioData.mock.calls.map(([bytes]) => Array.from(new Uint8Array(bytes)))).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(tail.stopTimes).toEqual([]); expect(stopped).not.toHaveBeenCalled(); expect(engine.playing).toBe(true);
    test.advance(.36); test.advance(.46);
    timesClose(context.sources.map(voice => voice.when), [.05, .35, .35, .45]);
    expect(context.sources.slice(1).map(voice => voice.buffer?.tag)).toEqual(['loaded-explicit', 'loaded-default', 'loaded-explicit']);
    expect(context.panners.slice(1).map(panner => panner.positionX.value)).toEqual([-.5, .75, -.5]);
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': .15625, [newTrackId]: .1875 }, master: .34375 });
    expect(engine.updateProject(next)).toBe(true); test.advance(.55);
    expect(context.sources).toHaveLength(4); expect(context.sources.every(voice => voice.startTimes.length === 1 && voice.stopTimes.length === 0)).toBe(true);
    expect(project).toEqual(original); expect(source).toEqual(sourceBefore); expect(next).toEqual(nextBefore); stop();
  });

  it('moves both group members future onsets together to their destination timbres while retaining old tails and clock', async () => {
    const test = fixture(), { engine, project, context, apply, stop } = test;
    project.tracks[1].volume = 2;
    project.tracks.push({ ...newTrack('C', 2, 'bell'), id: 'track-c', volume: .5 });
    project.patterns[0].notes.push({ ...newNote(8, 66, 5), id: 'a-future-implicit', velocity: .5 }, { ...newNote(12, 66, 5), id: 'a-future-explicit', instrumentId: 'flute', velocity: .5 });
    project.patterns[1].notes.push({ ...newNote(10, 66, 5), id: 'b-future-implicit', velocity: .5 }, { ...newNote(14, 66, 5), id: 'b-future-explicit', instrumentId: 'harp', velocity: .5 });
    const before = structuredClone(project); await engine.play(project, 0, true); test.advance(.12);
    const tails = context.sources.filter(source => Math.abs(source.when - .05) < 1e-10), oldFuture = context.sources.filter(source => source.when > .12), position = engine.position(), stopped = vi.spyOn(engine, 'stop');
    expect(tails).toHaveLength(2); expect(oldFuture).toHaveLength(4);
    const next = produce(project, draft => { expect(applyRegionGroupMove(draft, [
      { id: project.regions[0].id, start: 4, trackId: 'track-b' }, { id: 'region-b', start: 4, trackId: 'track-c' },
    ])).toBe(true); }); apply(next);
    positionUnchanged(engine.position(), position); expect(engine.playing).toBe(true); expect(stopped).not.toHaveBeenCalled();
    expect(tails.every(source => source.stopTimes.length === 0 && source.startTimes.length === 1)).toBe(true);
    expect(oldFuture.every(source => source.stopTimes.length === 1 && source.stopTimes[0] < source.when)).toBe(true);
    const active = context.sources.filter(source => !source.stopTimes.length);
    timesClose(active.map(source => source.when), [.05, .05, .17, .19, .21, .23]);
    expect(active.slice(2).map(source => source.buffer?.tag)).toEqual(['b', 'old-future', 'new-future', 'a']);
    test.advance(.24);
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': .125, 'track-b': .28125, 'track-c': .078125 }, master: .484375 });
    expect(context.sources.filter(source => Math.abs(source.when - .05) < 1e-10)).toEqual(tails); expect(project).toEqual(before); expect(next.patterns).toBe(project.patterns); stop();
  });

  it('moves future region voices to destination timbre and mix without replaying its already sounding source tail', async () => {
    const test = fixture(), { engine, project, context, apply, stop } = test;
    project.tracks[1].volume = 2;
    project.patterns[0].notes.push({ ...newNote(8, 66, 5), id: 'future-implicit', velocity: .5 }, { ...newNote(12, 66, 5), id: 'future-explicit', instrumentId: 'flute', velocity: .5 });
    const before = structuredClone(project);
    await engine.play(project, 0, true); test.advance(.06);
    const tail = context.sources.find(source => source.buffer?.tag === 'a' && Math.abs(source.when - .05) < 1e-10)!;
    const oldFuture = context.sources.find(source => source.buffer?.tag === 'a' && Math.abs(source.when - .13) < 1e-10)!, position = engine.position();
    const next = produce(project, draft => { moveRegion(draft, project.regions[0].id, 'track-b', 0); }); apply(next);
    positionUnchanged(engine.position(), position); expect(engine.playing).toBe(true); expect(tail.stopTimes).toEqual([]);
    expect(oldFuture.stopTimes[0]).toBeLessThan(.13);
    const replacement = context.sources.find(source => source.buffer?.tag === 'b' && Math.abs(source.when - .13) < 1e-10)!;
    expect(replacement).toBeDefined(); expect(context.sources.filter(source => source.buffer?.tag === 'a' && !source.stopTimes.length)).toEqual([tail]);
    test.advance(.18);
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': .125, 'track-b': .28125 }, master: .40625 });
    expect(context.sources.filter(source => source.buffer?.tag === 'new-future' && !source.stopTimes.length).map(source => source.when)).toEqual([.17]);
    expect(project).toEqual(before); expect(next.patterns).toBe(project.patterns); stop();
  });

  it('updates already sounding source gain/pan/master and true summed meters without stopping or resetting the clock', async () => {
    const test = fixture(), { engine, project, context, apply, stop } = test, before = structuredClone(project);
    await engine.play(project, 0, true); test.advance(.3); const position = engine.position(), voices = context.sources.slice(), panners = context.panners.slice(), stopSpy = vi.spyOn(engine, 'stop');
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': .125, 'track-b': .0625 }, master: .1875 });
    const next = structuredClone(project); next.tracks[0].volume = 2; next.tracks[0].pan = -.5; next.audio.masterGain = .25; apply(next);
    positionUnchanged(engine.position(), position); expect(engine.playing).toBe(true); expect(stopSpy).not.toHaveBeenCalled();
    expect(context.sources).toEqual(voices); expect(context.panners).toEqual(panners); expect(panners[0].positionX.value).toBe(-.5);
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': .125, 'track-b': .03125 }, master: .15625 });
    expect(voices.every(source => source.stopTimes.length === 0)).toBe(true); expect(project).toEqual(before); stop();
  });

  it('applies mute/solo to active tails and restores them on clear without replaying source starts', async () => {
    const test = fixture(), { engine, project, context, apply, stop } = test; await engine.play(project, 0, true); test.advance(.3);
    const voices = context.sources.slice(), position = engine.position();
    const muted = structuredClone(project); muted.tracks[0].muted = true; apply(muted);
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': 0, 'track-b': .0625 }, master: .0625 });
    const solo = structuredClone(project); solo.tracks[1].solo = true; apply(solo);
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': 0, 'track-b': .0625 }, master: .0625 });
    apply(project); expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': .125, 'track-b': .0625 }, master: .1875 });
    positionUnchanged(engine.position(), position); expect(context.sources).toEqual(voices); expect(voices.every(source => source.startTimes.length === 1 && source.stopTimes.length === 0)).toBe(true); stop();
  });

  it('keeps preview changes out of project data and clearing them restores the latest committed values', async () => {
    const test = fixture(), { engine, project, context, apply, stop } = test; await engine.play(project, 0, true); test.advance(.3); const before = structuredClone(project), voices = context.sources.slice();
    engine.previewTrack('track-a', { volume: 0, pan: 1 });
    expect(engine.meterLevels().master).toBe(.0625); expect(context.panners[0].positionX.value).toBe(2);
    engine.previewMaster(0); expect(engine.meterLevels().master).toBe(0);
    engine.previewMaster(undefined); expect(engine.meterLevels().master).toBe(.0625);
    engine.previewTrack('track-a', undefined); expect(engine.meterLevels().master).toBe(.1875); expect(context.panners[0].positionX.value).toBe(.5);
    engine.previewTrack('track-a', { volume: 2 }); const committed = structuredClone(project); committed.tracks[0].volume = .75; committed.tracks[0].pan = -.25; committed.audio.masterGain = .4; apply(committed);
    engine.previewTrack('track-a', undefined);
    expect(engine.meterLevels().tracks['track-a']).toBeCloseTo(.075, 7); expect(engine.meterLevels().tracks['track-b']).toBeCloseTo(.05, 7); expect(engine.meterLevels().master).toBeCloseTo(.125, 7); expect(context.panners[0].positionX.value).toBe(0);
    engine.previewMaster(.1); const last = structuredClone(committed); last.audio.masterGain = .8; apply(last); engine.previewMaster(undefined);
    expect(engine.meterLevels().master).toBeCloseTo(.25, 7); expect(project).toEqual(before); expect(context.sources).toEqual(voices); stop();
  });

  it('cancels a removed unstarted lookahead note and schedules its replacement while preserving an audible tail', async () => {
    const test = fixture({ twoTracks: false }), { engine, project, context, apply, stop } = test;
    project.patterns[0].notes.push({ ...newNote(8, 66, 5), id: 'future-old', instrumentId: 'bell' });
    await engine.play(project, 0, true); const old = context.sources.find(source => source.buffer?.tag === 'old-future')!, tail = context.sources.find(source => source.buffer?.tag === 'a')!;
    timesClose([old.when, tail.when], [.13, .05]); test.advance(.06); const position = engine.position();
    const next = structuredClone(project); next.patterns[0].notes = [next.patterns[0].notes[0], { ...newNote(12, 66, 5), id: 'future-new', instrumentId: 'flute' }]; apply(next);
    expect(old.stopTimes.length).toBeGreaterThan(0); expect(old.stopTimes[0]).toBeLessThan(old.when); expect(tail.stopTimes).toEqual([]); positionUnchanged(engine.position(), position);
    expect(context.sources.filter(source => source.buffer?.tag === 'a')).toHaveLength(1);
    const replacement = context.sources.find(source => source.buffer?.tag === 'new-future')!; expect(replacement).toBeDefined(); expect(replacement.when).toBeCloseTo(.17, 10);
    test.advance(.18); expect(old.signal(.18)).toBe(0); expect(replacement.signal(.18)).toBe(.0625); stop();
  });

  it('does not cancel or duplicate queued notes for metadata-only project edits', async () => {
    const test = fixture({ twoTracks: false }), { engine, project, context, apply, stop } = test;
    project.patterns[0].notes.push({ ...newNote(8, 66, 5), id: 'future-old', instrumentId: 'bell' }); await engine.play(project, 0, true); test.advance(.06);
    const sources = context.sources.slice(), position = engine.position(), before = structuredClone(project), expected = structuredClone(project);
    expected.name = 'Renamed while playing'; expected.tracks[0].name = 'New display name'; expected.modifiedAt = '2026-10-25T01:00:00.000Z';
    const next = produce(project, draft => { draft.name = 'Renamed while playing'; draft.tracks[0].name = 'New display name'; draft.modifiedAt = '2026-10-25T01:00:00.000Z'; });
    expect(next.patterns).toBe(project.patterns); expect(next.regions).toBe(project.regions); expect(next.tempos).toBe(project.tempos); expect(next).toEqual(expected); apply(next);
    expect(context.sources).toEqual(sources); expect(sources.every(source => source.stopTimes.length === 0)).toBe(true); positionUnchanged(engine.position(), position); expect(project).toEqual(before); stop();
  });

  it('replaces only future Delay events, retaining active old echoes and never retriggering a dry or past tap', async () => {
    const test = fixture({ twoTracks: false }), { engine, project, context, apply, stop } = test; await engine.play(project, 0, true); test.advance(.2);
    const enabled = structuredClone(project); enabled.tracks[0].delay = { ...createDefaultDelay(), enabled: true, mode: 'tail', timeUnit: 'seconds', interval: .25, tail: .5, feedback: .5, wet: 1 }; apply(enabled);
    expect(context.sources.some(source => Math.abs(source.when - .3) < 1e-10)).toBe(true);
    test.advance(.45); const firstTap = context.sources.find(source => Math.abs(source.when - .3) < 1e-10)!, oldFutureTap = context.sources.find(source => Math.abs(source.when - .55) < 1e-10)!;
    const changed = structuredClone(enabled); changed.tracks[0].delay!.interval = .375; changed.tracks[0].delay!.tail = .75; apply(changed);
    expect(oldFutureTap.stopTimes.length).toBeGreaterThan(0); expect(oldFutureTap.stopTimes[0]).toBeLessThan(.55); expect(firstTap.stopTimes).toEqual([]);
    test.advance(.7); expect(context.sources.some(source => Math.abs(source.when - .8) < 1e-10)).toBe(true);
    expect(context.sources.filter(source => Math.abs(source.when - .05) < 1e-10)).toHaveLength(1); expect(context.sources.some(source => Math.abs(source.when - .425) < 1e-10)).toBe(false); stop();
  });

  it('preserves a previous cycle future echo after rebuilding a looping plan without replaying past dry notes', async () => {
    const test = fixture({ twoTracks: false, period: 100 }), { engine, project, context, apply, stop } = test;
    project.patterns[0].notes[0].tick = 80; project.tracks[0].delay = { ...createDefaultDelay(), enabled: true, mode: 'tail', timeUnit: 'seconds', interval: .75, tail: 1.5, feedback: .5, wet: 1 };
    await engine.play(project, 0, true); test.advance(.75); test.advance(1.05);
    const before = engine.position(), changed = structuredClone(project); changed.tracks[0].delay!.feedback = .25; apply(changed); positionUnchanged(engine.position(), before);
    test.advance(1.5); test.advance(1.8);
    timesClose(context.sources.filter(source => !source.stopTimes.length).map(source => source.when), [.85, 1.6, 1.85]);
    expect(context.sources.filter(source => Math.abs(source.when - .85) < 1e-10)).toHaveLength(1); expect(engine.position()!.linearTick).toBeGreaterThan(100); stop();
  });

  it('rejects live updates outside Web transport and tears down all live nodes on stop', async () => {
    const test = fixture(), { engine, project, context, stop } = test; expect(engine.updateProject(project)).toBe(false); expect(context.sources).toEqual([]);
    await engine.playRendered(project, Uint8Array.of(1), 0); expect(engine.updateProject(project)).toBe(false); stop();
    await engine.play(project, 0, true); test.advance(.3); engine.previewTrack('track-a', { volume: 0 }); engine.previewMaster(0); stop();
    expect(engine.updateProject(project)).toBe(false); expect(engine.position()).toBeUndefined(); expect(engine.playing).toBe(false);
    expect(engine.meterLevels()).toEqual({ tracks: {}, master: 0 }); expect(context.nodes.every(node => node.outputs.size === 0)).toBe(true);
    await engine.play(project, 0, true); test.advance(context.currentTime + .1); expect(engine.meterLevels().master).toBe(.1875); stop();
  });

  it('changes reference gain without restarting it, reschedules a moved start, and removes its signal completely', async () => {
    const test = fixture({ twoTracks: false }), { engine, project, context, apply, stop } = test; addReference(project, 50);
    await engine.play(project, 0, true); test.advance(.8);
    const dry = context.sources.find(source => source.buffer?.tag === 'a')!, original = context.sources.find(source => source.buffer?.tag === 'decoded-rendered')!, position = engine.position();
    expect(original.when).toBeCloseTo(.55, 10); expect(original.offset).toBe(0);
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': .125 }, master: .25 });
    const quieter = produce(project, draft => { draft.reference!.gain = .2; draft.audio.masterGain = .4; }); apply(quieter);
    expect(context.sources).toHaveLength(2); expect(original.stopTimes).toEqual([]); positionUnchanged(engine.position(), position);
    expect(engine.meterLevels().tracks['track-a']).toBeCloseTo(.1, 7); expect(engine.meterLevels().master).toBeCloseTo(.12, 7);
    const moved = produce(quieter, draft => { draft.reference!.startTick = 100; }); apply(moved);
    expect(original.stopTimes).toEqual([.8]); expect(dry.stopTimes).toEqual([]); positionUnchanged(engine.position(), position);
    const replacement = context.sources.filter(source => source.buffer?.tag === 'decoded-rendered').at(-1)!;
    expect(replacement).not.toBe(original); expect(replacement.when).toBeCloseTo(1.05, 10); expect(replacement.offset).toBe(0);
    test.advance(.9); expect(engine.meterLevels().master).toBeCloseTo(.1, 7);
    test.advance(1.1); expect(engine.meterLevels().master).toBeCloseTo(.12, 7);
    const removed = produce(moved, draft => { delete draft.reference; }); apply(removed);
    expect(replacement.stopTimes).toEqual([1.1]); expect(dry.stopTimes).toEqual([]);
    test.advance(1.2); expect(engine.meterLevels().master).toBeCloseTo(.1, 7);
    expect(context.sources.filter(source => source.buffer?.tag === 'a')).toHaveLength(1); stop();
  });

  it('keeps reference audio continuous while replacing future notes without changing the musical clock', async () => {
    const test = fixture({ twoTracks: false }), { engine, project, context, apply, stop } = test; addReference(project);
    await engine.play(project, 0, true); test.advance(.2);
    const original = context.sources.find(source => source.buffer?.tag === 'decoded-rendered')!, position = engine.position();
    const edited = produce(project, draft => { draft.patterns[0].notes.push({ ...newNote(50, 66, 5), id: 'new-later', instrumentId: 'bell' }); }); apply(edited);
    expect(original.stopTimes).toEqual([]); expect(context.sources.filter(source => source.buffer?.tag === 'decoded-rendered')).toEqual([original]);
    positionUnchanged(engine.position(), position); test.advance(.5);
    expect(context.sources.find(source => source.buffer?.tag === 'old-future')!.when).toBeCloseTo(.55, 10); expect(original.stopTimes).toEqual([]); stop();
  });

  it('anchors a tempo edit to the current musical tick and seeks reference audio and unstarted notes to that new time', async () => {
    const test = fixture({ twoTracks: false }), { engine, project, context, apply, stop } = test; addReference(project);
    project.patterns[0].notes.push({ ...newNote(78, 66, 5), id: 'future-at-78', instrumentId: 'bell' });
    await engine.play(project, 0, true); test.advance(.7);
    const dry = context.sources.find(source => source.buffer?.tag === 'a')!, queued = context.sources.find(source => source.buffer?.tag === 'old-future')!, originalReference = context.sources.find(source => source.buffer?.tag === 'decoded-rendered')!;
    expect(engine.position()!.tick).toBeCloseTo(65, 10); expect(engine.position()!.seconds).toBeCloseTo(.65, 10); expect(queued.when).toBeCloseTo(.83, 10);
    const faster = produce(project, draft => { draft.tempos[0].bpm = 120; }); apply(faster);
    expect(engine.position()!.tick).toBeCloseTo(65, 10); expect(engine.position()!.linearTick).toBeCloseTo(65, 10); expect(engine.position()!.seconds).toBeCloseTo(.325, 10);
    expect(dry.stopTimes).toEqual([]); expect(context.sources.filter(source => source.buffer?.tag === 'a')).toHaveLength(1);
    expect(queued.stopTimes).toEqual([.7]); expect(originalReference.stopTimes).toEqual([.7]);
    const replacementNote = context.sources.filter(source => source.buffer?.tag === 'old-future').at(-1)!, replacementReference = context.sources.filter(source => source.buffer?.tag === 'decoded-rendered').at(-1)!;
    expect(replacementNote).not.toBe(queued); expect(replacementNote.when).toBeCloseTo(.765, 10);
    expect(replacementReference.when).toBeCloseTo(.7, 10); expect(replacementReference.offset).toBeCloseTo(.325, 10); expect(replacementReference.duration).toBeCloseTo(3.675, 10);
    test.advance(.8); expect(replacementNote.signal(.8)).toBe(.125); expect(queued.signal(.8)).toBe(0); stop();
  });

  it.each(['volume-zero', 'muted'] as const)('restores an initially %s track while its existing sample tail is still running', async initial => {
    const test = fixture({ twoTracks: false }), { engine, project, context, apply, stop } = test;
    if (initial === 'volume-zero') project.tracks[0].volume = 0; else project.tracks[0].muted = true;
    await engine.play(project, 0, true); test.advance(.3);
    const voice = context.sources[0], position = engine.position(); expect(context.sources).toHaveLength(1); expect(engine.meterLevels().master).toBe(0);
    const restored = produce(project, draft => { draft.tracks[0].volume = 1; draft.tracks[0].muted = false; }); apply(restored);
    positionUnchanged(engine.position(), position); expect(context.sources).toEqual([voice]); expect(voice.startTimes).toEqual([.05]); expect(voice.stopTimes).toEqual([]);
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': .125 }, master: .125 }); stop();
  });

  it.each([
    { profile: 'java-1.5.2', afterMaster: .5 },
    { profile: 'java-1.16.5', afterMaster: .75 },
    { profile: 'java-1.21.9', afterMaster: .5 },
  ])('applies the $profile vanilla master placement once to an active source with gain above unity', async ({ profile, afterMaster }) => {
    const test = fixture({ twoTracks: false }), { engine, project, context, apply, stop } = test;
    project.audio.mode = 'vanilla'; project.audio.profileId = profile; project.tracks[0].volume = 2; project.patterns[0].notes[0].velocity = .75;
    await engine.play(project, 0, true); test.advance(.3); const voice = context.sources[0];
    // Original source clamp / listener placement: a .5 PCM sample, instance
    // gain 1.5, and master .5 yield .25 in all three selected rules.
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': .25 }, master: .25 });
    const louder = produce(project, draft => { draft.audio.masterGain = 1.5; }); apply(louder);
    expect(engine.meterLevels()).toEqual({ tracks: { 'track-a': afterMaster }, master: afterMaster });
    expect(context.sources).toEqual([voice]); expect(voice.startTimes).toEqual([.05]); expect(voice.stopTimes).toEqual([]);
    engine.previewMaster(.5); expect(engine.meterLevels().master).toBe(.25); engine.previewMaster(undefined); expect(engine.meterLevels().master).toBe(afterMaster); stop();
  });

  it('cannot resume Web playback when an awaited reference decode resolves after stop', async () => {
    const test = fixture({ twoTracks: false }), { engine, project, context, stop } = test; addReference(project);
    let resolve!: (buffer: Pcm) => void; context.decoded.push(new Promise<Pcm>(done => { resolve = done; }));
    const playback = engine.play(project, 0, true); await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(1));
    stop(); resolve(new Pcm('late-reference', .25, 4)); expect(await playback).toBe(false); test.advance(1);
    expect(context.sources).toEqual([]); expect(engine.playing).toBe(false); expect(engine.position()).toBeUndefined(); expect(engine.updateProject(project)).toBe(false);
    expect(engine.meterLevels()).toEqual({ tracks: {}, master: 0 }); expect(context.nodes.every(node => node.outputs.size === 0)).toBe(true);
  });
});
