import type { Diagnostic, FlatNote, Project } from './types';

const validNumber = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
/** Optional embedded mappings extend NBSX v2 without rewriting source triggers. */
export function validateDrumMappings(project: Project): void {
  if (project.drumPresets !== undefined && (!Array.isArray(project.drumPresets) || project.drumPresets.length > 1024)) throw new Error('鼓组预设列表无效或超过 1024 个。');
  const presetIds = new Set<string>(), ids = new Set<string>();
  const id = (value: unknown) => { if (typeof value !== 'string' || !value || ids.has(value)) throw new Error('鼓组预设存在缺失或重复标识。'); ids.add(value); };
  for (const preset of project.drumPresets ?? []) {
    if (!preset || typeof preset !== 'object') throw new Error('鼓组预设无效。');
    id(preset.id); presetIds.add(preset.id);
    if (typeof preset.name !== 'string' || !preset.name.trim() || !Array.isArray(preset.mappings) || preset.mappings.length > 128) throw new Error('鼓组预设名称或触发映射无效。');
    const triggers = new Set<number>();
    for (const mapping of preset.mappings) {
      if (!mapping || typeof mapping !== 'object') throw new Error('鼓组触发映射无效。');
      id(mapping.id);
      if (mapping.name !== undefined && (typeof mapping.name !== 'string' || mapping.name.length > 200)) throw new Error('鼓组映射名称无效或超过 200 个字符。');
      if (!Number.isInteger(mapping.trigger) || !validNumber(mapping.trigger, 0, 127) || triggers.has(mapping.trigger) || !Array.isArray(mapping.notes) || !mapping.notes.length || mapping.notes.length > 256) throw new Error('鼓组触发键重复、无效，或没有实际子音符。');
      triggers.add(mapping.trigger);
      for (const hit of mapping.notes) {
        if (!hit || typeof hit !== 'object') throw new Error('鼓组实际子音符无效。');
        id(hit.id);
        if (!project.instruments.some(instrument => instrument.id === hit.instrumentId) || !Number.isInteger(hit.midi) || !validNumber(hit.midi, 0, 127) || !validNumber(hit.offsetBeats, 0, 256) || !validNumber(hit.durationBeats, 1 / 32768, 256) || !validNumber(hit.velocity, 0, 1)) throw new Error('鼓组实际子音符的乐器、音高、拍偏移、时值或力度无效。');
      }
    }
  }
  for (const track of project.tracks) if (track.drumPresetId !== undefined && (typeof track.drumPresetId !== 'string' || !presetIds.has(track.drumPresetId))) throw new Error(`轨道“${track.name}”引用的鼓组预设不存在。`);
}

export function expandDrumMappings(project: Project, source: FlatNote[]): { notes: FlatNote[]; diagnostics: Diagnostic[]; mapped: number } {
  validateDrumMappings(project);
  if (!project.tracks.some(track => track.drumPresetId)) return { notes: source, diagnostics: [], mapped: 0 };
  const tracks = new Map(project.tracks.map(track => [track.id, track]));
  const presets = new Map((project.drumPresets ?? []).map(preset => [preset.id, preset]));
  const notes: FlatNote[] = []; let mapped = 0;
  for (const note of source) {
    const presetId = tracks.get(note.trackId)?.drumPresetId;
    if (!presetId) notes.push(note);
    else {
      const preset = presets.get(presetId)!;
      const mapping = preset.mappings.find(mapping => mapping.trigger === note.midi);
      if (!mapping) throw new Error(`鼓组预设“${preset.name}”未设置触发键 MIDI ${note.midi} 的映射。请补充映射或取消该轨道的鼓组预设。`);
      for (const hit of mapping.notes) {
        const expanded: FlatNote = { ...note, id: `drum:${JSON.stringify([note.regionId,note.id,note.absoluteTick,hit.id])}`, midi: hit.midi, duration: hit.durationBeats * project.ppq,
          absoluteTick: note.absoluteTick + hit.offsetBeats * project.ppq, instrumentId: hit.instrumentId, effectiveInstrument: hit.instrumentId,
          velocity: note.velocity * hit.velocity, gain: note.gain * hit.velocity,
          drumSource: { noteId: note.id, occurrenceTick: note.absoluteTick, offsetBeats: hit.offsetBeats, triggerTick: note.tick } };
        delete expanded.midiSource; notes.push(expanded); mapped++;
        if (notes.length > 2000000) throw new Error('鼓组展开超过 200 万个实际音符，请缩短工程或减少映射子音符。');
      }
    }
    if (notes.length > 2000000) throw new Error('鼓组展开超过 200 万个实际音符。');
  }
  notes.sort((a,b) => a.absoluteTick - b.absoluteTick || a.midi - b.midi);
  const diagnostics: Diagnostic[] = mapped ? [{ severity: 'info', code: 'drum-mapping-expanded', message: `鼓组触发已展开为 ${mapped} 个实际子音符；源触发仍以单个音符保存在 NBSX 中。` }] : [];
  return { notes, diagnostics, mapped };
}
