import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { createAuditionProject } from '../src/core/audition-project';
import { bytesToBase64 } from '../src/core/container';
import { createDefaultDelay } from '../src/core/delay';
import { patternOrigin } from '../src/core/meter';
import { createProject, newNote, renderNoteEvents, uid } from '../src/core/project';
import { beginRecordedPress, finishRecordedPress, type RecordedPress } from '../src/core/recording';
import { previewBackendForProject, type PlaybackMode } from '../src/audio/preview';
import type { Note, Project, SampleLibrary } from '../src/core/types';
import type { TransportPosition } from '../src/core/transport';

// Execute the actual App closures with real timing/recording/effect helpers.
// The engine and desktop boundaries are inert; this is not an audio-device test.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(start: string, end: string): string {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`App audition source boundary missing: ${start} / ${end}`);
  return source.slice(from, to);
}
const code = transformSync([
  section('  async function audition(', '\n  async function loadResources('),
  section('  async function locateSample(', '\n  const midiDown ='),
  section('  midiDown.current = (key,', '\n  finishHeld.current ='),
].join('\n'), { loader: 'ts', target: 'es2022' }).code;

interface AppFunctions {
  audition: (midi: number, note?: Note, origin?: number) => Promise<void>;
  locateSample: () => Promise<void>;
  midiDown: (key: string, pitch: number, velocity: number) => void;
}

function fixture(backend: 'native' | 'web' = 'native', ppq = 480, noteLength = 16) {
  const project = createProject('App Delay audition fixture'); project.ppq = ppq;
  project.audio.previewEngine = backend;
  project.tempos = [{ tick: 0, bpm: 120 }, { tick: ppq * 2, bpm: 60 }, { tick: ppq * 2.5, bpm: 180 }];
  const track = project.tracks[0], pattern = project.patterns[0], region = project.regions[0];
  pattern.notes = [{ ...newNote(ppq / 2, 66, ppq), id: 'existing-note' }];
  track.delay = { ...createDefaultDelay(), enabled: true, mode: 'gate', interval: .5, feedback: 1, wet: 1, attack: 0, decay: 0, sustain: 1, release: 0 };
  const projectRef = { current: project }, positionRef = { current: ppq * 2 }, recordingRef = { current: true };
  const keysHeld = { current: new Map<string, RecordedPress>() }, auditionCache = { current: new Map<string, Uint8Array>() };
  const previews: Project[] = [];
  const library = { root: 'fixture', version: '1.16.5', profileId: project.audio.profileId, nativeLibrary: 'fixture-not-loaded', samples: {} } satisfies SampleLibrary;
  const engine = {
    playing: false, position: vi.fn((): TransportPosition | undefined => undefined),
    nativeRequest: vi.fn(async (preview: Project) => { previews.push(preview); return { serial: previews.length }; }),
    auditionProject: vi.fn(async (preview: Project) => { previews.push(preview); }),
    auditionRendered: vi.fn(async (_wav: Uint8Array) => {}),
    loadProjectSamples: vi.fn(async (_project: Project) => {}),
  };
  const renderNative = vi.fn(async (request: { serial: number }): Promise<{ wav: Uint8Array }> => ({ wav: Uint8Array.of(request.serial) }));
  const file = { name: 'replacement.ogg', bytes: Uint8Array.of(7, 8, 9) };
  const openFile = vi.fn(async () => file), setMessage = vi.fn();
  const commit = (_label: string, change: (project: Project) => void) => { projectRef.current = produce(projectRef.current, draft => { change(draft); }); };
  function functions(editorDocumentKey = 1, playbackMode: PlaybackMode = backend === 'native' ? 'native-compare' : 'realtime'): AppFunctions {
    const midiDown = { current: (_key: string, _pitch: number, _velocity: number) => {} };
    const scope = { track, pattern, region, sourceOrigin: patternOrigin(region, pattern), positionRef, projectRef, library, engine,
      createAuditionProject, previewBackendForProject, preferences: { noteLength, snap: 0 }, stopEpoch: { current: 0 }, auditionCache,
      playbackMode, editorDocumentKey, window: { desktop: { renderNative, openFile } }, setMessage, firstNote: pattern.notes[0],
      instrument: project.instruments.find(item => item.id === track.instrumentId), uid, commit, bytesToBase64,
      midiDown, keysHeld, beginRecordedPress, recordingRef, newNote, setHasHeldRecording: vi.fn() };
    return Function(...Object.keys(scope), `${code}\nreturn {audition,locateSample,midiDown:midiDown.current};`)(...Object.values(scope)) as AppFunctions;
  }
  return { project, projectRef, track, pattern, region, positionRef, keysHeld, auditionCache, previews, engine, renderNative, openFile, setMessage, functions };
}
const settleKeyTrigger = () => new Promise<void>(resolve => setImmediate(resolve));

describe('App Delay audition trigger context', () => {
  it.each(['native', 'web'] as const)('uses realtime audition for a saved %s project unless native comparison was explicitly selected', async saved => {
    const test = fixture(saved), before = structuredClone(test.project);
    await test.functions(1, 'realtime').audition(60);
    expect(test.engine.auditionProject).toHaveBeenCalledOnce();
    expect(test.engine.nativeRequest).not.toHaveBeenCalled(); expect(test.renderNative).not.toHaveBeenCalled();
    expect(test.project).toEqual(before);
  });
  it.each(['native', 'web'] as const)('retains the existing pattern-note origin and exact duration for %s', async backend => {
    const test = fixture(backend), note = test.pattern.notes[0];
    test.region.start = 960; test.region.offset = 240;
    const before = structuredClone(test.project);
    await test.functions().audition(note.midi, note);
    const preview = test.previews[0];
    // patternOrigin 720 + source tick 240 = actual occurrence 960.
    expect(preview.tempos).toEqual([{ tick: 0, bpm: 60 }, { tick: 240, bpm: 180 }]);
    expect(preview.patterns[0].notes[0].duration).toBe(480);
    expect(preview.patterns[0].notes[0].tick).toBe(0);
    expect(renderNoteEvents(preview).notes.map(note => note.absoluteTick)).toEqual([0, 240]);
    expect(test.project).toEqual(before);
  });

  it.each([
    { backend: 'native' as const, ppq: 960, noteLength: 4, interval: .5, duration: 960, onsets: [0, 480] },
    { backend: 'web' as const, ppq: 960, noteLength: 4, interval: .5, duration: 960, onsets: [0, 480] },
    { backend: 'native' as const, ppq: 480, noteLength: 16, interval: .125, duration: 120, onsets: [0, 60] },
    { backend: 'web' as const, ppq: 7, noteLength: 16, interval: .125, duration: 2, onsets: [0, .875, 1.75] },
  ])('uses the keyboard press absolute origin and actual step duration: %j', async ({ backend, ppq, noteLength, interval, duration, onsets }) => {
    const test = fixture(backend, ppq, noteLength); test.track.delay!.interval = interval;
    const before = structuredClone(test.project);
    test.functions().midiDown('keyboard:0', 60, .6); await settleKeyTrigger();
    const press = test.keysHeld.current.get('keyboard:0')!, preview = test.previews[0];
    expect(press.absoluteTick).toBe(2 * ppq);
    expect(preview.tempos).toEqual([{ tick: 0, bpm: 60 }, { tick: ppq / 2, bpm: 180 }]);
    expect(preview.patterns[0].notes[0].duration).toBe(duration);
    expect(preview.patterns[0].notes[0].velocity).toBe(.6);
    expect(finishRecordedPress(test.project, press)!.note.duration).toBe(duration);
    expect(renderNoteEvents(preview).notes.map(note => note.absoluteTick)).toEqual(onsets);
    expect(test.project).toEqual(before);
  });

  it('uses the live transport position rather than a stale caret for keyboard preview', async () => {
    const test = fixture('web', 960, 4);
    test.engine.position.mockReturnValue({ tick: 2400, linearTick: 6240, seconds: 1.5 });
    test.functions().midiDown('keyboard:0', 60, .7); await settleKeyTrigger();
    expect(test.keysHeld.current.get('keyboard:0')!.absoluteTick).toBe(2400);
    expect(test.previews[0].tempos).toEqual([{ tick: 0, bpm: 180 }]);
    expect(test.previews[0].patterns[0].notes[0].duration).toBe(960);
  });
});

describe('App native audition sample cache', () => {
  it('reuses an unchanged preview, then clears and rerenders after replacing its instrument sample', async () => {
    const test = fixture(), app = test.functions(), note = test.pattern.notes[0];
    await app.audition(note.midi, note); await app.audition(note.midi, note);
    expect(test.engine.nativeRequest).toHaveBeenCalledOnce(); expect(test.auditionCache.current.size).toBe(1);
    await app.locateSample();
    expect(test.auditionCache.current.size).toBe(0);
    expect(test.engine.loadProjectSamples).toHaveBeenCalledExactlyOnceWith(test.projectRef.current);
    await app.audition(note.midi, note);
    expect(test.engine.nativeRequest).toHaveBeenCalledTimes(2);
    expect(test.previews[1].instruments.find(item => item.id === test.track.instrumentId)?.assetId).toBe(test.projectRef.current.assets[0].id);
    expect(test.engine.auditionRendered.mock.calls.map(([wav]) => [...wav])).toEqual([[1], [1], [2]]);
  });

  it('cannot reuse a late old-sample result that re-enters the cache after sample replacement', async () => {
    const test = fixture(), app = test.functions(), note = test.pattern.notes[0];
    let release!: (value: { wav: Uint8Array }) => void;
    test.renderNative.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const oldPreview = app.audition(note.midi, note); await Promise.resolve();
    await app.locateSample(); release({ wav: Uint8Array.of(99) }); await oldPreview;
    expect(test.auditionCache.current.size).toBe(1);
    await app.audition(note.midi, note);
    expect(test.engine.nativeRequest).toHaveBeenCalledTimes(2);
    expect(test.engine.auditionRendered.mock.calls.at(-1)![0]).toEqual(Uint8Array.of(2));
  });

  it('does not share a cached preview across adopted document generations with reused IDs', async () => {
    const test = fixture(), note = test.pattern.notes[0];
    await test.functions(1).audition(note.midi, note);
    await test.functions(2).audition(note.midi, note);
    expect(test.engine.nativeRequest).toHaveBeenCalledTimes(2);
  });
});
