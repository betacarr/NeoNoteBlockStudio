import { APP_NAME, APP_VERSION } from '../core/app-identity';
import { availableAppearance, INTERNAL_LIQUID_GLASS } from '../core/appearance';
import { useEffect, useMemo, useRef, useState } from 'react';
import { produce } from 'immer';
import { ArrowClockwise, ArrowCounterClockwise, ArrowsOut, CaretDown, Circle, Copy, Cursor, DownloadSimple, Eraser, FloppyDisk, FolderOpen, GearSix, Headphones, List, MagnifyingGlass, Minus, MusicNotes, PencilSimple, PianoKeys, Play, Plus, Record, Repeat, Scissors, SlidersHorizontal, SpeakerHigh, Stop, Warning, Waveform, X } from '@phosphor-icons/react';
import { AudioEngine, PROFILE_STATUS } from '../audio/engine';
import { audioProfile, releaseIdentity } from '../audio/profiles';
import { hrtfOptionHint } from '../audio/context';
import { previewBackendForProject, type PlaybackMode } from '../audio/preview';
import { base64ToBytes, bytesToBase64, openNbsx, saveNbsx } from '../core/container';
import { exportMidi, importMidi, originalMidi } from '../core/midi';
import { exportNbs, importNbs } from '../core/nbs';
import { nbsExportTiming, type NbsTempoPreset } from '../core/nbs-export-timing';
import { importFlp, prepareFlpImport, withFlpSampleChecks, type FlpChannelChoice, type FlpImportPlan } from '../core/flp-import';
import { clamp, createDemo, createProject, flattenNotes, newNote, newTrack, projectDiagnostics, projectEnd, uid } from '../core/project';
import { createTempoMap, tickToSeconds } from '../core/time';
import { createMeterMap, patternOrigin, patternPlayhead, patternTickAt } from '../core/meter';
import { playbackEndTick, waveformPeaks, type WaveformPeaks } from '../core/reference';
import { beginRecordedPress, finishRecordedPress, previewRecordingProject, recordingProjectsEqual, type RecordedPress } from '../core/recording';
import { createAuditionProject } from '../core/audition-project';
import { createNoteClipboard, planNotePaste, type NoteClipboard } from '../core/note-clipboard';
import { applyNoteEdit } from '../core/note-edit';
import { CommitRangeInput } from './CommitRangeInput';
import { createRegionClipboard, planRegionPaste, type RegionClipboard } from '../core/region-clipboard';
import { INSTRUMENTS, noteName } from '../core/instruments';
import { clearBuiltinSampleOverrides } from '../core/sample-overrides';
import { growEditedPattern, trimRegion } from '../core/editor-interaction';
import { MAX_PROJECT_TICK, inspectorBeatTicks, noteTimingError, regionLengthError } from '../core/inspector-timing';
import { canCopyNotes, canCutNotes, canPasteNotes, canEditSelectedNotes, changeSelectedNotes, moveSelectedNotes } from '../core/editor-commands';
import { normalizeEditorSelection, resolveEditorSelection, type EditorSelection } from '../core/editor-selection';
import { moveRegion } from '../core/region-transfer';
import { applyRegionGroupMove, deleteRegionGroup, duplicateRegionGroup, type RegionMove } from '../core/region-batch';
import { inspectRegionSplit, splitRegionGroup } from '../core/region-split';
import { filterTracks } from '../core/track-filter';
import { inspectTrackMove, moveTrackInView, inspectTrackDelete, deleteTrack, allocateTrackMidiChannel } from '../core/track-management';
import { commandForShortcut, displayShortcut, inspectShortcuts, isShortcutInput, isShortcutPreset, isTransportSpace, SHORTCUT_COMMANDS, shortcutForEvent, textEditingCommands } from '../core/shortcuts';
import type { DelayEffect, Diagnostic, Note, Pattern, Preferences, Project, Region, SampleLibrary, Track } from '../core/types';
import { Arrangement } from './Arrangement';
import { PianoRoll, type Tool } from './PianoRoll';
import { PIANO_DEFAULT_ROW_HEIGHT } from './piano-view';
import { PianoZoomControls } from './PianoZoomControls';
import { MenuBar, type StudioMenu } from './MenuBar';
import { TimingEditor } from './TimingEditor';
import { ResizableEditorPanels } from './ResizableEditorPanels';
import { InstrumentBlock } from './InstrumentBlock';
import { LiquidGlassAppearance } from './LiquidGlassAppearance';
import { LiquidGlassTheme } from './LiquidGlassTheme';
import { ShortcutSettings } from './ShortcutSettings';
import { CommitNumberInput, flushActiveNumberInput } from './CommitNumberInput';
import { DelayEditor } from './DelayEditor';
import { FlpImportDialog } from './FlpImportDialog';
import { Mixer } from './Mixer';
import { TrackInstrumentFilter } from './TrackInstrumentFilter';
import { isCurrentExport, syncExportOwner, type ExportContext, type ExportOptions, type ExportOwner, type ExportTicket, type PreparedExport } from './export-context';

const defaults: Preferences = { appearance: 'classic', preset: 'fl', snap: 16, noteLength: 16, shortcuts: {}, showMixer: false, showLibrary: true, showInspector: true };
const readPreferences = (): Preferences => { try { const saved = JSON.parse(localStorage.getItem('nbsx-preferences') ?? '{}'); return { ...defaults, ...saved, preset: isShortcutPreset(saved?.preset) ? saved.preset : 'fl', shortcuts: saved?.shortcuts && typeof saved.shortcuts === 'object' && !Array.isArray(saved.shortcuts) ? Object.fromEntries(Object.entries(saved.shortcuts).filter(([, value]) => typeof value === 'string')) : {}, appearance: availableAppearance(saved?.appearance) }; } catch { return defaults; } };
const shortcutPlatform = window.desktop?.platform ?? navigator.platform;
interface NoteCommandContext {
  project: Project; focus: 'piano' | 'arrangement'; track?: Track; region?: Region; pattern?: Pattern;
  selected: Note[]; selectedNotes: ReadonlySet<string>; meterMap: ReturnType<typeof createMeterMap>; sourceOrigin: number; editorDocumentKey: number;
  current?: () => boolean;
}
function IconButton({ label, children, active, onClick, className = '', disabled }: { label: string; children: React.ReactNode; active?: boolean; onClick: () => void; className?: string; disabled?: boolean }) {
  return <button className={`icon-button ${active ? 'active' : ''} ${className}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton></header>{children}</section></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)])); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const studioRoot = useRef<HTMLDivElement>(null);
  const [project, setProject] = useState<Project>(createDemo);
  const projectRef = useRef(project); projectRef.current = project;
  // Recording can add notes while an unchanged inspector field has a draft.
  // Other edits and history navigation invalidate its captured callbacks.
  const numberEditOwner = useRef({ project, generation: 0 });
  const noteRangePreview = useRef<{ token: object; owner: object; base: Project; project: Project } | undefined>(undefined);
  const savedSnapshot = useRef<Project | undefined>(project);
  const history = useRef<{ label: string; project: Project; selection: EditorSelection }[]>([]), future = useRef<{ label: string; project: Project; selection: EditorSelection }[]>([]);
  const [revision, setRevision] = useState(0), [dirty, setDirty] = useState(false), [filePath, setFilePath] = useState<string>();
  const numberDrafts = useRef(new Set<string>()), [hasNumberDraft, setHasNumberDraft] = useState(false);
  const [hasHeldRecording, setHasHeldRecording] = useState(false);
  const unsaved = dirty || hasNumberDraft || hasHeldRecording;
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [selectedRegion, setSelectedRegion] = useState(project.regions[0]?.id ?? ''), [selectedNotes, setSelectedNotes] = useState(new Set<string>());
  const [selectedRegions, setSelectedRegions] = useState(() => new Set(project.regions[0] ? [project.regions[0].id] : []));
  const selectedRegionsRef = useRef(selectedRegions); selectedRegionsRef.current = selectedRegions;
  const [selectedTrack, setSelectedTrack] = useState(project.regions[0]?.trackId ?? project.tracks[0]?.id ?? '');
  const [instrumentFilter, setInstrumentFilter] = useState('');
  const instrumentFilterRef = useRef(instrumentFilter); instrumentFilterRef.current = instrumentFilter;
  const [focus, setFocus] = useState<'piano' | 'arrangement'>('piano'), [tool, setTool] = useState<Tool>('draw');
  const [zoom, setZoom] = useState(72), [arrangementZoom, setArrangementZoom] = useState(34);
  const [pianoRowHeight, setPianoRowHeight] = useState(PIANO_DEFAULT_ROW_HEIGHT);
  const [editorDocumentKey, setEditorDocumentKey] = useState(0);
  const [pianoViewRequest, setPianoViewRequest] = useState<{ id: number; mode: 'all' | 'selection' }>();
  const [playhead, setPlayhead] = useState(0), positionRef = useRef(0), [playing, setPlaying] = useState(false), [loop, setLoop] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('realtime');
  const [recording, setRecording] = useState(false), recordingRef = useRef(recording); recordingRef.current = recording;
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);
  const [search, setSearch] = useState(''), [message, setMessage] = useState('准备就绪 · 导入 MIDI 开始创作');
  const [modal, setModal] = useState<'settings' | 'export' | 'help' | 'recovery' | 'timing' | 'flp-import' | null>(null);
  const modalRef = useRef(modal); modalRef.current = modal;
  const flpOpenTicket = useRef(0);
  const flpCommitTicket = useRef<number | undefined>(undefined);
  const [flpImport, setFlpImport] = useState<{ plan: FlpImportPlan; ticket: number; owner: { project: Project; generation: number } }>();
  const [settingsTab, setSettingsTab] = useState<'audio' | 'keys' | 'project' | 'appearance'>('audio');
  const [library, setLibrary] = useState<SampleLibrary>(), [roots, setRoots] = useState<{ root: string; versions: string[]; indexes: string[] }[]>([]);
  const [resourceRoot, setResourceRoot] = useState(''), [resourceIndex, setResourceIndex] = useState(''), [resourceVersion, setResourceVersion] = useState('');
  const [loadingResources, setLoadingResources] = useState(false), [portable, setPortable] = useState(true), [busy, setBusy] = useState(false);
  const [importDiagnostics, setImportDiagnostics] = useState<Diagnostic[]>([]);
  const [exportFormat, setExportFormat] = useState<'nbs' | 'mid' | 'wav'>('nbs'), [nbsVersion, setNbsVersion] = useState<4 | 5 | 6>(5), [nbsTempoPreset, setNbsTempoPreset] = useState<NbsTempoPreset>('bpm-7.5'), [nativeAudio, setNativeAudio] = useState(true);
  const [prepared, setPrepared] = useState<PreparedExport>();
  const [exportError, setExportError] = useState<{ ticket: ExportTicket; message: string }>();
  const exportContext: ExportContext = { documentKey: editorDocumentKey, project, format: exportFormat, nbsVersion, nbsTempoPreset, nativeAudio, library, open: modal === 'export' };
  const exportOwner = useRef<ExportOwner>({ context: exportContext, generation: 0 }), exportRunning = useRef(false), exportSaving = useRef(false);
  syncExportOwner(exportOwner.current, exportContext);
  const currentPrepared = prepared && isCurrentExport(exportOwner.current, prepared) ? prepared : undefined;
  const currentExportError = exportError && isCurrentExport(exportOwner.current, exportError.ticket) ? exportError.message : undefined;
  const exportIssues = currentPrepared?.diagnostics.filter(item => item.severity === 'warning') ?? [];
  let nbsTiming: ReturnType<typeof nbsExportTiming> | undefined, nbsTimingIssue: string | undefined;
  try { nbsTiming = nbsExportTiming(project, nbsTempoPreset); } catch (error) { nbsTimingIssue = error instanceof Error ? error.message : String(error); }
  const [recovery, setRecovery] = useState<{ name: string; bytes: Uint8Array; projectId?: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), referenceInput = useRef<HTMLInputElement>(null);
  const engine = useRef(new AudioEngine()).current, clipboard = useRef<NoteClipboard | undefined>(undefined), keysHeld = useRef(new Map<string, RecordedPress>());
  const regionClipboard = useRef<RegionClipboard | undefined>(undefined), lastClipboardKind = useRef<'notes' | 'regions' | undefined>(undefined);
  const [, setClipboardRevision] = useState(0);
  const clipboardTarget = { documentKey: editorDocumentKey, focus, trackId: selectedTrack, regionId: selectedRegion, regions: selectedRegions, notes: selectedNotes, filter: instrumentFilter };
  const liveClipboardTarget = useRef<typeof clipboardTarget | undefined>(clipboardTarget); liveClipboardTarget.current = clipboardTarget;
  const [referencePreview, setReferencePreview] = useState<{ data: string; peaks: WaveformPeaks }>();
  const finishHeld = useRef<(keys?: string[]) => void>(() => {});
  const renderCache = useRef<{ key: string; wav: Uint8Array; audioHint?: string; loopStart?: number; loopEnd?: number } | undefined>(undefined);
  const auditionCache = useRef(new Map<string, Uint8Array>()), stopEpoch = useRef(0);
  const [meters, setMeters] = useState<Record<string, number>>({});
  const [masterMeter, setMasterMeter] = useState(0);
  const [mixerMeterScope, setMixerMeterScope] = useState<'tracks' | 'master'>('tracks');
  const commands = useRef<Record<string, () => void>>({});
  const { region, track, pattern, notes: selected } = resolveEditorSelection(project, { trackId: selectedTrack, regionId: selectedRegion, noteIds: [...selectedNotes], focus });
  const firstNote = selected[0];
  const canEditSelection = focus === 'piano' && canEditSelectedNotes(track, pattern, selectedNotes);
  const regionGroupIssue = useMemo(() => regionGroupProblem(project, selectedRegions, instrumentFilter), [project, selectedRegions, instrumentFilter]);
  const trackManagement = useMemo(() => trackControlState(project, selectedTrack, instrumentFilter), [project.tracks, project.regions, selectedTrack, instrumentFilter]);
  const selectedRegionGeometry = useMemo(() => project.regions.filter(item => selectedRegions.has(item.id)), [project.regions, selectedRegions]);
  const regionSplitIssue = useMemo(() => regionSplitProblem(project, selectedRegions, instrumentFilter, playhead, regionGroupIssue, selectedRegionGeometry), [project, selectedRegions, instrumentFilter, playhead, regionGroupIssue, selectedRegionGeometry]);
  const regionCopyIssue = useMemo(() => regionGroupProblem(project, selectedRegions, instrumentFilter, true), [project, selectedRegions, instrumentFilter]);
  const regionPasteTargetIssue = track?.locked ? '目标轨道已锁定，请先解锁或选择其他轨道。' : instrumentFilter && track && track.instrumentId !== instrumentFilter ? '目标轨道被筛选隐藏，请先显示或选择可见轨道。' : '';
  const canPasteRegionSelection = lastClipboardKind.current === 'regions' && !!regionClipboard.current?.regions.length && !regionPasteTargetIssue;
  const hiddenRegionCount = useMemo(() => {
    const visible = new Set(filterTracks(project.tracks, instrumentFilter).map(item => item.id));
    return project.regions.filter(item => selectedRegions.has(item.id) && !visible.has(item.trackId)).length;
  }, [project.regions, project.tracks, selectedRegions, instrumentFilter]);
  const visibleRegionIds = useMemo(() => {
    const visible = new Set(filterTracks(project.tracks, instrumentFilter).map(item => item.id));
    return new Set(project.regions.filter(item => visible.has(item.trackId)).map(item => item.id));
  }, [project.regions, project.tracks, instrumentFilter]);
  const numberGeneration = numberEditOwner.current.generation;
  const numberContext = JSON.stringify([editorDocumentKey, project.id, numberGeneration, region?.id, pattern?.id, [...selectedNotes].sort()]);
  const liveNumberContext = useRef(numberContext); liveNumberContext.current = numberContext;
  const noteRangeContext = useMemo(() => JSON.stringify([editorDocumentKey, project.id, region?.id, pattern?.id, track?.id, [...selectedNotes].sort()]), [editorDocumentKey, project.id, region?.id, pattern?.id, track?.id, selectedNotes]);
  const delayContext = JSON.stringify([editorDocumentKey, project.id, track?.id, track?.delay]);
  const liveDelayContext = useRef(delayContext); liveDelayContext.current = delayContext;
  const diagnostics = useMemo(() => [...importDiagnostics, ...projectDiagnostics(project)], [project, importDiagnostics]);
  const warnings = diagnostics.filter(d => d.severity !== 'info');
  const flatCount = useMemo(() => { try { return flattenNotes(project).length; } catch { return undefined; } }, [project]);
  const instrument = project.instruments.find(i => i.id === track?.instrumentId);
  const profile = audioProfile(project.audio.profileId);
  const meterMap = useMemo(() => createMeterMap(project), [project.ppq, project.timeSignatures]);
  const tempoMap = useMemo(() => createTempoMap(project), [project.ppq, project.tempos]);
  const activeTempo = tempoMap.at(playhead), activeMeter = meterMap.at(playhead);
  const sourceOrigin = pattern && region ? patternOrigin(region, pattern) : 0;
  const delayPreviewOrigin = Math.max(0, firstNote ? sourceOrigin + firstNote.tick : playhead);
  const delayPreviewBeats = firstNote ? firstNote.duration / project.ppq : 1;
  const delayPreviewDuration = { beats: delayPreviewBeats, seconds: tempoMap.seconds(delayPreviewOrigin + delayPreviewBeats * project.ppq) - tempoMap.seconds(delayPreviewOrigin) };
  const setPrefs = (patch: Partial<Preferences>) => setPreferences(value => ({ ...value, ...patch, appearance: availableAppearance(patch.appearance ?? value.appearance) }));
  const selectionSnapshot = (value = projectRef.current) => normalizeEditorSelection(value, { trackId: selectedTrack, regionId: selectedRegion, regionIds: [...selectedRegionsRef.current], noteIds: [...selectedNotes], focus });
  function restoreSelection(value: Project, saved: EditorSelection) {
    const selection = normalizeEditorSelection(value, saved);
    const ids = new Set(selection.regionIds ?? (selection.regionId ? [selection.regionId] : []));
    selectedRegionsRef.current = ids; setSelectedRegions(ids);
    setSelectedTrack(selection.trackId ?? ''); setSelectedRegion(selection.regionId ?? ''); setSelectedNotes(new Set(selection.noteIds)); setFocus(selection.focus);
  }
  function selectRegion(value: Region) {
    const current = projectRef.current.regions.find(item => item.id === value.id); if (!current) return;
    const ids = selectedRegionsRef.current.has(current.id) ? new Set(selectedRegionsRef.current) : new Set([current.id]);
    selectedRegionsRef.current = ids; setSelectedRegions(ids);
    setSelectedTrack(current.trackId); setSelectedRegion(current.id); setSelectedNotes(new Set());
  }
  function selectRegionGroup(ids: Set<string>, primaryId?: string) {
    const selection = normalizeEditorSelection(projectRef.current, { trackId: selectedTrack, regionId: primaryId ?? selectedRegion, regionIds: [...ids], noteIds: [], focus: 'arrangement' });
    const next = new Set(selection.regionIds); selectedRegionsRef.current = next; setSelectedRegions(next);
    setSelectedTrack(selection.trackId ?? ''); setSelectedRegion(selection.regionId ?? ''); setSelectedNotes(new Set()); setFocus('arrangement');
  }
  function selectTrack(value: Track) {
    setSelectedTrack(value.id);
    const target = region?.trackId === value.id ? region : project.regions.find(r => r.trackId === value.id);
    const ids = new Set(target ? [target.id] : []); selectedRegionsRef.current = ids; setSelectedRegions(ids);
    setSelectedRegion(target?.id ?? ''); setSelectedNotes(new Set());
  }
  function selectAllInEditor() {
    if (focus === 'piano') { setSelectedNotes(new Set(pattern?.notes.map(note => note.id))); return; }
    const current = projectRef.current, visible = new Set(filterTracks(current.tracks, instrumentFilterRef.current).map(item => item.id));
    const ids = new Set(current.regions.filter(item => visible.has(item.trackId)).map(item => item.id));
    selectRegionGroup(ids, ids.has(selectedRegion) ? selectedRegion : undefined);
  }
  function commit(label: string, change: (p: Project) => void, preserveNumberDraft = false) {
    const previous = projectRef.current;
    const changed = produce(previous, draft => { change(draft); });
    if (changed === previous) return;
    const next = produce(changed, draft => { draft.modifiedAt = new Date().toISOString(); });
    const owner = numberEditOwner.current;
    numberEditOwner.current = { project: next, generation: owner.generation + (preserveNumberDraft && owner.project === previous ? 0 : 1) };
    history.current.push({ label, project: previous, selection: selectionSnapshot(previous) }); if (history.current.length > 80) history.current.shift(); future.current = [];
    projectRef.current = next; setProject(next); setDirty(true); setRevision(v => v + 1);
  }
  const changeTrack = (id: string, patch: Partial<Track>) => commit('调整轨道', p => { const t = p.tracks.find(t => t.id === id); if (t) Object.assign(t, patch); });
  function changeMixerTrack(id: string, patch: Partial<Track>) {
    if (numberEditOwner.current.generation !== numberGeneration || numberEditOwner.current.project !== projectRef.current) return;
    const target = projectRef.current.tracks.find(item => item.id === id);
    if (!target || Object.keys(patch).some(key => !['volume', 'pan', 'muted', 'solo'].includes(key))) return;
    if (patch.volume !== undefined && (target.locked || !Number.isFinite(patch.volume) || patch.volume < 0 || patch.volume > 4)) return;
    if (patch.pan !== undefined && (target.locked || !Number.isFinite(patch.pan) || patch.pan < -1 || patch.pan > 1)) return;
    if (patch.muted !== undefined && typeof patch.muted !== 'boolean' || patch.solo !== undefined && typeof patch.solo !== 'boolean') return;
    commit('调整混音器轨道', p => { const current = p.tracks.find(item => item.id === id); if (current) Object.assign(current, patch); });
  }
  function changeMixerMaster(value: number) {
    if (numberEditOwner.current.generation !== numberGeneration || numberEditOwner.current.project !== projectRef.current || !Number.isFinite(value) || value < 0 || value > 2) return;
    commit('调整总音量', p => { p.audio.masterGain = value; });
  }
  function updateRealtimeProject(value: Project) {
    const preview = noteRangePreview.current;
    try { engine.updateProject(preview && preview.base === value && preview.owner === numberEditOwner.current ? preview.project : value); }
    catch (error) { setMessage(`实时试听更新失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  function previewMixerTrack(id: string, patch: Partial<Track> | undefined) {
    if (patch !== undefined) { engine.previewTrack(id, patch); return; }
    try { updateRealtimeProject(projectRef.current); }
    finally { engine.previewTrack(id, undefined); }
  }
  function previewMixerMaster(value: number | undefined) {
    if (value !== undefined) { engine.previewMaster(value); return; }
    try { updateRealtimeProject(projectRef.current); }
    finally { engine.previewMaster(undefined); }
  }
  function previewNoteRange(field: 'velocity' | 'pan') {
    const token = {}, owner = numberEditOwner.current;
    return (value: number | undefined) => {
      if (value === undefined) {
        if (noteRangePreview.current?.token !== token) return;
        noteRangePreview.current = undefined; updateRealtimeProject(projectRef.current); return;
      }
      if (!pattern || !region || !track || track.locked || !Number.isFinite(value) || value < (field === 'pan' ? -100 : 0) || value > 100
        || projectRef.current !== project || numberEditOwner.current !== owner || liveNumberContext.current !== numberContext) return;
      const preview = produce(project, next => {
        const source = next.patterns.find(item => item.id === pattern.id);
        if (source) source.notes = changeSelectedNotes(source.notes, selectedNotes, note => ({ ...note, [field]: value / 100 }));
      });
      noteRangePreview.current = { token, owner, base: project, project: preview }; updateRealtimeProject(project);
    };
  }
  function filterInstruments(value: string) {
    if (!finishNumberDraft()) return;
    instrumentFilterRef.current = value;
    setInstrumentFilter(value);
  }
  function selectMixerTrack(value: Track) {
    if (!finishNumberDraft()) return;
    const current = projectRef.current.tracks.find(item => item.id === value.id); if (!current) return;
    selectTrack(current); setFocus('arrangement');
  }
  const changeRegion = (id: string, patch: Partial<Region>) => {
    if (numberEditOwner.current.generation !== numberGeneration || numberEditOwner.current.project !== projectRef.current) return;
    if (selectedRegionsRef.current.size > 1) { setMessage('仅单片段可编辑这些属性；请先单独选择一个片段。'); return; }
    const previous = projectRef.current, source = previous.regions.find(item => item.id === id), keys = Object.keys(patch);
    if (!source) return;
    if (keys.some(key => key === 'start' || key === 'trackId')) {
      // A captured pointer/selector cannot apply geometry to a newer document,
      // even if its UUID was reused or a recording preserved number generation.
      if (previous !== project || keys.some(key => key !== 'start' && key !== 'trackId')) return;
      commit('移动片段', p => { moveRegion(p, id, patch.trackId ?? source.trackId, patch.start ?? source.start); });
      if (projectRef.current !== previous) {
        const moved = projectRef.current.regions.find(item => item.id === id);
        if (moved && moved.trackId !== source.trackId) { selectRegion(moved); setFocus('arrangement'); }
      }
      return;
    }
    if (keys.some(key => !['length', 'offset', 'loop'].includes(key))
      || patch.length !== undefined && (!Number.isFinite(patch.length) || patch.length < 1 || patch.length > MAX_PROJECT_TICK)
      || patch.offset !== undefined && (!Number.isFinite(patch.offset) || patch.offset < 0 || patch.offset > MAX_PROJECT_TICK)
      || patch.loop !== undefined && typeof patch.loop !== 'boolean') return;
    commit('调整片段', p => { const r = p.regions.find(item => item.id === id); if (r && p.tracks.some(item => item.id === r.trackId && !item.locked)) Object.assign(r, patch); });
  };
  function trimCurrentRegion(id: string, edge: 'start' | 'end', tick: number) {
    const target = projectRef.current.regions.find(r => r.id === id);
    if (!target || !projectRef.current.tracks.some(t => t.id === target.trackId && !t.locked)) return;
    const ids = new Set([id]); selectedRegionsRef.current = ids; setSelectedRegions(ids);
    setSelectedTrack(target.trackId); setSelectedRegion(id);
    commit('调整片段播放范围', p => { trimRegion(p, id, edge, tick); }); setSelectedNotes(new Set());
  }
  function changeRegionGroup(changes: RegionMove[]) {
    if (!regionGroupEditable()) return;
    const previous = projectRef.current, ids = selectedRegionsRef.current;
    const changedIds = new Set(changes.map(item => item.id));
    const visible = new Set(filterTracks(previous.tracks, instrumentFilterRef.current).map(item => item.id));
    if (changes.length !== ids.size || changedIds.size !== ids.size || [...ids].some(id => !changedIds.has(id)) || changes.some(item => !visible.has(item.trackId))) {
      setMessage('所选片段或目标轨道已更改，请重新拖动。'); return;
    }
    const originals = new Map(previous.regions.map(item => [item.id, item]));
    if (changes.every(item => { const region = originals.get(item.id); return region?.start === item.start && region.trackId === item.trackId; })) return;
    commit(ids.size > 1 ? '移动所选片段' : '移动片段', p => { applyRegionGroupMove(p, changes); });
    if (projectRef.current === previous) { setMessage('无法整体移动：目标无效、已锁定或超出工程范围。'); return; }
    const primary = projectRef.current.regions.find(item => item.id === selectedRegion && ids.has(item.id)) ?? projectRef.current.regions.find(item => ids.has(item.id));
    if (primary) selectRegion(primary); setFocus('arrangement');
  }
  function renameCurrentRegion(value: string) {
    if (!region || selectedRegionsRef.current.size !== 1 || !selectedRegionsRef.current.has(region.id)
      || numberEditOwner.current.generation !== numberGeneration || numberEditOwner.current.project !== projectRef.current || projectRef.current !== project
      || !projectRef.current.tracks.some(item => item.id === region.trackId && !item.locked)) return;
    commit('重命名片段', p => { const current = p.patterns.find(item => item.id === region.patternId); if (current) current.name = value; });
  }
  function editNotes(label: string, change: (notes: Note[]) => Note[], context?: Pick<NoteCommandContext, 'pattern' | 'region' | 'track' | 'current'>): boolean {
    const target = context ?? { pattern, region, track };
    if (!target.pattern || !target.region || !target.track || target.track.locked) return false;
    const snapshot = projectRef.current, owner = numberEditOwner.current;
    try {
      if (target.current ? !target.current() : snapshot !== project || owner.project !== snapshot || owner.generation !== numberGeneration) {
        setMessage('工程或选择已更改，请重新修改音符。'); return false;
      }
      const source = snapshot.patterns.find(item => item.id === target.pattern!.id);
      if (!source) throw new Error('要修改的音符源已失效。');
      // Isolate callback mutations before validating or committing the document.
      const notes = produce(source.notes, draft => change(draft));
      if (projectRef.current !== snapshot || numberEditOwner.current !== owner) throw new Error('工程已更改，请重新修改音符。');
      commit(label, p => {
        applyNoteEdit(p, { patternId: target.pattern!.id, regionId: target.region!.id, trackId: target.track!.id }, notes);
      });
      return true;
    } catch (error) { setMessage(`音符修改未应用：${error instanceof Error ? error.message : String(error)}`); return false; }
  }
  function updateNotes(patch: Partial<Note>, context?: Pick<NoteCommandContext, 'pattern' | 'region' | 'track' | 'current'>) { return editNotes('修改音符属性', notes => changeSelectedNotes(notes, selectedNotes, n => ({ ...n, ...patch })), context); }
  function setNumberPending(field: string, pending: boolean) {
    if (pending) numberDrafts.current.add(field); else numberDrafts.current.delete(field);
    setHasNumberDraft(numberDrafts.current.size > 0);
  }
  function commitNoteNumber(patch: Partial<Note>) {
    if (liveNumberContext.current !== numberContext || numberEditOwner.current.generation !== numberGeneration || numberEditOwner.current.project !== projectRef.current) return;
    if (!pattern || !region || track?.locked) return;
    if (region && (patch.tick !== undefined || patch.duration !== undefined)) {
      const error = noteTimingError(projectRef.current, region.id, selectedNotes, patch);
      if (error) { setMessage(error); return false; }
    }
    const snapshot = projectRef.current, owner = numberEditOwner.current;
    const currentRegion = snapshot.regions.find(item => item.id === region.id);
    const currentPattern = snapshot.patterns.find(item => item.id === pattern.id);
    const currentTrack = snapshot.tracks.find(item => item.id === track?.id);
    const current = () => projectRef.current === snapshot && numberEditOwner.current === owner && liveNumberContext.current === numberContext;
    if (!updateNotes(patch, { region: currentRegion, pattern: currentPattern, track: currentTrack, current })) return false;
    setMessage('已更新音符属性。');
  }
  function commitRegionLength(value: number) {
    if (selectedRegionsRef.current.size !== 1 || !region || !selectedRegionsRef.current.has(region.id)) return;
    if (!region || liveNumberContext.current !== numberContext || numberEditOwner.current.generation !== numberGeneration || numberEditOwner.current.project !== projectRef.current || projectRef.current.regions.find(item => item.id === region.id)?.length !== region.length) return;
    const length = Math.max(1, project.ppq / 4, inspectorBeatTicks(value, project.ppq)), error = regionLengthError(projectRef.current, region.id, length);
    if (error) { setMessage(error); return false; }
    changeRegion(region.id, { length }); setMessage('已调整片段长度。');
  }
  function finishNumberDraft(): boolean {
    if (flushActiveNumberInput() && !numberDrafts.current.size) return true;
    setMessage('属性中有未完成或超出范围的数字，请修正后再继续。'); return false;
  }
  function changeTrackDelay(value: DelayEffect) {
    if (!track || track.locked || liveDelayContext.current !== delayContext || numberEditOwner.current.generation !== numberGeneration || numberEditOwner.current.project !== projectRef.current) return;
    commit('调整 Delay 效果', next => { const target = next.tracks.find(item => item.id === track.id); if (target && !target.locked) target.delay = value; });
  }
  function moveNoteSelection(tick: number, pitch = 0) {
    if (focus !== 'piano' || !canEditSelectedNotes(track, pattern, selectedNotes)) return;
    editNotes(pitch ? '移调' : '移动音符', notes => moveSelectedNotes(notes, selectedNotes, tick, pitch));
  }
  function nudgeNoteSelection(direction: number, beat = false) {
    const step = beat ? project.ppq : preferences.snap ? project.ppq * 4 / preferences.snap : 1;
    moveNoteSelection(direction * step);
  }
  function quantizeNoteSelection() {
    if (focus !== 'piano' || !canEditSelectedNotes(track, pattern, selectedNotes)) return;
    editNotes('量化音符', notes => changeSelectedNotes(notes, selectedNotes, n => ({ ...n, tick: Math.max(0, meterMap.snap(sourceOrigin + n.tick, project.ppq * 4 / (preferences.snap || 16)) - sourceOrigin) })));
  }
  function stop() { finishHeld.current(); stopEpoch.current++; engine.stop(); setPlaying(false); }
  function seek(tick: number) { stop(); const next = Math.max(0, tick); setPlayhead(next); positionRef.current = next; }
  function changePlaybackMode(value: PlaybackMode) {
    if (value === playbackMode) return;
    stop(); setPlaybackMode(value);
  }
  async function togglePlay(looping = loop, restart = false) {
    if (playing && !restart) { stop(); return; }
    if (busy) { stop(); setMessage('已取消启动试听，等待后台渲染结束。'); return; }
    setBusy(true);
    try {
      const epoch = stopEpoch.current, snapshot = projectRef.current;
      const reference = await engine.loadReference(snapshot);
      if (epoch !== stopEpoch.current || snapshot !== projectRef.current) return;
      const end = playbackEndTick(snapshot, reference?.duration), from = positionRef.current >= end ? 0 : positionRef.current;
      const backend = previewBackendForProject(snapshot, library, !!window.desktop, playbackMode);
      if (backend.type === 'native' && window.desktop) {
        const library = backend.library;
        const key = `${snapshot.id}:${revision}:${library.nativeLibrary}:${looping}`;
        let cached = renderCache.current;
        if (cached?.key !== key) {
          setBusy(true); setMessage('正在准备原生声音试听…');
          const request = await engine.nativeRequest(snapshot);
          const timing = createTempoMap(snapshot), period = timing.seconds(end);
          const warmup = Math.max(1, Math.ceil((request.duration - period) / period));
          const cycles = looping ? warmup + 2 : 1;
          if (looping) {
            const events = request.events;
            if (events.length * cycles > 2000000 || request.duration + (cycles - 1) * period > 1800) throw new Error('循环试听的 Delay 尾音展开量过大，请缩短尾音、增大回声间隔或关闭循环。');
            request.events = Array.from({ length: cycles }, (_, cycle) => events.map(e => ({ ...e, time: e.time + cycle * period,
              frame: e.tick === undefined ? Math.round((e.time + cycle * period) * request.sampleRate) : timing.frame(e.tick, request.sampleRate, { cycle, endTick: end }) }))).flat();
            request.duration += (cycles - 1) * period;
          }
          request.duration = Math.max(request.duration, looping ? cycles * period : period);
          const result = await window.desktop.renderNative(request);
          const device = result.hrtfGameDevice ?? result.hrtfDefaultDevice;
          const actual = device?.directional ? '开启' : '关闭';
          const audioHint = !device ? undefined : result.hrtfGameDevice?.control === 'device-default' || !result.hrtfGameDevice ? `方向音频：沿用设备默认（${actual}）` : result.hrtfGameDevice.option !== device.directional ? `方向音频：设备设置覆盖为${actual}` : `方向音频：${actual}`;
          cached = { key, wav: result.wav, audioHint, ...(looping ? { loopStart: warmup * period, loopEnd: (warmup + 1) * period } : {}) };
          renderCache.current = cached;
        }
        if (epoch !== stopEpoch.current || snapshot !== projectRef.current) return;
        if (!await engine.playRendered(snapshot, cached!.wav, from, cached!.loopStart, cached!.loopEnd)) return;
        if (epoch !== stopEpoch.current || snapshot !== projectRef.current) { engine.stop(); return; }
        setMixerMeterScope('master');
        setMessage(`原生离线对照 · ${library.version} · ${PROFILE_STATUS[audioProfile(snapshot.audio.profileId).status]}${cached?.audioHint ? ` · ${cached.audioHint}` : ''}`);
      } else {
        if (!await engine.play(snapshot, from, looping)) return;
        if (epoch !== stopEpoch.current || snapshot !== projectRef.current) { engine.stop(); return; }
        setMixerMeterScope('tracks'); setMessage('实时试听 · 编辑即时生效 · 空间效果为预览');
      }
      setPlaying(true);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  function toggleLoop() { const resume = engine.playing, next = !loop; stop(); setLoop(next); if (resume) void togglePlay(next, true); }
  async function audition(midi: number, note?: Note, origin = note ? Math.max(0, sourceOrigin + note.tick) : positionRef.current) {
    if (!track) return;
    try {
      const current = projectRef.current, currentTrack = current.tracks.find(item => item.id === track.id);
      if (!currentTrack) return;
      const id = note?.instrumentId ?? currentTrack.instrumentId;
      const backend = previewBackendForProject(current, library, !!window.desktop, playbackMode);
      if (backend.type === 'native' && window.desktop) {
        const library = backend.library;
        const epoch = stopEpoch.current;
        const preview = createAuditionProject(current, currentTrack, midi, note, origin, preferences.noteLength);
        const key = JSON.stringify([editorDocumentKey, current.id, library.nativeLibrary, id, current.instruments.find(item => item.id === id)?.assetId, midi, preview.ppq, preview.tempos, { ...preview.patterns[0].notes[0], id: undefined }, currentTrack.volume, currentTrack.pan, currentTrack.delay, current.audio]);
        let wav = auditionCache.current.get(key);
        if (!wav) {
          const request = await engine.nativeRequest(preview);
          const result = await window.desktop.renderNative(request); wav = result.wav;
          auditionCache.current.set(key, wav); if (auditionCache.current.size > 32) auditionCache.current.delete(auditionCache.current.keys().next().value!);
        }
        if (epoch === stopEpoch.current) await engine.auditionRendered(wav);
      } else await engine.auditionProject(createAuditionProject(current, currentTrack, midi, note, origin, preferences.noteLength));
    }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function loadResources(root = resourceRoot, index = resourceIndex, version = resourceVersion, applyProfile = true) {
    if (!window.desktop || !root || !index) return;
    setLoadingResources(true);
    try {
      const loaded = await window.desktop.loadMinecraft(root, index, version);
      const count = await engine.setLibrary(loaded);
      if (applyProfile) commit('切换声音资源版本', p => { p.audio.profileId = loaded.profileId; clearBuiltinSampleOverrides(p.instruments); });
      await engine.loadProjectSamples(projectRef.current);
      setLibrary(loaded); setMessage(`已加载 Java ${loaded.version} · ${count} 个声音事件采样${loaded.warnings?.length ? ' · ' + loaded.warnings.join('；') : ' · 声音一致性待实测'}`);
      renderCache.current = undefined; auditionCache.current.clear();
      setResourceRoot(root); setResourceIndex(index); setResourceVersion(version);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setLoadingResources(false); }
  }
  async function discover(autoLoad = false) {
    if (!window.desktop) { setMessage('浏览器仅用于界面预览；请在桌面程序中查找本机游戏资源。'); return; }
    setLoadingResources(true);
    try {
      const found = await window.desktop.discoverMinecraft(); setRoots(found);
      if (found.length) {
        const requested = projectRef.current.audio.profileId.replace(/^java-/, ''), indexName = `${releaseIdentity(requested)?.assetIndex}.json`;
        const best = found.find(r => r.versions.includes(requested) && r.indexes.includes(indexName)) ?? found[0];
        const version = best.versions.find(v => v === requested) ?? best.versions[0];
        const index = best.indexes.find(i => i === indexName) ?? best.indexes[0];
        setResourceRoot(best.root); setResourceVersion(version); setResourceIndex(index);
        if (autoLoad && version === requested && index === indexName) await loadResources(best.root, index, version, false);
        else if (autoLoad) setMessage(`未找到 ${requested} 的完整资源。请在声音设置中选择客户端，或使用工程内嵌采样进行 Web 试听。`);
      } else setMessage('没有找到完整的本机 Minecraft 资源。');
    } catch (error) { setMessage(String(error)); }
    finally { setLoadingResources(false); }
  }
  function chooseResourceVersion(version: string, selectedRoot = roots.find(r => r.root === resourceRoot)) {
    setResourceVersion(version);
    const index = releaseIdentity(version)?.assetIndex;
    if (index && selectedRoot?.indexes.includes(`${index}.json`)) setResourceIndex(`${index}.json`);
    else if (!selectedRoot?.indexes.includes(resourceIndex)) setResourceIndex(selectedRoot?.indexes[0] ?? '');
  }
  async function selectResourceDirectory() {
    try {
      const root = await window.desktop?.selectMinecraftRoot(); if (!root) return;
      setRoots(previous => [...previous.filter(r => r.root !== root.root), root]); setResourceRoot(root.root);
      chooseResourceVersion(root.versions[0], root); setMessage('目录已选择，请加载对应客户端资源。');
    } catch (error) { setMessage(String(error)); }
  }
  function adopt(next: Project, filename?: string, path?: string, reports: Diagnostic[] = []) {
    liveClipboardTarget.current = undefined;
    instrumentFilterRef.current = '';
    setInstrumentFilter('');
    flpOpenTicket.current++; setFlpImport(undefined); setModal(current => current === 'flp-import' ? null : current);
    setEditorDocumentKey(value => value + 1); setPianoViewRequest(undefined);
    if (filename && /\.(?:mid|midi|nbs|flp)$/i.test(filename) && library) next.audio.profileId = library.profileId;
    stop(); numberEditOwner.current = { project: next, generation: numberEditOwner.current.generation + 1 };
    const ids = new Set(next.regions[0] ? [next.regions[0].id] : []); selectedRegionsRef.current = ids; setSelectedRegions(ids);
    history.current = []; future.current = []; projectRef.current = next; savedSnapshot.current = next; setProject(next); setSelectedTrack(next.regions[0]?.trackId ?? next.tracks[0]?.id ?? ''); setSelectedRegion(next.regions[0]?.id ?? ''); setSelectedNotes(new Set()); seek(0);
    setDirty(false); setFilePath(filename?.endsWith('.nbsx') ? path : undefined); setImportDiagnostics(reports); setRevision(v => v + 1);
    setMessage(`${filename ? '已打开 ' + filename : '新建工程'} · ${next.tracks.length} 条轨道`);
    void engine.loadProjectSamples(next).catch(error => setMessage(`工程采样加载失败：${String(error)}`));
    if (filename?.endsWith('.nbsx') && window.desktop && next.audio.profileId !== library?.profileId) {
      const version = next.audio.profileId.replace(/^java-/, ''), index = `${releaseIdentity(version)?.assetIndex}.json`;
      const matching = roots.find(r => r.versions.some(v => v === version || v.startsWith(`${version}-`)) && r.indexes.includes(index));
      const instance = matching?.versions.find(v => v === version) ?? matching?.versions.find(v => v.startsWith(`${version}-`));
      if (matching && instance) void loadResources(matching.root, index, instance, false);
      else setMessage(`已打开 ${filename} · 未找到目标 ${version} 的本机声音资源，请在设置中选择匹配版本。`);
    }
  }
  async function openBytes(name: string, bytes: Uint8Array, path?: string) {
    try {
      if (!finishNumberDraft()) return;
      if (/\.flp$/i.test(name)) { await beginFlpImport(name, bytes, path); return; }
      const changed = projectRef.current !== savedSnapshot.current || [...keysHeld.current.values()].some(press => press.capture);
      if (changed && !window.confirm('当前工程有未保存的修改，继续打开其他文件吗？')) return;
      if (changed) await window.desktop?.clearRecovery(projectRef.current.id);
      const ext = name.split('.').at(-1)?.toLowerCase();
      if (ext === 'nbsx') adopt(openNbsx(bytes), name, path);
      else if (ext === 'mid' || ext === 'midi') { const result = importMidi(bytes, name); adopt(result.project, name, undefined, result.diagnostics); savedSnapshot.current = undefined; setDirty(true); }
      else if (ext === 'nbs') { const result = importNbs(bytes, name); adopt(result.project, name, undefined, result.diagnostics); savedSnapshot.current = undefined; setDirty(true); }
      else throw new Error('请选择 MIDI、NBS、FLP 或 NBSX 文件。');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  function cancelFlpImport() {
    flpOpenTicket.current++; setFlpImport(undefined); setModal(null); setMessage('已取消 FLP 导入。');
  }
  function isCurrentFlpImport(ticket: number, owner: { project: Project; generation: number }) {
    return ticket === flpOpenTicket.current && projectRef.current === owner.project && numberEditOwner.current.generation === owner.generation;
  }
  async function beginFlpImport(name: string, bytes: Uint8Array, path?: string) {
    const ticket = ++flpOpenTicket.current, owner = { ...numberEditOwner.current, project: projectRef.current };
    setFlpImport(undefined); setModal('flp-import'); setMessage(`正在读取 ${name}…`);
    try {
      let plan = await prepareFlpImport(bytes, name);
      if (!isCurrentFlpImport(ticket, owner)) return;
      if (path && window.desktop?.inspectFlpSamples) {
        try {
          const checks = await window.desktop.inspectFlpSamples(path, plan.channels.filter(channel => channel.kind === 0 && channel.sample).map(channel => ({ id: channel.id, path: channel.sample })));
          if (!isCurrentFlpImport(ticket, owner)) return;
          plan = withFlpSampleChecks(plan, checks);
        } catch { plan = { ...plan, warnings: [...plan.warnings, '本机采样文件未能核对，请手动确认音色与采样基准。'] }; }
      }
      if (!isCurrentFlpImport(ticket, owner)) return;
      setFlpImport({ plan, ticket, owner }); setMessage('FLP 已读取，请确认导入音色与采样基准。');
    } catch (error) {
      if (ticket !== flpOpenTicket.current) return;
      setFlpImport(undefined); setModal(null); setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (ticket === flpOpenTicket.current && !isCurrentFlpImport(ticket, owner)) {
        cancelFlpImport(); setMessage('读取期间当前工程已更改，请重新打开 FLP。');
      }
    }
  }
  async function finishFlpImport(choices: FlpChannelChoice[], acknowledgeWarnings: boolean) {
    const pending = flpImport;
    if (!pending) return;
    if (flpCommitTicket.current === pending.ticket) return;
    if (!isCurrentFlpImport(pending.ticket, pending.owner)) { cancelFlpImport(); setMessage('当前工程已更改，请重新打开 FLP。'); return; }
    flpCommitTicket.current = pending.ticket;
    try {
      // Build and validate the complete replacement before discarding anything.
      const result = importFlp(pending.plan, choices, { acknowledgeWarnings });
      const changed = projectRef.current !== savedSnapshot.current || [...keysHeld.current.values()].some(press => press.capture);
      if (changed && !window.confirm('当前工程有未保存的修改，继续导入 FLP 吗？')) return;
      if (!isCurrentFlpImport(pending.ticket, pending.owner)) return;
      adopt(result.project, pending.plan.filename, undefined, result.diagnostics); savedSnapshot.current = undefined; setDirty(true);
      if (changed) await window.desktop?.clearRecovery(pending.owner.project.id).catch(error => {
        if (projectRef.current === result.project) setMessage(`FLP 已导入，但旧工程恢复副本未能清理：${String(error)}`);
      });
    } catch (error) { if (pending.ticket === flpOpenTicket.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (flpCommitTicket.current === pending.ticket) flpCommitTicket.current = undefined; }
  }
  async function open() { if (!finishNumberDraft()) return; if (window.desktop) { try { const file = await window.desktop.openFile('project'); if (file) await openBytes(file.name, file.bytes, file.path); } catch (error) { setMessage(String(error)); } } else fileInput.current?.click(); }
  function projectForSave(base = projectRef.current): Project {
    const next = structuredClone(base);
    if (portable && library) for (const id of new Set(flattenNotes(next, true).map(n => n.effectiveInstrument))) {
      const sample = library.samples[id], ins = next.instruments.find(i => i.id === id);
      if (!sample || !ins || ins.assetId || next.audio.profileId !== library.profileId) continue;
      const assetId = `sample-${id}`; next.assets = next.assets.filter(a => a.id !== assetId);
      next.assets.push({ id: assetId, name: `${id}.ogg`, mime: 'audio/ogg', data: bytesToBase64(sample.bytes), sha1: sample.sha1 }); ins.assetId = assetId;
    }
    return next;
  }
  async function saveOriginalMidi() {
    try {
      const source = originalMidi(projectRef.current);
      if (!source) throw new Error('此工程没有嵌入的原始 MIDI 文件。');
      const saved = window.desktop ? await window.desktop.saveFile(source.name, source.bytes) : (download(source.name, source.bytes), source.name);
      if (saved) setMessage('已另存原始 MIDI；文件内容与导入时一致。');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function save(as = false) {
    try {
      if (!finishNumberDraft()) return false;
      const pending = previewRecordingProject(projectRef.current, keysHeld.current.values(), engine.position(), editorDocumentKey);
      const snapshot = pending.project, next = projectForSave(snapshot), bytes = saveNbsx(next), name = `${next.name}.nbsx`;
      const saved = window.desktop ? await window.desktop.saveFile(name, bytes, as ? undefined : filePath) : (download(name, bytes), name);
      if (saved) {
        const matches = projectRef.current === snapshot || (pending.noteCount > 0 && recordingProjectsEqual(projectRef.current, snapshot));
        savedSnapshot.current = matches ? projectRef.current : snapshot; setFilePath(saved); setDirty(!matches);
        setMessage(`已保存 ${name}${portable ? ' · 便携工程' : ''}${pending.noteCount ? ' · 包含按下中的音符快照' : ''}`);
        if (matches) {
          if (window.desktop) await window.desktop.clearRecovery(snapshot.id).catch(error => setMessage(`工程已保存，但恢复副本未能清理：${String(error)}`));
          else localStorage.removeItem('nbsx-recovery');
          setRecovery(current => current?.projectId === snapshot.id ? null : current);
        }
        return projectRef.current === savedSnapshot.current && ![...keysHeld.current.values()].some(press => press.capture);
      }
      return false;
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    return false;
  }
  async function newProject() {
    if (!finishNumberDraft()) return;
    const changed = projectRef.current !== savedSnapshot.current || [...keysHeld.current.values()].some(press => press.capture);
    if (changed && !window.confirm('当前修改尚未保存，仍要新建工程吗？')) return;
    if (changed) await window.desktop?.clearRecovery(projectRef.current.id).catch(error => setMessage(`恢复副本未能清理：${String(error)}`));
    adopt(createProject());
  }
  function restoreRecovery() {
    if (!recovery) return;
    try { const next = openNbsx(recovery.bytes); adopt(next, recovery.name); setRecovery({ ...recovery, projectId: next.id }); savedSnapshot.current = undefined; setDirty(true); setModal(null); setMessage('已恢复未保存的内容，请保存为 NBSX 工程。'); }
    catch (error) { setMessage(`恢复失败：${String(error)}`); }
  }
  async function discardRecovery() {
    try { if (window.desktop) await window.desktop.clearRecovery(); else localStorage.removeItem('nbsx-recovery'); setRecovery(null); setModal(null); }
    catch (error) { setMessage(`恢复副本未能清理：${String(error)}`); }
  }
  function undo() {
    if (playbackMode === 'native-compare') stop(); else finishHeld.current();
    const entry = history.current.pop(); if (!entry) return;
    future.current.push({ label: entry.label, project: projectRef.current, selection: selectionSnapshot() });
    numberEditOwner.current = { project: entry.project, generation: numberEditOwner.current.generation + 1 };
    projectRef.current = entry.project; setProject(entry.project); restoreSelection(entry.project, entry.selection);
    setDirty(entry.project !== savedSnapshot.current); setRevision(v => v + 1); setMessage(`撤销：${entry.label}`);
  }
  function redo() {
    if (playbackMode === 'native-compare') stop(); else finishHeld.current();
    const entry = future.current.pop(); if (!entry) return;
    history.current.push({ label: entry.label, project: projectRef.current, selection: selectionSnapshot() });
    numberEditOwner.current = { project: entry.project, generation: numberEditOwner.current.generation + 1 };
    projectRef.current = entry.project; setProject(entry.project); restoreSelection(entry.project, entry.selection);
    setDirty(entry.project !== savedSnapshot.current); setRevision(v => v + 1); setMessage(`重做：${entry.label}`);
  }
  function copyNotes(context: NoteCommandContext = { project: projectRef.current, focus, track, region, pattern, selected, selectedNotes, meterMap, sourceOrigin, editorDocumentKey }) {
    const { project, focus, track, selected, editorDocumentKey } = context;
    if (context.current && !context.current()) return false;
    if (!canCopyNotes(focus, track, selected)) return false;
    try {
      const next = createNoteClipboard(project, selected, track!.id, editorDocumentKey);
      if (context.current && !context.current()) return false;
      clipboard.current = next; setMessage(`已复制 ${selected.length} 个音符`); return true;
    }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return false; }
  }
  function cutNotes(context: NoteCommandContext = { project: projectRef.current, focus, track, region, pattern, selected, selectedNotes, meterMap, sourceOrigin, editorDocumentKey }) {
    const { focus, track, selected, selectedNotes } = context;
    if (context.current && !context.current()) return false;
    if (!canCutNotes(focus, track, selected)) return false;
    try {
      const previous = projectRef.current, next = createNoteClipboard(context.project, selected, track!.id, context.editorDocumentKey);
      if (context.current && !context.current()) return false;
      editNotes('剪切音符', notes => notes.filter(note => !selectedNotes.has(note.id)), context);
      if (projectRef.current === previous) return false;
      clipboard.current = next; setSelectedNotes(new Set()); setMessage(`已剪切 ${selected.length} 个音符`); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return false; }
  }
  function pasteNotes(duplicate = false, context: NoteCommandContext = { project: projectRef.current, focus, track, region, pattern, selected, selectedNotes, meterMap, sourceOrigin, editorDocumentKey }) {
    const { project, focus, track, region, pattern, selected, meterMap, sourceOrigin, editorDocumentKey } = context;
    if (context.current && !context.current()) return;
    if (focus !== 'piano') { setMessage('编曲区请使用“独立复制”；音符粘贴仅用于钢琴卷帘。'); return; }
    const notes = duplicate ? selected : clipboard.current?.notes ?? []; if (!region || !pattern || !canPasteNotes(track, pattern, notes)) return;
    const at = duplicate ? notes.reduce((end, note) => Math.max(end, note.tick + note.duration), 0) : region ? patternTickAt(positionRef.current, region, pattern) : 0;
    const targetTick = Math.max(0, meterMap.snap(sourceOrigin + at, preferences.snap ? project.ppq * 4 / preferences.snap : 1) - sourceOrigin);
    try {
      const snapshot = projectRef.current;
      const source = duplicate ? createNoteClipboard(snapshot, notes, track!.id, editorDocumentKey) : clipboard.current!;
      const plan = planNotePaste(snapshot, source, targetTick, track!.id, editorDocumentKey);
      if (context.current && !context.current()) return;
      commit('复制音符', next => {
        const pt = next.patterns.find(item => item.id === pattern.id)!, r = next.regions.find(item => item.id === region.id)!;
        if (plan.instruments.length) next.instruments = [...next.instruments, ...plan.instruments];
        if (plan.assets.length) next.assets = [...next.assets, ...plan.assets];
        pt.notes = [...pt.notes, ...plan.notes];
        const required = plan.notes.reduce((end, note) => Math.max(end, note.tick + 1), 1);
        growEditedPattern(next, r, pt, required);
      });
      setSelectedNotes(new Set(plan.notes.map(note => note.id))); setFocus('piano');
      if (plan.instruments.length || plan.assets.length) {
        const pastedProject = projectRef.current;
        void engine.loadProjectSamples(pastedProject).catch(error => { if (projectRef.current === pastedProject) setMessage(`粘贴音符已保留，但采样加载失败：${String(error)}`); });
      }
      if (plan.diagnostics.length) setMessage(plan.diagnostics.map(item => item.message).join(' '));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  function sameClipboardTarget() {
    const live = liveClipboardTarget.current;
    return live !== undefined && live.documentKey === clipboardTarget.documentKey && live.focus === clipboardTarget.focus
      && live.trackId === clipboardTarget.trackId && live.regionId === clipboardTarget.regionId && live.regions === clipboardTarget.regions && live.notes === clipboardTarget.notes
      && live.filter === clipboardTarget.filter && selectedRegionsRef.current === clipboardTarget.regions && instrumentFilterRef.current === clipboardTarget.filter;
  }
  function clipboardCommandTarget(action = '剪贴板操作') {
    if (projectRef.current !== project || numberEditOwner.current.generation !== numberGeneration || numberEditOwner.current.project !== projectRef.current || !sameClipboardTarget()) {
      setMessage(`工程或选择已更改，请重新执行${action}。`); return;
    }
    if (!finishNumberDraft()) return;
    if (!sameClipboardTarget() || numberEditOwner.current.project !== projectRef.current) { setMessage(`工程或选择已更改，请重新执行${action}。`); return; }
    const snapshot = projectRef.current, owner = numberEditOwner.current;
    const current = () => {
      const valid = projectRef.current === snapshot && numberEditOwner.current === owner && sameClipboardTarget();
      if (!valid) setMessage(`工程或选择已更改，请重新执行${action}。`);
      return valid;
    };
    const resolved = resolveEditorSelection(snapshot, { trackId: clipboardTarget.trackId, regionId: clipboardTarget.regionId, noteIds: [...clipboardTarget.notes], focus: clipboardTarget.focus });
    const timing = createMeterMap(snapshot);
    const context: NoteCommandContext = { project: snapshot, focus: clipboardTarget.focus, ...resolved, selected: resolved.notes, selectedNotes: clipboardTarget.notes,
      meterMap: timing, sourceOrigin: resolved.region && resolved.pattern ? patternOrigin(resolved.region, resolved.pattern) : 0, editorDocumentKey, current };
    return { snapshot, current, context, ids: new Set(clipboardTarget.regions), targetTrackId: clipboardTarget.trackId || undefined, filter: clipboardTarget.filter, primaryId: clipboardTarget.regionId };
  }
  function preparePianoGesture(): boolean {
    const target = clipboardCommandTarget('钢琴编辑');
    return !!target?.context.track && !!target.context.region && !!target.context.pattern && target.current();
  }
  function copiedKind(kind: 'notes' | 'regions') {
    lastClipboardKind.current = kind;
    if (kind === 'notes') regionClipboard.current = undefined; else clipboard.current = undefined;
    setClipboardRevision(value => value + 1);
  }
  function copySelection() {
    const target = clipboardCommandTarget(); if (!target) return false;
    if (target.context.focus === 'piano') {
      if (!copyNotes(target.context)) return false;
      copiedKind('notes'); return true;
    }
    try {
      const problem = regionGroupProblem(target.snapshot, target.ids, target.filter, true); if (problem) throw new Error(problem);
      const next = createRegionClipboard(target.snapshot, target.ids, editorDocumentKey, target.primaryId);
      if (!target.current()) return false;
      regionClipboard.current = next; copiedKind('regions'); setMessage(`已复制 ${next.regions.length} 个片段`); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return false; }
  }
  function cutSelection() {
    const target = clipboardCommandTarget(); if (!target) return;
    if (target.context.focus === 'piano') { if (cutNotes(target.context)) copiedKind('notes'); return; }
    try {
      const problem = regionGroupProblem(target.snapshot, target.ids, target.filter); if (problem) throw new Error(problem);
      const next = createRegionClipboard(target.snapshot, target.ids, editorDocumentKey, target.primaryId);
      if (!target.current()) return;
      commit('剪切所选片段', p => { deleteRegionGroup(p, target.ids); });
      if (projectRef.current === target.snapshot) return;
      regionClipboard.current = next; copiedKind('regions'); selectRegionGroup(new Set()); setMessage(`已剪切 ${next.regions.length} 个片段`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  function pasteSelection() {
    const target = clipboardCommandTarget(); if (!target) return;
    if (target.context.focus === 'piano') {
      if (lastClipboardKind.current !== 'notes') { setMessage(lastClipboardKind.current === 'regions' ? '剪贴板中是片段，请在编曲区粘贴。' : '剪贴板中没有音符。'); return; }
      pasteNotes(false, target.context); return;
    }
    if (lastClipboardKind.current !== 'regions' || !regionClipboard.current) { setMessage(lastClipboardKind.current === 'notes' ? '剪贴板中是音符，请在钢琴卷帘中粘贴。' : '剪贴板中没有片段。'); return; }
    try {
      const at = target.context.meterMap.snap(Math.max(0, positionRef.current), preferences.snap ? target.snapshot.ppq * 4 / preferences.snap : 1);
      const visible = new Set(filterTracks(target.snapshot.tracks, target.filter).map(item => item.id));
      const plan = planRegionPaste(target.snapshot, regionClipboard.current, at, target.targetTrackId, editorDocumentKey, visible);
      if (!target.current()) return;
      commit('粘贴片段', next => {
        next.tracks = next.tracks.concat(plan.tracks); next.patterns = next.patterns.concat(plan.patterns); next.regions = next.regions.concat(plan.regions);
        next.instruments = next.instruments.concat(plan.instruments); next.assets = next.assets.concat(plan.assets);
      });
      if (projectRef.current === target.snapshot) return;
      selectRegionGroup(new Set(plan.regions.map(item => item.id)), plan.primaryRegionId);
      const pastedProject = projectRef.current;
      if (plan.instruments.length || plan.assets.length) void engine.loadProjectSamples(pastedProject).catch(error => { if (projectRef.current === pastedProject) setMessage(`粘贴片段已保留，但采样加载失败：${String(error)}`); });
      const tracks = new Map(pastedProject.tracks.map(item => [item.id, item]));
      const hidden = plan.regions.filter(item => target.filter && tracks.get(item.trackId)?.instrumentId !== target.filter).length;
      setMessage([`已粘贴 ${plan.regions.length} 个片段`, hidden ? `${hidden} 个片段被筛选隐藏，可用“显示全部所选”查看。` : '', ...plan.diagnostics.map(item => item.message)].filter(Boolean).join(' '));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  function duplicate() {
    if (focus === 'piano') { if (selected.length) pasteNotes(true); return; }
    duplicateCurrentRegion();
  }
  function duplicateCurrentRegion() {
    if (!regionGroupEditable()) return;
    const previous = projectRef.current, originals = previous.regions.filter(item => selectedRegionsRef.current.has(item.id));
    let ids: string[] = []; commit('创建独立片段副本', p => { ids = duplicateRegionGroup(p, selectedRegionsRef.current)?.map(item => item.id) ?? []; });
    if (projectRef.current === previous) { setMessage('无法创建独立副本：工程范围或对象数量超限。'); return; }
    selectRegionGroup(new Set(ids), ids[Math.max(0, originals.findIndex(item => item.id === selectedRegion))]);
  }
  function splitSelectedRegions() {
    const target = clipboardCommandTarget('片段拆分'); if (!target) return;
    try {
      const tick = positionRef.current, visible = new Set(filterTracks(target.snapshot.tracks, target.filter).map(item => item.id));
      const problem = regionGroupProblem(target.snapshot, target.ids, target.filter); if (problem) { setMessage(problem); return; }
      const inspected = inspectRegionSplit(target.snapshot, target.ids, tick, visible);
      if (!inspected.ok) { setMessage(inspected.reason); return; }
      if (!target.current()) return;
      let result: ReturnType<typeof splitRegionGroup>;
      commit('在播放头拆分片段', next => { result = splitRegionGroup(next, target.ids, tick, visible); });
      if (!result || projectRef.current === target.snapshot) { setMessage('无法拆分片段，请检查片段范围或工程容量。'); return; }
      const right = new Map(result.pairs.map(pair => [pair.leftId, pair.rightId]));
      selectRegionGroup(new Set([...target.ids].map(id => right.get(id) ?? id)), right.get(target.primaryId) ?? target.primaryId);
      setMessage(`已拆分 ${result.pairs.length} 个片段，已选择右半段。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  function regionSplitProblem(value: Project, ids: ReadonlySet<string>, filter: string, tick: number, cachedProblem?: string, candidates?: readonly Region[]): string {
    const problem = cachedProblem ?? regionGroupProblem(value, ids, filter); if (problem) return problem;
    if (!Number.isFinite(tick)) return '播放头位置无效。';
    let count = 0;
    for (const item of candidates ?? value.regions) if (ids.has(item.id)) {
      const delta = tick - item.start;
      if (delta <= 0 || delta >= item.length) continue;
      if (delta < 1 || item.length - delta < 1) return '播放头两侧需留有最小片段长度。';
      count++;
    }
    return count ? '' : '请将播放头移到所选片段内部。';
  }
  function regionGroupProblem(value: Project, ids: ReadonlySet<string>, filter: string, readOnly = false): string {
    if (!ids.size) return '请选择片段。';
    const tracks = new Map(value.tracks.map(item => [item.id, item]));
    const patterns = new Set(value.patterns.map(item => item.id));
    const group = value.regions.filter(item => ids.has(item.id));
    if (group.length !== ids.size || group.some(item => !tracks.has(item.trackId) || !patterns.has(item.patternId))) return '所选片段已失效，请重新选择。';
    const hidden = group.filter(item => filter && tracks.get(item.trackId)?.instrumentId !== filter).length;
    const locked = !readOnly && group.some(item => tracks.get(item.trackId)?.locked);
    return [hidden ? `${hidden} 个所选片段被隐藏，请先显示全部所选。` : '', locked ? '所选片段包含锁定轨道，请先解锁。' : ''].filter(Boolean).join(' ');
  }
  function regionGroupEditable(): boolean {
    if (numberEditOwner.current.generation !== numberGeneration || numberEditOwner.current.project !== projectRef.current || projectRef.current !== project) {
      setMessage('工程已更改，请重新选择后再操作。'); return false;
    }
    const problem = regionGroupProblem(projectRef.current, selectedRegionsRef.current, instrumentFilterRef.current);
    if (problem) { setMessage(problem); return false; }
    return true;
  }
  function addTrack() {
    const target = clipboardCommandTarget('添加轨道'); if (!target) return;
    try {
      if (target.snapshot.tracks.length >= 10000 || target.snapshot.patterns.length >= 100000 || target.snapshot.regions.length >= 100000) { setMessage('工程轨道或片段数量已达到上限。'); return; }
      const t = newTrack(`轨道 ${target.snapshot.tracks.length + 1}`, target.snapshot.tracks.length, target.context.track?.instrumentId ?? 'harp');
      t.midiChannel = allocateTrackMidiChannel(projectRef.current);
      const p = { id: uid(), name: t.name, length: target.context.meterMap.at(0).barEnd, notes: [] };
      const r: Region = { id: uid(), trackId: t.id, patternId: p.id, start: 0, length: p.length, offset: 0, loop: false };
      if (!target.current()) return;
      commit('添加轨道', next => { next.tracks.push(t); next.patterns.push(p); next.regions.push(r); }); selectRegion(r);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  function trackControlState(value: Project, id: string, filter: string) {
    const current = value.tracks.find(item => item.id === id), visible = filterTracks(value.tracks, filter), index = visible.findIndex(item => item.id === id);
    const hidden = !!current && index < 0, issue = !current ? '请选择轨道。' : hidden ? '当前轨道被筛选隐藏，请先显示当前轨道。' : '';
    const count = current ? value.regions.reduce((sum, item) => sum + Number(item.trackId === id), 0) : 0;
    return { hidden, upIssue: issue || (index <= 0 ? '当前轨道已是第一条可见轨道。' : ''), downIssue: issue || (index === visible.length - 1 ? '当前轨道已是最后一条可见轨道。' : ''),
      deleteIssue: issue || (current?.locked ? '当前轨道已锁定，请先解锁。' : ''), deleteDescription: current ? `删除“${current.name}”及其 ${count} 个片段；可撤销恢复。` : '请选择轨道。' };
  }
  function moveCurrentTrack(direction: -1 | 1) {
    const target = clipboardCommandTarget('轨道排序'); if (!target) return;
    try {
      const id = target.targetTrackId; if (!id) { setMessage('请选择轨道。'); return; }
      const visible = new Set(filterTracks(target.snapshot.tracks, target.filter).map(item => item.id));
      const inspected = inspectTrackMove(target.snapshot, id, direction, visible); if (!inspected.ok) { setMessage(inspected.reason); return; }
      if (!target.current()) return;
      commit(direction < 0 ? '上移轨道' : '下移轨道', next => { moveTrackInView(next, id, direction, visible); });
      if (projectRef.current !== target.snapshot) setMessage(`已${direction < 0 ? '上移' : '下移'}当前轨道。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  function selectionAfterTrackDelete(before: Project, after: Project, saved: EditorSelection, removedTrackId: string, filter: string): EditorSelection {
    const rows = new Map(before.tracks.map((item, index) => [item.id, index])), origin = rows.get(removedTrackId) ?? 0;
    const visible = new Set(filterTracks(after.tracks, filter).map(item => item.id));
    const nearest = (ids: ReadonlySet<string>) => {
      let best: Track | undefined, distance = Infinity, nextSide = false;
      for (const item of after.tracks) if (ids.has(item.id)) {
        const row = rows.get(item.id) ?? origin, delta = Math.abs(row - origin), next = row >= origin;
        if (delta < distance || delta === distance && next && !nextSide) { best = item; distance = delta; nextSide = next; }
      }
      return best;
    };
    const regions = new Map(after.regions.map(item => [item.id, item])), ids = (saved.regionIds ?? (saved.regionId ? [saved.regionId] : [])).filter(id => regions.has(id));
    let primary = ids.includes(saved.regionId ?? '') ? regions.get(saved.regionId!) : undefined;
    if (ids.length) {
      if (!primary) {
        const groupTracks = new Set(ids.map(id => regions.get(id)!.trackId)), visibleGroup = new Set([...groupTracks].filter(id => visible.has(id)));
        const chosen = nearest(visibleGroup.size ? visibleGroup : groupTracks);
        primary = ids.map(id => regions.get(id)!).find(item => item.trackId === chosen?.id);
      }
      return normalizeEditorSelection(after, { trackId: primary?.trackId, regionId: primary?.id, regionIds: ids, noteIds: primary?.id === saved.regionId ? saved.noteIds : [], focus: saved.focus });
    }
    const chosen = nearest(visible.size ? visible : new Set(after.tracks.map(item => item.id))), first = after.regions.find(item => item.trackId === chosen?.id);
    return normalizeEditorSelection(after, { trackId: chosen?.id, regionId: first?.id, regionIds: first ? [first.id] : [], noteIds: [], focus: saved.focus });
  }
  function deleteCurrentTrack() {
    const target = clipboardCommandTarget('删除轨道'); if (!target) return;
    try {
      const id = target.targetTrackId; if (!id) { setMessage('请选择轨道。'); return; }
      const visible = new Set(filterTracks(target.snapshot.tracks, target.filter).map(item => item.id));
      const inspected = inspectTrackDelete(target.snapshot, id, visible); if (!inspected.ok) { setMessage(inspected.reason); return; }
      if (!target.current()) return;
      const saved = selectionSnapshot(target.snapshot), name = target.snapshot.tracks.find(item => item.id === id)?.name;
      commit('删除轨道', next => { deleteTrack(next, id, visible); });
      if (projectRef.current === target.snapshot) return;
      restoreSelection(projectRef.current, selectionAfterTrackDelete(target.snapshot, projectRef.current, saved, id, target.filter));
      setMessage(`已删除轨道“${name}”，可撤销恢复。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  function createRegion(trackId: string, tick: number) {
    const t = project.tracks.find(t => t.id === trackId); if (!t || t.locked) return;
    const start = Math.max(0, meterMap.barSnap(tick, 'floor'));
    const pt = { id: uid(), name: `${t.name} · 片段`, length: meterMap.at(start).barEnd - start, notes: [] };
    const r: Region = { id: uid(), trackId, patternId: pt.id, start, length: pt.length, offset: 0, loop: false };
    commit('新建片段', next => { next.patterns.push(pt); next.regions.push(r); }); selectRegion(r);
  }
  function deleteSelection() {
    if (focus === 'piano') {
      if (!canEditSelectedNotes(track, pattern, selectedNotes)) return;
      if (editNotes('删除音符', notes => changeSelectedNotes(notes, selectedNotes, () => undefined))) setSelectedNotes(new Set());
    } else {
      if (!regionGroupEditable()) return;
      const previous = projectRef.current;
      commit(selectedRegionsRef.current.size > 1 ? '删除所选片段' : '删除片段', p => { deleteRegionGroup(p, selectedRegionsRef.current); });
      if (projectRef.current === previous) return;
      const ids = new Set<string>(); selectedRegionsRef.current = ids; setSelectedRegions(ids);
      setSelectedRegion(''); setSelectedNotes(new Set());
    }
  }
  function changeExportOptions(patch: Partial<ExportOptions>) {
    const next = { ...exportOwner.current.context, ...patch, project: projectRef.current };
    syncExportOwner(exportOwner.current, next);
    setExportFormat(next.format); setNbsVersion(next.nbsVersion); setNbsTempoPreset(next.nbsTempoPreset); setNativeAudio(next.nativeAudio);
    setPrepared(undefined); setExportError(undefined);
  }
  function openExport() {
    if (!finishNumberDraft()) return;
    setPrepared(undefined); setExportError(undefined); setModal('export');
  }
  async function prepareExport(ticket: ExportTicket): Promise<PreparedExport> {
    const snapshot = ticket.context;
    let output: Pick<PreparedExport, 'name' | 'bytes' | 'diagnostics'>;
    if (snapshot.format === 'mid') { const result = exportMidi(snapshot.project); output = { name: `${snapshot.project.name}.mid`, ...result }; }
    else if (snapshot.format === 'nbs') { const result = exportNbs(snapshot.project, snapshot.nbsVersion, snapshot.nbsTempoPreset); output = { name: `${snapshot.project.name}.nbs`, ...result }; }
    else if (snapshot.nativeAudio) {
      if (!window.desktop || !snapshot.library?.nativeLibrary) throw new Error('原生音频引擎不可用。请加载匹配游戏资源，或取消原生混音选项后使用 Web Audio 近似导出。');
      const result = await window.desktop.renderNative(await engine.nativeRequest(snapshot.project));
      output = { name: `${snapshot.project.name}.wav`, bytes: result.wav, diagnostics: [{ severity: 'info', code: 'backend', message: result.backend }, ...result.warnings.map(message => ({ severity: 'warning' as const, code: 'native-audio', message }))] };
    } else {
      const bytes = await engine.renderWeb(snapshot.project); output = { name: `${snapshot.project.name}.wav`, bytes, diagnostics: [{ severity: 'warning', code: 'web-audio', message: '此文件使用 Web Audio 预览引擎渲染，尚未通过游戏录音验收。' }] };
    }
    return { ...ticket, ...output };
  }
  async function finishExport() {
    if (busy || exportRunning.current) return;
    exportRunning.current = true;
    let ticket: ExportTicket | undefined;
    try {
      if (!finishNumberDraft()) return;
      syncExportOwner(exportOwner.current, { ...exportOwner.current.context, project: projectRef.current, open: modalRef.current === 'export' });
      ticket = { ...exportOwner.current };
      if (!ticket.context.open) return;
      setBusy(true); setExportError(undefined);
      const output = prepared && isCurrentExport(exportOwner.current, prepared, projectRef.current, true) ? prepared : await prepareExport(ticket);
      if (!isCurrentExport(exportOwner.current, ticket, projectRef.current, modalRef.current === 'export')) {
        if (modalRef.current === 'export') setMessage('工程或导出设置已更改，请再次导出。');
        return;
      }
      setPrepared(output);
      const errors = output.diagnostics.filter(item => item.severity === 'error');
      if (errors.length) throw new Error(errors.map(item => item.message).join('\n'));
      exportSaving.current = true;
      const saved = window.desktop ? await window.desktop.saveFile(output.name, output.bytes) : (download(output.name, output.bytes), output.name);
      if (saved && isCurrentExport(exportOwner.current, ticket, projectRef.current, modalRef.current === 'export')) {
        const warnings = output.diagnostics.filter(item => item.severity === 'warning');
        setMessage(`已导出 ${output.name}${warnings.length ? ` · ${warnings.length} 条转换提示` : ''}`);
        if (!warnings.length) setModal(null);
      }
    } catch (error) {
      if (ticket && isCurrentExport(exportOwner.current, ticket, projectRef.current, modalRef.current === 'export')) {
        const text = error instanceof Error ? error.message : String(error); setExportError({ ticket, message: text }); setMessage(text);
      }
    }
    finally { exportRunning.current = false; exportSaving.current = false; setBusy(false); }
  }
  async function importReference(file?: { name: string; bytes: Uint8Array }) {
    try {
      const selected = file ?? await window.desktop?.openFile('reference'); if (!selected) { if (!window.desktop) referenceInput.current?.click(); return; }
      const id = uid(), asset = { id, name: selected.name, mime: `audio/${selected.name.split('.').at(-1)}`, data: bytesToBase64(selected.bytes) };
      await engine.loadReference({ ...projectRef.current, assets: [asset], reference: { assetId: id, startTick: 0, gain: .7 } });
      stop(); commit('导入参考音频', p => { p.assets.push(asset); p.reference = { assetId: id, startTick: 0, gain: .7 }; });
      setMessage(`参考音频已导入：${selected.name}`);
    } catch (error) { setMessage(String(error)); }
  }
  async function locateSample() {
    if (!firstNote && !instrument) return;
    if (!window.desktop) { setMessage('定位自定义采样请使用桌面程序。'); return; }
    try {
      const file = await window.desktop.openFile('sample'); if (!file) return;
      const id = firstNote?.instrumentId ?? instrument?.id; if (!id) return;
      const assetId = uid();
      commit('定位乐器采样', p => { const ins = p.instruments.find(i => i.id === id)!; ins.assetId = assetId; p.assets.push({ id: assetId, name: file.name, mime: `audio/${file.name.split('.').at(-1)}`, data: bytesToBase64(file.bytes) }); });
      auditionCache.current.clear();
      await engine.loadProjectSamples(projectRef.current); setMessage(`已载入 ${file.name}`);
    } catch (error) { setMessage(String(error)); }
  }
  const midiDown = useRef<(key: string, pitch: number, velocity: number) => void>(() => {}), midiUp = useRef<(key: string) => void>(() => {});
  midiDown.current = (key, pitch, velocity) => {
    if (keysHeld.current.has(key) || !region || !pattern) return;
    const p = projectRef.current, target = p.regions.find(r => r.id === region.id);
    if (!target) return;
    const press = beginRecordedPress(p, target, pitch, velocity, positionRef.current, engine.position(), recordingRef.current, preferences.snap, preferences.noteLength, editorDocumentKey);
    if (!press) return;
    keysHeld.current.set(key, press);
    setHasHeldRecording([...keysHeld.current.values()].some(item => item.capture));
    if (!press.capture && recordingRef.current) setMessage(p.tracks.find(item => item.id === target.trackId)?.locked ? '所选轨道已锁定，本次只试听。解锁后可录入。' : '播放线在所选片段范围外，本次只试听。选择覆盖当前位置的片段后可录入。');
    void audition(pitch, { ...newNote(0, pitch, Math.max(1, Math.round(press.duration))), velocity }, press.absoluteTick);
  };
  finishHeld.current = (keys = [...keysHeld.current.keys()]) => {
    const p = projectRef.current, position = engine.position();
    let canceled = false;
    const notes = keys.flatMap(key => { const press = keysHeld.current.get(key); keysHeld.current.delete(key); const result = press && finishRecordedPress(p, press, position, editorDocumentKey); if (press?.capture && !result) canceled = true; return result ? [{ ...result, press }] : []; });
    setHasHeldRecording([...keysHeld.current.values()].some(press => press.capture));
    if (canceled) setMessage('录入目标已移动、裁剪、锁定或切换，本次按下中的音符已取消，请重新录入。');
    if (!notes.length) return;
    if (p.patterns.reduce((count, item) => count + item.notes.length, notes.length) > 2000000) { setMessage('录入后的音符超过 200 万个，本次录入已取消，请先拆分工程。'); return; }
    // Our own source growth must not cancel other keys in the same chord.
    const continuing = [...keysHeld.current.entries()].filter(([, press]) => finishRecordedPress(p, press, position, editorDocumentKey));
    commit('录入音符', next => {
      for (const { note, press } of notes) {
        const pt = next.patterns.find(item => item.id === press.patternId)!, r = next.regions.find(item => item.id === press.regionId)!;
        const saved = savedSnapshot.current?.patterns.find(item => item.id === press.patternId), index = saved?.notes.findIndex(item => item.id === note.id) ?? -1;
        let before = -1;
        // A saved chord retains its checkpoint order even when keys release in reverse.
        if (saved && index >= 0) {
          const present = new Map(pt.notes.map((item, at) => [item.id, at]));
          for (let i = index + 1; i < saved.notes.length; i++) { const at = present.get(saved.notes[i].id); if (at !== undefined) { before = at; break; } }
        }
        if (before < 0) pt.notes.push(note); else pt.notes.splice(before, 0, note);
        if (!r.loop) growEditedPattern(next, r, pt, note.tick + 1);
      }
    }, true);
    for (const [key, press] of continuing) {
      const r = projectRef.current.regions.find(item => item.id === press.regionId)!;
      if (r.length !== press.regionState.length) keysHeld.current.set(key, { ...press, regionState: { ...press.regionState, length: r.length } });
    }
    if (savedSnapshot.current && notes.some(({ note, press }) => savedSnapshot.current?.patterns.find(item => item.id === press.patternId)?.notes.some(item => item.id === note.id)) && recordingProjectsEqual(projectRef.current, savedSnapshot.current)) {
      savedSnapshot.current = projectRef.current; setDirty(false);
      const id = projectRef.current.id;
      try {
        if (window.desktop) void window.desktop.clearRecovery(id).catch(error => setMessage(`工程已保存，但恢复副本未能清理：${String(error)}`));
        else localStorage.removeItem('nbsx-recovery');
        setRecovery(current => current?.projectId === id ? null : current);
      } catch (error) { setMessage(`工程已保存，但恢复副本未能清理：${String(error)}`); }
    }
    const stepNotes = notes.filter(item => !item.press.live);
    if (stepNotes.length) { positionRef.current = Math.max(positionRef.current, ...stepNotes.map(item => item.caret)); setPlayhead(positionRef.current); }
  };
  midiUp.current = key => finishHeld.current([key]);
  function toggleRecord() {
    if (recordingRef.current) { finishHeld.current(); recordingRef.current = false; setRecording(false); return; }
    recordingRef.current = true; setRecording(true);
  }
  useEffect(() => {
    if (!recording) return;
    let canceled = false, access: MIDIAccess | undefined;
    const connected = new Map<MIDIInput, (event: MIDIMessageEvent) => void>();
    const connect = () => {
      if (!access || canceled) return;
      for (const [input, listener] of connected) if (input.state === 'disconnected') { if (input.onmidimessage === listener) input.onmidimessage = null; connected.delete(input); finishHeld.current([...keysHeld.current.keys()].filter(key => key.startsWith(`midi:${input.id}:`))); }
      for (const input of access.inputs.values()) if (input.state === 'connected' && !connected.has(input)) {
        const listener = (event: MIDIMessageEvent) => { const [status, note, velocity] = event.data ?? []; const key = `midi:${input.id}:${status & 15}:${note}`; if ((status & 0xf0) === 0x90 && velocity > 0) midiDown.current(key, note, velocity / 127); else if ((status & 0xf0) === 0x80 || (status & 0xf0) === 0x90 && velocity === 0) midiUp.current(key); };
        input.onmidimessage = listener; connected.set(input, listener);
      }
    };
    if (!navigator.requestMIDIAccess) setMessage('电脑键盘录入已启用；此环境不支持外部 MIDI 设备。');
    else void navigator.requestMIDIAccess().then(result => { if (canceled) return; access = result; connect(); access.onstatechange = connect; setMessage(`录入已启用 · ${access.inputs.size} 个 MIDI 输入 · 也可使用电脑键盘 Z–M`); }).catch(() => { if (!canceled) setMessage('电脑键盘录入已启用；外部 MIDI 访问未获准。'); });
    return () => { canceled = true; if (access?.onstatechange === connect) access.onstatechange = null; for (const [input, listener] of connected) if (input.onmidimessage === listener) input.onmidimessage = null; };
  }, [recording]);
  useEffect(() => { const blur = () => finishHeld.current(); window.addEventListener('blur', blur); return () => { window.removeEventListener('blur', blur); keysHeld.current.clear(); }; }, []);
  commands.current = {
    play: () => void togglePlay(), new: newProject, open: () => void open(), save: () => void save(), 'save-as': () => void save(true), 'original-midi': () => void saveOriginalMidi(), undo, redo,
    duplicate, 'split-region': splitSelectedRegions, 'add-track': addTrack, 'track-up': () => moveCurrentTrack(-1), 'track-down': () => moveCurrentTrack(1), 'delete-track': deleteCurrentTrack, draw: () => setTool('draw'), select: () => setTool('select'), erase: () => setTool('erase'), mixer: () => setPrefs({ showMixer: !preferences.showMixer }),
    'piano-fit-all': () => { if (pattern) setPianoViewRequest(value => ({ id: (value?.id ?? 0) + 1, mode: 'all' })); },
    'piano-fit-selection': () => { if (selected.length) setPianoViewRequest(value => ({ id: (value?.id ?? 0) + 1, mode: 'selection' })); },
    export: () => openExport(), settings: () => setModal('settings'), timing: () => { if (playbackMode === 'native-compare') stop(); else finishHeld.current(); setModal('timing'); },
    'save-close': () => { if (!finishNumberDraft()) return; stop(); void save().then(async saved => { if (saved && window.desktop) { await window.desktop.notifyDirty(false); await window.desktop.closeAfterSave(); } }); },
    copy: copySelection, paste: pasteSelection, cut: cutSelection, delete: deleteSelection,
    'select-all': selectAllInEditor,
    library: () => setPrefs({ showLibrary: !preferences.showLibrary }), inspector: () => setPrefs({ showInspector: !preferences.showInspector }),
    help: () => setModal('help'), reference: () => void importReference(), stop: () => seek(0), loop: toggleLoop, record: toggleRecord,
    'previous-bar': () => { const position = meterMap.at(playhead); seek(Math.max(0, playhead > position.barStart ? position.barStart : meterMap.barTick(position.bar - 1))); },
    'next-bar': () => seek(meterMap.at(playhead).barEnd),
    'recover-project': restoreRecovery, 'discard-recovery': () => void discardRecovery(),
    recovery: () => { if (recovery) setModal('recovery'); else setMessage('当前没有待恢复的工程。'); },
    quantize: quantizeNoteSelection,
    'nudge-left': () => nudgeNoteSelection(-1), 'nudge-right': () => nudgeNoteSelection(1),
    'nudge-beat-left': () => nudgeNoteSelection(-1, true), 'nudge-beat-right': () => nudgeNoteSelection(1, true),
    ...Object.fromEntries([['transpose-up', 1], ['transpose-down', -1], ['transpose-octave-up', 12], ['transpose-octave-down', -12]].map(([command, delta]) => [command, () => moveNoteSelection(0, Number(delta))])),
  };
  const bindings = useMemo(() => inspectShortcuts(preferences.preset, preferences.shortcuts, shortcutPlatform).effective, [preferences.preset, preferences.shortcuts]);
  const openBytesRef = useRef(openBytes); openBytesRef.current = openBytes;
  const menus: StudioMenu[] = [
    { label: '文件', items: [{ label: '新建工程', command: 'new', shortcut: 'Ctrl+N' }, { label: '打开 / 导入…', command: 'open', shortcut: 'Ctrl+O' }, { label: '保存工程', command: 'save', shortcut: 'Ctrl+S' }, { label: '另存为…', command: 'save-as', shortcut: 'Ctrl+Shift+S' }, { label: '另存原始 MIDI…', command: 'original-midi', disabled: !project.midi }, { label: '检查恢复副本…', command: 'recovery', disabled: !recovery }, { label: '导入参考音频…', command: 'reference', separatorBefore: true }, { label: '导出 NBS / MIDI / 音频…', command: 'export' }] },
    { label: '编辑', items: [{ label: '撤销', command: 'undo', shortcut: bindings.undo, disabled: !history.current.length }, { label: '重做', command: 'redo', shortcut: bindings.redo, disabled: !future.current.length }, { label: focus === 'arrangement' ? '复制片段' : '复制音符', command: 'copy', shortcut: 'Ctrl+C', separatorBefore: true, disabled: focus === 'arrangement' ? !!regionCopyIssue : !canCopyNotes(focus, track, selected) }, { label: focus === 'arrangement' ? '剪切片段' : '剪切音符', command: 'cut', shortcut: 'Ctrl+X', disabled: focus === 'arrangement' ? !!regionGroupIssue : !canCutNotes(focus, track, selected) }, { label: focus === 'arrangement' ? '粘贴片段' : '粘贴音符', command: 'paste', shortcut: 'Ctrl+V', disabled: focus === 'arrangement' ? !canPasteRegionSelection : lastClipboardKind.current !== 'notes' || !canPasteNotes(track, pattern, clipboard.current?.notes ?? []) }, { label: '独立复制', command: 'duplicate', shortcut: bindings.duplicate, disabled: focus === 'piano' ? !canEditSelection : !!regionGroupIssue }, { label: '在播放头拆分片段', command: 'split-region', shortcut: bindings['split-region'], disabled: !!regionSplitIssue }, { label: focus === 'arrangement' ? '全选可见片段' : '全选音符', command: 'select-all', shortcut: 'Ctrl+A', disabled: focus === 'arrangement' ? !visibleRegionIds.size : !pattern }, { label: '删除所选', command: 'delete', shortcut: 'Delete', disabled: focus === 'piano' ? !canEditSelection : !!regionGroupIssue }, { label: '量化所选音符', command: 'quantize', shortcut: bindings.quantize, separatorBefore: true, disabled: !canEditSelection }] },
    { label: '视图', items: [{ label: '音色库', command: 'library', checked: preferences.showLibrary }, { label: '检查器', command: 'inspector', checked: preferences.showInspector }, { label: '混音器', command: 'mixer', checked: preferences.showMixer, shortcut: bindings.mixer }, { label: '显示全部音符', command: 'piano-fit-all', separatorBefore: true, disabled: !pattern }, { label: '显示所选音符', command: 'piano-fit-selection', disabled: !selected.length }] },
    { label: '轨道', items: [{ label: '添加轨道', command: 'add-track' }, { label: '上移当前轨道', command: 'track-up', shortcut: bindings['track-up'], disabled: !!trackManagement.upIssue }, { label: '下移当前轨道', command: 'track-down', shortcut: bindings['track-down'], disabled: !!trackManagement.downIssue }, { label: '删除当前轨道', command: 'delete-track', shortcut: bindings['delete-track'], disabled: !!trackManagement.deleteIssue }] },
    { label: '播放', items: [{ label: playing ? '暂停' : '播放', command: 'play', shortcut: bindings.play }, { label: '停止并回到起点', command: 'stop' }, { label: '上一小节', command: 'previous-bar', separatorBefore: true }, { label: '下一小节', command: 'next-bar' }, { label: '速度与拍号…', command: 'timing' }, { label: '循环播放工程', command: 'loop', checked: loop, separatorBefore: true }, { label: '录入 MIDI / 电脑键盘', command: 'record', checked: recording }] },
    { label: '设置', command: 'settings' }, { label: '帮助', command: 'help' },
  ];
  for (const menu of menus) for (const item of menu.items ?? []) if (item.shortcut) item.shortcut = displayShortcut(item.shortcut, shortcutPlatform);
  useEffect(() => {
    const onSpaceDown = (event: KeyboardEvent) => {
      if (!isTransportSpace(event)) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) commands.current.play?.();
    };
    const onSpaceUp = (event: KeyboardEvent) => {
      if (!isTransportSpace(event)) return;
      event.preventDefault(); event.stopPropagation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.getModifierState('AltGraph')) return;
      if (event.key === 'Escape') { if (modal) event.preventDefault(); if (modal === 'flp-import') cancelFlpImport(); else setModal(null); return; }
      if (isShortcutInput(event.target)) return;
      if (modal) return;
      const target = event.target as Element | null;
      if (target?.closest?.('button,a[href],[role="button"],[role^="menuitem"],[role="slider"],[role="scrollbar"]') && [' ', 'Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
      const key = event.key.toUpperCase(), chord = shortcutForEvent(event, shortcutPlatform);
      const playingKey = 'ZSXDCVGBHNJM'.indexOf(key);
      if ((keyboardEnabled || recording) && playingKey >= 0 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); if (!event.repeat) midiDown.current(`keyboard:${playingKey}`, 60 + playingKey, .8); return; }
      const command = commandForShortcut(chord, bindings, shortcutPlatform);
      if (command) { event.preventDefault(); if (!event.repeat || command === 'delete' || command.startsWith('transpose-') || command.startsWith('nudge-')) commands.current[command]?.(); }
    };
    const onKeyUp = (event: KeyboardEvent) => { const index = 'ZSXDCVGBHNJM'.indexOf(event.key.toUpperCase()); if (index >= 0) midiUp.current(`keyboard:${index}`); };
    window.addEventListener('keydown', onSpaceDown, true); window.addEventListener('keyup', onSpaceUp, true);
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onSpaceDown, true); window.removeEventListener('keyup', onSpaceUp, true);
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
    };
  });
  useEffect(() => { const timer = setInterval(() => { const levels = engine.meterLevels(); setMeters(previous => Object.keys(previous).length === Object.keys(levels.tracks).length && Object.keys(levels.tracks).every(key => Math.abs((previous[key] ?? 0) - levels.tracks[key]) < .003) ? previous : levels.tracks); setMasterMeter(previous => Math.abs(previous - levels.master) < .003 ? previous : levels.master); }, 100); return () => clearInterval(timer); }, [engine]);
  useEffect(() => {
    if (!engine.playing) return;
    updateRealtimeProject(project);
  }, [engine, project]);
  useEffect(() => { try { localStorage.setItem('nbsx-preferences', JSON.stringify(preferences)); } catch { /* Preferences remain usable for this session. */ } }, [preferences]);
  useEffect(() => { void window.desktop?.notifyDirty(unsaved); }, [unsaved]);
  useEffect(() => {
    engine.onPosition = tick => { positionRef.current = tick; setPlayhead(tick); }; engine.onEnded = () => { finishHeld.current(); setPlaying(false); };
    let canceled = false;
    if (window.desktop) {
      void discover(true);
      void window.desktop.recover().then(result => { if (result && !canceled) { setRecovery(result); setModal('recovery'); } }).catch(error => { if (!canceled) setMessage(`恢复副本读取失败：${String(error)}`); });
    } else { const cached = localStorage.getItem('nbsx-recovery'); if (cached) { setRecovery({ name: '恢复的工程.nbsx', bytes: base64ToBytes(cached) }); setModal('recovery'); } }
    const off = window.desktop?.onMenu(command => {
      const editing = isShortcutInput(document.activeElement);
      if (editing && textEditingCommands.has(command)) { document.execCommand(command === 'select-all' ? 'selectAll' : command); return; }
      const activeModal = modalRef.current;
      const recoveryAction = activeModal === 'recovery' && (command === 'recover-project' || command === 'discard-recovery');
      if (activeModal && command !== 'save-close' && !recoveryAction) return;
      if (editing && (Object.hasOwn(SHORTCUT_COMMANDS, command) || command.startsWith('transpose-') || command.startsWith('nudge-'))) return;
      commands.current[command]?.();
    });
    const offOpen = window.desktop?.onOpenFile(file => { void openBytesRef.current(file.name, file.bytes, file.path); });
    void window.desktop?.rendererReady();
    return () => { canceled = true; engine.stop(); off?.(); offOpen?.(); };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!dirty && !hasHeldRecording) return;
      try { const snapshot = previewRecordingProject(projectRef.current, keysHeld.current.values(), engine.position(), editorDocumentKey).project; const bytes = saveNbsx(snapshot); if (window.desktop) void window.desktop.autosave(bytes).catch(error => setMessage(`自动保存失败：${String(error)}`)); else if (bytes.length < 3 * 1024 * 1024) localStorage.setItem('nbsx-recovery', bytesToBase64(bytes)); }
      catch (error) { setMessage(`自动保存失败：${String(error)}`); }
    }, 30000); return () => clearInterval(timer);
  }, [dirty, hasHeldRecording, editorDocumentKey]);
  useEffect(() => { const protect = (e: BeforeUnloadEvent) => { if (unsaved) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect); }, [unsaved]);
  useEffect(() => { document.title = `${unsaved ? '● ' : ''}${project.name} — ${APP_NAME}`; }, [project.name, unsaved]);
  const exportGeneration = exportOwner.current.generation;
  useEffect(() => { if (prepared && !isCurrentExport(exportOwner.current, prepared)) setPrepared(undefined); }, [prepared, exportGeneration]);
  const rootChoice = roots.find(r => r.root === resourceRoot);
  const referenceAsset = project.assets.find(a => a.id === project.reference?.assetId);
  useEffect(() => {
    let canceled = false;
    setReferencePreview(undefined);
    if (referenceAsset?.data) void engine.loadReference(projectRef.current).then(buffer => {
      if (!canceled && buffer) setReferencePreview({ data: referenceAsset.data!, peaks: waveformPeaks(Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch)), buffer.sampleRate) });
    }).catch(error => { if (!canceled) setMessage(`参考音频读取失败：${String(error)}`); });
    return () => { canceled = true; };
  }, [referenceAsset?.data, engine]);
  const referencePeaks = referencePreview?.data === referenceAsset?.data ? referencePreview?.peaks : undefined;
  const changeReference = (patch: { startTick?: number; gain?: number }) => { if (playbackMode === 'native-compare') stop(); else finishHeld.current(); commit('调整参考音频', p => { if (p.reference) Object.assign(p.reference, patch); }); };
  const removeReference = () => { if (playbackMode === 'native-compare') stop(); else finishHeld.current(); commit('移除参考音频', p => { p.reference = undefined; }); };


  return <div className="studio" ref={studioRoot} data-appearance={preferences.appearance} data-number-draft-pending={hasNumberDraft} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) void file.arrayBuffer().then(bytes => openBytes(file.name, new Uint8Array(bytes))); }}>
    {INTERNAL_LIQUID_GLASS && <LiquidGlassTheme enabled={preferences.appearance === 'liquid-glass'} root={studioRoot} />}
    <input ref={fileInput} type="file" hidden accept=".nbsx,.nbs,.mid,.midi,.flp" onChange={e => { const file = e.target.files?.[0]; if (file) void file.arrayBuffer().then(bytes => openBytes(file.name, new Uint8Array(bytes))); e.target.value = ''; }} />
    <input ref={referenceInput} type="file" hidden accept="audio/*" onChange={e => { const file = e.target.files?.[0]; if (file) void file.arrayBuffer().then(bytes => importReference({ name: file.name, bytes: new Uint8Array(bytes) })); e.target.value = ''; }} />
    <div className="menu-bar"><div className="brand"><PianoKeys size={17} weight="fill" /><b>{APP_NAME[0]}</b><span>{APP_NAME}</span><small>{APP_VERSION}</small></div><MenuBar menus={menus} onCommand={command => commands.current[command]?.()} /><span className="edition-badge">JAVA EDITION</span></div>
    <header className="control-bar">
      <div className="project-controls"><div className="project-title"><span className="project-dot" /><input aria-label="工程名称" value={project.name} onChange={e => commit('重命名工程', p => { p.name = e.target.value; })} /><span className="project-extension">.nbsx{unsaved ? ' •' : ''}</span></div><div className="file-controls"><IconButton label="打开 / 导入 MIDI、NBS 或 FLP" onClick={() => void open()}><FolderOpen size={17} /></IconButton><IconButton label="保存工程" onClick={() => void save()}><FloppyDisk size={17} /></IconButton><IconButton label="撤销" onClick={undo} disabled={!history.current.length}><ArrowCounterClockwise size={17} /></IconButton><IconButton label="重做" onClick={redo} disabled={!future.current.length}><ArrowClockwise size={17} /></IconButton><span className="file-hint">{hasNumberDraft ? '属性输入待确认' : dirty ? '有未保存的修改' : '工程已就绪'}</span></div></div>
      <div className="transport"><IconButton label="停止并回到起点" onClick={() => seek(0)}><Stop size={19} weight="fill" /></IconButton><IconButton label={playing ? '暂停' : '播放'} className={`play-button ${playing ? 'is-playing' : ''}`} onClick={() => void togglePlay()}><Play size={21} weight="fill" /></IconButton><IconButton label="录入 MIDI / 电脑键盘" active={recording} className="record-button" onClick={() => void toggleRecord()}><Record size={21} weight="fill" /></IconButton><IconButton label="循环播放工程" active={loop} onClick={toggleLoop}><Repeat size={20} /></IconButton>
        <div className="lcd"><div className="position"><small>小节 · 拍 · 位置</small><strong data-testid="transport-position">{meterMap.format(playhead)}</strong></div><div><small>BPM · ♩</small><input aria-label="当前位置速度 BPM" title={playing && playbackMode === 'native-compare' ? '原生对照播放中；停止后可编辑' : '每分钟四分音符数；实时试听时修改即时生效'} type="number" min=".01" max="10000" readOnly={playing && playbackMode === 'native-compare'} value={Math.round(activeTempo.bpm * 100) / 100} onChange={e => { const value = Number(e.target.value); if (value >= .01 && value <= 10000) commit('修改速度节点', p => { p.tempos = p.tempos.filter(item => item.tick !== activeTempo.tick); p.tempos.push({ tick: activeTempo.tick, bpm: value }); p.tempos.sort((a,b) => a.tick-b.tick); }); }} /></div><button className="signature signature-button" aria-label="编辑速度与拍号" title={playbackMode === 'native-compare' ? '编辑速度与拍号（暂停原生对照）' : '编辑速度与拍号'} onClick={() => commands.current.timing()}><small>拍号</small><strong data-testid="transport-signature">{activeMeter.numerator}/{activeMeter.denominator}</strong></button></div>
      </div>
      <div className="output-controls"><div className="master-control"><SpeakerHigh size={17} /><input aria-label="总音量" type="range" min="0" max="200" value={project.audio.masterGain * 100} onChange={e => commit('调整总音量', p => { p.audio.masterGain = +e.target.value / 100; })} /><span>{Math.round(project.audio.masterGain * 100)}%</span></div><button className="export-button" onClick={openExport}><DownloadSimple size={15} /> 导出 <CaretDown size={11} /></button></div>
    </header>
    <div className="toolbar"><div className="toolbar-group"><IconButton label="显示音色库" active={preferences.showLibrary} onClick={() => setPrefs({ showLibrary: !preferences.showLibrary })}><List size={16} /></IconButton><IconButton label="显示检查器" active={preferences.showInspector} onClick={() => setPrefs({ showInspector: !preferences.showInspector })}><SlidersHorizontal size={16} /></IconButton></div><span className="toolbar-divider" /><div className="toolbar-group tool-select"><IconButton label="绘制音符" active={tool === 'draw'} onClick={() => setTool('draw')}><PencilSimple size={16} /></IconButton><IconButton label="选择音符" active={tool === 'select'} onClick={() => setTool('select')}><Cursor size={16} /></IconButton><IconButton label="擦除音符" active={tool === 'erase'} onClick={() => setTool('erase')}><Eraser size={16} /></IconButton></div><span className="toolbar-divider" /><label className="inline-select">吸附<select aria-label="网格吸附" value={preferences.snap} onChange={e => setPrefs({ snap: +e.target.value })}><option value="0">自由</option>{[4, 8, 16, 32, 64].map(n => <option key={n} value={n}>1/{n}</option>)}</select></label><label className="inline-select">时值<select aria-label="新音符显示时值" value={preferences.noteLength} onChange={e => setPrefs({ noteLength: +e.target.value })}>{[1, 2, 4, 8, 16, 32, 64].map(n => <option key={n} value={n}>1/{n}</option>)}</select></label><button className="quiet-button" disabled={!canEditSelection} onClick={() => commands.current.quantize()} title="量化选中音符">量化</button><IconButton label="电脑键盘演奏" active={keyboardEnabled} onClick={() => setKeyboardEnabled(!keyboardEnabled)}><PianoKeys size={16} /></IconButton><div className="toolbar-spacer" /><span className="preset-label" onClick={() => { setSettingsTab('keys'); setModal('settings'); }}>{preferences.preset.toUpperCase()} 操作预设</span><button className="quiet-button" onClick={() => void importReference()}><Waveform size={14} /> 参考音频</button><IconButton label="设置" onClick={() => setModal('settings')}><GearSix size={16} /></IconButton></div>
    <main className="workspace">
      {preferences.showLibrary && <aside className="library"><div className="panel-title">音色库 <span>{project.instruments.length}</span></div><label className="search"><MagnifyingGlass size={13} /><input aria-label="搜索音色" placeholder="搜索音色…" value={search} onChange={e => setSearch(e.target.value)} /></label><div className="library-section-title">MINECRAFT NOTE BLOCKS</div><div className="instrument-list">{project.instruments.filter(i => `${i.name} ${i.englishName}`.toLowerCase().includes(search.toLowerCase())).map(ins => <button key={ins.id} className={`instrument-item ${track?.instrumentId === ins.id ? 'selected' : ''}`} onClick={() => { if (track && !track.locked) changeTrack(track.id, { instrumentId: ins.id }); void audition(66, { ...newNote(0, 66), instrumentId: ins.id }); }}><span className="instrument-glyph" style={{ color: ins.color }}><InstrumentBlock instrumentId={ins.id} size={28} /></span><span><strong>{ins.name}</strong><small>{ins.englishName}</small></span><i className={`sample-dot ${engine.bufferFor(ins.id) ? 'loaded' : ''}`} title={engine.bufferFor(ins.id) ? '采样已加载' : '未加载采样'} /></button>)}</div><button className="resource-card" onClick={() => { setSettingsTab('audio'); setModal('settings'); }}><Headphones size={17} /><span><strong>{loadingResources ? '正在查找资源…' : library ? `${library.version} 资源已载入` : '加载游戏声音资源'}</strong><small>{library ? `${Object.keys(library.samples).length} 个原始采样 · ${PROFILE_STATUS[audioProfile(library.profileId).status]}` : '从本机 Minecraft 实例读取'}</small></span></button></aside>}
      <section className="center-workspace"><ResizableEditorPanels activePanel={focus} onActivePanel={setFocus} minimumTop={referenceAsset ? 194 : 150} arrangement={<><div className="section-heading arrangement-heading"><span><MusicNotes size={14} /> 编曲区{selectedRegions.size > 0 && <span aria-live="polite"> · 已选 {selectedRegions.size} 片段{hiddenRegionCount ? `（${hiddenRegionCount} 隐藏）` : ''}</span>}</span><div className="arrangement-heading-tools"><TrackInstrumentFilter tracks={project.tracks} instruments={project.instruments} value={instrumentFilter} onChange={filterInstruments} context="编曲区" />{track && instrumentFilter && track.instrumentId !== instrumentFilter && <button onClick={() => filterInstruments(track.instrumentId)} title="切换筛选以显示当前选中轨道">显示当前轨道</button>}{hiddenRegionCount > 0 && <button onClick={() => filterInstruments('')}>显示全部所选</button>}{selectedRegions.size > 0 && regionGroupIssue && <span className="field-hint" role="status">{regionGroupIssue}</span>}<span className="tiny-divider" />{lastClipboardKind.current === 'regions' && regionClipboard.current && <span className="field-hint" aria-label="片段剪贴板">{regionClipboard.current.regions.length} 个片段 · 播放头 → {track?.name ?? '新轨道'}</span>}<button aria-label="粘贴片段" disabled={!canPasteRegionSelection} onClick={pasteSelection} title={regionPasteTargetIssue || `在播放头粘贴到${track?.name ?? '新轨道'}`}>粘贴片段</button><button aria-label="在播放头拆分片段" disabled={!!regionSplitIssue} onClick={splitSelectedRegions} title={regionSplitIssue || `${displayShortcut(bindings['split-region'], shortcutPlatform)} · 在 ${meterMap.format(playhead)} 拆分`}><Scissors size={13} /> 拆分</button><button disabled={!!regionGroupIssue} onClick={duplicateCurrentRegion} title={regionGroupIssue || '为全部所选片段创建独立副本'}><Copy size={13} /> 独立复制</button><button className={region?.loop ? 'selected-text' : ''} disabled={!region || selectedRegions.size !== 1 || track?.locked} onClick={() => region && changeRegion(region.id, { loop: !region.loop })}><Repeat size={14} /> 片段循环</button><span className="tiny-divider" /><button aria-label="缩小编曲区" onClick={() => setArrangementZoom(v => clamp(v - 6, 16, 100))}><Minus size={12} /></button><button aria-label="放大编曲区" onClick={() => setArrangementZoom(v => clamp(v + 6, 16, 100))}><Plus size={12} /></button></div></div>
        <Arrangement project={project} instrumentFilter={instrumentFilter} meter={meterMap} snap={preferences.snap} zoom={arrangementZoom} selectedRegion={region?.id ?? ''} selectedRegions={selectedRegions} onRegionSelection={selectRegionGroup} onRegionGroupChange={changeRegionGroup} onGestureMessage={setMessage} selectedTrack={track?.id ?? ''} playhead={playhead} gestureOwner={numberEditOwner.current} getGestureOwner={() => numberEditOwner.current} onSelect={selectRegion} onTrack={selectTrack} onTrackChange={changeTrack} onRegionChange={changeRegion} onTrimRegion={trimCurrentRegion} onAddTrack={addTrack} onCreateRegion={createRegion} onSeek={seek} onFocus={() => setFocus('arrangement')} referencePeaks={referencePeaks} onReferenceChange={changeReference} onReferenceRemove={removeReference} />
        </>} piano={<><div className="editor-heading"><div><PianoKeys size={15} /><strong>钢琴卷帘</strong><span className="breadcrumb">{track?.name} <span>›</span> {pattern?.name}</span></div><div><span>{selected.length ? `已选择 ${selected.length} 个音符` : `${pattern?.notes.length ?? 0} 个音符`}</span><button aria-label="显示全部音符" title="显示当前片段全部音符" disabled={!pattern} onClick={() => commands.current['piano-fit-all']()}>全部</button><button aria-label="显示所选音符" title="显示所选音符" disabled={!selected.length} onClick={() => commands.current['piano-fit-selection']()}>所选</button><PianoZoomControls zoom={zoom} rowHeight={pianoRowHeight} onZoom={setZoom} onRowHeight={setPianoRowHeight} disabled={!pattern} /></div></div>
        {pattern && track && region ? <PianoRoll viewKey={`${editorDocumentKey}:${project.id}:${region.id}`} viewRequest={pianoViewRequest} pattern={pattern} track={track} gestureOwner={numberEditOwner.current} getGestureOwner={() => numberEditOwner.current} onPrepareGesture={preparePianoGesture} preset={preferences.preset} region={region} onTrimRegion={trimCurrentRegion} ppq={project.ppq} meter={meterMap} origin={sourceOrigin} onSeek={seek} selected={selectedNotes} tool={tool} snap={preferences.snap} noteLength={preferences.noteLength} zoom={zoom} playhead={region && pattern ? patternPlayhead(playhead, region, pattern) : -1} onZoom={setZoom} rowHeight={pianoRowHeight} onRowHeight={setPianoRowHeight} onSelect={setSelectedNotes} onEdit={editNotes} onAudition={(midi, note) => void audition(midi, note)} onFocus={() => setFocus('piano')} /> : <div className="editor-empty"><PianoKeys size={32} /><p>{track ? '选择一个片段，或在当前轨道创建新片段' : '创建一条轨道或导入 MIDI'}</p><button disabled={track?.locked} onClick={() => track ? createRegion(track.id, playhead) : addTrack()}>{track ? '在当前轨道创建片段' : '添加轨道'}</button></div>}
        </>} />
        {preferences.showMixer && <Mixer project={project} selectedTrack={track?.id ?? ''} instrumentFilter={instrumentFilter} onInstrumentFilter={filterInstruments} onSelect={selectMixerTrack} onTrackChange={changeMixerTrack} onMasterChange={changeMixerMaster} onTrackPreview={previewMixerTrack} onMasterPreview={previewMixerMaster} meters={meters} masterMeter={masterMeter} playing={playing} meterScope={mixerMeterScope} gestureOwner={numberEditOwner.current} getGestureOwner={() => numberEditOwner.current} numberContextKey={`${editorDocumentKey}:${numberGeneration}`} getNumberContextKey={() => `${editorDocumentKey}:${numberEditOwner.current.generation}`} onNumberPending={setNumberPending} />}
      </section>
      {preferences.showInspector && <aside className="inspector"><div className="panel-title">检查器 <SlidersHorizontal size={13} /></div><div className="inspector-section"><div className="inspector-heading">{selected.length ? `音符 · ${selected.length} 个已选` : '音符属性'}</div>{firstNote ? <><div className="note-display"><strong>{noteName(firstNote.midi)}</strong><span>{firstNote.midi + firstNote.detune / 100 < 54 || firstNote.midi + firstNote.detune / 100 > 78 ? '超出原版音域' : '原版音域内'}</span></div>{(firstNote.midi + firstNote.detune / 100 < 54 || firstNote.midi + firstNote.detune / 100 > 78) && <div className="field-hint">实时试听保留实际音高；原版播放需要资源包或模组支持。</div>}<Field label="音高"><CommitNumberInput aria-label="音符 MIDI 音高" value={firstNote.midi} min={0} max={127} step={1} integer contextKey={numberContext} disabled={track?.locked} onPendingChange={pending => setNumberPending('midi', pending)} onCommit={value => commitNoteNumber({ midi: value })} /></Field><Field label="开始 / 四分拍"><CommitNumberInput aria-label="音符开始拍" value={firstNote.tick / project.ppq} min={0} max={MAX_PROJECT_TICK / project.ppq} step={.25} contextKey={numberContext} disabled={track?.locked} onPendingChange={pending => setNumberPending('tick', pending)} onCommit={value => commitNoteNumber({ tick: Math.max(0, inspectorBeatTicks(value, project.ppq)) })} /></Field><Field label="显示时值 / 四分拍"><CommitNumberInput aria-label="音符显示时值" value={firstNote.duration / project.ppq} min={1 / project.ppq} max={MAX_PROJECT_TICK / project.ppq} step={.25} contextKey={numberContext} disabled={track?.locked} onPendingChange={pending => setNumberPending('duration', pending)} onCommit={value => commitNoteNumber({ duration: Math.max(1, inspectorBeatTicks(value, project.ppq)) })} /></Field><div className="field-hint">时值不截断原版采样</div><Field label="力度"><CommitRangeInput aria-label="音符力度" min={0} max={100} value={firstNote.velocity * 100} disabled={track?.locked} contextKey={noteRangeContext} owner={numberEditOwner.current} getOwner={() => numberEditOwner.current} onPrepare={finishNumberDraft} onPreview={previewNoteRange('velocity')} onCommit={value => updateNotes({ velocity: value / 100 })} formatValue={value => `${Math.round(value)}%`} /></Field><Field label="左右"><CommitRangeInput aria-label="音符左右声像" min={-100} max={100} value={firstNote.pan * 100} disabled={track?.locked} contextKey={noteRangeContext} owner={numberEditOwner.current} getOwner={() => numberEditOwner.current} onPrepare={finishNumberDraft} onPreview={previewNoteRange('pan')} onCommit={value => updateNotes({ pan: value / 100 })} formatValue={value => value === 0 ? '居中' : `${value > 0 ? 'R' : 'L'} ${Math.abs(Math.round(value))}`} /></Field><Field label="上下 / 方块"><CommitNumberInput aria-label="音符上下位置" value={firstNote.height} min={-64} max={64} step={.25} contextKey={numberContext} disabled={track?.locked} onPendingChange={pending => setNumberPending('height', pending)} onCommit={value => commitNoteNumber({ height: value })} /></Field><Field label="微调 / 音分"><CommitNumberInput aria-label="音符微调音高" value={firstNote.detune} min={-32768} max={32767} step={1} contextKey={numberContext} disabled={track?.locked} onPendingChange={pending => setNumberPending('detune', pending)} onCommit={value => commitNoteNumber({ detune: value })} /></Field><Field label="音色覆盖"><select aria-label="单音符音色" value={firstNote.instrumentId ?? ''} onChange={e => updateNotes({ instrumentId: e.target.value || undefined })}><option value="">跟随轨道</option>{project.instruments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field></> : <div className="selection-hint"><Cursor size={26} /><p>选择一个音符</p><small>编辑音高、力度、声像与音色<br />Ctrl / Shift 拖动可框选多个音符</small></div>}</div>
        {track && <div className="inspector-section"><div className="inspector-heading">轨道</div><div className="button-row" aria-label="轨道整理"><button aria-label="上移当前轨道" disabled={!!trackManagement.upIssue} title={trackManagement.upIssue || "与上一条可见轨道交换位置"} onClick={() => moveCurrentTrack(-1)}>上移</button><button aria-label="下移当前轨道" disabled={!!trackManagement.downIssue} title={trackManagement.downIssue || "与下一条可见轨道交换位置"} onClick={() => moveCurrentTrack(1)}>下移</button><button aria-label="删除当前轨道" disabled={!!trackManagement.deleteIssue} title={[trackManagement.deleteIssue, trackManagement.deleteDescription].filter(Boolean).join(" ")} onClick={deleteCurrentTrack}>删除轨道</button></div>{trackManagement.hidden && <p className="field-hint">当前轨道被筛选隐藏。<button className="text-button" onClick={() => filterInstruments(track.instrumentId)}>显示当前轨道</button></p>}<Field label="名称"><input aria-label="轨道名称" value={track.name} onChange={e => changeTrack(track.id, { name: e.target.value })} /></Field><Field label="默认音色"><select aria-label="轨道默认音色" value={track.instrumentId} onChange={e => changeTrack(track.id, { instrumentId: e.target.value })}>{project.instruments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field><button className="text-button" onClick={() => void locateSample()}>定位 / 替换乐器采样…</button>{region && <>{selectedRegions.size > 1 && <p className="field-hint">仅单片段可编辑名称、长度、所属轨道和循环；请先单独选择一个片段。</p>}<Field label="片段所属轨道"><select aria-label="片段所属轨道" value={region.trackId} disabled={track.locked || selectedRegions.size !== 1} onChange={e => changeRegion(region.id, { trackId: e.currentTarget.value })} title="移动后跟随目标轨道的默认音色、混音和 Delay；保留单音符音色覆盖。">{project.tracks.map((item, index) => <option key={item.id} value={item.id} disabled={item.locked}>{index + 1}. {item.name}{item.locked ? '（已锁定）' : ''}</option>)}</select></Field><p className="field-hint">移动后跟随目标轨道的默认音色、混音和 Delay；单音符音色覆盖保持不变。</p><Field label="片段名称"><input aria-label="片段名称" value={pattern?.name ?? ''} disabled={track.locked || selectedRegions.size !== 1} onChange={e => renameCurrentRegion(e.target.value)} /></Field><Field label="片段长度 / 四分拍"><CommitNumberInput aria-label="片段长度" value={region.length / project.ppq} min={Math.max(.25, 1 / project.ppq)} max={MAX_PROJECT_TICK / project.ppq} step={1} contextKey={numberContext} disabled={track.locked || selectedRegions.size !== 1} onPendingChange={pending => setNumberPending('region-length', pending)} onCommit={commitRegionLength} /></Field></>}</div>}
        {track && <DelayEditor value={track.delay} disabled={track.locked} contextKey={delayContext} onChange={changeTrackDelay} onPendingChange={setNumberPending} previewDuration={delayPreviewDuration} secondsPerBeat={60 / tempoMap.at(delayPreviewOrigin).bpm} />}
        <div className="inspector-section verification"><div className="inspector-heading">声音配置</div><strong>{profile.name}</strong><span className="verification-state">{profile.status === 'partially-measured' ? '部分游戏场景已对照' : '待游戏录音验收'}</span><small>平面声场 · 左右 / 上下<br />{library?.nativeLibrary ? '原生 OpenAL 可用于离线导出' : 'Web Audio 预览引擎'}</small><button className="text-button" onClick={() => { setSettingsTab('audio'); setModal('settings'); }}>查看声音设置…</button></div>
      </aside>}
    </main>
    <footer className="status-bar"><div className="status-message"><span className={`status-dot ${library ? 'ready' : ''}`} />{message}</div><button className={`warning-count ${warnings.length ? 'has-warnings' : ''}`} onClick={() => setModal('help')}><Warning size={13} /> {warnings.length}</button><span>{project.tracks.length} 轨 · {flatCount === undefined ? '音符展开超限' : flatCount.toLocaleString() + ' 音符'}</span><span className="status-divider" /><button className={preferences.showMixer ? 'active-text' : ''} onClick={() => setPrefs({ showMixer: !preferences.showMixer })}><SlidersHorizontal size={14} /> 混音器</button><button onClick={() => setModal('help')}>快捷操作</button></footer>

    {modal === 'timing' && <Modal title="速度与拍号" wide onClose={() => setModal(null)}><TimingEditor project={project} meter={meterMap} tempo={tempoMap} playhead={playhead} onEdit={commit} onSeek={seek} /></Modal>}
    {modal === 'flp-import' && (flpImport ? <FlpImportDialog key={flpImport.ticket} plan={flpImport.plan} onCancel={cancelFlpImport} onImport={(choices, acknowledged) => { void finishFlpImport(choices, acknowledged); }} /> : <Modal title="读取 FLP" onClose={cancelFlpImport}><div className="modal-body"><p>正在读取工程并核对可用采样…</p><div className="button-row end"><button onClick={cancelFlpImport}>取消</button></div></div></Modal>)}
    {modal === 'settings' && <Modal title="设置" wide onClose={() => setModal(null)}><div className="settings-tabs"><button className={settingsTab === 'audio' ? 'active' : ''} onClick={() => setSettingsTab('audio')}>声音与资源</button><button className={settingsTab === 'keys' ? 'active' : ''} onClick={() => setSettingsTab('keys')}>操作与快捷键</button><button className={settingsTab === 'project' ? 'active' : ''} onClick={() => setSettingsTab('project')}>工程与保存</button>{INTERNAL_LIQUID_GLASS && <button className={settingsTab === 'appearance' ? 'active' : ''} onClick={() => setSettingsTab('appearance')}>外观</button>}</div><div className="modal-body">
      {settingsTab === 'audio' && <><p className="modal-intro">使用本机 Minecraft 的原始音符盒采样。版本、底层音频库和实测状态分别记录。</p><Field label="试听方式（本机）"><select value={playbackMode} onChange={e => changePlaybackMode(e.target.value as PlaybackMode)}><option value="realtime">实时试听 · 编辑即时生效</option><option value="native-compare" disabled={!window.desktop}>原生离线对照 · 与 WAV 导出共用处理</option></select></Field><p className="field-hint">实时试听可在播放时编辑；原生离线对照用于核对目标版本，修改后需重新播放。切换方式会停止当前播放。</p><Field label="工程目标版本"><input readOnly value={project.audio.profileId} /></Field><p className="field-hint">下方选择并加载客户端资源后，工程会记录实际使用的版本；未通过实测的配置保持明确标记。</p><div className="research-notice"><Warning size={17} /><span>{PROFILE_STATUS[profile.status]}。{profile.measurementSummary ?? '版本元数据和原生混音不等同于游戏录音验收。'}</span></div><Field label="本机游戏实例"><select aria-label="Minecraft 实例" value={resourceRoot} onChange={e => { const r = roots.find(r => r.root === e.target.value); setResourceRoot(e.target.value); chooseResourceVersion(r?.versions[0] ?? '', r); }}><option value="">请选择实例</option>{roots.map(r => <option key={r.root} value={r.root}>{r.root}</option>)}</select></Field><div className="form-columns"><Field label="客户端版本"><select value={resourceVersion} onChange={e => chooseResourceVersion(e.target.value)}>{rootChoice?.versions.map(v => <option key={v}>{v}</option>)}</select></Field><Field label="资源索引"><select value={resourceIndex} onChange={e => setResourceIndex(e.target.value)}>{rootChoice?.indexes.map(i => <option key={i}>{i}</option>)}</select></Field></div><div className="button-row"><button onClick={() => void discover()} disabled={loadingResources}>重新查找</button><button onClick={() => void selectResourceDirectory()} disabled={loadingResources}>选择目录…</button><button className="primary" disabled={loadingResources || !resourceRoot} onClick={() => void loadResources()}>{loadingResources ? '正在加载…' : '加载所选资源'}</button></div><Field label="试听模式"><select value={project.audio.mode} onChange={e => commit('更改试听模式', p => { p.audio.mode = e.target.value as 'vanilla' | 'studio'; })}><option value="vanilla">游戏预览 · 应用距离衰减</option><option value="studio">完整试听 · 保留所有声音</option></select></Field><p className="field-hint">游戏预览以站立视角为基准，计算声音发送范围与距离衰减。实时试听和 Web WAV 保留实际音高，包括超音域；原生离线对照和原生 WAV 遵循目标游戏的音高限制。</p><label className="checkbox"><input type="checkbox" checked={project.audio.directional} onChange={e => commit('调整方向音频', p => { p.audio.directional = e.target.checked; })} /> 方向音频 / HRTF</label><p className="field-hint">{hrtfOptionHint(project)}</p><Field label="导出采样率"><select value={project.audio.sampleRate} onChange={e => commit('调整采样率', p => { p.audio.sampleRate = +e.target.value; })}>{[44100, 48000, 96000].map(n => <option key={n} value={n}>{n.toLocaleString()} Hz</option>)}</select></Field><p className="field-hint">高密度发声只提示风险，编辑器不会刻意丢音或模拟卡顿。结构生成规则仍待定。</p></>}
      {settingsTab === 'keys' && <ShortcutSettings preset={preferences.preset} shortcuts={preferences.shortcuts} platform={shortcutPlatform} onChange={settings => setPrefs(settings)} />}
      {INTERNAL_LIQUID_GLASS && settingsTab === 'appearance' && <LiquidGlassAppearance appearance={preferences.appearance} onChange={appearance => setPrefs({ appearance })} />}
      {settingsTab === 'project' && <><Field label="作者"><input value={project.author} onChange={e => commit('修改作者', p => { p.author = e.target.value; })} /></Field><Field label="说明"><textarea value={project.description} onChange={e => commit('修改工程说明', p => { p.description = e.target.value; })} /></Field><label className="checkbox"><input type="checkbox" checked={portable} onChange={e => setPortable(e.target.checked)} /> 保存时嵌入本曲使用的采样（分享前确认素材授权）</label><p className="modal-intro">NBSX 保留完整音乐数据、MIDI 来源信息、片段和单音符属性。嵌入游戏或第三方采样的工程须按素材授权分享。音符长度始终保留，不会截断原版采样。</p><p className="field-hint">有修改时每 30 秒写入恢复副本。桌面保存前保留旧版备份，最多 30 份。游戏安装目录只读。</p><div className="button-row"><button onClick={() => void save(true)}>另存为 NBSX 工程…</button>{project.midi && <button onClick={() => void saveOriginalMidi()}>另存原始 MIDI…</button>}</div></>}
    </div></Modal>}
    {modal === 'export' && <Modal title="导出" onClose={() => { if (!busy) setModal(null); }}><div className="modal-body">
      <p className="modal-intro">选择格式后直接导出，完整数据保留在 NBSX 工程中。</p>
      <div className="export-formats">{(['nbs', 'mid', 'wav'] as const).map(format => <button key={format} className={exportFormat === format ? 'active' : ''} onClick={() => changeExportOptions({ format })}><strong>{format.toUpperCase()}</strong><small>{format === 'nbs' ? 'Note Block Studio' : format === 'mid' ? '标准 MIDI' : '立体声音频'}</small></button>)}</div>
      {exportFormat === 'nbs' && <>
        <div className="form-columns">
          <Field label="NBS 版本"><select aria-label="NBS 导出版本" value={nbsVersion} onChange={e => changeExportOptions({ nbsVersion: +e.target.value as 4 | 5 | 6 })}><option value="4">v4 · 广泛兼容</option><option value="5">v5 · 自定义乐器</option><option value="6">v6 · 新版乐器</option></select></Field>
          <Field label="TPS 换算预设"><select aria-label="NBS TPS 换算预设" value={nbsTempoPreset} onChange={e => changeExportOptions({ nbsTempoPreset: e.target.value as NbsTempoPreset })}><option value="bpm-7.5">BPM ÷ 7.5 · 150 BPM → 20 TPS</option><option value="bpm-5">BPM ÷ 5 · 100 BPM → 20 TPS</option></select></Field>
        </div>
        <p className="field-hint"><output aria-label="NBS 自动 TPS">{nbsTiming ? `${nbsTiming.bpm} BPM ÷ ${nbsTempoPreset === 'bpm-7.5' ? '7.5' : '5'} = ${nbsTiming.ticksPerSecond} TPS` : nbsTimingIssue}</output><br />每四分拍 {nbsTempoPreset === 'bpm-7.5' ? 8 : 12} tick，音符位置按 MIDI 刻度直接换算；不足一格时按 NBS 规则向前取整。起始 TPS 按文件格式保留两位小数。{project.tempos.length > 1 && '变速段使用 Tempo Changer，接收端需支持此功能。'}</p>
      </>}
      {exportFormat === 'wav' && <><label className="checkbox"><input type="checkbox" checked={nativeAudio} onChange={e => changeExportOptions({ nativeAudio: e.target.checked })} /> 使用已加载版本的原生 OpenAL 离线混音</label><p className="field-hint">{library?.nativeLibrary ? '原生混音可用，游戏录音对照仍未完成。' : '原生音频库不可用；取消上方选项后可明确选择 Web Audio 近似导出。'}</p><p className="field-hint">原生混音遵循目标游戏的音高限制；取消上方选项后，Web WAV 将保留实际音高，包括超音域。</p></>}
      {currentExportError && <div className="export-report" role="alert"><strong><Warning size={15} /> 导出失败</strong><p className="error">{currentExportError}</p></div>}
      {!!exportIssues.length && <div className="export-report"><strong><Warning size={15} /> 导出转换提示</strong>{exportIssues.map((d, i) => <p className={d.severity} key={i}>{d.message}</p>)}</div>}
      <div className="button-row end"><button className="primary" disabled={busy} onClick={() => void finishExport()}>{busy ? exportSaving.current ? '正在保存…' : exportFormat === 'wav' ? '正在渲染…' : '正在导出…' : '导出文件…'}</button></div>
    </div></Modal>}
    {modal === 'help' && <Modal title="操作与工程提示" wide onClose={() => setModal(null)}><div className="modal-body"><p className="modal-intro">{APP_NAME} {APP_VERSION} · 独立音符盒编曲编辑器</p><p className="field-hint">非官方 Minecraft 产品，未经 Mojang 或 Microsoft 认可，也不与其关联。游戏素材的权利归相应权利人所有。代码许可与用户作品的权利分别适用。</p><div className="help-grid"><p><b>绘制与选择</b><br />左键绘制 / 拖动，右键擦除<br />Ctrl / Cmd 拖框替换，Shift 追加选择</p><p><b>导航与缩放</b><br />滚轮上下滚动，Shift 滚轮左右滚动<br />Ctrl / Cmd 滚轮横向缩放，配合 Shift 纵向缩放<br />标题栏横向／纵向滑杆，点击轴名恢复默认<br />按住编曲时间尺拖动定位</p><p><b>编辑</b><br />Ctrl+C / X / V 复制、剪切、粘贴当前区域所选<br />编曲区操作片段，钢琴区操作音符；Delete 删除<br />上下方向键移调，Shift 以八度移调<br />左右方向键按网格移动，Shift 按四分拍移动<br />关闭吸附时左右键移动 1 tick</p><p><b>片段与循环</b><br />空白拖框，Shift 点击增减片段选择<br />拖动选区整组移动；独立复制后各自编辑<br />单选后调整范围，循环须单独启用</p></div><div className="diagnostic-list"><h3>工程提示</h3>{diagnostics.length ? diagnostics.map((d, i) => <p className={d.severity} key={i}><span>{d.severity === 'warning' ? '△' : '·'}</span>{d.message}</p>) : <p>当前没有工程警告。</p>}</div><p className="field-hint">拖入 MIDI、NBS、FLP 或 NBSX 文件即可打开。FL / Logic / NBS 基础快捷键可以在设置中修改。</p></div></Modal>}
    {modal === 'recovery' && recovery && <Modal title="发现恢复副本" onClose={() => setModal(null)}><div className="modal-body"><p>发现上次编辑留下的自动保存工程。载入后请另行保存。</p><div className="button-row end"><button onClick={() => void discardRecovery()}>丢弃恢复副本</button><button onClick={() => setModal(null)}>稍后处理</button><button className="primary" onClick={restoreRecovery}>载入恢复副本</button></div></div></Modal>}
  </div>;
}
