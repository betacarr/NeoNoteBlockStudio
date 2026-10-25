import { NBSX_SAVE_TIMESTAMP, sizeBudget } from './clipboard-resources';
import { notesUnchanged } from './editor-commands';
import { growEditedPattern } from './editor-interaction';
import { expansionError, MAX_PROJECT_TICK } from './expansion';
import { validateProject } from './project';
import type { Note, Project } from './types';

export interface NoteEditTarget { patternId: string; regionId: string; trackId: string }
const finiteTick = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= MAX_PROJECT_TICK;

/** Count the actual saved representation without serializing embedded Base64. */
function assertBudget(project: Project): void {
  const budget = sizeBudget();
  if (project.midi && !project.assets.find(asset => asset.id === project.midi!.sourceAssetId)?.data) throw new Error('工程缺少嵌入的原始 MIDI 文件，无法完整保存音符修改。');
  if (project.provenance?.kind === 'flp' && !project.assets.find(asset => asset.id === project.provenance!.metadata.sourceAssetId)?.data) throw new Error('工程缺少嵌入的原始 FLP 文件，无法完整保存音符修改。');
  budget.addJson({ ...project, modifiedAt: NBSX_SAVE_TIMESTAMP, tracks: [], patterns: [], regions: [], instruments: [], assets: [],
    ...(project.midi ? { midi: { ...project.midi, conductor: [] } } : {}) });
  budget.addItems(project.tracks); budget.addItems(project.regions); budget.addItems(project.instruments);
  if (project.midi) budget.addItems(project.midi.conductor);
  project.patterns.forEach((pattern, index) => {
    if (index) budget.comma();
    budget.addJson({ ...pattern, notes: [], ...(pattern.midiEvents === undefined ? {} : { midiEvents: [] }) });
    budget.addItems(pattern.notes); if (pattern.midiEvents !== undefined) budget.addItems(pattern.midiEvents);
  });
  project.assets.forEach((asset, index) => { if (index) budget.comma(); budget.addAsset(asset); });
  budget.finish();
}

/** One atomic final boundary for draw, drag, keyboard, quantize and inspectors.
 * The supplied array is a candidate, never a request to mutate original notes.
 */
export function applyNoteEdit(project: Project, target: NoteEditTarget, notes: Note[]): boolean {
  try {
    // current() retains any changes already made in this transaction, while
    // removing proxy reads from full schema and byte-budget scans. original()
    // would silently discard those changes and is deliberately not used.
    const snapshot = isDraft(project) ? current(project) : project;
    const region = snapshot.regions.find(item => item.id === target.regionId), pattern = snapshot.patterns.find(item => item.id === target.patternId), track = snapshot.tracks.find(item => item.id === target.trackId);
    if (!region || !pattern || !track || region.patternId !== pattern.id || region.trackId !== track.id) throw new Error('音符编辑的片段、源或轨道已失效，请重新选择。');
    if (snapshot.regions.filter(item => item.id === region.id).length !== 1 || snapshot.patterns.filter(item => item.id === pattern.id).length !== 1 || snapshot.tracks.filter(item => item.id === track.id).length !== 1) throw new Error('音符编辑目标的对象 ID 重复。');
    if (track.locked) throw new Error('轨道已锁定，无法修改音符。');
    if (!Array.isArray(notes) || notes.some(note => !note || typeof note !== 'object')) throw new Error('候选音符内容无效。');
    // Also support callers passing a candidate that shares draft notes. Plain
    // immutable candidates keep their array and object identities unchanged.
    let unwrapped: Note[] | undefined;
    for (let index = 0; index < notes.length; index++) {
      const note = notes[index]; let value = isDraft(note) ? current(note) : note;
      if (value.midiSource && isDraft(value.midiSource)) value = { ...value, midiSource: current(value.midiSource) };
      if (!unwrapped && value !== note) unwrapped = notes.slice(0, index);
      if (unwrapped) unwrapped.push(value);
    }
    notes = unwrapped ?? notes;
    if (notesUnchanged(pattern.notes, notes)) return false;

    const previous = new Map(pattern.notes.map(note => [note.id, note.tick]));
    let required = pattern.length, recount = notes.length !== pattern.notes.length;
    for (const note of notes) {
      if (!finiteTick(note.tick) || !finiteTick(note.duration)) throw new Error('音符开始时间和时值必须是 0 至 1e12 之间的有限数字。');
      if (previous.get(note.id) !== note.tick) {
        recount = true;
        if (note.tick >= pattern.length) required = Math.max(required, note.tick + 1);
      }
    }
    const candidatePattern = { ...pattern, notes }, candidateRegion = { ...region };
    if (required > pattern.length) growEditedPattern(snapshot, candidateRegion, candidatePattern, required);
    if (!finiteTick(candidatePattern.length, 1) || !finiteTick(candidateRegion.length, 1)) throw new Error('音符修改后的小节进位、源长度或片段长度超过 1e12，请缩短开始位置。');
    const candidate: Project = { ...snapshot,
      patterns: snapshot.patterns.map(item => item === pattern ? candidatePattern : item),
      regions: candidateRegion.length === region.length ? snapshot.regions : snapshot.regions.map(item => item === region ? candidateRegion : item),
    };
    validateProject(candidate);
    // Duration, velocity and other properties do not change flattenNotes' onset
    // count. Retain repair access to a legacy over-expanded project for them.
    if (recount || candidatePattern.length !== pattern.length) {
      const error = expansionError(candidate, true); if (error) throw new Error(error);
    }
    assertBudget(candidate);

    // No writes occur before every check, including shared/loop occurrences.
    const destination = project.patterns.find(item => item.id === pattern.id)!, destinationRegion = project.regions.find(item => item.id === region.id)!;
    destination.notes = notes;
    if (destination.length !== candidatePattern.length) destination.length = candidatePattern.length;
    if (destinationRegion.length !== candidateRegion.length) destinationRegion.length = candidateRegion.length;
    return true;
  } catch (error) {
    const message = (error instanceof Error ? error.message : '候选音符参数或引用无效。').replace(/^粘贴后工程/, '音符修改后工程');
    throw new Error(`无法提交音符修改：${message}`);
  }
}
import { current, isDraft } from 'immer';
