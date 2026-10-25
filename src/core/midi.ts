import { Midi, type MidiJSON, type TrackJSON } from '@tonejs/midi';
import { flattenNotes } from './project';
import { encodeMidiText } from './midi-text';
import { exportArchivedMidi } from './midi-export';
import type { Diagnostic, Project } from './types';
export { importMidi } from './midi-import';
export { decodeMidiText } from './midi-text';
export { originalMidi } from './midi-export';

export function exportMidi(project: Project): { bytes: Uint8Array; diagnostics: Diagnostic[] } {
  const legacy = project.provenance?.kind === 'midi' && project.provenance.metadata.midi as MidiJSON | undefined;
  if (!legacy || project.midi) return exportArchivedMidi(project);
  // Compatibility for pre-archive NBSX files. Their source JSON never contained
  // SysEx/pressure/etc.; keep the metadata that was actually saved, without
  // claiming to reconstruct information that an earlier importer discarded.
  const midi = new Midi();
  midi.header.fromJSON({ name: encodeMidiText(project.name), ppq: project.ppq,
    tempos: project.tempos.map(t => ({ ticks: Math.round(t.tick), bpm: t.bpm })),
    timeSignatures: project.timeSignatures.map(t => ({ ticks: Math.round(t.tick), timeSignature: [t.numerator, t.denominator] })),
    keySignatures: legacy.header.keySignatures ?? [], meta: legacy.header.meta ?? [] });
  const notes = flattenNotes(project, true);
  for (const source of project.tracks) {
    const track = midi.addTrack();
    const metadata: TrackJSON | undefined = source.sourceMidiTrack === undefined ? undefined : legacy.tracks[source.sourceMidiTrack];
    if (metadata) {
      track.fromJSON({ ...structuredClone(metadata), notes: [] });
      for (const bend of metadata.pitchBends ?? []) track.addPitchBend({ ticks: bend.ticks, value: bend.value });
    }
    track.name = encodeMidiText(source.name); track.channel = source.midiChannel ?? (midi.tracks.length - 1) % 16;
    if (!metadata) track.instrument.number = project.instruments.find(i => i.id === source.instrumentId)?.gmProgram ?? 0;
    for (const note of notes.filter(n => n.trackId === source.id)) track.addNote({ ticks: Math.round(note.absoluteTick), durationTicks: Math.max(1, Math.round(note.duration)), midi: note.midi, velocity: note.velocity });
    track.endOfTrackTicks = project.regions.reduce((end, region) => region.trackId === source.id ? Math.max(end, region.start + region.length) : end, track.durationTicks);
  }
  const diagnostics: Diagnostic[] = [{ severity: 'info', code: 'midi-legacy-source', message: '此旧版工程只包含当时保存的 MIDI 来源信息。重新导入原始 MIDI 可保留更多消息，并让表情消息随片段编辑。' }];
  if (notes.some(n => n.detune !== 0 || n.pan !== 0 || n.height !== 0 || n.instrumentId)) diagnostics.push({ severity: 'warning', code: 'midi-note-properties', message: '标准 MIDI 导出保留音符、力度、时值与轨道信息；单音符空间位置、独立音色和微调音高保留在 NBSX 母版中。' });
  return { bytes: midi.toArray(), diagnostics };
}
