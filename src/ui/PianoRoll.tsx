import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Instrument, Note, Pattern, Region, ShortcutPreset, Track } from '../core/types';
import { clamp, newNote } from '../core/project';
import { INSTRUMENTS, inNoteBlockRange, noteBlockMidiRange, noteName } from '../core/instruments';
import type { MeterMap } from '../core/meter';
import { dragNotes, dragPlacedNote, noteResizeHandleWidth, planRegionTrim, regionSourceRanges } from '../core/editor-interaction';
import { velocityBounds, constrainVelocityDelta, changeNoteVelocities, type VelocityMode } from '../core/note-velocity';
import { EditorScrollbar } from './EditorScrollbar';
import { noteAt, notesAlongStroke, type Point } from './piano-hit-test';
import { clampPianoZoom, planPianoView, planPianoRowZoom, pianoRowHeaderWidth, pianoGridTick, pianoGridX, visibleDrumRows, type DrumRowLabel } from './piano-view';
import { PianoNoteIndex } from './piano-note-index';
import { previewPianoNotes } from './piano-preview';
import { NoteDeletionFeedback, deletionFeedbackCandidates } from './note-deletion-feedback';

export type Tool = 'draw' | 'select' | 'erase';
interface Props {
  drumRows?: DrumRowLabel[];
  instruments?: readonly Instrument[];
  pattern: Pattern; track: Track; ppq: number; selected: Set<string>; tool: Tool;
  snap: number; noteLength: number; zoom: number; playhead: number; meter: MeterMap; origin: number;
  preset: ShortcutPreset; region?: Region;
  viewKey?: string; viewRequest?: { id: number; mode: 'all' | 'selection' };
  /** Empty mapped tracks locate their trigger register without adding source notes. */
  guidePitches?: number[];
  gestureOwner?: object; getGestureOwner?: () => object;
  onPrepareGesture?: () => boolean;
  onZoom: (zoom: number) => void; onSelect: (ids: Set<string>) => void;
  rowHeight?: number; onRowHeight?: (height: number) => void;
  onEdit: (label: string, change: (notes: Note[]) => Note[]) => void | boolean;
  onAudition: (midi: number, note?: Note) => void; onFocus: () => void; onSeek: (tick: number) => void;
  onTrimRegion: (id: string, edge: 'start' | 'end', tick: number) => void;
}
interface Drag {
  kind: 'draw' | 'move' | 'resize' | 'select' | 'erase' | 'velocity' | 'seek' | 'pan' | 'trim-start' | 'trim-end';
  origin: { x: number; y: number }; point: { x: number; y: number };
  scroll: { x: number; y: number }; pointerId: number;
  notes: Note[]; ids: Set<string>; added?: Note; anchorTick: number; deltaTick: number; deltaPitch: number; value: number;
  region?: Region; patch?: Partial<Region>;
  moved?: boolean;
  selectionBefore: Set<string>;
  target: { patternId: string; trackId: string; region: Region | undefined; owner?: object };
  erasePoint?: Point;
  selection?: PianoNoteIndex;
  velocityMode?: VelocityMode;
  velocityBounds?: ReturnType<typeof velocityBounds>;
  copyIds?: Map<string, string>;
  copiedSelection?: Set<string>;
}
interface NoteContextMenu {
  x: number; y: number; ids: Set<string>; notes: Note[]; patternId: string; trackId: string; region?: Region; owner?: object;
}
const TIMELINE = 26, RULER = 42, ROW = 18, VELOCITY = 78;
const black = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

export function PianoRoll(props: Props) {
  const canvasId = useId();
  const canvas = useRef<HTMLCanvasElement>(null), container = useRef<HTMLDivElement>(null);
  const size = useRef({ width: 800, height: 400 });
  const scroll = useRef({ x: 0, y: (127 - 84) * ROW });
  const rowHeight = useRef(ROW);
  const [viewport, setViewport] = useState({ width: 800, height: 400, x: 0, y: scroll.current.y, rowHeight: ROW });
  const navigation = useRef<{ measured: boolean; key?: string; request?: number }>({ measured: false });
  const pendingView = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const previousZoom = useRef(props.zoom), syncNavigation = useRef<() => void>(() => {});
  const drag = useRef<Drag | null>(null);
  const animation = useRef(0);
  const deletion = useRef(new NoteDeletionFeedback());
  const deletionAnimation = useRef(0), reducedMotion = useRef(true);
  const visibleBeforeDelete = useRef<{ note: Note; color: string }[]>([]);
  const erasePreviewed = useRef(new Set<string>());
  const deletionSource = useRef(props.pattern.notes);
  const deletionOwner = useRef<unknown[]>([]);
  const current = useRef(props); current.current = props;
  const [contextMenu, setContextMenu] = useState<NoteContextMenu | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  // Keep only the current immutable source index, rather than retaining one per undo state.
  const indexedNotes = useRef<PianoNoteIndex | undefined>(undefined);
  const noteIndex = () => {
    const notes = current.current.pattern.notes;
    if (indexedNotes.current?.notes !== notes) indexedNotes.current = new PianoNoteIndex(notes);
    return indexedNotes.current;
  };
  const drawRef = useRef<() => void>(() => {});
  function clearDeletionFeedback() {
    deletion.current.clear(); erasePreviewed.current.clear(); visibleBeforeDelete.current = [];
    cancelAnimationFrame(deletionAnimation.current); deletionAnimation.current = 0;
  }
  function animateDeletion() {
    if (deletionAnimation.current || !deletion.current.size || reducedMotion.current) return;
    deletionAnimation.current = requestAnimationFrame(() => {
      deletionAnimation.current = 0; drawRef.current(); animateDeletion();
    });
  }
  const keyboardWidth = () => pianoRowHeaderWidth(!!current.current.drumRows);
  const scale = () => current.current.zoom / current.current.ppq;
  const step = () => current.current.snap ? current.current.ppq * 4 / current.current.snap : 1;
  const snap = (tick: number) => Math.max(0, current.current.meter.snap(current.current.origin + tick, step()) - current.current.origin);
  const position = (e: { clientX: number; clientY: number }) => { const rect = canvas.current!.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; };
  const toTick = (x: number) => Math.max(0, pianoGridTick(x, scroll.current.x, current.current.ppq, current.current.zoom, keyboardWidth()));
  const toPitch = (y: number) => clamp(127 - Math.floor((y - RULER + scroll.current.y) / rowHeight.current), 0, 127);
  const rectFor = (note: Note) => ({ x: pianoGridX(note.tick, scroll.current.x, current.current.ppq, current.current.zoom, keyboardWidth()), y: RULER + (127 - note.midi) * rowHeight.current - scroll.current.y, width: Math.max(6, note.duration * scale()), height: Math.max(1, rowHeight.current - 2) });
  const rawTick = (x: number) => pianoGridTick(x, scroll.current.x, current.current.ppq, current.current.zoom, keyboardWidth());
  const queryFor = (x1: number, y1: number, x2: number, y2: number) => {
    const start = rawTick(Math.min(x1, x2)), end = rawTick(Math.max(x1, x2));
    // Inverse pixel conversion can round across a closed edge, especially far from zero.
    const pad = Number.EPSILON * 8 * Math.max(1, Math.abs(start), Math.abs(end), scroll.current.x / scale());
    return { start: start - pad, end: end + pad,
      low: Math.max(0, 126 - Math.ceil((Math.max(y1, y2) - RULER + scroll.current.y) / rowHeight.current)),
      // Bodies keep a one-pixel hit area even when many pitch rows fit in one pixel.
      high: Math.min(127, 128 - Math.floor((Math.min(y1, y2) - RULER + scroll.current.y - Math.max(1, rowHeight.current)) / rowHeight.current)),
      minimumDuration: 6 / scale(),
    };
  };
  const hit = (x: number, y: number) => noteAt(noteIndex().query(queryFor(x, y, x, y)), x, y, rectFor);
  const validDrag = (active: Drag) => {
    const p = current.current;
    return active.target.patternId === p.pattern.id && active.target.trackId === p.track.id && active.target.region === p.region && active.notes === p.pattern.notes
      && active.target.owner === p.gestureOwner && (!p.getGestureOwner || p.getGestureOwner() === active.target.owner)
      && (!p.track.locked || active.kind === 'pan' || active.kind === 'seek');
  };
  function cancelDrag(restoreSelection = true) {
    const active = drag.current; if (!active) return;
    if (active.kind === 'erase') { deletion.current.remove(erasePreviewed.current); erasePreviewed.current.clear(); }
    drag.current = null; cancelAnimationFrame(animation.current); animation.current = 0;
    const element = canvas.current;
    if (element) { element.style.cursor = ''; if (element.hasPointerCapture(active.pointerId)) element.releasePointerCapture(active.pointerId); }
    if (restoreSelection && validDrag(active)) current.current.onSelect(new Set(active.selectionBefore));
    drawRef.current();
  }
  const viewportWidth = () => Math.max(1, size.current.width - keyboardWidth());
  const viewportHeight = () => Math.max(1, size.current.height - RULER - VELOCITY);
  const previewRegion = () => {
    const active = drag.current;
    return active?.region && active.patch ? { ...active.region, ...active.patch } : current.current.region;
  };
  const playbackBounds = (region = previewRegion()) => {
    const active = drag.current, original = active?.region ?? region;
    let start = original ? original.loop ? original.offset % Math.max(1, current.current.pattern.length) : original.offset : 0;
    let end = start + (original?.length ?? current.current.pattern.length);
    if (active?.kind === 'trim-start') start += active.deltaTick;
    if (active?.kind === 'trim-end') end += active.deltaTick;
    return { start, end };
  };
  const contentWidth = () => {
    const p = current.current, active = drag.current;
    const notesEnd = noteIndex().maxEnd;
    const draftEnd = active?.kind === 'draw' && active.added ? active.added.tick + Math.max(0, active.deltaTick) + active.added.duration
      : active?.kind === 'move' || active?.kind === 'resize' ? notesEnd + Math.max(0, active.deltaTick) : 0;
    const end = Math.max(p.pattern.length, notesEnd, draftEnd, playbackBounds().end);
    const firstEnd = p.meter.at(p.origin + end).barEnd;
    return Math.max(viewportWidth(), (p.meter.at(firstEnd).barEnd - p.origin) * scale());
  };
  const publishViewport = () => setViewport(previous => previous.width === size.current.width && previous.height === size.current.height && previous.x === scroll.current.x && previous.y === scroll.current.y && previous.rowHeight === rowHeight.current ? previous : { ...size.current, ...scroll.current, rowHeight: rowHeight.current });
  const setScroll = (x: number, y: number) => {
    const next = { x: clamp(x, 0, Math.max(0, contentWidth() - viewportWidth())), y: clamp(y, 0, Math.max(0, rowHeight.current * 128 - viewportHeight())) };
    const changed = next.x !== scroll.current.x || next.y !== scroll.current.y;
    scroll.current = next;
    if (changed) { publishViewport(); drawRef.current(); }
    return changed;
  };
  const resizeRows = (value: number, anchor = viewportHeight() / 2) => {
    cancelDrag();
    const plan = planPianoRowZoom(rowHeight.current, value, scroll.current.y, viewportHeight(), anchor);
    rowHeight.current = plan.rowHeight;
    if (pendingView.current) pendingView.current.y = plan.y;
    setScroll(scroll.current.x, plan.y); publishViewport(); drawRef.current();
    current.current.onRowHeight?.(plan.rowHeight);
  };
  const applyView = (mode: 'locate' | 'all' | 'selection') => {
    const p = current.current;
    let notes = p.pattern.notes;
    if (!notes.length && p.drumRows && mode !== 'selection') notes = (p.drumRows.filter(row => row.mapped).map(row => row.midi).length ? p.drumRows.filter(row => row.mapped).map(row => row.midi) : p.guidePitches?.length ? p.guidePitches : [36,38,42,46]).map(midi => newNote(0,midi));
    if (!notes.length && p.guidePitches?.length && mode !== 'selection') notes = p.guidePitches.map(midi => newNote(0, midi));
    if (mode === 'selection') { notes = notes.filter(note => p.selected.has(note.id)); if (!notes.length) return; }
    let startTick: number | undefined;
    if (mode === 'locate' && p.region) {
      const ranges = regionSourceRanges(p.pattern.length, p.region);
      const audible = notes.filter(note => ranges.some(range => note.tick >= range.start && note.tick < range.end));
      if (audible.length) notes = audible;
      const phase = p.region.loop ? p.region.offset % Math.max(1, p.pattern.length) : p.region.offset;
      startTick = notes.reduce((first, note) => note.tick >= phase ? Math.min(first, note.tick) : first, Infinity);
      if (!Number.isFinite(startTick)) startTick = notes.length ? undefined : phase;
    }
    // View-only actions must not change selection or create project history.
    cancelDrag();
    const plan = planPianoView({ notes, ppq: p.ppq, width: viewportWidth(), height: viewportHeight(), zoom: p.zoom, mode: mode === 'locate' ? 'locate' : 'fit', startTick });
    rowHeight.current = plan.rowHeight;
    if (plan.zoom === p.zoom) { pendingView.current = null; setScroll(plan.x, plan.y); }
    else { pendingView.current = plan; p.onZoom(plan.zoom); }
    p.onRowHeight?.(plan.rowHeight);
    publishViewport(); drawRef.current();
  };
  syncNavigation.current = () => {
    if (!navigation.current.measured) return;
    const p = current.current, key = p.viewKey ?? `${p.track.id}:${p.pattern.id}:${p.region?.id ?? ''}`;
    if (navigation.current.key !== key) {
      cancelDrag(false); navigation.current.key = key; navigation.current.request = p.viewRequest?.id; applyView('locate');
    } else if (p.viewRequest && p.viewRequest.id !== navigation.current.request) {
      navigation.current.request = p.viewRequest.id; applyView(p.viewRequest.mode);
    }
  };
  const placedNote = (active: Drag) => active.added && dragPlacedNote(active.added, current.current.preset, active.deltaTick, active.deltaPitch, snap(toTick(active.point.x)) + step());

  drawRef.current = () => {
    const element = canvas.current; if (!element) return;
    const context = element.getContext('2d'); if (!context) return;
    const { width: w, height: h } = size.current, p = current.current, active = drag.current, ROW = rowHeight.current;
    const rowLabels = new Map(p.drumRows?.map(row => [row.midi, row]) ?? []);
    const rootMidi = (p.instruments ?? INSTRUMENTS).find(instrument => instrument.id === p.track.instrumentId)?.rootMidi ?? 66;
    // gestureOwner changes on ordinary commits; it is deliberately not an
    // animation scope. Document navigation is represented by viewKey instead.
    const now = performance.now(), owner = [p.viewKey,p.pattern.id,p.track.id,p.region?.id,!!p.drumRows];
    if (owner.some((value,index) => value !== deletionOwner.current[index])) {
      clearDeletionFeedback(); deletionOwner.current = owner; deletionSource.current = p.pattern.notes;
    }
    if (deletionSource.current !== p.pattern.notes) {
      // Scan IDs once per immutable edit, never on animation frames.
      const liveIds = new Set(p.pattern.notes.map(note => note.id));
      deletion.current.restore(liveIds);
      deletion.current.enqueue(visibleBeforeDelete.current.filter(item => !liveIds.has(item.note.id) && !erasePreviewed.current.has(item.note.id)),now,reducedMotion.current);
      deletionSource.current = p.pattern.notes;
      if (active?.kind !== 'erase') erasePreviewed.current.clear();
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (element.width !== Math.round(w * dpr) || element.height !== Math.round(h * dpr)) { element.width = Math.round(w * dpr); element.height = Math.round(h * dpr); }
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, w, h);
    context.fillStyle = '#1c222c'; context.fillRect(0, 0, w, h);
    const noteBottom = h - VELOCITY;
    context.save(); context.beginPath(); context.rect(keyboardWidth(), RULER, w - keyboardWidth(), noteBottom - RULER); context.clip();
    for (let row = Math.max(0, Math.floor(scroll.current.y / ROW)); row <= Math.min(127, Math.ceil((scroll.current.y + noteBottom) / ROW)); row++) {
      const midi = 127 - row, y = RULER + row * ROW - scroll.current.y;
      context.fillStyle = p.drumRows ? (p.drumRows.some(row => row.midi === midi && row.mapped) ? '#293c3f' : '#232a36') : black(midi) ? '#202631' : '#272f3b'; context.fillRect(keyboardWidth(), y, w - keyboardWidth(), ROW);
      const range = p.drumRows ? rowLabels.get(midi)?.range ?? 'unmapped' : inNoteBlockRange(midi, rootMidi) ? 'in' : 'out';
      if (range !== 'in') { context.fillStyle = range === 'mixed' ? '#00000032' : '#00000070'; context.fillRect(keyboardWidth(), y, w - keyboardWidth(), ROW); }
      context.strokeStyle = midi % 12 === 0 ? '#485568' : '#313b4a'; context.beginPath(); context.moveTo(keyboardWidth(), y + ROW); context.lineTo(w, y + ROW); context.stroke();
    }
    const grid = p.meter.grid(p.origin + scroll.current.x / scale(), p.origin + (scroll.current.x + w - keyboardWidth()) / scale(), scale(), p.snap ? p.ppq * 4 / p.snap : p.ppq / 4);
    for (const mark of grid) {
      const x = keyboardWidth() + (mark.tick - p.origin) * scale() - scroll.current.x;
      context.strokeStyle = mark.kind === 'bar' ? '#4b596e' : mark.kind === 'beat' ? '#394557' : '#313b4a';
      context.beginPath(); context.moveTo(x + 0.5, RULER); context.lineTo(x + 0.5, noteBottom); context.stroke();
    }
    const playingRegion = previewRegion(), ranges = regionSourceRanges(p.pattern.length, playingRegion);
    let previousEnd = keyboardWidth();
    for (const range of ranges) {
      const left = keyboardWidth() + range.start * scale() - scroll.current.x, right = keyboardWidth() + range.end * scale() - scroll.current.x;
      context.fillStyle = '#00000030'; context.fillRect(previousEnd, RULER, Math.max(0, left - previousEnd), noteBottom - RULER);
      context.fillStyle = '#bdd7ff05'; context.fillRect(left, RULER, right - left, noteBottom - RULER);
      previousEnd = Math.max(previousEnd, right);
    }
    context.fillStyle = '#00000030'; context.fillRect(previousEnd, RULER, Math.max(0, w - previousEnd), noteBottom - RULER);
    const query = queryFor(keyboardWidth(), RULER, w, noteBottom);
    const visible = noteIndex().query(query).filter(note => { const rect=rectFor(note); return rect.x+rect.width>=keyboardWidth() && rect.x<=w && rect.y+rect.height>=RULER && rect.y<noteBottom; });
    visibleBeforeDelete.current = deletionFeedbackCandidates(visible,p.selected,p.track.color);
    if (active?.kind === 'erase') {
      const erased = visible.filter(note => active.ids.has(note.id) && !erasePreviewed.current.has(note.id)).slice(0,256).map(note => ({note,color:p.selected.has(note.id)?'#e4f5ec':p.track.color}));
      deletion.current.enqueue(erased,now,reducedMotion.current);
      for (const item of erased) erasePreviewed.current.add(item.note.id);
    }
    const ghostFrames = deletion.current.frame(now);
    if (element.dataset) {
      element.dataset.deletionFeedbackCount = String(ghostFrames.length);
      element.dataset.deletionFeedbackProgress = String(ghostFrames.length ? Math.max(...ghostFrames.map(ghost=>ghost.progress)) : 1);
      element.dataset.deletionFeedbackActive = String(ghostFrames.length > 0);
      element.dataset.copyPreviewCount = String(active?.copyIds?.size ?? 0);
    }
    // Ghosts precede live notes, so immediate redraw at the same position wins.
    for (const ghost of ghostFrames) {
      const rect=rectFor(ghost.note), width=Math.max(1,(rect.width-2)*ghost.scale), height=Math.max(.5,rect.height*ghost.scale);
      context.globalAlpha=ghost.opacity; context.fillStyle=ghost.color; context.beginPath();
      context.roundRect(rect.x+1+(rect.width-2-width)/2,rect.y+1+(rect.height-height)/2,width,height,2); context.fill();
    }
    context.globalAlpha=1;
    animateDeletion();
    const preview = active ? { ...active, addedPreview: placedNote(active) } : null;
    const notes = previewPianoNotes(noteIndex(), active?.selection, preview, query, 'body');
    for (const note of notes) {
      const r = rectFor(note); if (r.x + r.width < keyboardWidth() || r.x > w || r.y + ROW < RULER || r.y > noteBottom) continue;
      const selected = active?.kind !== 'select' && (active?.copyIds ? active.copiedSelection?.has(note.id) : p.selected.has(note.id));
      context.globalAlpha = (0.55 + note.velocity * 0.45) * (ranges.some(range => note.tick >= range.start && note.tick < range.end) ? 1 : .35);
      context.fillStyle = selected ? '#e4f5ec' : p.track.color; context.beginPath(); context.roundRect(r.x + 1, r.y + 1, r.width - 2, r.height, 2); context.fill(); context.globalAlpha = 1;
      context.fillStyle = selected ? '#22342e' : '#152925';
      if (r.width > 30 && ROW >= 12) { context.font = '10px system-ui, sans-serif'; context.fillText(p.drumRows ? rowLabels.get(note.midi)?.mappingName ?? '未映射' : noteName(note.midi), r.x + 5, r.y + 12, Math.max(1,r.width-10)); }
      if (r.width > 12 && ROW >= 6) { context.fillStyle = 'rgba(0,0,0,.2)'; context.fillRect(r.x + r.width - 4, r.y + 3, 1, Math.min(10, ROW - 4)); }
      if (!p.drumRows && !inNoteBlockRange(note.midi + note.detune / 100, (p.instruments ?? INSTRUMENTS).find(instrument => instrument.id === (note.instrumentId ?? p.track.instrumentId))?.rootMidi ?? 66)) { context.fillStyle = '#f0c373'; context.fillRect(r.x + 1, r.y + 1, Math.min(r.width - 2, 12), 2); }
    }
    if (active?.kind === 'select') {
      context.strokeStyle = '#9bbdfb'; context.fillStyle = '#9bbdfb2e';
      const origin = { x: active.origin.x + active.scroll.x - scroll.current.x, y: active.origin.y + active.scroll.y - scroll.current.y };
      const x = Math.min(origin.x, active.point.x), y = Math.min(origin.y, active.point.y), width = Math.abs(active.point.x - origin.x), height = Math.abs(active.point.y - origin.y);
      context.fillRect(x, y, width, height); context.strokeRect(x + .5, y + .5, width, height);
    }
    if (active?.copyIds) { context.fillStyle = '#e4f5ec'; context.font = '11px system-ui, sans-serif'; context.fillText(`复制 ${active.copyIds.size} 个音符 · Esc 取消`, keyboardWidth() + 12, noteBottom - 10); }
    context.strokeStyle = '#9bbdfb'; context.lineWidth = 1;
    for (const range of ranges) {
      const left = keyboardWidth() + range.start * scale() - scroll.current.x, right = keyboardWidth() + range.end * scale() - scroll.current.x;
      context.strokeRect(left + .5, RULER + 1.5, right - left - 1, noteBottom - RULER - 3);
    }
    const sourceEndX = keyboardWidth() + p.pattern.length * scale() - scroll.current.x;
    context.strokeStyle = '#c9ad76'; context.setLineDash([4, 4]); context.beginPath(); context.moveTo(sourceEndX + .5, RULER); context.lineTo(sourceEndX + .5, noteBottom); context.stroke(); context.setLineDash([]);
    if (sourceEndX > keyboardWidth() + 86 && sourceEndX < w + 80) { context.fillStyle = '#c9ad76'; context.font = '10px system-ui, sans-serif'; context.fillText('源片段结束', sourceEndX - 72, noteBottom - 9); }
    context.restore();
    context.fillStyle = '#202631'; context.fillRect(0, 0, w, RULER);
    context.font = '10px system-ui, sans-serif';
    let previousLabelEnd = -Infinity;
    for (const mark of grid) {
      const x = keyboardWidth() + (mark.tick - p.origin) * scale() - scroll.current.x;
      if (x < keyboardWidth() || !mark.label) continue;
      context.strokeStyle = mark.kind === 'bar' ? '#4b596e' : '#354252'; context.beginPath(); context.moveTo(x + .5, 0); context.lineTo(x + .5, RULER); context.stroke();
      const label = mark.signature ? `${mark.label} · ${mark.signature}` : mark.label;
      if (x + 6 < previousLabelEnd) continue;
      context.fillStyle = mark.kind === 'bar' ? '#ebf1fc' : '#a2afc2'; context.fillText(label, x + 6, 17); previousLabelEnd = x + 14 + context.measureText(label).width;
    }
    context.save(); context.beginPath(); context.rect(keyboardWidth(), TIMELINE, w - keyboardWidth(), RULER - TIMELINE); context.clip();
    context.fillStyle = '#171c25'; context.fillRect(keyboardWidth(), TIMELINE, w - keyboardWidth(), RULER - TIMELINE);
    const playback = playbackBounds(), rangeLeft = keyboardWidth() + playback.start * scale() - scroll.current.x, rangeRight = keyboardWidth() + playback.end * scale() - scroll.current.x;
    context.fillStyle = '#384f70'; context.fillRect(rangeLeft, TIMELINE + 1, rangeRight - rangeLeft, RULER - TIMELINE - 2);
    context.strokeStyle = '#9bbdfb'; context.strokeRect(rangeLeft + .5, TIMELINE + 1.5, rangeRight - rangeLeft - 1, RULER - TIMELINE - 3);
    context.fillStyle = p.track.locked ? '#6a7c99' : '#b0cbf1';
    context.fillRect(rangeLeft, TIMELINE + 2, 6, RULER - TIMELINE - 4); context.fillRect(rangeRight - 6, TIMELINE + 2, 6, RULER - TIMELINE - 4);
    const ribbonLabelX = Math.max(keyboardWidth() + 10, rangeLeft + 10);
    if (rangeRight - ribbonLabelX > 94) {
      context.fillStyle = '#e3efff'; context.font = '10px system-ui, sans-serif';
      const label = playingRegion ? `${p.meter.format(playingRegion.start)} — ${p.meter.format(playingRegion.start + playingRegion.length)}${playingRegion.loop ? ' · 循环播放范围' : ' · 播放范围'}` : '副本播放范围';
      context.fillText(label, ribbonLabelX, RULER - 4, Math.max(1, rangeRight - ribbonLabelX - 10));
    }
    context.restore();
    if (!p.drumRows) {
      context.fillStyle = '#aab8ca'; context.font = '10px system-ui, sans-serif';
      context.fillText('音高', 10, 17);
    }
    context.fillStyle = '#181d26'; context.fillRect(0, RULER, keyboardWidth(), noteBottom - RULER);
    for (let row = Math.max(0, Math.floor(scroll.current.y / ROW)); row <= Math.min(127, Math.ceil((scroll.current.y + noteBottom) / ROW)); row++) {
      const midi = 127 - row, y = RULER + row * ROW - scroll.current.y; if (y < RULER - ROW || y > noteBottom) continue;
      context.save(); context.beginPath(); context.rect(0, RULER, keyboardWidth(), noteBottom - RULER); context.clip();
      if (p.drumRows) {
        const row = rowLabels.get(midi), mapped = row?.mapped ?? false;
        context.fillStyle = mapped ? '#344b4e' : '#28313f'; context.fillRect(0,y,keyboardWidth()-1,Math.max(.5,ROW-1));
        if (mapped) { context.fillStyle = '#96d5bc'; context.fillRect(0,y,3,Math.max(.5,ROW-1)); }
      } else {
        const isBlack = black(midi), octave = midi % 12 === 0, height = Math.max(.5, ROW - 1);
        context.fillStyle = octave ? '#e2e7f0' : '#bac3d0';
        context.fillRect(0, y, keyboardWidth() - 1, height);
        if (isBlack) {
          context.fillStyle = '#232c38';
          context.fillRect(0, y, 37, height);
        }
        context.fillStyle = isBlack ? '#c0cad9' : '#344153';
        context.font = '9px system-ui, sans-serif';
        if (ROW >= 12 && (octave || isBlack) || ROW >= 1 && octave) context.fillText(noteName(midi), isBlack ? 5 : 34, y + Math.min(12, ROW));
      }
      context.restore();
    }
    context.fillStyle = '#181e27'; context.fillRect(0, noteBottom, w, VELOCITY);
    context.fillStyle = '#222a36'; context.fillRect(0, noteBottom, keyboardWidth(), VELOCITY);
    context.strokeStyle = '#2b3747';
    for (const level of [.25, .5, .75]) {
      const y = Math.round(h - 10 - level * (VELOCITY - 22)) + .5;
      context.beginPath(); context.moveTo(keyboardWidth(), y); context.lineTo(w, y); context.stroke();
    }
    context.strokeStyle = '#475468'; context.beginPath(); context.moveTo(0, noteBottom + .5); context.lineTo(w, noteBottom + .5); context.stroke();
    context.fillStyle = '#aab8ca'; context.font = '10px system-ui, sans-serif'; context.fillText('力度', 14, noteBottom + 20);
    for (const note of previewPianoNotes(noteIndex(), active?.selection, preview, query, 'velocity')) {
      const x = pianoGridX(note.tick, scroll.current.x, current.current.ppq, current.current.zoom, keyboardWidth()); if (x < keyboardWidth() || x > w) continue;
      const selected = active?.copyIds ? active.copiedSelection?.has(note.id) : p.selected.has(note.id);
      context.strokeStyle = selected ? '#e2f5e9' : p.track.color; context.lineWidth = selected ? 3 : 2;
      const y = h - 10 - note.velocity * (VELOCITY - 22); context.beginPath(); context.moveTo(x + 2, h - 8); context.lineTo(x + 2, y); context.stroke(); context.fillStyle = context.strokeStyle; context.fillRect(x, y - 1, 4, 3);
    }
    context.lineWidth = 1;
    if (p.playhead >= 0) {
      const x = keyboardWidth() + p.playhead * scale() - scroll.current.x;
      if (x >= keyboardWidth() && x < w) { context.strokeStyle = '#eef3ff'; context.beginPath(); context.moveTo(x + .5, 0); context.lineTo(x + .5, h); context.stroke(); context.fillStyle = '#eef3ff'; context.beginPath(); context.moveTo(x - 4, 0); context.lineTo(x + 4, 0); context.lineTo(x, 7); context.fill(); }
    }
  };
  useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => { size.current = { width: entries[0].contentRect.width, height: entries[0].contentRect.height }; navigation.current.measured = true; syncNavigation.current(); setScroll(scroll.current.x, scroll.current.y); publishViewport(); drawRef.current(); });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      // Canvas navigation owns this gesture, including at the scroll limits.
      event.preventDefault(); event.stopPropagation();
      const p = current.current;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
        if (event.deltaY !== 0) resizeRows(rowHeight.current * (event.deltaY < 0 ? 1.1 : .9), event.clientY - element.getBoundingClientRect().top - RULER);
      }
      else if (event.ctrlKey || event.metaKey) {
        cancelDrag();
        const zoom = clampPianoZoom(p.zoom * (event.deltaY < 0 ? 1.1 : .9));
        if (zoom === p.zoom) { pendingView.current = null; return; }
        const anchor = clamp(event.clientX - element.getBoundingClientRect().left - keyboardWidth(), 0, viewportWidth());
        pendingView.current = { x: (scroll.current.x + anchor) * zoom / p.zoom - anchor, y: scroll.current.y, zoom };
        p.onZoom(zoom);
      }
      else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) setScroll(scroll.current.x + (event.deltaX || event.deltaY), scroll.current.y);
      else setScroll(scroll.current.x, scroll.current.y + event.deltaY);
      drawRef.current();
    };
    // React's delegated wheel listener is passive and cannot cancel native scrolling.
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);
  useEffect(() => { drawRef.current(); });
  useLayoutEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => { reducedMotion.current = media?.matches ?? true; if (reducedMotion.current) clearDeletionFeedback(); drawRef.current(); };
    update(); media?.addEventListener?.('change',update);
    return () => { media?.removeEventListener?.('change',update); clearDeletionFeedback(); };
  }, []);
  useLayoutEffect(() => { if (drag.current && !validDrag(drag.current)) cancelDrag(false); }, [props.pattern.id, props.pattern.notes, props.region, props.track.id, props.track.locked, props.gestureOwner]);
  useLayoutEffect(() => { syncNavigation.current(); }, [props.viewKey, props.pattern.id, props.region?.id, props.track.id, props.viewRequest?.id]);
  useLayoutEffect(() => {
    cancelDrag(false); navigation.current.key = undefined; syncNavigation.current();
    setScroll(scroll.current.x, scroll.current.y); drawRef.current();
  }, [!!props.drumRows]);
  useLayoutEffect(() => {
    const pending = pendingView.current;
    if (pending && pending.zoom === props.zoom) { pendingView.current = null; setScroll(pending.x, pending.y); }
    else if (!pending && previousZoom.current !== props.zoom) {
      const center = viewportWidth() / 2; setScroll((scroll.current.x + center) * props.zoom / previousZoom.current - center, scroll.current.y);
    }
    previousZoom.current = props.zoom; publishViewport(); drawRef.current();
  }, [props.zoom]);
  useLayoutEffect(() => {
    if (props.rowHeight !== undefined && props.rowHeight !== rowHeight.current) resizeRows(props.rowHeight);
  }, [props.rowHeight]);
  useEffect(() => { setScroll(scroll.current.x, scroll.current.y); }, [props.pattern.length, props.region?.length, props.region?.offset]);
  useEffect(() => { const blur = () => cancelDrag(); window.addEventListener('blur', blur); return () => window.removeEventListener('blur', blur); }, []);
  useEffect(() => () => cancelAnimationFrame(animation.current), []);
  const contextCurrent = (menu: NoteContextMenu) => {
    const p = current.current;
    return p.pattern.id === menu.patternId && p.pattern.notes === menu.notes && p.track.id === menu.trackId && p.region === menu.region
      && p.gestureOwner === menu.owner && (!p.getGestureOwner || p.getGestureOwner() === menu.owner);
  };
  const closeContextMenu = () => { setContextMenu(null); canvas.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close); window.addEventListener('blur', close);
    const frame = requestAnimationFrame(() => menuElement.current?.querySelector?.<HTMLElement>('button:not(:disabled)')?.focus());
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close); cancelAnimationFrame(frame); };
  }, [contextMenu]);
  useEffect(() => { if (contextMenu && !contextCurrent(contextMenu)) setContextMenu(null); }, [props.pattern.id, props.pattern.notes, props.track.id, props.region, props.gestureOwner, contextMenu]);
  const openContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (current.current.preset !== 'logic') return;
    event.stopPropagation(); cancelDrag();
    let ready = false;
    flushSync(() => { if (current.current.onPrepareGesture?.() === false) return; current.current.onFocus(); ready = true; });
    if (!ready) return;
    const p = current.current, point = position(event), note = point.x >= keyboardWidth() && point.y >= RULER && point.y < size.current.height - VELOCITY ? hit(point.x, point.y) : undefined;
    const ids = note ? p.selected.has(note.id) ? new Set(p.selected) : new Set([note.id]) : new Set(p.selected);
    if (note) p.onSelect(ids);
    setContextMenu({ x: event.clientX, y: event.clientY, ids, notes: p.pattern.notes, patternId: p.pattern.id, trackId: p.track.id, region: p.region, owner: p.gestureOwner });
  };
  const contextEdit = (action: 'delete' | 'duplicate' | 'select-all') => {
    const menu = contextMenu, p = current.current; if (!menu || !contextCurrent(menu)) { closeContextMenu(); return; }
    if (action === 'select-all') { p.onSelect(new Set(p.pattern.notes.map(note => note.id))); closeContextMenu(); return; }
    if (p.track.locked || !menu.ids.size) return;
    if (action === 'delete') { if (p.onEdit('删除音符', notes => notes.filter(note => !menu.ids.has(note.id))) !== false) p.onSelect(new Set()); }
    else {
      const source = menu.notes.filter(note => menu.ids.has(note.id));
      if (!source.length) { closeContextMenu(); return; }
      const start = source.reduce((value, note) => Math.min(value, note.tick), Infinity), end = source.reduce((value, note) => Math.max(value, note.tick + note.duration), 0);
      const added = source.map(note => ({ ...note, id: newNote(0, 0).id, tick: note.tick + Math.max(1, end - start), midiSource: undefined }));
      if (p.onEdit('独立复制音符', notes => [...notes, ...added]) !== false) p.onSelect(new Set(added.map(note => note.id)));
    }
    closeContextMenu();
  };
  const keyboardContextMenu = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (current.current.preset !== 'logic' || event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return false;
    const selected = current.current.pattern.notes.find(note => current.current.selected.has(note.id));
    const note = selected ? rectFor(selected) : undefined, bounds = canvas.current!.getBoundingClientRect();
    const x = note ? clamp(note.x + 4, keyboardWidth() + 4, size.current.width - 4) : keyboardWidth() + 20;
    const y = note ? clamp(note.y + 4, RULER + 4, size.current.height - VELOCITY - 4) : RULER + 20;
    openContextMenu({ clientX: bounds.left + x, clientY: bounds.top + y, preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation() } as React.MouseEvent<HTMLCanvasElement>);
    return true;
  };
  const seekAt = (point: { x: number; y: number }) => {
    const p = current.current;
    p.onSeek(Math.max(0, p.meter.snap(p.origin + toTick(point.x), step())));
  };
  const updateDrag = (active: Drag, point: { x: number; y: number }) => {
    active.point = point;
    if (Math.abs(point.x - active.origin.x) >= 2 || Math.abs(point.y - active.origin.y) >= 2) active.moved = true;
    if (active.kind === 'seek') { seekAt(point); return; }
    if (active.kind === 'pan') { setScroll(active.scroll.x + active.origin.x - point.x, active.scroll.y + active.origin.y - point.y); return; }
    if (active.kind === 'erase') {
      const contentPoint = { x: point.x + scroll.current.x, y: point.y + scroll.current.y };
      const previous = active.erasePoint ?? contentPoint;
      const from = { x: previous.x - scroll.current.x, y: previous.y - scroll.current.y };
      for (const note of notesAlongStroke(noteIndex().query(queryFor(from.x, from.y, point.x, point.y)), from, point, rectFor,
        { x: keyboardWidth(), y: RULER, width: viewportWidth(), height: viewportHeight() }, active.ids)) active.ids.add(note.id);
      active.erasePoint = contentPoint;
      return;
    }
    const dx = point.x - active.origin.x + scroll.current.x - active.scroll.x;
    const dy = active.origin.y - point.y + active.scroll.y - scroll.current.y;
    if ((active.kind === 'trim-start' || active.kind === 'trim-end') && active.region) {
      if (Math.abs(dx) < 2) { active.deltaTick = 0; active.patch = undefined; return; }
      const edge = active.kind === 'trim-start' ? 'start' : 'end';
      const target = current.current.meter.snap(active.anchorTick + dx / scale(), step());
      const plan = planRegionTrim(active.region, current.current.pattern.length, edge, target);
      active.patch = plan.region;
      active.deltaTick = edge === 'start' ? plan.region.start - active.region.start : plan.region.length - active.region.length;
      return;
    }
    const delta = Math.abs(dx) < 2 ? 0 : snap(active.anchorTick + dx / scale()) - active.anchorTick;
    const selected = active.selection;
    const movement = selected?.notes.length ? { tick: Math.max(delta, -selected.minTick), pitch: clamp(Math.round(dy / rowHeight.current), -selected.lowPitch, 127 - selected.highPitch) } : { tick: 0, pitch: 0 };
    const previousPitch = active.deltaPitch;
    active.deltaTick = active.kind === 'resize' ? delta : movement.tick;
    active.deltaPitch = movement.pitch;
    if (movement.pitch !== previousPitch && (active.kind === 'move' || active.kind === 'draw' && current.current.preset === 'fl')) {
      const note = active.added ?? selected?.notes[0];
      if (note) current.current.onAudition(note.midi + movement.pitch, { ...note, midi: note.midi + movement.pitch });
    }
    if (active.kind === 'velocity') active.value = active.velocityMode === 'relative'
      ? active.velocityBounds ? constrainVelocityDelta(active.velocityBounds, (active.origin.y - point.y) / (VELOCITY - 22)) : 0
      : clamp((size.current.height - 10 - point.y) / (VELOCITY - 22), 0, 1);
  };
  const autoScroll = () => {
    animation.current = 0;
    const active = drag.current;
    if (active && !validDrag(active)) { cancelDrag(false); return; }
    if (!active || active.kind === 'pan' || active.kind === 'velocity') return;
    if (!active.moved && active.kind !== 'seek') { animation.current = requestAnimationFrame(autoScroll); return; }
    const { width, height } = size.current, point = active.point;
    const edge = (value: number, start: number, end: number) => value < start + 24 ? -Math.min(18, (start + 24 - value) * .45) : value > end - 24 ? Math.min(18, (value - end + 24) * .45) : 0;
    const dx = edge(point.x, keyboardWidth(), width), dy = active.kind === 'seek' || active.kind.startsWith('trim-') ? 0 : edge(point.y, RULER, height - VELOCITY);
    if (setScroll(scroll.current.x + dx, scroll.current.y + dy)) { updateDrag(active, point); drawRef.current(); }
    animation.current = requestAnimationFrame(autoScroll);
  };
  const beginDrag = (active: Drag) => {
    if (!validDrag(active)) return false;
    if (active.kind === 'erase') active.erasePoint = { x: active.point.x + scroll.current.x, y: active.point.y + scroll.current.y };
    if (active.kind === 'move' || active.kind === 'resize' || active.kind === 'velocity' || active.kind === 'draw') active.selection = new PianoNoteIndex(active.added ? [active.added] : noteIndex().forIds(active.ids));
    if (active.kind === 'velocity') {
      active.velocityBounds = velocityBounds(active.selection!.notes);
      active.velocityMode = active.selection!.notes.length > 1 ? 'relative' : 'absolute';
      if (active.velocityMode === 'relative') active.value = 0;
    }
    drag.current = active; canvas.current?.setPointerCapture(active.pointerId);
    if (drag.current !== active) return false;
    if (!validDrag(active)) { cancelDrag(false); return false; }
    if (!animation.current) animation.current = requestAnimationFrame(autoScroll);
    return true;
  };
  const pointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current || ![0, 1, 2].includes(e.button)) return;
    const before = current.current;
    if (before.getGestureOwner && before.getGestureOwner() !== before.gestureOwner) return;
    e.preventDefault();
    let prepared = false;
    // A numeric blur may commit a new immutable note array. Finish that React
    // event boundary before choosing notes, geometry or the gesture owner.
    flushSync(() => {
      if (current.current.onPrepareGesture?.() === false) return;
      e.currentTarget.focus({ preventScroll: true }); current.current.onFocus(); prepared = true;
    });
    const p = current.current;
    if (!prepared || drag.current || canvas.current !== e.currentTarget || p.getGestureOwner && p.getGestureOwner() !== p.gestureOwner
      || p.viewKey !== before.viewKey || p.pattern.id !== before.pattern.id || p.track.id !== before.track.id || p.region?.id !== before.region?.id) return;
    const point = position(e);
    if (e.button === 2 && p.preset === 'logic') return;
    setContextMenu(null);
    const notes = p.pattern.notes;
    const common = { origin: point, point, scroll: { ...scroll.current }, pointerId: e.pointerId, notes, ids: new Set<string>(), anchorTick: 0, deltaTick: 0, deltaPitch: 0, value: 0,
      selectionBefore: new Set(p.selected), target: { patternId: p.pattern.id, trackId: p.track.id, region: p.region, owner: p.gestureOwner } };
    if (e.button === 1) { if (beginDrag({ ...common, kind: 'pan' })) canvas.current!.style.cursor = 'grabbing'; return; }
    if (point.x < keyboardWidth()) { if (e.button === 0 && point.y > RULER && point.y < size.current.height - VELOCITY) p.onAudition(toPitch(point.y)); return; }
    if (point.y < RULER) {
      if (e.button === 0) {
        const bounds = playbackBounds(), startX = keyboardWidth() + bounds.start * scale() - scroll.current.x, endX = keyboardWidth() + bounds.end * scale() - scroll.current.x;
        const trimStart = point.y >= TIMELINE && Math.abs(point.x - startX - 3) <= 7, trimEnd = point.y >= TIMELINE && Math.abs(point.x - endX + 3) <= 7;
        if (p.region && !p.track.locked && (trimStart || trimEnd)) {
          const edge = trimStart && (!trimEnd || point.x < (startX + endX) / 2) ? 'start' : 'end';
          beginDrag({ ...common, kind: edge === 'start' ? 'trim-start' : 'trim-end', region: { ...p.region }, anchorTick: edge === 'start' ? p.region.start : p.region.start + p.region.length });
        } else if (beginDrag({ ...common, kind: 'seek' })) seekAt(point);
      }
      return;
    }
    if (p.track.locked) return;
    const existing = hit(point.x, point.y);
    if (point.y >= size.current.height - VELOCITY) {
      if (e.button !== 0) return;
      const window = queryFor(point.x - 8, point.y, point.x + 8, point.y);
      const nearby = noteIndex().starts(window.start, window.end).filter(n => Math.abs(rectFor(n).x - point.x) < 8).sort((a, b) => Number(p.selected.has(b.id)) - Number(p.selected.has(a.id)))[0];
      if (!nearby) return;
      const ids = p.selected.has(nearby.id) ? new Set(p.selected) : new Set([nearby.id]); p.onSelect(ids);
      beginDrag({ ...common, kind: 'velocity', ids, value: clamp((size.current.height - 10 - point.y) / (VELOCITY - 22), 0, 1) });
    } else if (e.button === 2) {
      beginDrag({ ...common, kind: 'erase', ids: new Set(existing ? [existing.id] : []) });
    } else if (e.ctrlKey || e.metaKey || e.shiftKey || p.tool === 'select' && !existing) {
      if (!beginDrag({ ...common, kind: 'select', ids: e.shiftKey ? new Set(p.selected) : new Set() })) return;
      if (!e.shiftKey) p.onSelect(new Set());
    } else if (p.tool === 'erase') {
      beginDrag({ ...common, kind: 'erase', ids: new Set(existing ? [existing.id] : []) });
    } else if (existing) {
      const ids = p.selected.has(existing.id) ? new Set(p.selected) : new Set([existing.id]);
      p.onSelect(ids);
      const copy = p.preset === 'logic' && e.altKey;
      const rect = rectFor(existing), resize = !copy && point.x >= rect.x + rect.width - noteResizeHandleWidth(rect.width);
      const copyIds = copy ? new Map(notes.filter(note => ids.has(note.id)).map(note => [note.id, newNote(0, 0).id])) : undefined;
      if (!beginDrag({ ...common, kind: resize ? 'resize' : 'move', anchorTick: existing.tick + (resize ? existing.duration : 0), ids, ...(copyIds ? { copyIds, copiedSelection: new Set(copyIds.values()) } : {}) })) return;
      if (copy) e.currentTarget.style.cursor = 'copy';
      p.onAudition(existing.midi, existing);
    } else {
      const added = newNote(snap(toTick(point.x)), toPitch(point.y), Math.max(1, p.ppq * 4 / p.noteLength));
      if (!beginDrag({ ...common, kind: 'draw', anchorTick: added.tick, ids: new Set([added.id]), added })) return; p.onSelect(new Set([added.id])); p.onAudition(added.midi, added);
    }
    drawRef.current();
  };
  const pointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const active = drag.current, point = position(e);
    if (!active) {
      const note = point.y >= RULER && point.y < size.current.height - VELOCITY ? hit(point.x, point.y) : undefined;
      const rect = note && rectFor(note);
      e.currentTarget.style.cursor = point.x < keyboardWidth() ? 'pointer' : point.y < RULER ? 'ew-resize' : rect ? e.altKey && current.current.preset === 'logic' ? 'copy' : point.x >= rect.x + rect.width - noteResizeHandleWidth(rect.width) ? 'ew-resize' : 'move' : 'crosshair';
      return;
    }
    if (active.pointerId !== e.pointerId) return;
    if (!validDrag(active)) { cancelDrag(false); return; }
    updateDrag(active, point);
    drawRef.current();
  };
  const pointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const active = drag.current; if (!active) return;
    if (active.pointerId !== e.pointerId) return;
    if (!validDrag(active)) { cancelDrag(false); return; }
    updateDrag(active, position(e));
    const added = active.kind === 'draw' ? placedNote(active) : undefined;
    drag.current = null;
    cancelAnimationFrame(animation.current); animation.current = 0;
    if (canvas.current?.hasPointerCapture(e.pointerId)) canvas.current.releasePointerCapture(e.pointerId);
    if (canvas.current) canvas.current.style.cursor = '';
    // Capture release can synchronously deliver history/document changes.
    if (!validDrag(active)) { drawRef.current(); return; }
    const p = current.current;
    const edit = (label: string, change: (notes: Note[]) => Note[]) => {
      const accepted = p.onEdit(label, change) !== false;
      if (!accepted && active.kind === 'erase') { deletion.current.remove(erasePreviewed.current); erasePreviewed.current.clear(); }
      if (!accepted && validDrag(active)) current.current.onSelect(new Set(active.selectionBefore));
      return accepted;
    };
    if ((active.kind === 'trim-start' || active.kind === 'trim-end') && active.region && active.deltaTick) p.onTrimRegion(active.region.id, active.kind === 'trim-start' ? 'start' : 'end', active.anchorTick + active.deltaTick);
    else if (active.kind === 'select') {
      const origin = { x: active.origin.x + active.scroll.x - scroll.current.x, y: active.origin.y + active.scroll.y - scroll.current.y };
      const x1 = Math.min(origin.x, active.point.x), x2 = Math.max(origin.x, active.point.x), y1 = Math.min(origin.y, active.point.y), y2 = Math.max(origin.y, active.point.y);
      for (const n of noteIndex().query(queryFor(x1, y1, x2, y2))) { const r = rectFor(n); if (r.x <= x2 && r.x + r.width >= x1 && r.y <= y2 && r.y + r.height >= y1) active.ids.add(n.id); }
      p.onSelect(active.ids);
    } else if (active.kind === 'draw' && added) edit('绘制音符', notes => [...notes, added]);
    else if (active.kind === 'erase' && active.ids.size) { if (edit('擦除音符', notes => notes.filter(n => !active.ids.has(n.id)))) p.onSelect(new Set([...p.selected].filter(id => !active.ids.has(id)))); }
    else if (active.kind === 'velocity' && (active.velocityMode !== 'relative' || active.value !== 0)) edit('调整力度', notes => changeNoteVelocities(notes, active.ids, active.value, active.velocityMode));
    else if ((active.kind === 'move' || active.kind === 'resize') && (active.deltaTick || active.kind === 'move' && active.deltaPitch)) {
      const kind = active.kind;
      if (active.copyIds && kind === 'move') {
        const copied = dragNotes(active.selection!.notes, active.ids, 'move', active.deltaTick, active.deltaPitch).map(note => ({ ...note, id: active.copyIds!.get(note.id)!, midiSource: undefined }));
        if (edit('拖动复制音符', notes => [...notes, ...copied])) p.onSelect(new Set(copied.map(note => note.id)));
      } else edit(kind === 'move' ? '移动音符' : '调整显示时值', notes => dragNotes(notes, active.ids, kind, active.deltaTick, active.deltaPitch));
    }
    drawRef.current();
  };
  return <div className="piano-surface" data-testid="piano-roll" data-keyboard-width={pianoRowHeaderWidth(!!props.drumRows)} data-range-guide={props.drumRows ? 'mapped-output' : 'instrument-root'} data-row-mode={props.drumRows ? 'drums' : 'piano'} onFocus={props.onFocus}><div className="piano-viewport" ref={container}><canvas id={canvasId} ref={canvas} data-keyboard-width={pianoRowHeaderWidth(!!props.drumRows)} data-range-min={noteBlockMidiRange((props.instruments ?? INSTRUMENTS).find(instrument=>instrument.id===props.track.instrumentId)?.rootMidi).min} data-range-max={noteBlockMidiRange((props.instruments ?? INSTRUMENTS).find(instrument=>instrument.id===props.track.instrumentId)?.rootMidi).max} data-zoom={props.zoom} data-row-height={rowHeight.current} data-scroll-x={scroll.current.x} data-scroll-y={scroll.current.y} tabIndex={0} title={props.drumRows ? '背景按映射后的实际子音符判断：范围外更暗；部分超出时半暗。触发编号不作为实际音高。' : '背景按当前轨道／绘制乐器的采样基准判断原版调音范围；范围外更暗，仍可自由编辑。'} aria-label={`${props.drumRows ? '鼓组触发卷帘，GM 编号从高到低。' : '钢琴卷帘。'}${props.preset === 'fl' ? '按下放置新音符后拖动可移动位置和音高；' : ''}拖动音符右边缘调整时值；按住标尺拖动定位；标尺下范围带的左右手柄裁剪当前副本；中键拖动平移；${props.preset === 'logic' ? '右键打开音符菜单；Alt / Option 拖动复制音符' : '右键擦除'}；Ctrl / Cmd 从音符、右边缘或空白处框选并替换选择，Shift 框选或与 Ctrl / Cmd 同按时追加选择；Esc 取消当前拖动；Ctrl / Cmd 加滚轮横向缩放，配合 Shift 纵向缩放；力度区多选拖动保留差值，检查器可统一设置力度。绿色框为当前副本播放范围，虚线为源片段结束。`} onContextMenu={openContextMenu} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onKeyDown={e => { if (keyboardContextMenu(e)) return; if (e.key === 'Escape' && drag.current) { e.preventDefault(); e.stopPropagation(); cancelDrag(); } }} onBlur={() => cancelDrag()} onPointerCancel={e => { if (drag.current?.pointerId === e.pointerId) cancelDrag(); }} onLostPointerCapture={e => { if (drag.current?.pointerId === e.pointerId) cancelDrag(); }} /></div>{contextMenu && <div ref={menuElement} className="audio-region-menu context-menu piano-context-menu" data-glass-surface="menu" role="menu" aria-label="音符编辑菜单" tabIndex={-1} style={{ "--context-x": contextMenu.x + "px", "--context-y": contextMenu.y + "px" } as React.CSSProperties} onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setContextMenu(null); }} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); closeContextMenu(); return; }
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    }}><button role="menuitem" disabled={props.track.locked || !contextMenu.ids.size} onClick={() => contextEdit('duplicate')}>独立复制所选音符</button><button className="context-danger" role="menuitem" disabled={props.track.locked || !contextMenu.ids.size} onClick={() => contextEdit('delete')}>删除所选音符</button><button role="menuitem" disabled={!props.pattern.notes.length} onClick={() => contextEdit('select-all')}>全选音符</button><small>Alt / Option 拖动复制 · Esc 关闭</small></div>}{props.drumRows && <><button type="button" data-testid="locate-mapped-drums" disabled={!props.drumRows.some(row=>row.mapped)} style={{position:'absolute',top:3,left:4,width:pianoRowHeaderWidth(true)-8,height:21,padding:'1px 4px',fontSize:10,zIndex:1}} onClick={()=>{const notes=current.current.drumRows!.filter(row=>row.mapped).map(row=>newNote(0,row.midi)); if(!notes.length)return;cancelDrag();const plan=planPianoView({notes,ppq:props.ppq,width:viewportWidth(),height:viewportHeight(),zoom:props.zoom,mode:'locate'});rowHeight.current=plan.rowHeight;setScroll(scroll.current.x,plan.y);props.onRowHeight?.(plan.rowHeight);publishViewport();drawRef.current();}}>定位已映射 · {props.drumRows.filter(row=>row.mapped).length}</button><div role="list" aria-label="GM 触发行（MIDI 从高到低）" className="drum-row-headers" style={{position:'absolute',left:0,top:RULER,width:pianoRowHeaderWidth(true),height:Math.max(0,viewport.height-RULER-VELOCITY),overflow:'hidden'}} onWheel={event=>{event.stopPropagation();setScroll(scroll.current.x,scroll.current.y+event.deltaY);}}>{visibleDrumRows(props.drumRows,viewport.y,viewport.rowHeight,Math.max(0,viewport.height-RULER-VELOCITY)).map(row=><div key={row.midi} role="listitem" data-testid="drum-row-header" className="drum-row-header" data-midi={row.midi} data-mapped={row.mapped} data-range={row.range ?? 'unmapped'} data-condensed={viewport.rowHeight<12} title={`${row.mappingName ?? (row.mapped ? '未命名映射' : '未映射')} · ${row.label} · ${noteName(row.midi)} / MIDI ${row.midi} · ${row.range === 'in' ? '全部实际子音符在原版音域内' : row.range === 'mixed' ? '部分实际子音符超出原版音域' : row.range === 'out' ? '全部实际子音符超出原版音域' : '未映射：没有实际输出'}`} style={{position:'absolute',left:0,top:(127-row.midi)*viewport.rowHeight-viewport.y,height:viewport.rowHeight,width:pianoRowHeaderWidth(true),fontSize:viewport.rowHeight>=12?11:0}} onPointerDown={event=>{if(event.button===0){event.preventDefault();props.onFocus();props.onAudition(row.midi);}}}><span className="drum-row-name">{row.mappingName ?? (row.mapped ? '未命名映射' : '未映射')}</span><span className="drum-row-key">{noteName(row.midi)} · {row.midi}</span><span className="sr-only">{row.label} · {row.mapped ? '已映射' : '未映射'}</span></div>)}</div></>}<EditorScrollbar orientation="vertical" label="钢琴卷帘垂直滚动" controls={canvasId} value={viewport.y} viewportSize={Math.max(1, viewport.height - RULER - VELOCITY)} contentSize={rowHeight.current * 128} onChange={value => setScroll(scroll.current.x, value)} /><EditorScrollbar orientation="horizontal" label="钢琴卷帘水平滚动" controls={canvasId} value={viewport.x} viewportSize={Math.max(1, viewport.width - keyboardWidth())} contentSize={contentWidth()} onChange={value => setScroll(value, scroll.current.y)} /><span className="piano-scroll-corner" aria-hidden="true" /></div>;
}
