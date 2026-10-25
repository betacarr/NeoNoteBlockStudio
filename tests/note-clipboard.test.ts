import { describe, expect, it } from 'vitest';
import { createNoteClipboard, planNotePaste } from '../src/core/note-clipboard';
import { createProject, newNote, newTrack, validateProject } from '../src/core/project';
import { openNbsx, saveNbsx } from '../src/core/container';
import type { Asset, Instrument, Note, Project } from '../src/core/types';

function fixture() {
  const source = createProject('Source'), target = createProject('Target');
  source.ppq = 480; target.ppq = 960;
  source.patterns[0].notes = [
    { ...newNote(120, 60, 240), id: 'first', velocity: .73, pan: -.2, detune: 12.5, height: .75,
      midiSource: { onOrder: 7, offOrder: 12, releaseVelocity: 41, offSourceTrack: 3 } },
    { ...newNote(600, 64, 480), id: 'second' },
  ];
  return { source, target, notes: source.patterns[0].notes };
}
function custom(source: Project) {
  const asset: Asset = { id: 'sample', name: 'lead.ogg', mime: 'audio/ogg', data: 'AQID', path: 'samples/lead.ogg', sha1: 'a'.repeat(40) };
  const instrument: Instrument = { ...source.instruments[0], id: 'custom', name: 'Custom lead', englishName: 'Custom lead', rootMidi: 60, assetId: asset.id, sound: 'custom:lead' };
  source.instruments.push(instrument); source.assets.push(asset); source.patterns[0].notes[0].instrumentId = instrument.id;
  return { instrument, asset };
}
function clipboard(source: Project, key = 1) { return createNoteClipboard(source, source.patterns[0].notes, source.tracks[0].id, key); }
function apply(target: Project, plan: ReturnType<typeof planNotePaste>) {
  const next = structuredClone(target);
  next.instruments.push(...plan.instruments); next.assets.push(...plan.assets); next.patterns[0].notes.push(...plan.notes);
  for (const note of plan.notes) next.patterns[0].length = Math.max(next.patterns[0].length, note.tick + 1);
  return next;
}
function freezeTree(value: object): void {
  Object.freeze(value);
  for (const nested of Object.values(value)) if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) freezeTree(nested);
}

describe('PPQ-aware independent note clipboard', () => {
  it('keeps beats and every non-time note attribute when converting 480 to 960 PPQ', () => {
    const { source, target, notes } = fixture(), copied = clipboard(source), before = structuredClone(source);
    const plan = planNotePaste(target, copied, 60, target.tracks[0].id, 2);
    expect(copied).toMatchObject({ ppq: 480, sourceProjectId: source.id, sourceTrackId: source.tracks[0].id, documentKey: 1 });
    expect(plan.notes.map(note => [note.tick, note.duration])).toEqual([[60, 480], [1020, 960]]);
    expect(plan.notes[0]).toMatchObject({ midi: 60, velocity: .73, pan: -.2, detune: 12.5, height: .75 });
    expect(plan.notes[0].midiSource).toEqual({ onOrder: 7, offOrder: 12, releaseVelocity: 41 });
    expect(plan.notes.every((note, index) => note.id !== notes[index].id)).toBe(true);
    expect(plan.diagnostics.some(item => item.code === 'clipboard-ppq-scaled')).toBe(true);
    expect(plan.instruments).toEqual([]); expect(plan.assets).toEqual([]); expect(source).toEqual(before);
  });

  it('normalizes to the earliest input rather than input order, preserving zero and fractional time', () => {
    const { source, target } = fixture(); source.ppq = 960; target.ppq = 480;
    const notes = [{ ...newNote(20.5, 70, .25), id: 'later' }, { ...newNote(10.25, 60, 0), id: 'earlier' }];
    const copied = createNoteClipboard(source, notes, source.tracks[0].id, 1);
    const plan = planNotePaste(target, copied, 7.125, target.tracks[0].id, 2);
    expect(plan.notes.map(note => [note.tick, note.duration])).toEqual([[12.25, .125], [7.125, 0]]);
    expect(notes.map(note => [note.tick, note.duration])).toEqual([[20.5, .25], [10.25, 0]]);
  });

  it('clones only explicit instrument dependencies, not the source track default or unrelated assets', () => {
    const { source } = fixture(), { instrument, asset } = custom(source);
    source.instruments.push({ ...instrument, id: 'unused', assetId: 'unused-sample' });
    source.assets.push({ ...asset, id: 'unused-sample' }); source.tracks[0].locked = true;
    const copied = clipboard(source);
    expect(copied.instruments).toEqual([instrument]); expect(copied.assets).toEqual([asset]);
    expect(copied.notes[1]).not.toHaveProperty('instrumentId');
    expect(copied.notes[0]).not.toBe(source.patterns[0].notes[0]); expect(copied.notes[0].midiSource).not.toBe(source.patterns[0].notes[0].midiSource);
    expect(copied.instruments[0]).not.toBe(instrument); expect(copied.assets[0]).not.toBe(asset);
    instrument.name = 'Changed source'; asset.data = 'BA=='; source.patterns[0].notes[0].midiSource!.releaseVelocity = 99;
    expect(copied.instruments[0].name).toBe('Custom lead'); expect(copied.assets[0].data).toBe('AQID');
    expect(copied.notes[0].midiSource!.releaseVelocity).toBe(41);
  });

  it('leaves snapshots and both projects unchanged, and generates independent IDs for every paste', () => {
    const { source, target } = fixture(); custom(source);
    const copied = clipboard(source), before = structuredClone({ source, target, copied });
    freezeTree(source); freezeTree(target); freezeTree(copied);
    const first = planNotePaste(target, copied, 0, target.tracks[0].id, 2), second = planNotePaste(target, copied, 0, target.tracks[0].id, 2);
    expect(new Set([...first.notes, ...second.notes].map(note => note.id)).size).toBe(4);
    expect(first.notes[0].midiSource).not.toBe(copied.notes[0].midiSource);
    expect(first.assets[0]).not.toBe(copied.assets[0]); expect(first.instruments[0]).not.toBe(copied.instruments[0]);
    expect({ source, target, copied }).toEqual(before);
  });
});

describe('Clipboard custom instrument and sample mapping', () => {
  it('remaps same-ID different definitions, never overwrites target resources, and survives NBSX save/reopen', () => {
    const { source, target } = fixture(), { asset, instrument } = custom(source);
    target.assets.push({ ...asset, data: 'BAUG', name: 'destination.ogg' });
    target.instruments.push({ ...instrument, name: 'Destination synth' });
    const before = structuredClone(target), plan = planNotePaste(target, clipboard(source), 0, target.tracks[0].id, 2);
    expect(plan.instruments).toHaveLength(1); expect(plan.assets).toHaveLength(1);
    expect(plan.instruments[0].id).not.toBe(instrument.id); expect(plan.assets[0].id).not.toBe(asset.id);
    expect(plan.notes[0].instrumentId).toBe(plan.instruments[0].id); expect(plan.instruments[0].assetId).toBe(plan.assets[0].id);
    expect(plan.assets[0]).toEqual({ ...asset, id: plan.assets[0].id });
    expect(plan.notes[1]).not.toHaveProperty('instrumentId'); expect(target).toEqual(before);
    const reopened = openNbsx(saveNbsx(apply(target, plan)));
    expect(reopened.instruments.find(item => item.id === instrument.id)?.name).toBe('Destination synth');
    expect(reopened.assets.find(item => item.id === asset.id)?.data).toBe('BAUG');
    expect(reopened.assets.find(item => item.id === plan.assets[0].id)?.data).toBe('AQID');
    expect(reopened.patterns[0].notes[0].instrumentId).toBe(plan.instruments[0].id);
  });

  it.each([false, true])('reuses completely identical definitions even with different IDs: %s', renamed => {
    const { source, target } = fixture(), { asset, instrument } = custom(source);
    const targetAsset = { ...asset, id: renamed ? 'target-sample' : asset.id };
    const targetInstrument = { ...instrument, id: renamed ? 'target-custom' : instrument.id, assetId: targetAsset.id };
    target.assets.push(targetAsset); target.instruments.push(targetInstrument);
    const plan = planNotePaste(target, clipboard(source), 0, target.tracks[0].id, 2);
    expect(plan.assets).toEqual([]); expect(plan.instruments).toEqual([]);
    expect(plan.notes[0].instrumentId).toBe(targetInstrument.id);
  });

  it('avoids IDs already occupied by notes, not only existing assets', () => {
    const { source, target } = fixture(); custom(source);
    target.patterns[0].notes.push({ ...newNote(0, 60), id: 'sample' });
    const plan = planNotePaste(target, clipboard(source), 0, target.tracks[0].id, 2);
    expect(plan.assets[0].id).not.toBe('sample'); expect(plan.instruments[0].assetId).toBe(plan.assets[0].id);
    expect(() => validateProject(apply(target, plan))).not.toThrow();
  });

  it('deduplicates identical definitions inside the same clipboard plan', () => {
    const { source, target } = fixture(), { instrument } = custom(source);
    source.instruments.push({ ...instrument, id: 'same-definition' }); source.patterns[0].notes[1].instrumentId = 'same-definition';
    const plan = planNotePaste(target, clipboard(source), 0, target.tracks[0].id, 2);
    expect(plan.assets).toHaveLength(1); expect(plan.instruments).toHaveLength(1);
    expect(plan.notes.map(note => note.instrumentId)).toEqual(['custom', 'custom']);
  });

  it('retains linked or metadata-only sample definitions with an explicit availability warning', () => {
    const { source, target } = fixture(), { asset } = custom(source); delete asset.data;
    const linked = planNotePaste(target, clipboard(source), 0, target.tracks[0].id, 2);
    expect(linked.assets[0]).toEqual(asset); expect(linked.diagnostics.some(item => item.code === 'clipboard-external-sample')).toBe(true);
    delete asset.path;
    expect(() => planNotePaste(target, clipboard(source), 0, target.tracks[0].id, 2)).not.toThrow();
  });
});

describe('Clipboard MIDI source scope', () => {
  it('preserves NoteOff routing only in the same document and track', () => {
    const { source } = fixture(), copied = clipboard(source, 9);
    const same = planNotePaste(source, copied, 1200, source.tracks[0].id, 9);
    expect(same.notes[0].midiSource).toEqual(source.patterns[0].notes[0].midiSource);
    expect(same.notes[0].midiSource).not.toBe(source.patterns[0].notes[0].midiSource);
    expect(same.diagnostics.some(item => item.code === 'clipboard-midi-route-reset')).toBe(false);
  });
  it.each(['document', 'project', 'track'] as const)('clears only offSourceTrack for a different %s', scope => {
    const { source } = fixture(), copied = clipboard(source, 9);
    const target = structuredClone(source), track = newTrack('Other track');
    if (scope === 'project') target.id = 'another-project';
    if (scope === 'track') target.tracks.push(track);
    const plan = planNotePaste(target, copied, 0, scope === 'track' ? track.id : target.tracks[0].id, scope === 'document' ? 10 : 9);
    expect(plan.notes[0].midiSource).toEqual({ onOrder: 7, offOrder: 12, releaseVelocity: 41 });
    expect(copied.notes[0].midiSource!.offSourceTrack).toBe(3);
  });
});

describe('Clipboard validation and limits', () => {
  it.each([-1, NaN, Infinity, 1e12 + 1])('rejects an invalid paste target tick %s', tick => {
    const { source, target } = fixture(); expect(() => planNotePaste(target, clipboard(source), tick, target.tracks[0].id, 2)).toThrow();
  });
  it('rejects locked/missing targets and malformed clipboard provenance without changing inputs', () => {
    const { source, target } = fixture(), copied = clipboard(source);
    target.tracks[0].locked = true; expect(() => planNotePaste(target, copied, 0, target.tracks[0].id, 2)).toThrow('目标');
    target.tracks[0].locked = false; expect(() => planNotePaste(target, copied, 0, 'missing', 2)).toThrow('目标');
    expect(() => planNotePaste(target, { ...copied, ppq: 0 }, 0, target.tracks[0].id, 2)).toThrow('来源');
    expect(() => createNoteClipboard(source, source.patterns[0].notes, 'missing', 1)).toThrow('来源');
    expect(() => createNoteClipboard(source, source.patterns[0].notes, source.tracks[0].id, .5)).toThrow('来源');
  });
  it('rejects missing source definitions, missing captured dependencies and invalid embedded bytes', () => {
    const { source, target } = fixture(), { instrument, asset } = custom(source), copied = clipboard(source);
    expect(() => planNotePaste(target, { ...copied, instruments: [] }, 0, target.tracks[0].id, 2)).toThrow('音色不存在');
    expect(() => planNotePaste(target, { ...copied, assets: [] }, 0, target.tracks[0].id, 2)).toThrow('采样不存在');
    asset.data = 'not base64!'; expect(() => clipboard(source)).toThrow('Base64');
    source.assets = []; expect(() => clipboard(source)).toThrow('源采样不存在');
    source.instruments = source.instruments.filter(item => item.id !== instrument.id); expect(() => clipboard(source)).toThrow();
  });
  it.each([{ duration: -1 }, { tick: Infinity }, { midi: 60.5 }, { velocity: 1.1 }, { pan: -2 }, { detune: 32768 }, { height: 65 }, { instrumentId: '' }])('refuses malformed note data: %j', patch => {
    const { source, target } = fixture(), copied = clipboard(source);
    copied.notes[0] = { ...copied.notes[0], ...patch };
    expect(() => planNotePaste(target, copied, 0, target.tracks[0].id, 2)).toThrow('音符参数');
  });
  it('checks converted scalar limits and reserves onset + 1 for the pattern growth bound', () => {
    const { source, target } = fixture();
    source.patterns[0].notes = [{ ...newNote(0, 60, 1e12), id: 'boundary' }];
    expect(() => planNotePaste(target, clipboard(source), 0, target.tracks[0].id, 2)).toThrow('超过工程范围');
    target.ppq = source.ppq;
    const plan = planNotePaste(target, clipboard(source), 1e12 - 1, target.tracks[0].id, 2);
    expect(plan.notes[0]).toMatchObject({ tick: 1e12 - 1, duration: 1e12 });
    expect(() => validateProject(apply(target, plan))).not.toThrow();
    expect(() => planNotePaste(target, clipboard(source), 1e12, target.tracks[0].id, 2)).toThrow('超过工程范围');
  });
  it('rejects a two-million-note overflow before cloning or iterating a huge clipboard', () => {
    const { source, target } = fixture(), copied = clipboard(source);
    target.patterns[0].notes.push(newNote(0, 60)); copied.notes = Array(2000000).fill(copied.notes[0]) as Note[];
    expect(() => planNotePaste(target, copied, 0, target.tracks[0].id, 2)).toThrow('200 万');
  });
  it('uses the existing 64 MB manifest limit rather than an arbitrary resource-count cap', () => {
    const { source } = fixture(), longName = 'x'.repeat(300000), template = source.instruments[0];
    source.patterns[0].notes = [];
    for (let index = 0; index < 230; index++) {
      source.assets.push({ id: `sample-${index}`, name: longName, mime: 'audio/ogg', data: 'AA==' });
      source.instruments.push({ ...template, id: `custom-${index}`, assetId: `sample-${index}` });
      source.patterns[0].notes.push({ ...newNote(index, 60), id: `note-${index}`, instrumentId: `custom-${index}` });
    }
    expect(() => clipboard(source)).toThrow('64 MB');
  });
  it('handles an empty snapshot as a no-op plan', () => {
    const { source, target } = fixture();
    const copied = createNoteClipboard(source, [], source.tracks[0].id, 1);
    expect(planNotePaste(target, copied, 0, target.tracks[0].id, 2)).toEqual({ notes: [], instruments: [], assets: [], diagnostics: [] });
  });
});
