import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { canEditSelectedNotes, changeSelectedNotes, moveSelectedNotes, notesUnchanged } from '../src/core/editor-commands';
import { createMeterMap } from '../src/core/meter';
import { createProject, newNote } from '../src/core/project';
import type { Note, Project } from '../src/core/types';

// Execute App's actual note-command functions and table expressions. The edit
// boundary below models commits; no browser, physical shortcut or native IPC is run.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('  function moveNoteSelection('), end = source.indexOf('\n  function stop(', start);
const tableStart = source.indexOf('    quantize: quantizeNoteSelection,'), tableEnd = source.indexOf('\n  };', tableStart);
if (start < 0 || end < 0 || tableStart < 0 || tableEnd < 0) throw new Error('App note-command functions/table were not found');
const commandCode = transformSync(source.slice(start, end), { loader: 'ts', target: 'es2022' }).code;
const tableCode = transformSync(`const editorCommands = {\n${source.slice(tableStart, tableEnd)}\n};`, { loader: 'ts', target: 'es2022' }).code;

function fixture({ focus = 'piano', locked = false, ids = 'valid', snap = 16, ticks = [130, 390], pitches = [60, 64], sourceOrigin = 0 }: {
  focus?: 'piano' | 'arrangement'; locked?: boolean; ids?: 'valid' | 'empty' | 'stale'; snap?: number;
  ticks?: [number, number]; pitches?: [number, number]; sourceOrigin?: number;
} = {}) {
  const project = createProject(), pattern = project.patterns[0], track = project.tracks[0];
  project.ppq = 480; track.locked = locked;
  pattern.notes = [
    { ...newNote(ticks[0], pitches[0], 120), id: 'a', velocity: .7, pan: -.2, detune: 17, height: .5, instrumentId: 'bell', midiSource: { onOrder: 2, offOrder: 3, releaseVelocity: 45, offSourceTrack: 9 } },
    { ...newNote(ticks[1], pitches[1], 300), id: 'b', velocity: .45, pan: .4, detune: -11, height: -.75, midiSource: { onOrder: 4, offOrder: 5, releaseVelocity: 73 } },
    { ...newNote(720, 90, 90), id: 'unselected' },
  ];
  const selectedNotes = new Set(ids === 'valid' ? ['a', 'b'] : ids === 'stale' ? ['removed-note'] : []);
  const state = { project, history: [] as Project[], future: [structuredClone(project)] };
  const before = structuredClone(project), beforeFuture = state.future;
  const editNotes = vi.fn((_label: string, change: (notes: Note[]) => Note[]) => {
    const previous = state.project;
    const next = produce(previous, draft => { const target = draft.patterns[0], notes = change(target.notes); if (!notesUnchanged(target.notes, notes)) target.notes = notes; });
    if (next !== previous) { state.history.push(previous); state.project = next; state.future = []; }
  });
  const scope = { focus, track, pattern, selectedNotes, project, preferences: { snap }, sourceOrigin, meterMap: createMeterMap(project), canEditSelectedNotes, changeSelectedNotes, moveSelectedNotes, editNotes };
  const commands = Function(...Object.keys(scope), `${commandCode}\n${tableCode}\nreturn { moveNoteSelection, nudgeNoteSelection, quantizeNoteSelection, editorCommands };`)(...Object.values(scope)) as {
    moveNoteSelection: (tick: number, pitch?: number) => void; nudgeNoteSelection: (direction: number, beat?: boolean) => void;
    quantizeNoteSelection: () => void; editorCommands: Record<string, () => void>;
  };
  return { ...commands, state, before, beforeFuture, selectedNotes, editNotes, notes: () => state.project.patterns[0].notes };
}

describe('actual App note commands (unit scope)', () => {
  it('leaves retained piano note IDs untouched in arrangement focus for every note command', () => {
    const test = fixture({ focus: 'arrangement' });
    expect(test.selectedNotes.size).toBe(2);
    for (const command of Object.values(test.editorCommands)) command();
    test.moveNoteSelection(120, 1);
    expect(test.editNotes).not.toHaveBeenCalled(); expect(test.state.project).toEqual(test.before);
    expect(test.state.history).toEqual([]); expect(test.state.future).toBe(test.beforeFuture);
  });

  it.each([{ locked: true }, { ids: 'empty' as const }, { ids: 'stale' as const }])('rejects note edits before the edit boundary when the selection is unavailable: %j', options => {
    const test = fixture(options);
    for (const command of Object.values(test.editorCommands)) command();
    expect(test.editNotes).not.toHaveBeenCalled(); expect(test.state.project).toEqual(test.before);
    expect(test.state.history).toEqual([]); expect(test.state.future).toBe(test.beforeFuture);
  });

  it.each([[120, 360], [130, 390]] as [number, number][])('nudges by one grid interval while retaining the original offsets: %j', (first, second) => {
    const test = fixture({ ticks: [first, second] }), original = test.before.patterns[0].notes;
    test.editorCommands['nudge-right']();
    expect(test.notes()).toEqual([{ ...original[0], tick: first + 120 }, { ...original[1], tick: second + 120 }, original[2]]);
    test.editorCommands['nudge-left']();
    expect(test.notes()).toEqual(original); expect(test.state.history).toHaveLength(2);
  });

  it('uses a single tick with snapping disabled and a quarter note for Shift nudges', () => {
    const test = fixture({ snap: 0 }), original = test.before.patterns[0].notes;
    test.editorCommands['nudge-right']();
    expect(test.notes()).toEqual([{ ...original[0], tick: 131 }, { ...original[1], tick: 391 }, original[2]]);
    test.editorCommands['nudge-beat-right']();
    expect(test.notes()).toEqual([{ ...original[0], tick: 611 }, { ...original[1], tick: 871 }, original[2]]);
    test.editorCommands['nudge-beat-left'](); test.editorCommands['nudge-left']();
    expect(test.notes()).toEqual(original);
  });

  it('constrains the whole time selection at zero without changing relative timing or note metadata', () => {
    const test = fixture(), original = test.before.patterns[0].notes;
    test.editorCommands['nudge-beat-left']();
    expect(test.notes()).toEqual([{ ...original[0], tick: 0 }, { ...original[1], tick: 260 }, original[2]]);
  });

  it.each([
    { pitches: [126, 127] as [number, number], command: 'transpose-up', expected: [126, 127], noop: true },
    { pitches: [0, 1] as [number, number], command: 'transpose-down', expected: [0, 1], noop: true },
    { pitches: [116, 120] as [number, number], command: 'transpose-octave-up', expected: [123, 127], noop: false },
    { pitches: [3, 7] as [number, number], command: 'transpose-octave-down', expected: [0, 4], noop: false },
  ])('preserves the chord interval and all other fields at the keyboard boundary: $command/$pitches', ({ pitches, command, expected, noop }) => {
    const test = fixture({ pitches }), previous = test.state.project, original = test.before.patterns[0].notes;
    test.editorCommands[command]();
    expect(test.notes()).toEqual([{ ...original[0], midi: expected[0] }, { ...original[1], midi: expected[1] }, original[2]]);
    expect(test.notes()[1].midi - test.notes()[0].midi).toBe(pitches[1] - pitches[0]);
    if (noop) { expect(test.state.project).toBe(previous); expect(test.state.history).toEqual([]); expect(test.state.future).toBe(test.beforeFuture); }
    else expect(test.state.history).toHaveLength(1);
  });

  it('applies the full requested semitone delta away from boundaries without changing provenance', () => {
    const test = fixture(), original = test.before.patterns[0].notes;
    test.editorCommands['transpose-up']();
    expect(test.notes()).toEqual([{ ...original[0], midi: 61 }, { ...original[1], midi: 65 }, original[2]]);
    test.editorCommands['transpose-down']();
    expect(test.notes()).toEqual(original);
  });

  it('quantizes the real piano selection against its project origin while preserving other fields', () => {
    const test = fixture({ sourceOrigin: 30 }), original = test.before.patterns[0].notes;
    test.editorCommands.quantize();
    expect(test.notes()).toEqual([{ ...original[0], tick: 90 }, { ...original[1], tick: 450 }, original[2]]);
    expect(test.editNotes).toHaveBeenCalledOnce(); expect(test.editNotes.mock.calls[0][0]).toBe('量化音符');
    expect(test.selectedNotes).toEqual(new Set(['a', 'b']));
  });

  it('keeps history/redo unchanged when quantization already matches the grid', () => {
    const test = fixture({ ticks: [120, 360] }), previous = test.state.project;
    test.quantizeNoteSelection();
    expect(test.state.project).toBe(previous); expect(test.state.history).toEqual([]); expect(test.state.future).toBe(test.beforeFuture);
  });

  it('executes the actual four nudge/four transpose mappings and quantize binding', () => {
    const nudgeNoteSelection = vi.fn(), moveNoteSelection = vi.fn(), quantizeNoteSelection = vi.fn();
    const table = Function('nudgeNoteSelection', 'moveNoteSelection', 'quantizeNoteSelection', `${tableCode}\nreturn editorCommands;`)(nudgeNoteSelection, moveNoteSelection, quantizeNoteSelection) as Record<string, () => void>;
    for (const name of ['nudge-left', 'nudge-right', 'nudge-beat-left', 'nudge-beat-right']) table[name]();
    expect(nudgeNoteSelection.mock.calls).toEqual([[-1], [1], [-1, true], [1, true]]);
    for (const name of ['transpose-up', 'transpose-down', 'transpose-octave-up', 'transpose-octave-down']) table[name]();
    expect(moveNoteSelection.mock.calls).toEqual([[0, 1], [0, -1], [0, 12], [0, -12]]);
    table.quantize(); expect(quantizeNoteSelection).toHaveBeenCalledOnce();
  });
});
