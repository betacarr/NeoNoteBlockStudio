import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { growEditedPattern } from '../src/core/editor-interaction';
import { createProject, flattenNotes, newNote } from '../src/core/project';
import { beginRecordedPress, finishRecordedPress, previewRecordingProject, recordingProjectsEqual, type RecordedPress } from '../src/core/recording';
import { commandForShortcut, inspectShortcuts, isShortcutInput, shortcutForEvent } from '../src/core/shortcuts';
import type { Project } from '../src/core/types';
import type { TransportPosition } from '../src/core/transport';

// Isolated source-derived integration: App's actual functions/callbacks, real
// Immer commits and NBSX bytes. Desktop dialogs/engine clock are inert boundaries;
// this does not represent physical keys, native dialogs, playback or GUI testing.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const between = (from: string, to: string) => { const start = source.indexOf(from), end = source.indexOf(to, start); if (start < 0 || end < 0) throw new Error(`App source boundary missing: ${from}`); return source.slice(start, end); };
const closeEntry = between("    'save-close':", '\n    copy:');
const autosaveBody = between('  useEffect(() => {\n    const timer = setInterval(() => {\n      if (!dirty && !hasHeldRecording)', '\n  }, [dirty, hasHeldRecording, editorDocumentKey]);').slice('  useEffect(() => {'.length);
const unsavedExpression = source.match(/const unsaved = ([^;]+);/)?.[1];
if (!unsavedExpression) throw new Error('App unsaved expression was not found');
const unsaved = Function('dirty', 'hasNumberDraft', 'hasHeldRecording', `return ${unsavedExpression};`) as (dirty: boolean, draft: boolean, held: boolean) => boolean;
const actualCode = transformSync([
  between('  function commit(label:', '\n  const changeTrack ='),
  between('  function stop()', '\n  function seek('),
  between('  async function openBytes(', '\n  async function open()'),
  between('  function projectForSave(', '\n  async function saveOriginalMidi('),
  between('  async function save(as', '\n  async function newProject('),
  between('  async function newProject()', '\n  function restoreRecovery('),
  between('  midiDown.current =', '\n  function toggleRecord('),
  between('    const onKeyDown =', "\n    window.addEventListener('keydown'"),
  between('const blur = () => finishHeld.current();', " window.addEventListener('blur'"),
  `function setupAutosave(dirty: boolean, hasHeldRecording: boolean) { ${autosaveBody}\n }`,
  `const saveCloseCommand = { ${closeEntry}\n };`,
].join('\n'), { loader: 'ts', target: 'es2022' }).code;

function fixture({ live = false, caret = 0, length = 1920, ppq = 480, snap = 0, loop = false }: { live?: boolean; caret?: number; length?: number; ppq?: number; snap?: number; loop?: boolean } = {}) {
  const project = createProject('Recording save fixture'); project.ppq = ppq; project.regions[0].loop = loop;
  project.patterns[0].length = project.regions[0].length = length;
  project.patterns[0].notes = [{ ...newNote(0, 55, 60), id: 'existing-note' }];
  const original = structuredClone(project), projectRef = { current: project }, savedSnapshot = { current: project as Project | undefined };
  const numberEditOwner = { current: { project, generation: 0 } };
  const history = { current: [] as { label: string; project: Project; selection: unknown }[] }, future = { current: [] as unknown[] };
  const keysHeld = { current: new Map<string, RecordedPress>() }, positionRef = { current: caret }, recordingRef = { current: true }, stopEpoch = { current: 0 };
  const state = { dirty: false, held: false, playing: live, revision: 0, message: '', filePath: '/memory/current.nbsx', recovery: { projectId: project.id } as { projectId: string } | null };
  const order: string[] = [], files: Uint8Array[] = [], autosaves: Uint8Array[] = [], timers: (() => void)[] = [];
  let clock: TransportPosition | undefined = live ? { tick: 120, linearTick: 120, seconds: .125 } : undefined;
  let saveBehavior = async (): Promise<string | undefined> => '/memory/saved.nbsx', clearBehavior = async () => {}, numberFlushBehavior = () => true;
  let resolveClosed!: () => void; const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const engine = { playing: live, position: vi.fn(() => clock), stop: vi.fn(() => { order.push('stop'); engine.playing = false; clock = undefined; }) };
  const desktop = {
    saveFile: vi.fn(async (_name: string, bytes: Uint8Array, _path?: string) => { order.push('save'); files.push(Uint8Array.from(bytes)); return saveBehavior(); }),
    clearRecovery: vi.fn(async (_id: string) => { order.push('clear-recovery'); await clearBehavior(); }),
    autosave: vi.fn(async (bytes: Uint8Array) => { autosaves.push(Uint8Array.from(bytes)); }),
    notifyDirty: vi.fn(async (_value: boolean) => { order.push('notify-clean'); }),
    closeAfterSave: vi.fn(async () => { order.push('close'); resolveClosed(); }),
  };
  const window = { desktop, confirm: vi.fn(() => false) }, adopt = vi.fn(), audition = vi.fn(async () => {}), finishNumberDraft = vi.fn(() => numberFlushBehavior());
  const midiDown = { current: (_key: string, _pitch: number, _velocity: number) => {} }, midiUp = { current: (_key: string) => {} }, finishHeld = { current: (_keys?: string[]) => {} };
  const commands = { current: {} }, setMessage = vi.fn((message: string) => { state.message = message; });
  const scope = { recordDiagnostic: () => {}, audioDiagnosticSnapshot: () => ({}), signalLogged: { current: false }, projectRef, savedSnapshot, numberEditOwner, history, future, keysHeld, positionRef, recordingRef, stopEpoch, engine, window, adopt, audition, midiDown, midiUp, finishHeld, commands,
    editorDocumentKey: 0, region: project.regions[0], pattern: project.patterns[0], preferences: { snap, noteLength: 16 }, portable: false, library: undefined, filePath: state.filePath,
    setMessage, setProject: vi.fn(), setDirty: (value: boolean) => { state.dirty = value; }, setHasHeldRecording: (value: boolean) => { state.held = value; }, setPlaying: (value: boolean) => { state.playing = value; },
    setRevision: (update: (value: number) => number) => { state.revision = update(state.revision); }, setFilePath: (value: string) => { state.filePath = value; }, setRecovery: (update: (value: typeof state.recovery) => typeof state.recovery) => { state.recovery = update(state.recovery); }, setPlayhead: vi.fn(),
    selectionSnapshot: () => ({ trackId: project.tracks[0].id, regionId: project.regions[0].id, noteIds: [], focus: 'piano' }),
    finishNumberDraft, produce, createProject, openNbsx, saveNbsx, flattenNotes, bytesToBase64, growEditedPattern, beginRecordedPress, finishRecordedPress, previewRecordingProject, recordingProjectsEqual, newNote,
    localStorage: { removeItem: vi.fn(), setItem: vi.fn() }, download: vi.fn(),
    keyboardEnabled: false, recording: true, modal: null, setModal: vi.fn(), isShortcutInput, shortcutForEvent, commandForShortcut, shortcutPlatform: 'win32', bindings: inspectShortcuts('fl', {}, 'win32').effective,
    setInterval: (callback: () => void) => { timers.push(callback); return timers.length; }, clearInterval: vi.fn(),
  };
  const api = Function(...Object.keys(scope), `${actualCode}\nreturn { save, projectForSave, newProject, openBytes, stop, blur, onKeyDown, onKeyUp, setupAutosave, commit, saveClose: saveCloseCommand['save-close'], setDocumentKey: (key) => { editorDocumentKey = key; } };`)(...Object.values(scope)) as {
    save: (as?: boolean) => Promise<boolean>; projectForSave: (base?: Project) => Project; newProject: () => Promise<void>; openBytes: (name: string, bytes: Uint8Array, path?: string) => Promise<void>;
    stop: () => void; blur: () => void; onKeyDown: (event: any) => void; onKeyUp: (event: any) => void; setupAutosave: (dirty: boolean, held: boolean) => () => void; commit: (label: string, change: (project: Project) => void) => void;
    saveClose: () => void; setDocumentKey: (value: number) => void;
  };
  const recorded = (target = projectRef.current) => target.patterns[0].notes.filter(note => note.id !== 'existing-note');
  const keyEvent = (repeat = false) => ({ key: 'z', code: 'KeyZ', repeat, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, isComposing: false, getModifierState: () => false, target: null, preventDefault: vi.fn() });
  return { api, state, original, projectRef, savedSnapshot, numberEditOwner, history, future, keysHeld, positionRef, stopEpoch, engine, desktop, window, adopt, audition, finishNumberDraft, files, autosaves, timers, closed, order, recorded, keyEvent,
    down: (key = 'held', pitch = 64) => midiDown.current(key, pitch, .7), up: (key = 'held') => midiUp.current(key),
    at: (tick: number) => { clock = { tick, linearTick: tick, seconds: tick / 960 }; },
    saveBehavior: (callback: typeof saveBehavior) => { saveBehavior = callback; }, clearBehavior: (callback: typeof clearBehavior) => { clearBehavior = callback; }, numberFlushBehavior: (callback: typeof numberFlushBehavior) => { numberFlushBehavior = callback; },
    saved: (index = files.length - 1) => openNbsx(files[index]), unsaved: () => unsaved(state.dirty, false, state.held) };
}

describe('App held-recording save boundaries (source-derived integration)', () => {
  it('saves a live snapshot without ending the press or adding history, then keeps the stable ID and complete keyup duration', async () => {
    const test = fixture({ live: true }), base = test.projectRef.current;
    test.down(); const press = test.keysHeld.current.get('held')!; test.at(300);
    expect(test.unsaved()).toBe(true); expect(await test.api.save()).toBe(false);
    expect(test.projectRef.current).toBe(base); expect(test.projectRef.current).toEqual(test.original); expect(test.history.current).toHaveLength(0);
    expect(test.keysHeld.current.get('held')).toBe(press); expect(test.engine.stop).not.toHaveBeenCalled(); expect(test.desktop.clearRecovery).not.toHaveBeenCalled();
    const pendingNote = { id: press.noteId, tick: 120, duration: 180, midi: 64, velocity: .7, pan: 0, detune: 0, height: 0 };
    const expectedSnapshot = structuredClone(test.original); expectedSnapshot.patterns[0].notes.push(pendingNote);
    expect(test.recorded(test.saved())).toEqual([pendingNote]); expect(recordingProjectsEqual(test.saved(), expectedSnapshot)).toBe(true);
    test.at(600); test.up();
    expect(test.recorded()).toEqual([{ id: press.noteId, tick: 120, duration: 480, midi: 64, velocity: .7, pan: 0, detune: 0, height: 0 }]);
    expect(test.keysHeld.current.size).toBe(0); expect(test.history.current).toHaveLength(1); expect(test.state.held).toBe(false); expect(test.state.dirty).toBe(true);
    expect(test.numberEditOwner.current).toEqual({ project: test.projectRef.current, generation: 0 });
    expect(test.projectRef.current.patterns[0].notes[0]).toEqual(test.original.patterns[0].notes[0]);
    const expectedComplete = structuredClone(expectedSnapshot); expectedComplete.patterns[0].notes.find(note => note.id === press.noteId)!.duration = 480;
    expect(recordingProjectsEqual(test.projectRef.current, expectedComplete)).toBe(true);
  });

  it('marks an equivalent step note committed by dialog blur clean after the saved snapshot returns', async () => {
    const test = fixture(); test.down(); const id = test.keysHeld.current.get('held')!.noteId;
    test.saveBehavior(async () => { test.api.blur(); return '/memory/step.nbsx'; });
    expect(await test.api.save()).toBe(true);
    expect(test.recorded()[0]).toMatchObject({ id, duration: 120 }); expect(recordingProjectsEqual(test.saved(), test.projectRef.current)).toBe(true);
    expect(test.savedSnapshot.current).toBe(test.projectRef.current); expect(test.state.dirty).toBe(false); expect(test.unsaved()).toBe(false);
    expect(test.history.current).toHaveLength(1); expect(test.desktop.clearRecovery).toHaveBeenCalledOnce(); expect(test.state.recovery).toBeNull();
  });

  it('becomes clean when step-save resolves first and the same stable note is committed on later keyup', async () => {
    const test = fixture(); test.down(); const id = test.keysHeld.current.get('held')!.noteId;
    expect(await test.api.save()).toBe(false);
    expect(test.state.held).toBe(true); expect(test.unsaved()).toBe(true); expect(test.history.current).toHaveLength(0);
    test.up();
    expect(test.recorded()).toEqual([{ id, tick: 0, duration: 120, midi: 64, velocity: .7, pan: 0, detune: 0, height: 0 }]);
    expect(recordingProjectsEqual(test.projectRef.current, test.saved())).toBe(true);
    expect(test.savedSnapshot.current).toBe(test.projectRef.current); expect(test.state.dirty).toBe(false); expect(test.state.held).toBe(false); expect(test.unsaved()).toBe(false);
    expect(test.history.current).toHaveLength(1); expect(test.desktop.clearRecovery).toHaveBeenCalledOnce(); expect(test.state.recovery).toBeNull();
  });

  it('keeps a saved chord pending until its final keyup, including reverse release order', async () => {
    for (const order of [['a', 'b'], ['b', 'a']]) {
      const test = fixture(); test.down('a', 60); test.down('b', 64);
      const ids = [...test.keysHeld.current.values()].map(press => press.noteId);
      expect(await test.api.save()).toBe(false); const marker = test.savedSnapshot.current;
      test.up(order[0]);
      expect(test.state.held).toBe(true); expect(test.unsaved()).toBe(true); expect(test.state.dirty).toBe(true);
      expect(test.savedSnapshot.current).toBe(marker); expect(test.recorded()).toHaveLength(1);
      test.up(order[1]);
      expect(new Set(test.recorded().map(note => note.id))).toEqual(new Set(ids));
      // Isolate note ordering from any unrelated data change in the comparison.
      const savedOrder = new Map(marker!.patterns[0].notes.map((note, index) => [note.id, index])), reordered = structuredClone(test.projectRef.current);
      reordered.patterns[0].notes.sort((a, b) => savedOrder.get(a.id)! - savedOrder.get(b.id)!);
      expect(recordingProjectsEqual(reordered, marker!)).toBe(true);
      expect(test.state.held).toBe(false); expect(test.state.dirty).toBe(false); expect(test.unsaved()).toBe(false);
      expect(test.savedSnapshot.current).toBe(test.projectRef.current); expect(test.history.current).toHaveLength(2);
    }
  });

  it('keeps a longer live note committed during dialog blur dirty instead of claiming the earlier snapshot matches', async () => {
    const test = fixture({ live: true }); test.down(); test.at(300);
    test.saveBehavior(async () => { test.at(600); test.api.blur(); return '/memory/live.nbsx'; });
    expect(await test.api.save()).toBe(false);
    expect(test.recorded(test.saved())[0].duration).toBe(180); expect(test.recorded()[0].duration).toBe(480);
    expect(test.recorded()[0].id).toBe(test.recorded(test.saved())[0].id); expect(test.state.dirty).toBe(true); expect(test.unsaved()).toBe(true);
    expect(test.savedSnapshot.current).not.toBe(test.projectRef.current); expect(test.desktop.clearRecovery).not.toHaveBeenCalled(); expect(test.history.current).toHaveLength(1);
  });

  it.each(['cancel', 'failure'])('retains held recording and the saved marker when saving ends with %s', async outcome => {
    const test = fixture({ live: true }), marker = test.savedSnapshot.current; test.down(); test.at(300);
    const press = test.keysHeld.current.get('held');
    test.saveBehavior(async () => { if (outcome === 'failure') throw new Error('fixture disk failure'); return undefined; });
    expect(await test.api.save()).toBe(false);
    expect(test.savedSnapshot.current).toBe(marker); expect(test.keysHeld.current.get('held')).toBe(press); expect(test.projectRef.current).toBe(marker);
    expect(test.history.current).toHaveLength(0); expect(test.unsaved()).toBe(true); expect(test.desktop.clearRecovery).not.toHaveBeenCalled();
    if (outcome === 'failure') expect(test.state.message).toContain('fixture disk failure');
  });

  it('finalizes held input before stop/save-close writes and closes', async () => {
    const test = fixture({ live: true }); test.down(); const id = test.keysHeld.current.get('held')!.noteId; test.at(600);
    test.api.saveClose(); await test.closed;
    expect(test.order.indexOf('stop')).toBeLessThan(test.order.indexOf('save')); expect(test.stopEpoch.current).toBe(1);
    expect(test.keysHeld.current.size).toBe(0); expect(test.history.current).toHaveLength(1); expect(test.recorded(test.saved())[0]).toMatchObject({ id, duration: 480 });
    expect(test.state.dirty).toBe(false); expect(test.unsaved()).toBe(false); expect(test.desktop.notifyDirty).toHaveBeenCalledWith(false); expect(test.desktop.closeAfterSave).toHaveBeenCalledOnce();
  });

  it('flushes a valid number draft before finalizing held input during save-close', async () => {
    const test = fixture(), owner = test.projectRef.current; test.down(); let pending = true;
    // The owner gate models a numeric draft; the project edit uses actual commit.
    test.numberFlushBehavior(() => {
      test.order.push('number-flush'); if (!pending) return true;
      if (test.projectRef.current !== owner) return false;
      test.api.commit('Numeric property', project => { project.patterns[0].notes[0].velocity = .42; }); pending = false; return true;
    });
    test.api.saveClose(); await test.closed;
    expect(test.order.indexOf('number-flush')).toBeLessThan(test.order.indexOf('stop'));
    expect(test.finishNumberDraft).toHaveBeenCalledTimes(2); expect(test.history.current.map(entry => entry.label)).toEqual(['Numeric property', '录入音符']);
    expect(test.saved().patterns[0].notes[0].velocity).toBe(.42); expect(test.recorded(test.saved())).toHaveLength(1);
    expect(test.keysHeld.current.size).toBe(0); expect(test.unsaved()).toBe(false);
  });

  it('does not stop, save or finalize held input when the number draft rejects save-close', () => {
    const test = fixture(); test.down(); const press = test.keysHeld.current.get('held');
    test.numberFlushBehavior(() => false); test.api.saveClose();
    expect(test.finishNumberDraft).toHaveBeenCalledOnce(); expect(test.engine.stop).not.toHaveBeenCalled(); expect(test.desktop.saveFile).not.toHaveBeenCalled();
    expect(test.desktop.closeAfterSave).not.toHaveBeenCalled(); expect(test.keysHeld.current.get('held')).toBe(press); expect(test.history.current).toHaveLength(0); expect(test.unsaved()).toBe(true);
  });

  it('rechecks held input created while recovery cleanup is pending before reporting save success', async () => {
    const test = fixture(); test.clearBehavior(async () => { test.down(); });
    expect(await test.api.save()).toBe(false);
    expect(test.keysHeld.current.size).toBe(1); expect(test.state.held).toBe(true); expect(test.unsaved()).toBe(true); expect(test.history.current).toHaveLength(0);
  });

  it.each(['new', 'open'])('prompts and preserves pending capture when %s is cancelled despite an unchanged project reference', async action => {
    const test = fixture(), base = test.projectRef.current; test.down();
    expect(test.state.dirty).toBe(false); expect(test.projectRef.current).toBe(test.savedSnapshot.current); expect(test.unsaved()).toBe(true);
    if (action === 'new') await test.api.newProject(); else await test.api.openBytes('other.nbsx', saveNbsx(createProject('Other document')));
    expect(test.window.confirm).toHaveBeenCalledOnce(); expect(test.adopt).not.toHaveBeenCalled(); expect(test.projectRef.current).toBe(base);
    expect(test.keysHeld.current.size).toBe(1); expect(test.desktop.clearRecovery).not.toHaveBeenCalled(); expect(test.history.current).toHaveLength(0);
  });

  it('ignores keyboard repeats after a blur has finalized the original press', () => {
    const test = fixture(); test.api.onKeyDown(test.keyEvent()); test.api.blur();
    expect(test.recorded()).toHaveLength(1); expect(test.keysHeld.current.size).toBe(0);
    test.api.onKeyDown(test.keyEvent(true)); test.api.onKeyUp(test.keyEvent());
    expect(test.keysHeld.current.size).toBe(0); expect(test.recorded()).toHaveLength(1); expect(test.history.current).toHaveLength(1); expect(test.audition).toHaveBeenCalledOnce();
  });

  it('cancels a capture from an earlier document identity without committing', () => {
    const test = fixture(); test.down(); test.api.setDocumentKey(1); test.up();
    expect(test.recorded()).toEqual([]); expect(test.history.current).toHaveLength(0); expect(test.state.held).toBe(false); expect(test.state.message).toContain('取消');
  });

  it('keeps the second stable note of a held chord when the first keyup grows the region', () => {
    const test = fixture({ caret: 960, length: 480 }); test.down('a', 60); test.down('b', 64);
    const a = test.keysHeld.current.get('a')!, b = test.keysHeld.current.get('b')!;
    test.up('a');
    expect(test.projectRef.current.regions[0].length).toBeGreaterThan(480); expect(test.state.held).toBe(true);
    expect(test.keysHeld.current.get('b')).toMatchObject({ noteId: b.noteId, sourceTick: b.sourceTick, regionState: { length: test.projectRef.current.regions[0].length } });
    test.up('b');
    expect(test.recorded().map(note => [note.id, note.tick, note.duration, note.midi])).toEqual([[a.noteId, 960, 120, 60], [b.noteId, 960, 120, 64]]);
    expect(test.history.current).toHaveLength(2); expect(test.keysHeld.current.size).toBe(0); expect(test.state.held).toBe(false);
  });

  it('retains a one-tick loop period and both chord notes at a fractional onset', () => {
    const test = fixture({ live: true, ppq: 1, snap: 64, loop: true, length: 1 }); test.at(.9375);
    test.down('a', 60); test.down('b', 64);
    const a = test.keysHeld.current.get('a')!, b = test.keysHeld.current.get('b')!;
    test.up('a');
    expect(test.projectRef.current.patterns[0].length).toBe(1); expect(test.projectRef.current.regions[0].length).toBe(1);
    expect(test.keysHeld.current.get('b')!.noteId).toBe(b.noteId); expect(test.state.held).toBe(true);
    test.up('b');
    expect(test.recorded()).toEqual([
      { id: a.noteId, tick: .9375, duration: 1, midi: 60, velocity: .7, pan: 0, detune: 0, height: 0 },
      { id: b.noteId, tick: .9375, duration: 1, midi: 64, velocity: .7, pan: 0, detune: 0, height: 0 },
    ]);
    expect(test.projectRef.current.patterns[0].length).toBe(1); expect(test.projectRef.current.regions[0].length).toBe(1);
    expect(test.history.current).toHaveLength(2); expect(test.keysHeld.current.size).toBe(0); expect(test.state.held).toBe(false);
  });

  it('does not rebase a capture over an external region crop', () => {
    const test = fixture(); test.down();
    test.api.commit('User region crop', project => { project.regions[0].length -= 120; });
    test.up();
    expect(test.recorded()).toEqual([]); expect(test.history.current).toHaveLength(1); expect(test.state.message).toContain('取消'); expect(test.state.held).toBe(false);
  });

  it('autosaves the pending preview through the actual timer callback without mutating source, keys or history', async () => {
    const test = fixture({ live: true }), base = test.projectRef.current; test.down(); const press = test.keysHeld.current.get('held')!; test.at(300);
    const cleanup = test.api.setupAutosave(test.state.dirty, test.state.held); test.timers.at(-1)!(); await Promise.resolve(); cleanup();
    const saved = openNbsx(test.autosaves[0]), expected = structuredClone(test.original);
    expected.patterns[0].notes.push({ id: press.noteId, tick: 120, duration: 180, midi: 64, velocity: .7, pan: 0, detune: 0, height: 0 });
    expect(test.desktop.autosave).toHaveBeenCalledOnce(); expect(test.recorded(saved)[0]).toMatchObject({ id: press.noteId, duration: 180 });
    expect(recordingProjectsEqual(saved, expected)).toBe(true);
    expect(test.projectRef.current).toBe(base); expect(test.projectRef.current).toEqual(test.original); expect(test.keysHeld.current.get('held')).toBe(press);
    expect(test.history.current).toHaveLength(0); expect(test.state.held).toBe(true); expect(test.savedSnapshot.current).toBe(base);
  });
});
