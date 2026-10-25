import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../src/core/project';
import { createTempoMap } from '../src/core/time';
import { playbackEndTick, referenceSegment, waveformAmplitude, waveformPeaks } from '../src/core/reference';
import { transportPosition } from '../src/core/transport';
import { beginRecordedPress, finishRecordedPress } from '../src/core/recording';
import { AudioEngine } from '../src/audio/engine';

describe('reference timing on a musical timeline', () => {
  it('maps unchanged audio seconds across tempo changes and combines both stereo channels', () => {
    const p = createProject(); p.tempos = [{ tick: 0, bpm: 120 }, { tick: 1920, bpm: 60 }];
    p.reference = { assetId: 'ref', startTick: 960, gain: .7 };
    const peaks = waveformPeaks([new Float32Array(8), Float32Array.from([0, 0, .8, 0, 0, .5, 0, 0])], 2, 8), timing = createTempoMap(p);
    expect(playbackEndTick(p, peaks.duration)).toBe(5280);
    expect(waveformAmplitude(peaks, timing, 960, 0, 960)).toBe(0);
    expect(waveformAmplitude(peaks, timing, 960, 2400, 2880)).toBeCloseTo(.8);
    expect(waveformAmplitude(peaks, timing, 960, 3840, 4320)).toBe(.5);
    // At the same pixel after a horizontal scroll, sampling uses the new project ticks.
    expect(waveformAmplitude(peaks, timing, 960, 4320, 4800)).toBe(0);
  });
  it('seeks before / inside / after an offset clip and clips exactly at a loop boundary', () => {
    expect(referenceSegment(2, 6, 0, 10)).toEqual({ delay: 2, offset: 0, duration: 6 });
    expect(referenceSegment(2, 6, 4, 10)).toEqual({ delay: 0, offset: 2, duration: 4 });
    expect(referenceSegment(2, 6, 9, 10)).toBeUndefined();
    expect(referenceSegment(2, 6, 4, 5)).toEqual({ delay: 0, offset: 2, duration: 1 });
    expect(referenceSegment(-2, 6, 0, 10)).toEqual({ delay: 0, offset: 2, duration: 4 });
  });
});

describe('recording uses the transport, including repeated tempo maps', () => {
  it('preserves held duration through a loop with changing tempo instead of extrapolating wall time', () => {
    const p = createProject(); p.tempos = [{ tick: 0, bpm: 120 }, { tick: 1920, bpm: 60 }];
    const clock = { timing: createTempoMap(p), startedAt: 10, from: 2, endTick: 3840, loop: true };
    const start = transportPosition(clock, 10), finish = transportPosition(clock, 12);
    expect(start.tick).toBe(2880); expect(finish.tick).toBe(1920);
    const press = beginRecordedPress(p, p.regions[0], 64, .9, 0, start, true, 16, 16)!;
    expect(finishRecordedPress(p, press, finish)?.note).toMatchObject({ tick: 2880, duration: 2880, velocity: .9 });
    expect(transportPosition(clock, 9).tick).toBe(2880); // output preroll never moves the caret backwards
  });
  it('records in the correct trimmed source coordinates, uses fixed step duration, and rejects locked/outside live targets', () => {
    const p = createProject(), r = p.regions[0]; r.start = 3840; r.offset = 960; r.length = 1920;
    const step = beginRecordedPress(p, r, 60, .8, 4320, undefined, true, 16, 8)!;
    expect(finishRecordedPress(p, step)?.note).toMatchObject({ tick: 1440, duration: 480 });
    expect(finishRecordedPress(p, step)?.caret).toBe(4800);
    const outside = beginRecordedPress(p, r, 60, .8, 0, { tick: 0, linearTick: 0, seconds: 0 }, true, 16, 16)!;
    expect(finishRecordedPress(p, outside)).toBeUndefined();
    p.tracks[0].locked = true; expect(finishRecordedPress(p, step)).toBeUndefined();
  });
  it('quantizes a repeated region against its actual project bar and retains note length past the loop boundary', () => {
    const p = createProject(), r = p.regions[0]; r.loop = true; r.length = 7680;
    p.timeSignatures.push({ tick: 4800, numerator: 3, denominator: 4 });
    const press = beginRecordedPress(p, r, 67, 1, 0, { tick: 7590, linearTick: 7590, seconds: 0 }, true, 16, 16)!;
    expect(finishRecordedPress(p, press, { tick: 100, linearTick: 8000, seconds: 0 })?.note).toMatchObject({ tick: 0, duration: 410 });
  });
});

class BufferStub {
  numberOfChannels = 1; sampleRate = 100; length: number;
  constructor(public duration: number) { this.length = Math.round(duration * this.sampleRate); }
  getChannelData() { return new Float32Array(this.length); }
  copyToChannel() {}
}
class SourceStub {
  buffer?: BufferStub; loop = false; loopStart = 0; loopEnd = 0; onended?: () => void;
  start = vi.fn(); stop = vi.fn(); connect = vi.fn(); disconnect = vi.fn();
}
class ContextStub {
  currentTime = 0; sampleRate = 100; destination = {};
  sources: SourceStub[] = []; decoded: (BufferStub | Promise<BufferStub>)[] = [];
  resume = vi.fn(async () => {});
  decodeAudioData = vi.fn(async () => this.decoded.shift() ?? new BufferStub(4));
  createBufferSource() { const source = new SourceStub(); this.sources.push(source); return source; }
  createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
  createAnalyser() { return { fftSize: 0, connect() {}, disconnect() {} }; }
  createBuffer(_channels: number, frames: number, sampleRate: number) { return new BufferStub(frames / sampleRate); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('audio output transport lifecycle', () => {
  const setup = () => { vi.useFakeTimers(); const context = new ContextStub(); vi.stubGlobal('AudioContext', class { constructor() { return context; } }); return { engine: new AudioEngine(), context }; };
  it('stopping during a native decode cannot start either the music or reference afterwards', async () => {
    const { engine, context } = setup(); let resolve!: (buffer: BufferStub) => void;
    context.decoded.push(new Promise<BufferStub>(done => { resolve = done; }));
    const playback = engine.playRendered(createProject(), new Uint8Array([1]), 0);
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalled());
    engine.stop(); resolve(new BufferStub(6)); expect(await playback).toBe(false);
    expect(context.sources).toHaveLength(0); expect(engine.playing).toBe(false);
  });
  it('starts in the cold native prefix and seeks the reference to the same project time; pause reports the exact clock', async () => {
    const { engine, context } = setup(), p = createProject();
    p.reference = { assetId: 'ref', startTick: 1920, gain: .7 }; p.assets.push({ id: 'ref', name: 'test.wav', mime: 'audio/wav', data: 'AA==' });
    context.decoded.push(new BufferStub(4), new BufferStub(15));
    expect(await engine.playRendered(p, new Uint8Array([1]), 3840, 5, 10)).toBe(true);
    const [music, reference] = context.sources;
    expect(music.start).toHaveBeenCalledWith(.03, 2);
    expect(music.loopStart).toBe(5); expect(music.loopEnd).toBe(10);
    expect(reference.start).toHaveBeenCalledWith(.03, 1, 3);
    context.currentTime = 3.155;
    expect(engine.stop()?.tick).toBeCloseTo(240); // phase .125 sec in the next cycle
    expect(music.stop).toHaveBeenCalled(); expect(reference.stop).toHaveBeenCalled(); expect(engine.position()).toBeUndefined();
  });
});
