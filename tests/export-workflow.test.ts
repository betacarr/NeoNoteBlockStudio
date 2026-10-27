import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fromArrayBuffer } from '@nbsjs/core';
import { describe, expect, it, vi } from 'vitest';
import { createProject, newNote } from '../src/core/project';
import { exportNbs } from '../src/core/nbs';
import { exportMidi } from '../src/core/midi';
import { nbsExportTiming, type NbsTempoPreset } from '../src/core/nbs-export-timing';
import { isCurrentExport, syncExportOwner, type ExportContext, type ExportOptions, type ExportOwner, type ExportTicket, type PreparedExport } from '../src/ui/export-context';
import type { Project, SampleLibrary } from '../src/core/types';

// Actual App closures and MIDI/NBS writers, with an independent NBS reader.
// Audio/desktop promises are inert boundaries, not UI or hardware acceptance.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('  function changeExportOptions('), end = source.indexOf('\n  async function importReference(', start);
if (start < 0 || end < 0) throw new Error('Missing actual App export functions');
const code = transformSync(source.slice(start, end), { loader: 'ts', target: 'es2022' }).code;
const errorStart = source.indexOf('  const currentExportError = '), errorEnd = source.indexOf(';', errorStart);
if (errorStart < 0 || errorEnd < 0) throw new Error('Missing actual App export error visibility');
const errorCode = source.slice(errorStart + '  const currentExportError = '.length, errorEnd);
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture(format: ExportOptions['format'] = 'wav', nativeAudio = false) {
  const project = createProject('Export source'); project.ppq = 480; project.tempos = [{ tick: 0, bpm: 120 }];
  project.patterns[0].notes = [{ ...newNote(240, 66, 480), velocity: .8 }];
  const projectRef = { current: project }, modalRef = { current: 'export' as string | null };
  const library: SampleLibrary = { root: 'fixture', profileId: project.audio.profileId, version: '1.16.5', nativeLibrary: 'inert-fixture', samples: {} };
  const options: ExportOptions = { format, nbsVersion: 5, nbsTempoPreset: 'bpm-7.5', nativeAudio };
  const state = { busy: false, prepared: undefined as PreparedExport | undefined, options, documentKey: 1, library, modal: 'export' as string | null, error: undefined as { ticket: ExportTicket; message: string } | undefined };
  const exportOwner = { current: { context: { ...options, documentKey: 1, project, library, open: true }, generation: 0 } as ExportOwner };
  const exportRunning = { current: false }, exportSaving = { current: false };
  const web = deferred<Uint8Array>(), native = deferred<{ wav: Uint8Array; backend: string; warnings: string[] }>();
  const engine = { renderWeb: vi.fn((_project: Project) => web.promise), nativeRequest: vi.fn(async (snapshot: Project) => ({ snapshot })) };
  const renderNative = vi.fn(() => native.promise), saveFile = vi.fn(async (_name: string, _bytes: Uint8Array): Promise<string | null> => 'saved-file');
  const nbsWriter = vi.fn(exportNbs), midiWriter = vi.fn(exportMidi), download = vi.fn();
  const environment = { desktop: true };
  const setExportError = vi.fn((value: { ticket: ExportTicket; message: string } | undefined) => { state.error = value; });
  const setMessage = vi.fn(), setPrepared = vi.fn((value: PreparedExport | undefined) => { state.prepared = value; });
  const setBusy = vi.fn((value: boolean) => { state.busy = value; }), setModal = vi.fn((value: string | null) => { state.modal = modalRef.current = value; });
  let flush = () => true;
  const finishNumberDraft = vi.fn(() => flush());
  function functions() {
    const scope = { finishNumberDraft, busy: state.busy, exportOwner, exportRunning, exportSaving, projectRef, modalRef,
      ensurePreviewSamples: vi.fn(async () => 20),
      syncExportOwner, isCurrentExport, setPrepared, setBusy, setMessage, setModal, setExportError, prepared: state.prepared,
      setExportFormat: (value: ExportOptions['format']) => { state.options.format = value; },
      setNbsVersion: (value: 4 | 5 | 6) => { state.options.nbsVersion = value; }, setNbsTempoPreset: (value: NbsTempoPreset) => { state.options.nbsTempoPreset = value; },
      setNativeAudio: (value: boolean) => { state.options.nativeAudio = value; }, exportNbs: nbsWriter, exportMidi: midiWriter, nbsExportTiming, download, engine, window: { desktop: environment.desktop ? { renderNative, saveFile } : undefined } };
    return Function(...Object.keys(scope), code + '\nreturn {changeExportOptions,openExport,prepareExport,finishExport};')(...Object.values(scope)) as {
      changeExportOptions: (patch: Partial<ExportOptions>) => void; openExport: () => void; prepareExport: (ticket: ExportTicket) => Promise<PreparedExport>; finishExport: () => Promise<void>;
    };
  }
  function render(patch: Partial<ExportContext> = {}) {
    syncExportOwner(exportOwner.current, { ...exportOwner.current.context, ...state.options, project: projectRef.current, open: modalRef.current === 'export', documentKey: state.documentKey, library: state.library, ...patch });
  }
  const visibleError = () => Function('exportError', 'exportOwner', 'isCurrentExport', `return ${errorCode};`)(state.error, exportOwner, isCurrentExport) as string | undefined;
  return { project, projectRef, modalRef, state, exportOwner, exportRunning, exportSaving, web, native, engine, renderNative, saveFile, setMessage, setPrepared, setBusy, setModal,
    nbsWriter, midiWriter, download, environment, visibleError, setExportError, finishNumberDraft, functions, render, onFlush: (value: () => boolean) => { flush = value; } };
}
const settle = () => new Promise<void>(done => setImmediate(done));
function readNbs(bytes: Uint8Array) {
  const song = fromArrayBuffer(Uint8Array.from(bytes).buffer);
  // This reader indexes custom definitions after its built-in table (16 even
  // for a v6 file). The serialized table order + file's actual built-in count
  // identify functional notes without borrowing our production parser.
  const definitions = Object.values(song.instruments.all).filter(instrument => !instrument.isBuiltIn);
  const functional = new Set(definitions.flatMap((instrument, index) => instrument.name === 'Tempo Changer' ? [bytes[3] + index] : []));
  const notes = Object.values(song.layers.all).flatMap(layer => layer.notes.getTicks.map(tick => ({ tick, ...layer.notes.all[tick] }))).sort((a, b) => a.tick - b.tick);
  return { song, music: notes.filter(note => !functional.has(note.instrument)), functions: notes.filter(note => functional.has(note.instrument)), definitions };
}
const nbsTicks = (bytes: Uint8Array) => readNbs(bytes).music.map(note => note.tick);

describe('Single-click asynchronous export ownership', () => {
  it.each([
    { native: false, patch: { format: 'mid' as const } }, { native: true, patch: { nbsVersion: 6 as const } },
    { native: true, patch: { nbsTempoPreset: 'bpm-5' as const } }, { native: false, patch: { nativeAudio: true } },
  ])('does not save a late WAV after settings change: %j', async ({ native, patch }) => {
    const test = fixture('wav', native), pending = test.functions().finishExport(); await settle();
    test.functions().changeExportOptions(patch);
    if (native) test.native.resolve({ wav: Uint8Array.of(1), backend: 'fixture', warnings: [] }); else test.web.resolve(Uint8Array.of(2));
    await pending;
    expect(test.state.prepared).toBeUndefined(); expect(test.state.busy).toBe(false); expect(test.exportRunning.current).toBe(false);
    expect(test.saveFile).not.toHaveBeenCalled(); expect(test.state.error).toBeUndefined();
  });
  it('does not revive an old job when options return to their original value', async () => {
    const test = fixture(), pending = test.functions().finishExport();
    test.functions().changeExportOptions({ format: 'mid' }); test.functions().changeExportOptions({ format: 'wav' });
    test.web.resolve(Uint8Array.of(1)); await pending; expect(test.state.prepared).toBeUndefined(); expect(test.saveFile).not.toHaveBeenCalled();
  });
  it('rejects a replaced project before React renders the new owner', async () => {
    const test = fixture(), pending = test.functions().finishExport(); test.projectRef.current = { ...test.project, name: 'New source' };
    test.web.resolve(Uint8Array.of(1)); await pending;
    expect(test.state.prepared).toBeUndefined(); expect(test.engine.renderWeb).toHaveBeenCalledExactlyOnceWith(test.project); expect(test.saveFile).not.toHaveBeenCalled();
  });
  it('rejects edit then Undo back to the same project object', async () => {
    const test = fixture(), pending = test.functions().finishExport();
    test.projectRef.current = { ...test.project, name: 'Edited' }; test.render(); test.projectRef.current = test.project; test.render();
    test.web.resolve(Uint8Array.of(1)); await pending; expect(test.state.prepared).toBeUndefined(); expect(test.saveFile).not.toHaveBeenCalled();
  });
  it('rejects a closed/reopened panel and another document generation', async () => {
    const test = fixture(), pending = test.functions().finishExport();
    test.modalRef.current = null; test.render(); test.modalRef.current = 'export'; test.state.documentKey++; test.render();
    test.web.resolve(Uint8Array.of(1)); await pending; expect(test.state.prepared).toBeUndefined(); expect(test.saveFile).not.toHaveBeenCalled();
  });
  it('rejects audio rendered against a previous sample library', async () => {
    const test = fixture(), pending = test.functions().finishExport(); test.state.library = { ...test.state.library, version: 'other' }; test.render();
    test.web.resolve(Uint8Array.of(1)); await pending; expect(test.state.prepared).toBeUndefined(); expect(test.saveFile).not.toHaveBeenCalled();
  });
  it('ignores an obsolete render error and does not write it to the error panel', async () => {
    const test = fixture(), pending = test.functions().finishExport(); test.functions().changeExportOptions({ format: 'mid' });
    test.web.reject(new Error('old failure')); await pending;
    expect(test.setMessage).not.toHaveBeenCalled(); expect(test.state.error).toBeUndefined(); expect(test.state.busy).toBe(false); expect(test.saveFile).not.toHaveBeenCalled();
  });
  it('reports a current render failure, releases the lock and clears that error when settings change', async () => {
    const test = fixture(), pending = test.functions().finishExport(); test.web.reject(new Error('current failure')); await pending;
    expect(test.state.error?.message).toContain('current failure'); expect(test.state.busy).toBe(false); expect(test.exportRunning.current).toBe(false); expect(test.saveFile).not.toHaveBeenCalled();
    test.functions().changeExportOptions({ format: 'mid' }); expect(test.state.error).toBeUndefined();
    await test.functions().finishExport(); expect(test.saveFile).toHaveBeenCalledOnce(); expect(test.state.modal).toBeNull();
  });
  it('starts only one render before React updates busy and immediately saves its exact bytes', async () => {
    const test = fixture(), app = test.functions(), pending = app.finishExport(); await app.finishExport();
    expect(test.engine.renderWeb).toHaveBeenCalledOnce(); expect(test.finishNumberDraft).toHaveBeenCalledOnce();
    test.web.resolve(Uint8Array.of(3, 7)); await pending;
    expect(test.saveFile).toHaveBeenCalledExactlyOnceWith('Export source.wav', test.state.prepared!.bytes);
    expect(test.state.prepared!.bytes).toEqual(Uint8Array.of(3, 7)); expect(test.state.busy).toBe(false);
  });
  it('locks before flushing a valid number draft so synchronous re-entry cannot start a second export', async () => {
    const test = fixture('nbs'), app = test.functions(); let nested: Promise<void> | undefined;
    test.onFlush(() => { nested = app.finishExport(); return true; }); await app.finishExport(); await nested;
    expect(test.finishNumberDraft).toHaveBeenCalledOnce(); expect(test.nbsWriter).toHaveBeenCalledOnce(); expect(test.saveFile).toHaveBeenCalledOnce(); expect(test.exportRunning.current).toBe(false);
  });
  it('retains current native warnings, saves automatically and keeps the panel available to read them', async () => {
    const test = fixture('wav', true), pending = test.functions().finishExport(); await settle(); expect(test.engine.nativeRequest).toHaveBeenCalledExactlyOnceWith(test.project);
    test.native.resolve({ wav: Uint8Array.of(7), backend: 'fixture backend', warnings: ['fixture warning'] }); await pending;
    expect(test.state.prepared?.diagnostics.map(item => item.message)).toEqual(['fixture backend', 'fixture warning']);
    expect(test.saveFile).toHaveBeenCalledExactlyOnceWith('Export source.wav', test.state.prepared!.bytes); expect(test.state.modal).toBe('export'); expect(test.state.error).toBeUndefined();
  });
  it('closes after a successful native export with information only, without treating backend information as a warning', async () => {
    const test = fixture('wav', true), pending = test.functions().finishExport(); await settle();
    test.native.resolve({ wav: Uint8Array.of(8), backend: 'fixture backend', warnings: [] }); await pending;
    expect(test.state.prepared?.diagnostics).toMatchObject([{ severity: 'info', message: 'fixture backend' }]); expect(test.saveFile).toHaveBeenCalledOnce(); expect(test.state.modal).toBeNull();
  });
});

describe('Automatic NBS presets, exact saved output and draft boundaries', () => {
  it.each([4, 5, 6] as const)('one click writes default BPM/7.5 v%s NBS and preserves the complete source', async version => {
    const test = fixture('nbs'), before = structuredClone(test.project); test.functions().changeExportOptions({ nbsVersion: version }); await test.functions().finishExport();
    const output = test.state.prepared!;
    expect(output.bytes[2]).toBe(version); expect(nbsTicks(output.bytes)).toEqual([4]);
    const independent = fromArrayBuffer(Uint8Array.from(output.bytes).buffer); expect(independent.getTempo()).toBe(16);
    expect(test.nbsWriter).toHaveBeenCalledExactlyOnceWith(test.project, version, 'bpm-7.5');
    expect(test.saveFile).toHaveBeenCalledExactlyOnceWith('Export source.nbs', output.bytes); expect(test.state.modal).toBeNull(); expect(test.project).toEqual(before);
  });
  it('selects BPM/5 and writes literal 24 TPS / tick 6 for a half-beat onset at BPM120', async () => {
    const test = fixture('nbs'); test.functions().changeExportOptions({ nbsTempoPreset: 'bpm-5' }); await test.functions().finishExport();
    const output = test.state.prepared!; expect(fromArrayBuffer(Uint8Array.from(output.bytes).buffer).getTempo()).toBe(24); expect(nbsTicks(output.bytes)).toEqual([6]);
    expect(test.saveFile).toHaveBeenCalledExactlyOnceWith(output.name, output.bytes); expect(output.context.nbsTempoPreset).toBe('bpm-5');
  });
  it.each([4, 5, 6] as const)('keeps v%s music on its MIDI grid and expresses tempo changes as functional notes', async version => {
    const test = fixture('nbs'); test.functions().changeExportOptions({ nbsVersion: version }); test.project.tempos = [{ tick: 480, bpm: 60 }, { tick: 0, bpm: 120 }];
    test.project.patterns[0].notes = [newNote(240, 66, 120), newNote(960, 67, 120)];
    const before = structuredClone(test.project); await test.functions().finishExport();
    const actual = readNbs(test.state.prepared!.bytes); expect(actual.song.getTempo()).toBe(16); expect(actual.music.map(note => [note.tick, note.key])).toEqual([[4, 45], [16, 46]]);
    expect(actual.functions.map(note => [note.tick, note.pitch])).toEqual([[0, 240], [8, 120]]); expect(actual.definitions.map(instrument => instrument.name)).toContain('Tempo Changer');
    expect(test.state.prepared?.diagnostics.some(d => d.severity === 'warning' && d.message.includes('Tempo Changer'))).toBe(true);
    expect(test.saveFile).toHaveBeenCalledExactlyOnceWith('Export source.nbs', test.state.prepared!.bytes); expect(test.state.modal).toBe('export'); expect(test.project).toEqual(before);
  });
  it('uses the last committed project and selected preset in the same click, before React rerenders', async () => {
    const test = fixture('nbs'); test.onFlush(() => { test.projectRef.current = { ...test.project, name: 'Committed last draft', tempos: [{ tick: 0, bpm: 150 }] }; test.functions().changeExportOptions({ nbsTempoPreset: 'bpm-5' }); return true; });
    await test.functions().finishExport(); const output = test.state.prepared!;
    expect(output.name).toBe('Committed last draft.nbs'); expect(nbsTicks(output.bytes)).toEqual([6]); expect(fromArrayBuffer(Uint8Array.from(output.bytes).buffer).getTempo()).toBe(30);
    expect(output.context.nbsTempoPreset).toBe('bpm-5'); expect(test.saveFile).toHaveBeenCalledExactlyOnceWith(output.name, output.bytes); expect(test.project.name).toBe('Export source');
  });
  it('does not open or export with an invalid active draft, and releases the entry lock for retry', async () => {
    const test = fixture('nbs'); test.modalRef.current = null; test.onFlush(() => false); test.functions().openExport(); await test.functions().finishExport();
    expect(test.setModal).not.toHaveBeenCalled(); expect(test.nbsWriter).not.toHaveBeenCalled(); expect(test.engine.renderWeb).not.toHaveBeenCalled(); expect(test.saveFile).not.toHaveBeenCalled(); expect(test.state.prepared).toBeUndefined(); expect(test.exportRunning.current).toBe(false);
    test.modalRef.current = 'export'; test.onFlush(() => true); await test.functions().finishExport(); expect(test.saveFile).toHaveBeenCalledOnce();
  });
  it('does not flush or render while another operation owns busy', async () => {
    const test = fixture(); test.state.busy = true; await test.functions().finishExport(); expect(test.engine.renderWeb).not.toHaveBeenCalled(); expect(test.finishNumberDraft).not.toHaveBeenCalled(); expect(test.saveFile).not.toHaveBeenCalled();
  });
  it('does not render or save if the export panel is no longer open', async () => {
    const test = fixture('nbs'); test.modalRef.current = test.state.modal = 'settings'; await test.functions().finishExport();
    expect(test.nbsWriter).not.toHaveBeenCalled(); expect(test.saveFile).not.toHaveBeenCalled(); expect(test.state.modal).toBe('settings'); expect(test.state.busy).toBe(false);
  });
  it('one click saves exact MIDI bytes without preparing manually', async () => {
    const test = fixture('mid'), before = structuredClone(test.project); await test.functions().finishExport(); const output = test.state.prepared!;
    expect(new TextDecoder().decode(output.bytes.subarray(0, 4))).toBe('MThd'); expect(test.midiWriter).toHaveBeenCalledExactlyOnceWith(test.project);
    expect(test.saveFile).toHaveBeenCalledExactlyOnceWith('Export source.mid', output.bytes); expect(test.state.modal).toBeNull(); expect(test.project).toEqual(before);
  });
  it('rebuilds an obsolete cache using the current project even from a previously rendered export callback', async () => {
    const test = fixture('nbs'); test.saveFile.mockResolvedValueOnce(null); await test.functions().finishExport(); const old = test.state.prepared!, app = test.functions();
    test.projectRef.current = { ...test.project, name: 'Other project', patterns: [{ ...test.project.patterns[0], notes: [newNote(480, 67, 120)] }] };
    await app.finishExport(); expect(test.nbsWriter).toHaveBeenCalledTimes(2); expect(test.saveFile).toHaveBeenLastCalledWith('Other project.nbs', test.state.prepared!.bytes);
    expect(nbsTicks(test.state.prepared!.bytes)).toEqual([8]); expect(test.state.prepared).not.toBe(old);
  });
  it('rebuilds a canceled cache after a preset draft commits on the next click', async () => {
    const test = fixture('nbs'); test.saveFile.mockResolvedValueOnce(null); await test.functions().finishExport(); const old = test.state.prepared!, app = test.functions();
    test.onFlush(() => { test.functions().changeExportOptions({ nbsTempoPreset: 'bpm-5' }); return true; }); await app.finishExport();
    expect(test.nbsWriter).toHaveBeenCalledTimes(2); expect(test.state.prepared).not.toBe(old); expect(nbsTicks(test.state.prepared!.bytes)).toEqual([6]); expect(test.saveFile).toHaveBeenCalledTimes(2);
  });
  it('retains a prepared file after canceled save and retries with the identical byte object without rerendering', async () => {
    const test = fixture('nbs'); test.saveFile.mockResolvedValueOnce(null); await test.functions().finishExport(); const original = test.state.prepared!;
    expect(test.state.modal).toBe('export'); expect(test.exportRunning.current).toBe(false); expect(test.state.busy).toBe(false);
    await test.functions().finishExport(); expect(test.saveFile).toHaveBeenCalledTimes(2); expect(test.saveFile.mock.calls[0][1]).toBe(original.bytes); expect(test.saveFile.mock.calls[1][1]).toBe(original.bytes);
    expect(test.state.prepared).toBe(original); expect(test.nbsWriter).toHaveBeenCalledOnce(); expect(test.state.modal).toBeNull();
  });
  it('retains expensive native audio and all warnings after cancel, without invoking the renderer again on retry', async () => {
    const test = fixture('wav', true); test.saveFile.mockResolvedValueOnce(null); const pending = test.functions().finishExport(); await settle();
    test.native.resolve({ wav: Uint8Array.of(3, 8, 9), backend: 'fixture backend', warnings: ['retain this warning'] }); await pending;
    const output = test.state.prepared!; expect(test.state.modal).toBe('export'); await test.functions().finishExport();
    expect(test.engine.nativeRequest).toHaveBeenCalledOnce(); expect(test.renderNative).toHaveBeenCalledOnce(); expect(test.saveFile).toHaveBeenCalledTimes(2);
    expect(test.saveFile.mock.calls[0][1]).toBe(output.bytes); expect(test.saveFile.mock.calls[1][1]).toBe(output.bytes); expect(test.state.prepared).toBe(output); expect(test.state.modal).toBe('export');
    expect(output.diagnostics.map(item => item.message)).toEqual(['fixture backend', 'retain this warning']);
  });
  it('keeps a current NBS cache valid when only an unrelated sample library changes', async () => {
    const test = fixture('nbs'); test.saveFile.mockResolvedValueOnce(null); await test.functions().finishExport(); test.state.library = { ...test.state.library, version: 'other' }; test.render();
    expect(isCurrentExport(test.exportOwner.current, test.state.prepared!)).toBe(true); await test.functions().finishExport(); expect(test.nbsWriter).toHaveBeenCalledOnce(); expect(test.saveFile).toHaveBeenCalledTimes(2);
  });
  it('starts only one save while a file dialog/write is pending and does not flush twice', async () => {
    const test = fixture('nbs'), write = deferred<string | null>(); test.saveFile.mockImplementationOnce(() => write.promise);
    const app = test.functions(), pending = app.finishExport(); await settle(); await app.finishExport();
    expect(test.saveFile).toHaveBeenCalledOnce(); expect(test.finishNumberDraft).toHaveBeenCalledOnce(); expect(test.state.busy).toBe(true); expect(test.exportSaving.current).toBe(true);
    write.resolve('chosen-file'); await pending; expect(test.state.busy).toBe(false); expect(test.exportRunning.current).toBe(false); expect(test.exportSaving.current).toBe(false);
  });
  it('does not let an old save completion close another panel', async () => {
    const test = fixture('nbs'), write = deferred<string | null>(); test.saveFile.mockImplementationOnce(() => write.promise);
    const pending = test.functions().finishExport(); await settle(); test.modalRef.current = test.state.modal = 'settings'; test.render();
    write.resolve('written-old-snapshot'); await pending;
    expect(test.state.modal).toBe('settings'); expect(test.setModal).not.toHaveBeenCalled(); expect(test.setMessage).not.toHaveBeenCalled(); expect(test.state.busy).toBe(false);
  });
  it('does not report a late save failure against a replacement project', async () => {
    const test = fixture('nbs'), write = deferred<string | null>(); test.saveFile.mockImplementationOnce(() => write.promise);
    const pending = test.functions().finishExport(); await settle(); test.projectRef.current = { ...test.project, name: 'Next source' };
    write.reject(new Error('late write failure')); await pending;
    expect(test.state.error).toBeUndefined(); expect(test.setMessage).not.toHaveBeenCalled(); expect(test.state.busy).toBe(false);
  });
  it('keeps the current prepared file after write failure and retries without rendering again', async () => {
    const test = fixture('nbs'); test.saveFile.mockRejectedValueOnce(new Error('disk failure')); await test.functions().finishExport(); const original = test.state.prepared;
    expect(test.state.error?.message).toContain('disk failure'); expect(test.state.modal).toBe('export'); expect(test.state.busy).toBe(false);
    await test.functions().finishExport(); expect(test.state.prepared).toBe(original); expect(test.nbsWriter).toHaveBeenCalledOnce(); expect(test.state.error).toBeUndefined(); expect(test.state.modal).toBeNull();
  });
  it('shows a failure only for its actual current ticket even when its state remains after another document/panel takes ownership', async () => {
    const test = fixture('nbs'); test.saveFile.mockRejectedValueOnce(new Error('current disk failure')); await test.functions().finishExport();
    const error = test.state.error!; expect(test.visibleError()).toBe('current disk failure');
    test.state.documentKey++; test.render(); expect(test.state.error).toBe(error); expect(test.visibleError()).toBeUndefined();
    test.modalRef.current = 'settings'; test.render(); expect(test.visibleError()).toBeUndefined();
    test.modalRef.current = 'export'; test.render(); expect(test.visibleError()).toBeUndefined();
  });
  it('keeps export diagnostics and refuses saving a fatal result, while changing options permits a new attempt', async () => {
    const test = fixture('nbs'); test.nbsWriter.mockReturnValueOnce({ bytes: Uint8Array.of(9), diagnostics: [{ severity: 'error', code: 'fixture-fatal', message: 'Fixture conversion cannot complete' }] });
    await test.functions().finishExport(); expect(test.saveFile).not.toHaveBeenCalled(); expect(test.state.prepared?.diagnostics[0].severity).toBe('error'); expect(test.state.error?.message).toContain('Fixture conversion cannot complete'); expect(test.state.modal).toBe('export');
    test.functions().changeExportOptions({ nbsTempoPreset: 'bpm-5' }); expect(test.state.error).toBeUndefined(); await test.functions().finishExport(); expect(test.saveFile).toHaveBeenCalledOnce();
  });
  it.each([.01, 10000])('reports an unrepresentable automatic TPS for BPM%s without clamping or mutating the project', async bpm => {
    const test = fixture('nbs'); test.project.tempos = [{ tick: 0, bpm }]; const before = structuredClone(test.project); await test.functions().finishExport();
    expect(test.saveFile).not.toHaveBeenCalled(); expect(test.state.error?.message).toMatch(/0\.01|327\.67/); expect(test.project).toEqual(before); expect(test.exportRunning.current).toBe(false); expect(test.state.modal).toBe('export');
  });
  it('uses pure prepare(ticket) without flushing, mutating state or owning the UI lock', async () => {
    const test = fixture('nbs'), ticket = { ...test.exportOwner.current }, output = await test.functions().prepareExport(ticket);
    expect(output).toMatchObject({ name: 'Export source.nbs', generation: ticket.generation, context: ticket.context }); expect(nbsTicks(output.bytes)).toEqual([4]);
    expect(test.finishNumberDraft).not.toHaveBeenCalled(); expect(test.saveFile).not.toHaveBeenCalled(); expect(test.setPrepared).not.toHaveBeenCalled(); expect(test.setBusy).not.toHaveBeenCalled(); expect(test.exportRunning.current).toBe(false);
  });
  it.each([
    { bpm: 137, preset: 'bpm-7.5' as const, tps: 18.27, tick: 8000 },
    { bpm: 137, preset: 'bpm-5' as const, tps: 27.4, tick: 12000 },
    { bpm: 137.13, preset: 'bpm-7.5' as const, tps: 18.28, tick: 8000 },
    { bpm: 137.13, preset: 'bpm-5' as const, tps: 27.43, tick: 12000 },
  ])('keeps a distant source tick480000 at musical tick$tick for $bpm BPM/$preset despite fractional stored TPS', async ({ bpm, preset, tps, tick }) => {
    const test = fixture('nbs'); test.functions().changeExportOptions({ nbsTempoPreset: preset }); test.project.tempos = [{ tick: 0, bpm }];
    test.project.patterns[0].length = test.project.regions[0].length = 480001; test.project.patterns[0].notes = [newNote(480000, 66, 1)];
    const before = structuredClone(test.project); await test.functions().finishExport(); const output = test.state.prepared!, actual = readNbs(output.bytes);
    expect(actual.song.getTempo()).toBe(tps); expect(actual.music.map(note => note.tick)).toEqual([tick]); expect(actual.functions).toEqual([]);
    expect(test.nbsWriter).toHaveBeenCalledExactlyOnceWith(test.project, 5, preset); expect(test.saveFile).toHaveBeenCalledExactlyOnceWith(output.name, output.bytes); expect(test.project).toEqual(before);
  });
  it.each([
    { preset: 'bpm-7.5' as const, ticks: [0, 1, 2] },
    { preset: 'bpm-5' as const, ticks: [1, 1, 3] },
  ])('floors non-divisible source positions on the fixed $preset grid without an automatic multiplier', async ({ preset, ticks }) => {
    const test = fixture('nbs'); test.functions().changeExportOptions({ nbsTempoPreset: preset });
    test.project.patterns[0].notes = [59.999, 60, 130].map((tick, index) => newNote(tick, 66 + index, 1)); const before = structuredClone(test.project);
    await test.functions().finishExport(); const actual = readNbs(test.state.prepared!.bytes);
    expect(actual.music.map(note => [note.tick, note.key])).toEqual(ticks.map((tick, index) => [tick, 45 + index])); expect(actual.song.getTempo()).toBe(preset === 'bpm-7.5' ? 16 : 24);
    expect(actual.functions).toEqual([]); expect(test.saveFile).toHaveBeenCalledOnce(); expect(test.project).toEqual(before);
  });
  it('reports an invalid raw musical grid without writing an output or altering the source', async () => {
    const test = fixture('nbs'); test.project.ppq = 0; const before = structuredClone(test.project); await test.functions().finishExport();
    expect(test.saveFile).not.toHaveBeenCalled(); expect(test.visibleError()).toMatch(/PPQ|刻度|网格|有效|范围/i); expect(test.state.modal).toBe('export'); expect(test.project).toEqual(before); expect(test.exportRunning.current).toBe(false);
  });
  it('uses the existing browser download path after automatic NBS preparation without invoking desktop save', async () => {
    const test = fixture('nbs'); test.environment.desktop = false; await test.functions().finishExport();
    expect(test.download).toHaveBeenCalledExactlyOnceWith('Export source.nbs', test.state.prepared!.bytes); expect(nbsTicks(test.state.prepared!.bytes)).toEqual([4]);
    expect(test.saveFile).not.toHaveBeenCalled(); expect(test.state.modal).toBeNull(); expect(test.state.busy).toBe(false);
  });
  it('requires an available native backend rather than silently downloading or switching to Web audio', async () => {
    const test = fixture('wav', true); test.environment.desktop = false; await test.functions().finishExport();
    expect(test.visibleError()).toContain('原生音频引擎不可用'); expect(test.engine.renderWeb).not.toHaveBeenCalled(); expect(test.engine.nativeRequest).not.toHaveBeenCalled();
    expect(test.saveFile).not.toHaveBeenCalled(); expect(test.download).not.toHaveBeenCalled(); expect(test.state.modal).toBe('export');
  });
  it('renders default automatic BPM/7.5 and a single export action without an independent prepare/check action', () => {
    expect(source).toMatch(/nbsTempoPreset[^\n]*useState[^\n]*\('bpm-7\.5'\)/);
    const from = source.indexOf("{modal === 'export'"), to = source.indexOf("{modal === 'help'", from);
    expect(from).toBeGreaterThan(0); const ui = source.slice(from, to < 0 ? source.length : to);
    expect(ui.match(/onClick=\{\(\) => void finishExport\(\)\}/g)).toHaveLength(1);
    expect(ui).not.toMatch(/onClick=\{\(\) => void prepareExport\(/); expect(ui).not.toContain('检查并准备文件');
    expect(ui).toContain('bpm-7.5'); expect(ui).toContain('bpm-5'); expect(ui).not.toContain('aria-label="NBS 导出时间网格"');
    expect(ui).toContain('每四分拍'); expect(ui).toContain('音符位置按 MIDI 刻度直接换算'); expect(ui).toContain('向前取整');
  });
});
