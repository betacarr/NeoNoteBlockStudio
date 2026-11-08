import { current, isDraft } from 'immer';
import { requireEmbeddedAudioWorkspace, validateAudioAssets } from './audio-assist';
import { assertInstrument, assetBytes, NBSX_SAVE_TIMESTAMP, sameAsset, sizeBudget } from './clipboard-resources';
import { uid, validateProject } from './project';
import type { Asset, Instrument, Pattern, Project } from './types';

export interface SampleReplacementTarget {
  scope: 'track' | 'notes';
  instrumentId: string;
  trackId: string;
  noteIds: readonly string[];
  patternId?: string;
  regionId?: string;
}
export interface SampleReplacementReferences { trackDefaults: number; noteOverrides: number; drumHits: number; total: number }
export interface SampleReplacementInspection { instrument: Instrument; references: SampleReplacementReferences; targetLabel: string }
export interface SampleReplacementResult { instrumentId: string; patternId?: string; noteIds?: string[] }

/** Resolve the explicit captured target again. A selected note never changes a track-target operation. */
export function inspectSampleReplacement(project: Project, target: SampleReplacementTarget): SampleReplacementInspection {
  validateProject(project);
  if (!target || !['track', 'notes'].includes(target.scope) || !Array.isArray(target.noteIds)
    || new Set(target.noteIds).size !== target.noteIds.length) throw new Error('替换采样的目标无效，请重新选择。');
  const track = project.tracks.find(item => item.id === target.trackId), instrument = project.instruments.find(item => item.id === target.instrumentId);
  if (!track || track.kind === 'audio' || !instrument) throw new Error('替换采样的轨道或乐器已失效，请重新选择。');
  if (track.locked) throw new Error('目标轨道已锁定，不能替换采样。');
  if (target.scope === 'track') {
    if (track.instrumentId !== instrument.id) throw new Error('轨道默认音色已改变，请重新选择替换采样的目标。');
  } else {
    const region = project.regions.find(item => item.id === target.regionId), pattern = project.patterns.find(item => item.id === target.patternId);
    if (!region || !pattern || region.trackId !== track.id || region.patternId !== pattern.id || !target.noteIds.length)
      throw new Error('替换采样的音符片段或选区已失效，请重新选择。');
    const selected = new Set(target.noteIds), notes = pattern.notes.filter(note => selected.has(note.id));
    if (notes.length !== selected.size || notes.some(note => (note.instrumentId ?? track.instrumentId) !== instrument.id))
      throw new Error('所选音符或实际音色已改变，请重新选择；不同音色的音符请分开替换。');
  }
  const trackDefaults = project.tracks.filter(item => item.kind !== 'audio' && item.instrumentId === instrument.id).length;
  let noteOverrides = 0, drumHits = 0;
  for (const pattern of project.patterns) for (const note of pattern.notes) if (note.instrumentId === instrument.id) noteOverrides++;
  for (const preset of project.drumPresets ?? []) for (const mapping of preset.mappings) for (const hit of mapping.notes) if (hit.instrumentId === instrument.id) drumHits++;
  return { instrument, references: { trackDefaults, noteOverrides, drumHits, total: trackDefaults + noteOverrides + drumHits },
    targetLabel: target.scope === 'track' ? `轨道“${track.name}”的默认音色` : `“${track.name}”当前片段的 ${target.noteIds.length} 个所选音符` };
}

/** Apply the actual saved representation's size limits without decoding Base64 samples again. */
function assertSize(project: Project): void {
  const budget = sizeBudget();
  budget.addJson({ ...project, modifiedAt: NBSX_SAVE_TIMESTAMP, tracks: [], patterns: [], regions: [], audioClips: [], instruments: [], assets: [],
    ...(project.midi ? { midi: { ...project.midi, conductor: [] } } : {}) });
  budget.addItems(project.tracks); budget.addItems(project.regions); budget.addItems(project.audioClips ?? []); budget.addItems(project.instruments);
  if (project.midi) budget.addItems(project.midi.conductor);
  project.patterns.forEach((pattern, index) => {
    if (index) budget.comma();
    budget.addJson({ ...pattern, notes: [], ...(pattern.midiEvents === undefined ? {} : { midiEvents: [] }) });
    budget.addItems(pattern.notes); if (pattern.midiEvents !== undefined) budget.addItems(pattern.midiEvents);
  });
  project.assets.forEach((asset, index) => { if (index) budget.comma(); budget.addAsset(asset); }); budget.finish();
}

/** The caller decodes the supplied audio before this atomic document transaction.
 * Local is deliberately the default: clone the instrument and route only the
 * explicit target. Shared changes are an explicit project-wide operation.
 */
export function applySampleReplacement(project: Project, target: SampleReplacementTarget, asset: Asset, shared = false): SampleReplacementResult {
  if (typeof shared !== 'boolean') throw new Error('请选择仅替换当前目标或明确替换全部引用。');
  const snapshot = isDraft(project) ? current(project) : project;
  const inspection = inspectSampleReplacement(snapshot, target), source = inspection.instrument;
  if (!asset || typeof asset.mime !== 'string' || !asset.mime.startsWith('audio/') || !asset.data || asset.audioFile !== undefined || assetBytes(asset) < 1)
    throw new Error('乐器采样必须是已验证并嵌入的音频资源。');
  const existing = snapshot.assets.find(item => item.id === asset.id);
  if (existing && !sameAsset(existing, asset)) throw new Error('新采样资源标识与工程现有资源冲突，未替换任何内容。');
  const addedAsset = existing ? undefined : structuredClone(isDraft(asset) ? current(asset) : asset);
  const usedIds = new Set<string>([snapshot.id]);
  for (const list of [snapshot.tracks, snapshot.patterns, snapshot.regions, snapshot.instruments, snapshot.assets, snapshot.audioClips ?? [], snapshot.midi?.conductor ?? []]) for (const item of list) usedIds.add(item.id);
  for (const pattern of snapshot.patterns) { for (const note of pattern.notes) usedIds.add(note.id); for (const event of pattern.midiEvents ?? []) usedIds.add(event.id); }
  for (const preset of snapshot.drumPresets ?? []) { usedIds.add(preset.id); for (const mapping of preset.mappings) { usedIds.add(mapping.id); for (const hit of mapping.notes) usedIds.add(hit.id); } }
  if (addedAsset && usedIds.has(addedAsset.id)) throw new Error('新采样资源标识已被工程对象使用，未替换任何内容。');
  usedIds.add(asset.id);
  const freshId = () => { let id: string, attempts = 0; do { if (++attempts > 128) throw new Error('无法分配独立采样标识，请重试。'); id = uid(); } while (usedIds.has(id)); usedIds.add(id); return id; };
  const replacement: Instrument = { ...structuredClone(source), assetId: asset.id };
  if (!shared) {
    replacement.id = freshId();
    const base = `${source.name} · 独立采样`, names = new Set(snapshot.instruments.map(instrument => instrument.name));
    let name = base, suffix = 2; while (names.has(name)) name = `${base} ${suffix++}`;
    replacement.name = name;
    // The independent instrument must export as a custom sample, not retain a
    // built-in table number accidentally associated with the original sound.
    delete replacement.nbsIndex;
  }
  assertInstrument(replacement);
  let detached: Pattern | undefined, edited: Pattern | undefined;
  let noteIds: string[] | undefined;
  if (!shared && target.scope === 'notes') {
    const pattern = snapshot.patterns.find(item => item.id === target.patternId)!;
    const references = snapshot.regions.filter(region => region.patternId === pattern.id).length;
    const remapped = new Map<string, string>();
    edited = structuredClone(pattern);
    if (references > 1) {
      edited.id = freshId();
      for (const note of edited.notes) { const before = note.id; note.id = freshId(); remapped.set(before, note.id); }
      for (const event of edited.midiEvents ?? []) event.id = freshId();
      detached = edited;
    }
    const routedIds = new Set(target.noteIds.map(id => remapped.get(id) ?? id));
    for (const note of edited.notes) if (routedIds.has(note.id)) note.instrumentId = replacement.id;
    noteIds = target.noteIds.map(id => remapped.get(id) ?? id);
    // The unmodified original has the full pattern and MIDI source identity;
    // only the selected occurrence points at this independent copy.
  }
  const candidate: Project = { ...snapshot,
    instruments: shared ? snapshot.instruments.map(item => item.id === source.id ? replacement : item) : snapshot.instruments.concat(replacement),
    assets: addedAsset ? snapshot.assets.concat(addedAsset) : snapshot.assets,
    tracks: !shared && target.scope === 'track' ? snapshot.tracks.map(track => track.id === target.trackId ? { ...track, instrumentId: replacement.id } : track) : snapshot.tracks,
    patterns: detached ? snapshot.patterns.concat(detached) : edited ? snapshot.patterns.map(pattern => pattern.id === edited!.id ? edited! : pattern) : snapshot.patterns,
    regions: detached ? snapshot.regions.map(region => region.id === target.regionId ? { ...region, patternId: detached!.id } : region) : snapshot.regions };
  validateProject(candidate); validateAudioAssets(candidate.assets); requireEmbeddedAudioWorkspace(candidate); assertSize(candidate);

  // No mutation takes place until the complete candidate passes every check.
  if (addedAsset) project.assets.push(addedAsset);
  if (shared) project.instruments.find(instrument => instrument.id === source.id)!.assetId = asset.id;
  else {
    project.instruments.push(replacement);
    if (target.scope === 'track') project.tracks.find(track => track.id === target.trackId)!.instrumentId = replacement.id;
    else if (detached) {
      project.patterns.push(detached); project.regions.find(region => region.id === target.regionId)!.patternId = detached.id;
    } else if (edited) project.patterns.find(pattern => pattern.id === edited!.id)!.notes = edited.notes;
  }
  return { instrumentId: replacement.id,
    ...(target.scope === 'notes' ? { patternId: detached?.id ?? target.patternId, noteIds: noteIds ?? [...target.noteIds] } : {}) };
}
