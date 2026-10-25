import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/engine';
import { noteAudioParameters, renderDuration } from '../src/audio/parameters';
import { createDefaultDelay } from '../src/core/delay';
import { createProject, flattenNotes, newNote, renderNoteEvents } from '../src/core/project';
import { playbackEndTick } from '../src/core/reference';
import { createTempoMap } from '../src/core/time';
import type { FlatNote, Project, SampleLibrary } from '../src/core/types';

// These are production event/request/transport tests at a recorded schedule
// boundary. No native library or physical audio device is executed, and the
// offline context below only checks allocation/WAV length, not acoustic output.
const sample = { duration: .4, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => Float32Array.from([.2, -.1, .05]) } as unknown as AudioBuffer;
function fixture() {
  const project = createProject('Delay playback fixture'); project.ppq = 100; project.tempos = [{ tick: 0, bpm: 60 }];
  project.audio.mode = 'studio'; project.audio.masterGain = 1;
  project.patterns[0].length = project.regions[0].length = 100;
  project.patterns[0].notes = [{ ...newNote(10, 66, 10), id: 'dry-note', velocity: .8 }];
  project.tracks[0].delay = { ...createDefaultDelay(), enabled: true, mode: 'tail', timeUnit: 'seconds', interval: .75, tail: 2.25, feedback: .5, wet: .6 };
  return project;
}
function engineFixture(project: Project) {
  const engine = new AudioEngine(), instrument = project.tracks[0].instrumentId;
  engine.buffers.set(instrument, sample);
  engine.library = { root: 'fixture-only', version: '1.16.5', profileId: project.audio.profileId, nativeLibrary: 'not-executed-openal',
    nativeDecoder: 'not-executed-decoder', attenuationModel: 'openal-linear', samples: { [instrument]: { name: 'fixture.ogg', bytes: Uint8Array.of(1, 2, 3), sha1: 'fixture-only' } } } satisfies SampleLibrary;
  return engine;
}
interface Scheduled { note: FlatNote; when: number; context: BaseAudioContext }
function playbackFixture(project = fixture()) {
  vi.useFakeTimers();
  const engine = engineFixture(project), context = { currentTime: 0 } as AudioContext, scheduled: Scheduled[] = [];
  engine.context = context;
  vi.spyOn(engine, 'ensure').mockResolvedValue(context); vi.spyOn(engine, 'loadReference').mockResolvedValue(undefined);
  const boundary = engine as unknown as { schedule: (context: BaseAudioContext, project: Project, note: FlatNote, when: number) => void };
  vi.spyOn(boundary, 'schedule').mockImplementation((context, _project, note, when) => { scheduled.push({ context, note, when }); });
  const advanceTo = (seconds: number) => { Object.assign(context, { currentTime: seconds }); vi.advanceTimersByTime(25); };
  const runTo = (seconds: number) => { for (let frame = 1; frame <= Math.round(seconds * 20); frame++) advanceTo(frame / 20); };
  return { engine, project, context, scheduled, advanceTo, runTo };
}
const closeArray = (actual: number[], expected: number[]) => { expect(actual).toHaveLength(expected.length); actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 10)); };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Delay playback events and unchanged musical period', () => {
  it('passes literal alternating positions through nativeRequest and the actual Web panner schedule', async () => {
    const project = fixture(); project.patterns[0].notes[0].pan = .125; project.patterns[0].notes[0].height = .75;
    project.tracks[0].pan = .125; project.tracks[0].delay!.panAmount = .5;
    const before = structuredClone(project), engine = engineFixture(project), request = await engine.nativeRequest(project);
    expect(request.events.map(event => [event.x, event.y, event.z])).toEqual([[.5, .75, -2], [-.5, .75, -2], [1.5, .75, -2], [-.5, .75, -2]]);
    closeArray(request.events.map(event => event.time), [.1, .85, 1.6, 2.35]);
    closeArray(request.events.map(event => event.gain), [.8, .24, .12, .06]);
    const panners: { positionX: { value: number }; positionY: { value: number }; positionZ: { value: number } }[] = [], starts: number[] = [];
    const context = {
      currentTime: 0, destination: {},
      createBufferSource: () => ({ playbackRate: { value: 1 }, connect: vi.fn(), disconnect: vi.fn(), start: (when: number) => { starts.push(when); } }),
      createGain: () => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }),
      createPanner: () => {
        const panner = { positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
        panners.push(panner); return panner;
      },
    } as unknown as AudioContext;
    // Keep production auditionProject -> private schedule -> parameter helper
    // intact; only WebAudio node allocation/start are recorded inert sinks.
    vi.spyOn(engine, 'ensure').mockResolvedValue(context);
    await engine.auditionProject(project);
    expect(panners.map(panner => [panner.positionX.value, panner.positionY.value, panner.positionZ.value])).toEqual([[.5, .75, -2], [-.5, .75, -2], [1.5, .75, -2], [-.5, .75, -2]]);
    closeArray(starts, [.105, .855, 1.605, 2.355]); expect(project).toEqual(before);
    project.tracks[0].delay!.panAmount = 0;
    const zero = await engine.nativeRequest(project); delete project.tracks[0].delay!.panAmount;
    const legacy = await engine.nativeRequest(project);
    expect(legacy.events).toEqual(zero.events); expect(legacy.events.map(event => event.x)).toEqual([.5, .5, .5, .5]);
    expect(request.events.map(({ x, ...event }) => event)).toEqual(legacy.events.map(({ x, ...event }) => event));
  });

  it('retains per-note tap positions when actual Web transport interleaves echo and new cycles', async () => {
    const project = fixture(); project.tracks[0].delay!.panAmount = .5;
    const test = playbackFixture(project); await test.engine.play(project, 0, true); test.runTo(2.55);
    expect(test.scheduled.map(event => [event.note.delaySource?.tap ?? 0, event.note.effectivePan])).toEqual([
      [0, 0], [1, -.5], [0, 0], [2, .5], [1, -.5], [0, 0], [3, -.5], [2, .5],
    ]);
    closeArray(test.scheduled.map(event => event.when), [.15, .9, 1.15, 1.65, 1.9, 2.15, 2.4, 2.65]); test.engine.stop();
  });

  it('includes each echo once in a native request, retains exact event frames, and allocates its complete natural tail', async () => {
    const project = fixture(), before = structuredClone(project), engine = engineFixture(project), request = await engine.nativeRequest(project);
    closeArray(request.events.map(event => event.time), [.1, .85, 1.6, 2.35]);
    expect(request.events.map(event => event.frame)).toEqual([4800, 40800, 76800, 112800]);
    closeArray(request.events.map(event => event.gain), [.8, .24, .12, .06]);
    expect(request.events.map(event => event.pitch)).toEqual([1, 1, 1, 1]);
    expect(request.duration).toBeCloseTo(2.9, 10); // last onset 2.35 + .4 sample + .15 padding
    expect(playbackEndTick(project)).toBe(100); expect(playbackEndTick(project, 10)).toBe(100);
    project.reference = { assetId: 'reference', startTick: 0, gain: 1 };
    expect(playbackEndTick(project, 2)).toBe(200); // reference length, not the 2.35s echo
    delete project.reference; expect(project).toEqual(before); expect(flattenNotes(project)).toHaveLength(1);
  });

  it('preserves the no-Delay native timing/parameter/duration path, including a half-frame onset', async () => {
    const project = fixture(); delete project.tracks[0].delay;
    project.ppq = 480; project.tempos = [{ tick: 0, bpm: 96 }]; project.regions[0].length = project.patterns[0].length = 1920; project.patterns[0].notes[0].tick = 123;
    const engine = engineFixture(project), dry = flattenNotes(project), timing = createTempoMap(project), request = await engine.nativeRequest(project);
    expect(request.events).toEqual(dry.map(note => ({ time: timing.seconds(note.absoluteTick), frame: timing.frame(note.absoluteTick, 48000), tick: note.absoluteTick,
      instrument: note.effectiveInstrument, ...noteAudioParameters(project, note, engine.library) })));
    // Preserve the legacy seconds representation; exact integer frames remain
    // authoritative at the half-frame boundary rather than changing time.ts.
    expect(request.events[0].time).toBe(.16015624999999997); expect(request.events[0].frame).toBe(7688);
    expect(request.duration).toBe(renderDuration(project, dry, () => .4, engine.library, timing)); expect(engine.renderDiagnostics).toEqual([]);
    project.tracks[0].delay = createDefaultDelay();
    expect((await engine.nativeRequest(project)).events).toEqual(request.events);
  });

  it('keeps Gate as onset gain only and does not use its release or note duration to truncate a sample', async () => {
    const project = fixture();
    Object.assign(project.tracks[0].delay!, { mode: 'gate', interval: .2, attack: 0, decay: 0, sustain: 1, release: .2 });
    const engine = engineFixture(project); engine.buffers.set(project.tracks[0].instrumentId, { ...sample, duration: 4 } as AudioBuffer);
    const request = await engine.nativeRequest(project);
    closeArray(request.events.map(event => event.time), [.1, .3]); closeArray(request.events.map(event => event.gain), [.8, .12]);
    expect(request.duration).toBeCloseTo(4.45, 10); // echo .3 + original sample 4 + padding
  });

  it('merges an old cycle long echo with new dry cycles in actual Web scheduling callbacks', async () => {
    const test = playbackFixture(); await test.engine.play(test.project, 0, true); test.runTo(2.55);
    closeArray(test.scheduled.map(event => event.when), [.15, .9, 1.15, 1.65, 1.9, 2.15, 2.4, 2.65]);
    expect(test.scheduled.map(event => event.note.delaySource?.tap ?? 0)).toEqual([0, 1, 0, 2, 1, 0, 3, 2]);
    closeArray(test.scheduled.map(event => event.note.gain), [.8, .24, .8, .12, .24, .8, .06, .12]);
    // Transport still wraps every one second, not at the expanded event end.
    expect(test.engine.position()?.tick).toBeCloseTo(50, 10); test.engine.stop();
  });

  it('starts cold with no negative-cycle echoes and keeps a deterministic order at shared onsets', async () => {
    const project = fixture(); project.patterns[0].notes[0].tick = 40;
    Object.assign(project.tracks[0].delay!, { interval: 1, tail: 2 });
    const test = playbackFixture(project); await test.engine.play(project, 0, true); test.runTo(.2);
    expect(test.scheduled).toEqual([]);
    for (let frame = 5; frame <= 31; frame++) test.advanceTo(frame / 20);
    closeArray(test.scheduled.map(event => event.when), [.45, 1.45, 1.45]);
    expect(test.scheduled.map(event => event.note.delaySource?.tap ?? 0)).toEqual([0, 1, 0]); test.engine.stop();
  });

  it('waits for non-looping future echoes after the dry end and does not end in a silent gap', async () => {
    const test = playbackFixture(), ended = vi.fn(); test.engine.onEnded = ended;
    await test.engine.play(test.project, 0); test.runTo(1.2);
    expect(test.engine.playing).toBe(true); expect(ended).not.toHaveBeenCalled();
    for (let frame = 25; frame <= 55; frame++) test.advanceTo(frame / 20);
    closeArray(test.scheduled.map(event => event.when), [.15, .9, 1.65, 2.4]);
    // The recorded schedule boundary has no live sources; real sources retain
    // their existing onended lifecycle, as opposed to this test's silent sink.
    expect(ended).toHaveBeenCalledOnce(); expect(test.engine.playing).toBe(false);
  });

  it('seeks into the current cycle without inventing older cycles, then stops every outstanding callback', async () => {
    const test = playbackFixture(); await test.engine.play(test.project, 80, true); test.runTo(.8);
    closeArray(test.scheduled.map(event => event.when), [.1, .35, .85]);
    expect(test.scheduled.map(event => event.note.delaySource?.tap ?? 0)).toEqual([1, 0, 2]);
    const beforeStop = test.scheduled.length; expect(test.engine.stop()?.tick).toBeCloseTo(55, 10);
    test.advanceTo(10); expect(test.scheduled).toHaveLength(beforeStop); expect(test.engine.position()).toBeUndefined();
  });

  it('keeps empty looping projects finite per callback and respects stop inside a position listener', async () => {
    const project = fixture(); project.patterns[0].notes = [];
    const test = playbackFixture(project); test.engine.onPosition = () => { test.engine.onPosition = undefined; test.engine.stop(); };
    expect(await test.engine.play(project, 0, true)).toBe(true);
    expect(test.engine.playing).toBe(false); expect(vi.getTimerCount()).toBe(0); expect(test.scheduled).toEqual([]);
  });

  it('auditions a preview with derived echoes without replacing an active transport', async () => {
    const test = playbackFixture(), current = fixture(); delete current.tracks[0].delay;
    await test.engine.play(current, 0, true); test.scheduled.length = 0;
    const clock = test.engine.position(), stopped = vi.spyOn(test.engine, 'stop');
    const preview = fixture(); preview.patterns[0].notes[0].tick = 0;
    await test.engine.auditionProject(preview);
    closeArray(test.scheduled.map(event => event.when), [.005, .755, 1.505, 2.255]);
    closeArray(test.scheduled.map(event => event.note.gain), [.8, .24, .12, .06]);
    expect(test.engine.playing).toBe(true); expect(test.engine.position()).toEqual(clock); expect(stopped).not.toHaveBeenCalled(); test.engine.stop();
  });

  it('cancels a delayed Web start or preview when stop wins the async ensure boundary', async () => {
    for (const method of ['play', 'auditionProject'] as const) {
      const test = playbackFixture(); let resolve!: (context: AudioContext) => void;
      vi.mocked(test.engine.ensure).mockReturnValueOnce(new Promise<AudioContext>(done => { resolve = done; }));
      const pending = method === 'play' ? test.engine.play(test.project, 0) : test.engine.auditionProject(test.project);
      test.engine.stop(); resolve(test.context); await pending;
      expect(test.scheduled).toEqual([]); expect(test.engine.playing).toBe(false);
    }
  });

  it('uses the same literal echo onsets and full tail to allocate the Web WAV export', async () => {
    const project = fixture(), engine = engineFixture(project), scheduled: Scheduled[] = [], allocations: number[][] = [];
    const boundary = engine as unknown as { schedule: (context: BaseAudioContext, project: Project, note: FlatNote, when: number) => void };
    vi.spyOn(boundary, 'schedule').mockImplementation((context, _project, note, when) => { scheduled.push({ context, note, when }); });
    vi.stubGlobal('OfflineAudioContext', class {
      constructor(public channels: number, public frames: number, public sampleRate: number) { allocations.push([channels, frames, sampleRate]); }
      async startRendering() { return { sampleRate: this.sampleRate, getChannelData: () => new Float32Array(this.frames) }; }
    });
    const wav = await engine.renderWeb(project), view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    closeArray(scheduled.map(event => event.when), [.1, .85, 1.6, 2.35]);
    closeArray(scheduled.map(event => event.note.gain), [.8, .24, .12, .06]);
    expect(allocations).toEqual([[2, 139200, 48000]]); expect(view.getUint32(40, true)).toBe(139200 * 2 * 2);
    expect(flattenNotes(project)).toHaveLength(1); expect(renderNoteEvents(project).notes).toHaveLength(4);
  });

  it('rejects expanded audio beyond the existing 30 minute bound before offline allocation', async () => {
    const project = fixture(); project.patterns[0].length = project.regions[0].length = 179900; project.patterns[0].notes[0].tick = 179880;
    const engine = engineFixture(project), offline = vi.fn(); vi.stubGlobal('OfflineAudioContext', offline);
    await expect(engine.nativeRequest(project)).rejects.toThrow('30 分钟'); await expect(engine.renderWeb(project)).rejects.toThrow('30 分钟');
    expect(offline).not.toHaveBeenCalled();
  });
});
