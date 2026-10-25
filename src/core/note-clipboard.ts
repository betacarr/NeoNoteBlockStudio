import { assertNotes, resourceIndex, assertInstrument, assetBytes, sameInstrument, sameAsset, sizeBudget, NBSX_SAVE_TIMESTAMP } from './clipboard-resources';
import { uid, validateProject } from './project';
import type { Asset, Diagnostic, Instrument, Note, Project } from './types';

export interface NoteClipboard {
  ppq: number;
  sourceProjectId: string;
  sourceTrackId: string;
  documentKey: number;
  notes: Note[];
  instruments: Instrument[];
  assets: Asset[];
}
export interface NotePastePlan { notes: Note[]; instruments: Instrument[]; assets: Asset[]; diagnostics: Diagnostic[] }

const MAX_NOTES = 2000000, MAX_TICK = 1e12;
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const documentKeyValid = (value: number) => Number.isSafeInteger(value) && value >= 0;

function assertBudget(project: Project, notes: readonly Note[], instruments: readonly Instrument[], assets: readonly Asset[]): void {
  const budget = sizeBudget();
  budget.addJson({ ...project, modifiedAt: NBSX_SAVE_TIMESTAMP, patterns: [], instruments: [], assets: [] });
  for (let i = 0; i < project.patterns.length; i++) {
    const pattern = project.patterns[i]; budget.addJson({ ...pattern, notes: [] }); budget.addItems(pattern.notes);
    if (i) budget.comma();
  }
  // App chooses the destination pattern. One extra comma safely bounds either
  // an empty or populated destination without assigning notes to another pattern.
  budget.addItems(notes); if (notes.length) budget.comma();
  budget.addItems(project.instruments); budget.addItems(instruments);
  if (project.instruments.length && instruments.length) budget.comma();
  let assetCount = 0;
  for (const asset of [...project.assets, ...assets]) { budget.addAsset(asset); if (assetCount++) budget.comma(); }
  budget.finish();
}

export function createNoteClipboard(project: Project, notes: readonly Note[], sourceTrackId: string, documentKey: number): NoteClipboard {
  validateProject(project); assertNotes(notes);
  if (!documentKeyValid(documentKey) || !identifier(project.id) || !project.tracks.some(track => track.id === sourceTrackId)) throw new Error('剪贴板来源轨道或文档无效。');
  const instruments = resourceIndex(project.instruments), assets = resourceIndex(project.assets);
  const neededInstruments = new Map<string, Instrument>(), neededAssets = new Map<string, Asset>();
  for (const note of notes) {
    if (note.instrumentId === undefined) continue;
    const instrument = instruments.get(note.instrumentId);
    if (!instrument) throw new Error('剪贴板音符引用的源音色不存在。');
    assertInstrument(instrument); neededInstruments.set(instrument.id, instrument);
    if (instrument.assetId !== undefined) {
      const asset = assets.get(instrument.assetId);
      if (!asset) throw new Error('剪贴板音色引用的源采样不存在。');
      assetBytes(asset); neededAssets.set(asset.id, asset);
    }
  }
  const clipboard: NoteClipboard = { ppq: project.ppq, sourceProjectId: project.id, sourceTrackId, documentKey,
    notes: structuredClone([...notes]), instruments: structuredClone([...neededInstruments.values()]), assets: structuredClone([...neededAssets.values()]) };
  const budget = sizeBudget();
  budget.addJson({ ...clipboard, notes: [], instruments: [], assets: [] });
  budget.addItems(clipboard.notes); budget.addItems(clipboard.instruments);
  for (let i = 0; i < clipboard.assets.length; i++) { budget.addAsset(clipboard.assets[i]); if (i) budget.comma(); }
  budget.finish();
  return clipboard;
}

export function planNotePaste(targetProject: Project, clipboard: NoteClipboard, targetTick: number, targetTrackId: string, documentKey: number): NotePastePlan {
  validateProject(targetProject);
  const track = targetProject.tracks.find(item => item.id === targetTrackId);
  if (!track || track.locked || !finite(targetTick, 0, MAX_TICK) || !documentKeyValid(documentKey)) throw new Error('粘贴目标轨道、文档或时间位置无效。');
  if (!clipboard || !finite(clipboard.ppq, 1, 32767) || !Number.isInteger(clipboard.ppq) || !identifier(clipboard.sourceProjectId)
    || !identifier(clipboard.sourceTrackId) || !documentKeyValid(clipboard.documentKey) || !Array.isArray(clipboard.notes)) throw new Error('音符剪贴板来源信息无效。');
  let total = clipboard.notes.length;
  for (const pattern of targetProject.patterns) total += pattern.notes.length;
  if (total > MAX_NOTES) throw new Error('粘贴后工程音符超过 200 万个。');
  assertNotes(clipboard.notes);
  const sourceInstruments = resourceIndex(clipboard.instruments), sourceAssets = resourceIndex(clipboard.assets);
  if (!clipboard.notes.length) return { notes: [], instruments: [], assets: [], diagnostics: [] };

  const usedIds = new Set([targetProject.id, ...targetProject.tracks.map(item => item.id), ...targetProject.regions.map(item => item.id),
    ...targetProject.instruments.map(item => item.id), ...targetProject.assets.map(item => item.id), ...clipboard.notes.map(note => note.id)]);
  for (const pattern of targetProject.patterns) {
    usedIds.add(pattern.id); for (const note of pattern.notes) usedIds.add(note.id);
    for (const event of pattern.midiEvents ?? []) usedIds.add(event.id);
  }
  for (const event of targetProject.midi?.conductor ?? []) usedIds.add(event.id);
  const freshId = () => { let id: string; do { id = uid(); } while (usedIds.has(id)); usedIds.add(id); return id; };
  const resourceId = (preferred: string) => { if (usedIds.has(preferred)) return freshId(); usedIds.add(preferred); return preferred; };
  const instruments: Instrument[] = [], assets: Asset[] = [], diagnostics: Diagnostic[] = [];
  const instrumentMap = new Map<string, string>(), assetMap = new Map<string, string>();
  let remapped = 0;
  function copyAsset(sourceId: string): string {
    const previous = assetMap.get(sourceId); if (previous !== undefined) return previous;
    const asset = sourceAssets.get(sourceId); if (!asset) throw new Error('剪贴板音色引用的采样不存在。');
    assetBytes(asset);
    const match = targetProject.assets.find(item => item.id === sourceId && sameAsset(item, asset))
      ?? targetProject.assets.find(item => sameAsset(item, asset)) ?? assets.find(item => sameAsset(item, asset));
    const id = match?.id ?? resourceId(sourceId);
    if (!match) assets.push({ ...structuredClone(asset), id });
    assetMap.set(sourceId, id); if (id !== sourceId) remapped++;
    return id;
  }
  function copyInstrument(sourceId: string): string {
    const previous = instrumentMap.get(sourceId); if (previous !== undefined) return previous;
    const instrument = sourceInstruments.get(sourceId); if (!instrument) throw new Error('剪贴板音符引用的音色不存在。');
    assertInstrument(instrument);
    const candidate = { ...instrument, ...(instrument.assetId !== undefined ? { assetId: copyAsset(instrument.assetId) } : {}) };
    const match = targetProject.instruments.find(item => item.id === sourceId && sameInstrument(item, candidate))
      ?? targetProject.instruments.find(item => sameInstrument(item, candidate)) ?? instruments.find(item => sameInstrument(item, candidate));
    const id = match?.id ?? resourceId(sourceId);
    if (!match) instruments.push({ ...structuredClone(candidate), id });
    instrumentMap.set(sourceId, id); if (id !== sourceId) remapped++;
    return id;
  }
  const ratio = targetProject.ppq / clipboard.ppq;
  let firstTick = Infinity;
  for (const note of clipboard.notes) firstTick = Math.min(firstTick, note.tick);
  const preserveRoute = clipboard.sourceProjectId === targetProject.id && clipboard.documentKey === documentKey && clipboard.sourceTrackId === targetTrackId;
  let resetRoutes = 0;
  const notes = clipboard.notes.map(note => {
    const tick = targetTick + (note.tick - firstTick) * ratio, duration = note.duration * ratio;
    // Editing grows a pattern through onset + 1; the saved pattern length must
    // remain within the same schema bound even for zero-duration notes.
    if (!finite(tick, 0, MAX_TICK - 1) || !finite(duration, 0, MAX_TICK)) throw new Error('粘贴换算后的音符时间或时值超过工程范围。');
    const pasted = { ...structuredClone(note), id: freshId(), tick, duration };
    if (note.instrumentId !== undefined) pasted.instrumentId = copyInstrument(note.instrumentId);
    if (!preserveRoute && pasted.midiSource?.offSourceTrack !== undefined) { delete pasted.midiSource.offSourceTrack; resetRoutes++; }
    return pasted;
  });
  assertBudget(targetProject, notes, instruments, assets);
  if (ratio !== 1) diagnostics.push({ severity: 'info', code: 'clipboard-ppq-scaled', message: `音符已从 PPQ ${clipboard.ppq} 换算至 ${targetProject.ppq}，保留拍数与时值。` });
  if (remapped) diagnostics.push({ severity: 'info', code: 'clipboard-resource-remapped', message: `${remapped} 个音色或采样引用已安全映射，目标资源未被覆盖。` });
  if (resetRoutes) diagnostics.push({ severity: 'info', code: 'clipboard-midi-route-reset', message: `${resetRoutes} 个音符已移除原 MIDI NoteOff 轨道路由，释放力度与事件顺序仍保留。` });
  if ([...assetMap.keys()].some(id => !sourceAssets.get(id)!.data)) diagnostics.push({ severity: 'warning', code: 'clipboard-external-sample', message: '部分音色未嵌入采样内容；已保留原资源定义，仍需定位对应声音文件。' });
  return { notes, instruments, assets, diagnostics };
}
