import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { previewBackendForProject, type PlaybackMode } from '../src/audio/preview';
import { createProject } from '../src/core/project';
import { playbackEndTick } from '../src/core/reference';
import { createTempoMap } from '../src/core/time';
import type { Project, Track } from '../src/core/types';

// Actual App playback closures and project effect, with inert engine/desktop
// boundaries. These checks do not assert Web Audio output or physical input.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(from: string, to: string) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`App preview boundary missing: ${from}`);
  return source.slice(start, end);
}
const localModeState = source.split('\n').find(line => line.includes('[playbackMode, setPlaybackMode]'));
if (!localModeState) throw new Error('App local playback state missing');
const bpmStart = source.indexOf('<input aria-label="当前位置速度 BPM"');
if (bpmStart < 0) throw new Error('App current-tempo input missing');
const bpmSource = source.slice(bpmStart, source.indexOf('/>', bpmStart) + 2);
const code = transformSync([
  localModeState,
  section('  function commit(', '\n  const changeTrack ='),
  section('  function updateRealtimeProject(', '\n  function filterInstruments('),
  section('  function stop()', '\n  async function audition('),
  section('  function undo()', '\n  function copyNotes('),
  source.split('\n').find(line => line.startsWith('  const changeReference = '))!,
  source.split('\n').find(line => line.startsWith('  const removeReference = '))!,
  `const timingCommand = { ${section('timing: () => {', "\n    'save-close':")} };`,
  `const bpmInput = ${bpmSource};`,
  section('  useEffect(() => {\n    if (!engine.playing) return;', "  useEffect(() => { try { localStorage.setItem('nbsx-preferences'"),
].join('\n'), { loader: 'tsx', jsxFactory: 'element', target: 'es2022' }).code;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const project = createProject('Realtime App fixture');
  const projectRef = { current: project }, stopEpoch = { current: 0 }, positionRef = { current: 120 };
  const state = { mode: undefined as PlaybackMode | undefined, busy: false, playing: false, meter: 'tracks', message: '', playhead: 0, loop: false };
  const history = { current: [] as { label: string; project: Project; selection: unknown }[] }, future = { current: [] as { label: string; project: Project; selection: unknown }[] };
  const savedSnapshot = { current: project }, numberEditOwner = { current: { project, generation: 0 } };
  const finishHeld = { current: vi.fn() };
  const previewSamplesReady = { current: Promise.resolve(20) };
  const engine = {
    playing: false,
    stop: vi.fn(() => { engine.playing = false; }),
    loadReference: vi.fn(async (_project: Project) => undefined as { duration: number } | undefined),
    play: vi.fn(async (_project: Project, _from: number, _loop: boolean) => { engine.playing = true; return true; }),
    playRendered: vi.fn(async (_project: Project, _wav: Uint8Array, _from: number, _start?: number, _end?: number) => { engine.playing = true; return true; }),
    nativeRequest: vi.fn(async (_project: Project) => ({ sampleRate: 48000, duration: 4, events: [] as { time: number; frame?: number; tick?: number }[] })),
    updateProject: vi.fn((_project: Project) => engine.playing),
    previewTrack: vi.fn((_id: string, _patch: Partial<Track> | undefined) => {}),
    previewMaster: vi.fn((_value: number | undefined) => {}),
  };
  const renderNative = vi.fn(async (_request: unknown) => ({ wav: Uint8Array.of(1, 2, 3) }));
  const renderCache = { current: undefined };
  const setPlaybackMode = vi.fn((value: PlaybackMode) => { state.mode = value; });
  function functions() {
    let runEffect = () => {};
    const scope = {
      project: projectRef.current, projectRef, stopEpoch, positionRef, engine, finishHeld, noteRangePreview: { current: undefined },
      produce, history, future, savedSnapshot, numberEditOwner, selectionSnapshot: () => ({ trackId: project.tracks[0].id, noteIds: [], focus: 'piano' }),
      setProject: vi.fn(), setDirty: vi.fn(), setRevision: vi.fn(), restoreSelection: vi.fn(), setModal: vi.fn(),
      useState: (initial: PlaybackMode) => { state.mode ??= initial; return [state.mode, setPlaybackMode]; },
      useEffect: (callback: () => void) => { runEffect = callback; },
      setPlaying: (value: boolean) => { state.playing = value; }, setBusy: (value: boolean) => { state.busy = value; },
      setPlayhead: (value: number) => { state.playhead = value; }, setLoop: (value: boolean) => { state.loop = value; },
      setMessage: (value: string) => { state.message = value; }, setMixerMeterScope: (value: string) => { state.meter = value; },
      busy: state.busy, playing: state.playing, loop: state.loop, revision: 0, renderCache,
      library: { profileId: project.audio.profileId, root: 'fixture', version: '1.16.5', samples: {}, nativeLibrary: 'original-not-loaded' },
      window: { desktop: { renderNative } }, previewBackendForProject, playbackEndTick, createTempoMap,
      previewSamplesReady, setPreviewSampleCount: vi.fn(),
      audioProfile: () => ({ status: 'fixture' }), PROFILE_STATUS: { fixture: 'inert test boundary' },
      activeTempo: createTempoMap(projectRef.current).at(positionRef.current),
      element: (_tag: string, props: unknown) => props,
    };
    const app = Function(...Object.keys(scope), `${code}\nreturn {togglePlay,changePlaybackMode,previewMixerTrack,previewMixerMaster,commit,undo,redo,changeReference,removeReference,openTiming:timingCommand.timing,bpmInput};`)(...Object.values(scope)) as {
      togglePlay: () => Promise<void>;
      changePlaybackMode: (value: PlaybackMode) => void;
      previewMixerTrack: (id: string, patch: Partial<Track> | undefined) => void;
      previewMixerMaster: (value: number | undefined) => void;
      commit: (label: string, edit: (project: Project) => void) => void;
      undo: () => void; redo: () => void; openTiming: () => void;
      changeReference: (patch: { startTick?: number; gain?: number }) => void; removeReference: () => void;
      bpmInput: { readOnly: boolean; onChange: (event: { target: { value: string } }) => void };
    };
    return { ...app, runEffect: () => runEffect() };
  }
  return { project, projectRef, stopEpoch, positionRef, state, engine, renderNative, finishHeld, setPlaybackMode, functions };
}

describe('App local realtime/default playback integration', () => {
  it.each([undefined, 'native', 'web'] as const)('starts saved %s projects in realtime and keeps their complete source unchanged', async saved => {
    const t = fixture(); t.project.audio.previewEngine = saved;
    const before = structuredClone(t.project), app = t.functions();
    expect(t.state.mode).toBe('realtime');
    await app.togglePlay();
    expect(t.engine.play).toHaveBeenCalledExactlyOnceWith(t.project, 120, false);
    expect(t.engine.nativeRequest).not.toHaveBeenCalled(); expect(t.renderNative).not.toHaveBeenCalled();
    expect(t.state).toMatchObject({ playing: true, meter: 'tracks', busy: false });
    expect(t.projectRef.current).toBe(t.project); expect(t.project).toEqual(before);
  });

  it('stops before changing local mode, treats same mode as a no-op, and preserves the saved Web marker during explicit native comparison', async () => {
    const t = fixture(); t.project.audio.previewEngine = 'web'; const before = structuredClone(t.project), app = t.functions();
    app.changePlaybackMode('realtime'); expect(t.engine.stop).not.toHaveBeenCalled();
    t.engine.playing = true; t.state.playing = true;
    app.changePlaybackMode('native-compare');
    expect(t.engine.stop).toHaveBeenCalledOnce(); expect(t.finishHeld.current).toHaveBeenCalledOnce();
    expect(t.engine.stop.mock.invocationCallOrder[0]).toBeLessThan(t.setPlaybackMode.mock.invocationCallOrder[0]);
    expect(t.stopEpoch.current).toBe(1); expect(t.state.playing).toBe(false);
    await t.functions().togglePlay();
    expect(t.engine.playRendered).toHaveBeenCalledOnce(); expect(t.engine.play).not.toHaveBeenCalled();
    expect(t.state).toMatchObject({ playing: true, meter: 'master', mode: 'native-compare' });
    expect(t.project).toEqual(before);
  });

  it('rejects a stale project during reference loading before scheduling either backend', async () => {
    const t = fixture(), waiting = deferred<undefined>(); t.engine.loadReference.mockReturnValueOnce(waiting.promise);
    const playback = t.functions().togglePlay();
    t.projectRef.current = { ...t.project, name: 'New current revision' }; waiting.resolve(undefined); await playback;
    expect(t.engine.play).not.toHaveBeenCalled(); expect(t.renderNative).not.toHaveBeenCalled(); expect(t.state.playing).toBe(false); expect(t.state.busy).toBe(false);
  });

  it.each(['project', 'mode'] as const)('stops a realtime startup that became stale during engine await: %s', async reason => {
    const t = fixture(), waiting = deferred<boolean>();
    t.engine.play.mockImplementationOnce(async () => { await waiting.promise; t.engine.playing = true; return true; });
    const app = t.functions(), playback = app.togglePlay();
    for (let n = 0; n < 12 && !t.engine.play.mock.calls.length; n++) await Promise.resolve();
    expect(t.engine.play).toHaveBeenCalledOnce();
    if (reason === 'project') t.projectRef.current = { ...t.project, name: 'Edited while loading' };
    else app.changePlaybackMode('native-compare');
    waiting.resolve(true); await playback;
    expect(t.engine.playing).toBe(false); expect(t.state.playing).toBe(false); expect(t.state.message).toBe(''); expect(t.state.busy).toBe(false);
  });

  it('rejects stale native decode completion before marking playback or meter scope active', async () => {
    const t = fixture(), waiting = deferred<boolean>(); t.functions().changePlaybackMode('native-compare');
    t.engine.playRendered.mockImplementationOnce(async () => { await waiting.promise; t.engine.playing = true; return true; });
    const playback = t.functions().togglePlay();
    for (let n = 0; n < 5 && !t.engine.playRendered.mock.calls.length; n++) await Promise.resolve();
    expect(t.engine.playRendered).toHaveBeenCalledOnce();
    t.projectRef.current = { ...t.project, name: 'Edited before decode completed' }; waiting.resolve(true); await playback;
    expect(t.engine.playing).toBe(false); expect(t.state.playing).toBe(false); expect(t.state.meter).toBe('tracks'); expect(t.state.busy).toBe(false);
  });

  it.each(['realtime', 'native-compare'] as const)('keeps realtime history navigation playing but stops explicit native comparison: %s', mode => {
    const t = fixture(); t.state.mode = mode;
    const app = t.functions(); app.commit('note edit', project => { project.patterns[0].notes.push({ id: 'added', tick: 120, midi: 60, duration: 120, velocity: 1, pan: 0, detune: 0, height: 0 }); });
    const edited = t.projectRef.current; t.engine.playing = true; t.state.playing = true;
    app.undo(); expect(t.projectRef.current).toBe(t.project);
    expect(t.engine.stop).toHaveBeenCalledTimes(mode === 'realtime' ? 0 : 1);
    expect(t.engine.playing).toBe(mode === 'realtime');
    app.redo(); expect(t.projectRef.current).toBe(edited);
    expect(t.engine.stop).toHaveBeenCalledTimes(mode === 'realtime' ? 0 : 2);
    expect(t.finishHeld.current).toHaveBeenCalledTimes(2);
  });

  it.each(['realtime', 'native-compare'] as const)('opens timing and edits/removes reference without stopping only in realtime: %s', mode => {
    const t = fixture(); t.state.mode = mode;
    t.project.reference = { assetId: 'reference-file', startTick: 0, gain: .7 };
    t.engine.playing = true; t.state.playing = true; const app = t.functions();
    app.openTiming(); app.changeReference({ startTick: 480, gain: .25 });
    expect(t.projectRef.current.reference).toEqual({ assetId: 'reference-file', startTick: 480, gain: .25 });
    app.removeReference(); expect(t.projectRef.current.reference).toBeUndefined();
    expect(t.engine.stop).toHaveBeenCalledTimes(mode === 'realtime' ? 0 : 3);
    expect(t.engine.playing).toBe(mode === 'realtime'); expect(t.finishHeld.current).toHaveBeenCalledTimes(3);
  });

  it('allows the actual BPM input to commit live tempo while retaining native playback read-only behavior', () => {
    const t = fixture(); t.engine.playing = true; t.state.playing = true;
    const app = t.functions(); expect(app.bpmInput.readOnly).toBe(false);
    app.bpmInput.onChange({ target: { value: '150' } });
    expect(t.projectRef.current.tempos).toEqual([{ tick: 0, bpm: 150 }]); expect(t.engine.playing).toBe(true); expect(t.engine.stop).not.toHaveBeenCalled();
    t.functions().runEffect(); expect(t.engine.updateProject).toHaveBeenCalledExactlyOnceWith(t.projectRef.current);
    t.state.mode = 'native-compare'; expect(t.functions().bpmInput.readOnly).toBe(true);
    t.state.playing = false; expect(t.functions().bpmInput.readOnly).toBe(false);
  });
});

describe('App synchronous live project/temporary mixer overlays', () => {
  it('updates only an active engine through the actual project effect, using the newest project without a stop/replay', () => {
    const t = fixture(); t.functions().runEffect(); expect(t.engine.updateProject).not.toHaveBeenCalled();
    t.engine.playing = true; const next = { ...t.project, name: 'Updated notes / Delay / tempo revision' }; t.projectRef.current = next;
    t.functions().runEffect(); expect(t.engine.updateProject).toHaveBeenCalledExactlyOnceWith(next); expect(t.engine.stop).not.toHaveBeenCalled();
    t.engine.updateProject.mockReturnValueOnce(false); t.functions().runEffect(); expect(t.state.message).toBe('');
    t.engine.updateProject.mockImplementationOnce(() => { throw new Error('event budget'); }); t.functions().runEffect();
    expect(t.state.message).toBe('实时试听更新失败：event budget'); expect(t.projectRef.current).toBe(next);
  });

  it('previews without history/source writes, then installs the committed live snapshot before clearing track or master overlays', () => {
    const t = fixture(), app = t.functions(), before = structuredClone(t.project), id = t.project.tracks[0].id;
    app.previewMixerTrack(id, { volume: 2, pan: -.4 }); app.previewMixerMaster(.3);
    expect(t.engine.previewTrack).toHaveBeenCalledExactlyOnceWith(id, { volume: 2, pan: -.4 }); expect(t.engine.previewMaster).toHaveBeenCalledExactlyOnceWith(.3);
    expect(t.engine.updateProject).not.toHaveBeenCalled(); expect(t.project).toEqual(before);
    const latest = { ...t.project, audio: { ...t.project.audio, masterGain: .3 } }; t.projectRef.current = latest;
    app.previewMixerTrack(id, undefined); app.previewMixerMaster(undefined);
    expect(t.engine.updateProject.mock.calls.map(([p]) => p)).toEqual([latest, latest]);
    expect(t.engine.updateProject.mock.invocationCallOrder[0]).toBeLessThan(t.engine.previewTrack.mock.invocationCallOrder[1]);
    expect(t.engine.updateProject.mock.invocationCallOrder[1]).toBeLessThan(t.engine.previewMaster.mock.invocationCallOrder[1]);
    expect(t.project).toEqual(before); expect(t.projectRef.current).toBe(latest);
  });

  it('still clears temporary overlays when applying the committed project throws', () => {
    const t = fixture(), app = t.functions(), id = t.project.tracks[0].id;
    t.engine.updateProject.mockImplementation(() => { throw new Error('invalid live plan'); });
    app.previewMixerTrack(id, undefined); app.previewMixerMaster(undefined);
    expect(t.engine.previewTrack).toHaveBeenCalledExactlyOnceWith(id, undefined); expect(t.engine.previewMaster).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(t.state.message).toContain('invalid live plan');
  });
});
