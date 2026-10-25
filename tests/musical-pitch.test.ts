import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/engine';
import { noteAudioParameters, renderDuration } from '../src/audio/parameters';
import { createDefaultDelay } from '../src/core/delay';
import { createProject, flattenNotes, newNote } from '../src/core/project';
import type { Note, SampleLibrary } from '../src/core/types';

// Literal equal-tempered ratios relative to the stock sample's MIDI 66 root.
// These expectations never call either production pitch helper.
const PITCHES = [
  [0, .02209708691207961], [53, .47193715634084676], [54, .5], [66, 1],
  [78, 2], [79, 2.1189261887185906], [100, 7.127189745122715], [127, 33.90281901949744],
] as const;

class BufferStub {
  readonly numberOfChannels = 1; readonly sampleRate = 4000; readonly length = 1000;
  readonly duration = .25; private readonly data = new Float32Array(this.length).fill(.25);
  getChannelData(_channel: number) { return this.data; }
}
class NodeStub {
  connect = vi.fn(); disconnect = vi.fn();
}
class SourceStub extends NodeStub {
  buffer?: AudioBuffer; playbackRate = { value: 1 }; onended?: () => void;
  start = vi.fn(); stop = vi.fn();
}
class ContextStub {
  currentTime = 0; sampleRate = 22050; destination = new NodeStub(); sources: SourceStub[] = [];
  resume = vi.fn(async () => {});
  createBufferSource() { const source = new SourceStub(); this.sources.push(source); return source; }
  createGain() { return Object.assign(new NodeStub(), { gain: { value: 1 } }); }
  createPanner() { return Object.assign(new NodeStub(), { positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } }); }
  createAnalyser() { return Object.assign(new NodeStub(), { fftSize: 256 }); }
}
function fixture(notes: Note[] = PITCHES.map(([midi]) => newNote(0, midi, 0))) {
  const project = createProject('Musical pitch'), engine = new AudioEngine(), context = new ContextStub();
  project.ppq = 100; project.tempos = [{ tick: 0, bpm: 60 }]; project.audio.sampleRate = 22050;
  project.patterns[0].length = project.regions[0].length = 1; project.patterns[0].notes = notes;
  const sample = new BufferStub() as unknown as AudioBuffer;
  engine.buffers.set('harp', sample);
  engine.library = { root: 'inert-fixture', version: '1.16.5', profileId: project.audio.profileId,
    nativeLibrary: 'never-loaded-openal', nativeDecoder: 'never-loaded-vorbis', attenuationModel: 'openal-linear',
    samples: { harp: { name: 'inert.ogg', bytes: Uint8Array.of(1, 2), sha1: 'fixture' } } } satisfies SampleLibrary;
  engine.context = context as unknown as AudioContext;
  return { project, engine, context };
}
function pitchesAre(sources: SourceStub[], expected: readonly number[]) {
  expect(sources).toHaveLength(expected.length);
  sources.forEach((source, index) => expect(source.playbackRate.value).toBeCloseTo(expected[index], 13));
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('explicit musical pitch and original game pitch policies', () => {
  it.each(PITCHES)('keeps MIDI %s at its literal musical ratio %s without the game clamp', (midi, expected) => {
    const { project } = fixture([newNote(0, midi, 0)]), note = flattenNotes(project)[0], before = structuredClone(project);
    const musical = noteAudioParameters(project, note, undefined, 'musical'), { pitch: _musicalPitch, ...musicalMix } = musical;
    const { pitch: _gamePitch, ...gameMix } = noteAudioParameters(project, note);
    expect(musical.pitch).toBeCloseTo(expected, 13); expect(musicalMix).toEqual(gameMix);
    expect(project.audio.mode).toBe('vanilla'); expect(project).toEqual(before);
  });

  it('retains fractional cents instead of rounding them through a Java float', () => {
    const { project } = fixture([{ ...newNote(0, 66), detune: 25 }]), note = flattenNotes(project)[0];
    expect(noteAudioParameters(project, note, undefined, 'musical').pitch).toBe(1.0145453349375237);
    project.audio.mode = 'studio';
    expect(noteAudioParameters(project, note, undefined, 'musical').pitch).toBe(1.0145453349375237);
    expect(noteAudioParameters(project, note).pitch).not.toBe(1.0145453349375237); // default native-compatible float path
  });

  it('uses a custom sample root and event pitch multiplier once while preserving the vanilla volume and distance model', () => {
    const { project, engine } = fixture([newNote(0, 72)]); project.instruments.find(instrument => instrument.id === 'harp')!.rootMidi = 60;
    engine.library!.soundEvents = { harp: { event: 'custom.harp', path: 'inert.ogg', volume: .25, pitch: .75, attenuationDistance: 24 } };
    const note = flattenNotes(project)[0], before = structuredClone(project), musical = noteAudioParameters(project, note, engine.library, 'musical');
    expect(musical.pitch).toBe(1.5); expect(musical.gain).toBe(Math.fround(.2)); expect(musical.maxDistance).toBe(72);
    const { pitch: _pitch, ...mix } = musical, { pitch: _gamePitch, ...gameMix } = noteAudioParameters(project, note, engine.library);
    expect(mix).toEqual(gameMix); expect(project).toEqual(before);
  });

  it('bypasses the historical wire-byte wrap only under the explicit musical policy', () => {
    const { project } = fixture([newNote(0, 91)]); project.audio.profileId = 'java-1.8'; const note = flattenNotes(project)[0];
    expect(noteAudioParameters(project, note).pitch).toBe(.5); // 267 -> low byte 11 -> game lower clamp
    expect(noteAudioParameters(project, note, undefined, 'game').pitch).toBe(.5);
    expect(noteAudioParameters(project, note, undefined, 'musical').pitch).toBe(4.237852377437181);
    project.audio.profileId = 'java-1.16.5'; expect(noteAudioParameters(project, note).pitch).toBe(2);
  });

  it('allocates the complete slower musical sample tail, independently of displayed note duration', () => {
    const { project } = fixture([newNote(100, 0, 0)]); project.patterns[0].length = project.regions[0].length = 101;
    expect(renderDuration(project, flattenNotes(project), () => .25, undefined, undefined, 'musical')).toBeCloseTo(12.46370849898476, 12);
    expect(renderDuration(project, flattenNotes(project), () => .25)).toBeCloseTo(1.65, 12);
    project.patterns[0].notes[0].duration = 100000;
    expect(renderDuration(project, flattenNotes(project), () => .25, undefined, undefined, 'musical')).toBeCloseTo(12.46370849898476, 12);
  });
});

describe('actual engine Web entry points choose musical pitch', () => {
  it('uses full-range ratios in live transport and keeps them through live mixer refreshes', async () => {
    vi.useFakeTimers(); const { project, engine, context } = fixture(), before = structuredClone(project);
    expect(await engine.play(project, 0)).toBe(true); pitchesAre(context.sources, PITCHES.map(([, pitch]) => pitch));
    engine.previewMaster(.25); engine.previewTrack(project.tracks[0].id, { volume: .5 });
    pitchesAre(context.sources, PITCHES.map(([, pitch]) => pitch));
    expect(context.sources.every(source => source.start.mock.calls.length === 1 && source.stop.mock.calls.length === 0)).toBe(true);
    expect(project).toEqual(before); expect(project.audio.mode).toBe('vanilla'); engine.stop();
  });

  it('uses full-range ratios in individual note audition without starting transport', async () => {
    const { project, engine, context } = fixture(), before = structuredClone(project);
    for (const [midi] of PITCHES) await engine.audition(project, midi, 'harp');
    pitchesAre(context.sources, PITCHES.map(([, pitch]) => pitch));
    expect(context.sources.every(source => source.stop.mock.calls.length === 0)).toBe(true); expect(engine.playing).toBe(false); expect(project).toEqual(before); engine.stop();
  });

  it('keeps a high pitched note and its Delay audition echoes musical on a historical profile', async () => {
    const { project, engine, context } = fixture([newNote(0, 91, 0)]); project.audio.profileId = 'java-1.8';
    project.tracks[0].delay = { ...createDefaultDelay(), enabled: true, mode: 'tail', timeUnit: 'seconds', interval: .25, tail: .25, wet: 1 };
    const before = structuredClone(project); await engine.auditionProject(project);
    pitchesAre(context.sources, [4.237852377437181, 4.237852377437181]);
    expect(context.sources.map(source => source.start.mock.calls)).toEqual([[[.005]], [[.255]]]);
    expect(context.sources.every(source => source.stop.mock.calls.length === 0)).toBe(true); expect(project).toEqual(before); engine.stop();
  });

  it('uses musical rates and full low-note tail allocation in Web WAV export', async () => {
    const { project, engine, context: liveContext } = fixture([newNote(100, 0, 0), newNote(100, 127, 0)]), offline: (ContextStub & { frames: number })[] = [];
    project.patterns[0].length = project.regions[0].length = 101;
    vi.stubGlobal('OfflineAudioContext', class extends ContextStub {
      constructor(readonly channels: number, readonly frames: number, rate: number) { super(); this.sampleRate = rate; offline.push(this); }
      async startRendering() { return { sampleRate: this.sampleRate, getChannelData: () => new Float32Array(this.frames) }; }
    });
    const before = structuredClone(project), wav = await engine.renderWeb(project), rendered = offline[0];
    pitchesAre(rendered.sources, [.02209708691207961, 33.90281901949744]);
    expect(rendered.frames).toBe(Math.ceil(12.46370849898476 * 22050));
    expect(rendered.sources.every(source => source.stop.mock.calls.length === 0)).toBe(true);
    expect(rendered.sources.map(source => source.start.mock.calls)).toEqual([[[1]], [[1]]]);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(24, true)).toBe(22050); expect(view.getUint32(40, true)).toBe(rendered.frames * 2 * 2);
    expect(liveContext.sources).toEqual([]); expect(project).toEqual(before);
  });

  it('leaves native requests on the default game pitch and game-duration path', async () => {
    const { project, engine, context } = fixture([newNote(0, 55, 0), newNote(0, 91, 0)]);
    project.audio.profileId = engine.library!.profileId = 'java-1.8'; const before = structuredClone(project), request = await engine.nativeRequest(project);
    expect(request.events.map(event => event.pitch)).toEqual([.523809552192688, .5]);
    expect(request.duration).toBeCloseTo(.65, 12); expect(context.sources).toEqual([]); expect(project).toEqual(before);
  });
});
