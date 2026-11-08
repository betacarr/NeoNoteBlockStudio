import { planAudioSplit, type AudioTrimEdge } from '../core/audio-region-edit';
import { inspectTrackDelete } from '../core/track-management';
import { visibleFirstBeat, type AudioTempoAction } from '../core/audio-tempo';
import { AudioRegion } from './AudioRegion';
import { ARRANGEMENT_AUDIO_FORMAT_LABEL, audioTrackChildren, audioTrackParents } from '../core/audio-clips';
import { midiRegionChords, regionChords, type ChordGroupEdit, type ChordTrackPosition, type RegionChordAction } from '../core/chord-track';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CaretDown, CaretRight, LockSimple, Plus } from '@phosphor-icons/react';
import type { AudioClip, Pattern, Project, Region, ShortcutPreset, Track } from '../core/types';
import { playbackEndTick, type WaveformPeaks } from '../core/reference';
import type { MeterMap } from '../core/meter';
import { filterTracks } from '../core/track-filter';
import { InstrumentBlock } from './InstrumentBlock';
import { ReferenceHeader, ReferenceLane } from './ReferenceTrack';
import { regionPreviewGeometry } from './arrangement-preview';
import { regionDragPreview, type RegionDragPreview } from './region-drag-preview';
import { ArrangementNoteCache } from './arrangement-note-cache';
import { captureEditorPointer } from './pointer-capture';
import { startHorizontalEdgeScroll, startVerticalEdgeScroll } from './edge-scroll';
import { arrangementTrackAt } from './arrangement-track-drop';
import { ArrangementGroupGesture, type ArrangementGestureContext, type ArrangementGroupPreview, type ArrangementGroupRegionPreview } from './arrangement-group-gesture';
import type { RegionMove } from '../core/region-batch';
import { useChordGroupGesture } from './chord-group-gesture';

function MiniNotes({ pattern, region, offset, width, regionWidth, indexes, prepend = 0 }: { pattern: Pattern; region: Region; offset: number; width: number; regionWidth: number; indexes: ArrangementNoteCache; prepend?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const index = indexes.get(pattern.id)!;
  const pitchCenter = (index.lowPitch + index.highPitch) / 2;
  const lowPitch = Math.min(index.lowPitch, pitchCenter - 6), highPitch = Math.max(index.highPitch, pitchCenter + 6);
  useLayoutEffect(() => {
    const element = ref.current!;
    const draw = () => {
      const w = element.clientWidth, h = element.clientHeight, dpr = window.devicePixelRatio || 1;
      if (!w || !h) return;
      element.width = w * dpr; element.height = h * dpr; const c = element.getContext('2d')!; c.scale(dpr, dpr);
      c.fillStyle = '#f4f8f1bf';
      // A left extension will prepend source silence on commit. Apply that shift
      // to the preview origin, without cloning a potentially large note array.
      const geometry = regionPreviewGeometry(pattern, prepend ? { ...region, offset: region.offset - prepend } : region, { offset, width: w, regionWidth }, index);
      for (const note of geometry.notes) c.fillRect(note.x, 19 + (highPitch - note.midi) / (highPitch - lowPitch + 1) * Math.max(0, h - 24), note.width, 2);
      c.strokeStyle = '#ffffff42';
      for (const x of geometry.dividers) { c.beginPath(); c.moveTo(x, 17); c.lineTo(x, h); c.stroke(); }
    };
    const observer = new ResizeObserver(draw); observer.observe(element); draw(); return () => observer.disconnect();
  }, [pattern, region, offset, width, regionWidth, prepend, highPitch, lowPitch, index]);
  return <canvas ref={ref} className="region-notes" style={{ left: offset, width }} />;
}
interface Props {
  onTrackDelete?: (id:string)=>void;
  onAddDrumTrack?: () => void;
  showChordTrack?: boolean;
  onToggleChordTrack?: () => void;
  onEditGlobalChord?: (groupStart: number, chordStart: number) => void;
  onCreateGlobalChord?: (tick?: number) => void;
  onDeleteGlobalChord?: (groupStart: number, chordStart: number) => void;
  selectedGlobalChord?: ChordTrackPosition;
  onSelectGlobalChord?: (position?: ChordTrackPosition) => void;
  onEditChordGroup?: (project: Project, groupStart: number, edit: ChordGroupEdit, tick: number) => void;
  audioPeaks?: Record<string, WaveformPeaks>;
  onAudioDrop?: (files:File[], tick:number, trackId?:string)=>void;
  onImportAudio?: (trackId: string) => void;
  onFilesDrop?: (files:File[], tick:number, trackId?:string)=>void;
  selectedAudioClips?: ReadonlySet<string>;
  onAudioSelect?: (ids: Set<string>, primaryId?: string) => void;
  hasUsedStemSplitter?: boolean;
  preset?: ShortcutPreset;
  cycleRange?: { start: number; end: number };
  cycleEnabled?: boolean;
  onCycleChange?: (range: { start: number; end: number }) => void;
  onMidiChordAction?: (region: Region, action: RegionChordAction, ids?: ReadonlySet<string>) => void;
  onAudioTrim?: (id: string, edge: AudioTrimEdge, tick: number) => void;
  onAudioMove?: (id:string,start:number,trackId:string)=>void;
  onAudioAction?: (clip:AudioClip,action:'split'|'split-at-playhead'|'export-wav'|'mute'|'delete'|'relink'|'chords'|'edit-chords'|'apply-chords'|'read-chords'|'drop-chords'|AudioTempoAction)=>void;
  project: Project; meter: MeterMap; snap: number; selectedRegion: string; selectedTrack: string; zoom: number; playhead: number;
  gestureOwner?: object; getGestureOwner?: () => object;
  instrumentFilter?: string;
  selectedRegions?: ReadonlySet<string>;
  onRegionSelection?: (ids: Set<string>, primaryId?: string) => void;
  onRegionGroupChange?: (changes: RegionMove[]) => void;
  onRegionGroupCopy?: (changes: RegionMove[]) => void;
  onRegionAction?: (region: Region, action: 'copy' | 'cut' | 'paste' | 'delete' | 'duplicate') => void;
  onNumberPending?: (field: string, pending: boolean) => void;
  onGestureMessage?: (message: string) => void;
  onSelect: (region: Region) => void; onTrack: (track: Track) => void;
  onTrackOpen?: (track: Track) => void;
  onTrackChange: (id: string, patch: Partial<Track>) => void;
  onRegionChange: (id: string, patch: Partial<Region>) => void;
  onTrimRegion: (id: string, edge: 'start' | 'end', tick: number) => void;
  onAddTrack: () => void; onCreateRegion: (trackId: string, tick: number) => void; onSeek: (tick: number) => void; onFocus: () => void;
  referencePeaks?: WaveformPeaks;
  onReferenceChange: (patch: { startTick?: number; gain?: number }) => void; onReferenceRemove: () => void;
}
type Drag = {
  region: Region; x: number; scroll: number; pointer: number; edge: 'start' | 'end' | null; stop: () => void;
  copying: boolean;
  clientX: number; clientY: number; y: number; moved: boolean; scroller?: ReturnType<typeof startHorizontalEdgeScroll>;
  scrollY: number; lastScrollTop: number; verticalScroller?: ReturnType<typeof startVerticalEdgeScroll>;
  onPreviewExtent?: (owner: object, endTick?: number) => void;
  onTrackDropPreview?: (owner: object, trackId?: string, blocked?: boolean) => void;
  target: { region: Region; patternId: string; notes: Pattern['notes']; sourceLength: number; trackId: string; scale: number; meter: MeterMap; step: number; owner?: object; scroll: HTMLDivElement | null; element: HTMLDivElement; tracks: readonly Track[]; trackTop: number };
};
type TrackPreview = RegionDragPreview & { track?: Track; offsetY: number; blocked: boolean };
interface RegionClipProps {
  pattern: Pattern; region: Region; track: Track; scale: number; meter: MeterMap; step: number;
  tracks: readonly Track[]; trackTop: number;
  selected: boolean; scroll: React.RefObject<HTMLDivElement | null>;
  left: number; viewportWidth: number; visibleLane: boolean;
  indexes: ArrangementNoteCache;
  gestureOwner?: object; getGestureOwner?: () => object;
  onPreviewExtent?: (owner: object, endTick?: number) => void;
  onTrackDropPreview?: (owner: object, trackId?: string, blocked?: boolean) => void;
  selectedRegions?: ReadonlySet<string>;
  externalPreview?: ArrangementGroupRegionPreview; externalLabel?: string;
  onMarqueeStart?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onGroupMoveStart?: (event: React.PointerEvent<HTMLDivElement>, region: Region) => void;
  onToggleSelect?: (region: Region) => void;
  onSelectOnly?: (region: Region) => void;
  preset?: ShortcutPreset;
  onCopy?: (changes: RegionMove[]) => void;
  onContextMenu?: (region: Region, x: number, y: number) => void;
  chordMenuAvailable?: boolean;
  onChordDrop?: (region: Region, x: number, y: number) => boolean;
  isGroupGestureActive?: () => boolean;
  onSelect: Props['onSelect']; onFocus: Props['onFocus']; onRegionChange: Props['onRegionChange']; onTrimRegion: Props['onTrimRegion'];
}

function RegionClip({ pattern, region, track, tracks, trackTop, scale, meter, step, selected, selectedRegions, externalPreview, externalLabel, onMarqueeStart, onGroupMoveStart, onToggleSelect, onSelectOnly, preset, onCopy, onContextMenu, chordMenuAvailable, onChordDrop, isGroupGestureActive, scroll, left, viewportWidth, visibleLane, indexes, gestureOwner, getGestureOwner, onPreviewExtent, onTrackDropPreview, onSelect, onFocus, onRegionChange, onTrimRegion }: RegionClipProps) {
  const drag = useRef<Drag | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const current = useRef({ pattern, region, track, tracks, trackTop, scale, meter, step, scroll, gestureOwner, getGestureOwner });
  current.current = { pattern, region, track, tracks, trackTop, scale, meter, step, scroll, gestureOwner, getGestureOwner };
  const [localPreview, setPreview] = useState<TrackPreview | null>(null);
  const preview = externalPreview ?? localPreview;
  const copying = !!preview && (externalPreview?.copying || drag.current?.copying);
  const shown = preview?.region ?? region;
  const regionWidth = Math.max(12, shown.length * scale), contentLeft = shown.start * scale + 1;
  const previewStart = Math.max(0, left - contentLeft - 2), previewEnd = Math.min(regionWidth - 2, left + viewportWidth - contentLeft + 2);
  const planFor = (active: Drag, x: number, y: number) => {
    const pixels = x - active.x + (scroll.current?.scrollLeft ?? 0) - active.scroll;
    const origin = active.edge === 'end' ? active.region.start + active.region.length : active.region.start;
    const tick = Math.abs(pixels) < 2 ? origin : active.target.meter.snap(origin + pixels / active.target.scale, active.target.step);
    const base = regionDragPreview(active.region, active.target.sourceLength, active.edge, tick);
    if (active.edge) return { tick, preview: { ...base, offsetY: 0, blocked: false } as TrackPreview };
    const element = active.target.scroll, bounds = element?.getBoundingClientRect();
    const destination = element && bounds ? arrangementTrackAt(active.target.tracks, y, {
      top: bounds.top + element.clientTop, height: element.clientHeight, scrollTop: element.scrollTop, trackTop: active.target.trackTop,
    }) : undefined;
    const outsideX = destination?.id !== active.region.trackId && element && bounds
      && (x < bounds.left + element.clientLeft || x >= bounds.left + element.clientLeft + element.clientWidth);
    const nextTrack = outsideX ? undefined : destination;
    const offsetY = nextTrack ? (active.target.tracks.findIndex(item => item.id === nextTrack.id) - active.target.tracks.findIndex(item => item.id === active.region.trackId)) * 52 : 0;
    return { tick, preview: { ...base, region: { ...base.region, trackId: nextTrack?.id ?? active.region.trackId }, track: nextTrack, offsetY, blocked: !nextTrack || nextTrack.locked } };
  };
  const valid = (active: Drag) => {
    const p = current.current, t = active.target, original = active.region;
    return !p.track.locked && p.track.id === t.trackId && p.region === t.region
      && p.region.id === original.id && p.region.trackId === original.trackId && p.region.patternId === original.patternId
      && p.region.start === original.start && p.region.length === original.length && p.region.offset === original.offset && p.region.loop === original.loop
      && p.pattern.id === t.patternId && p.pattern.notes === t.notes && p.pattern.length === t.sourceLength
      && p.scale === t.scale && p.meter === t.meter && p.step === t.step
      && p.tracks === t.tracks && p.trackTop === t.trackTop
      && p.scroll.current === t.scroll && element.current === t.element
      && p.gestureOwner === t.owner && (!p.getGestureOwner || p.getGestureOwner() === t.owner);
  };
  const finish = (clearPreview = true) => {
    const active = drag.current; if (!active) return;
    drag.current = null;
    if (clearPreview) setPreview(null);
    active.scroller?.stop();
    active.verticalScroller?.stop();
    active.stop();
    active.onPreviewExtent?.(active, undefined);
    active.onTrackDropPreview?.(active);
  };
  const movedFromAnchor = (active: Drag, x: number, y: number) => Math.abs(x - active.x) >= 2 || Math.abs(y - active.y) >= 2
    || (active.target.scroll?.scrollLeft ?? 0) !== active.scroll || (active.target.scroll?.scrollTop ?? 0) !== active.scrollY;
  const updatePreview = (active: Drag) => {
    if (drag.current !== active) return;
    if (!valid(active)) { finish(); return; }
    active.moved ||= movedFromAnchor(active, active.clientX, active.clientY);
    if (!active.moved) return;
    active.lastScrollTop = active.target.scroll?.scrollTop ?? 0;
    const next = planFor(active, active.clientX, active.clientY).preview;
    setPreview(previous => previous && previous.region.start === next.region.start && previous.region.length === next.region.length && previous.region.offset === next.region.offset && previous.prepend === next.prepend && previous.track === next.track && previous.blocked === next.blocked && previous.offsetY === next.offsetY ? previous : next);
    if (active.moved) {
      active.onPreviewExtent?.(active, next.blocked ? undefined : next.region.start + next.region.length);
      if (drag.current !== active) return;
      if (!valid(active)) { finish(); return; }
      if (!active.edge) active.onTrackDropPreview?.(active, next.track?.id, next.blocked);
    }
    if (drag.current === active && !valid(active)) finish();
  };
  useLayoutEffect(() => {
    const active = drag.current; if (!active) return;
    if (!valid(active)) finish();
    else if ((active.target.scroll?.scrollTop ?? 0) !== active.lastScrollTop) updatePreview(active);
  });
  useEffect(() => () => finish(false), []);
  return <div ref={element} tabIndex={-1} data-testid="region" data-region-id={region.id} data-track-id={region.trackId} data-drop-track-id={preview?.track?.id} data-drop-blocked={preview?.blocked || undefined} data-copy-preview={copying || undefined} className={`region ${selected ? 'selected' : ''}${preview ? ' dragging' : ''}${preview?.blocked ? ' drop-blocked' : ''}`} style={{ left: shown.start * scale, width: regionWidth, '--region-color': preview?.track?.color ?? track.color, transform: preview?.offsetY ? `translateY(${preview.offsetY}px)` : undefined, overflow: copying ? 'visible' : undefined } as React.CSSProperties} title={preset === 'logic' ? '拖动移动片段；Alt / Option 拖动复制；拖动左右手柄裁剪；Esc 取消' : '拖动移动片段到其它轨道；拖动左右手柄裁剪；Esc 取消当前拖动'}
    onContextMenu={event => { if (preset !== 'logic' && !chordMenuAvailable || !onContextMenu) return; event.preventDefault(); event.stopPropagation(); onFocus(); if (!selected) onSelectOnly?.(region); onContextMenu(region, event.clientX, event.clientY); }}
    onKeyDown={event => { if ((preset === 'logic' || chordMenuAvailable) && onContextMenu && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); onFocus(); if (!selected) onSelectOnly?.(region); onContextMenu(region, bounds.left, bounds.bottom); } }}
    onPointerDown={event => {
      if (drag.current || isGroupGestureActive?.() || getGestureOwner && getGestureOwner() !== gestureOwner) return;
      event.stopPropagation();
      if (event.button === 0 && (event.ctrlKey || event.metaKey) && onMarqueeStart) { event.preventDefault(); onFocus(); onMarqueeStart(event); return; }
      if (event.button === 0 && event.shiftKey && onToggleSelect) { event.preventDefault(); onToggleSelect(region); onFocus(); return; }
      const handle = event.target as HTMLElement, edge = handle.classList.contains('region-resize');
      if (edge && onSelectOnly) onSelectOnly(region); else onSelect(region);
      onFocus();
      if (event.button !== 0) return;
      event.preventDefault();
      if (!edge && selectedRegions && selectedRegions.size > 1 && selectedRegions.has(region.id) && onGroupMoveStart) { onGroupMoveStart(event, region); return; }
      if (track.locked) return;
      const active: Drag = { region: { ...region }, copying: !edge && preset === 'logic' && event.altKey && !!onCopy, x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY, scrollY: scroll.current?.scrollTop ?? 0, lastScrollTop: scroll.current?.scrollTop ?? 0, moved: false, onPreviewExtent, onTrackDropPreview, scroll: scroll.current?.scrollLeft ?? 0, pointer: event.pointerId, edge: handle.classList.contains('region-resize') ? handle.classList.contains('region-resize-start') ? 'start' : 'end' : null, stop: () => {},
        target: { region, patternId: pattern.id, notes: pattern.notes, sourceLength: pattern.length, trackId: track.id, scale, meter, step, owner: gestureOwner, scroll: scroll.current, element: event.currentTarget, tracks, trackTop } };
      drag.current = active;
      const stop = captureEditorPointer(event.currentTarget, event.pointerId, () => finish());
      if (drag.current === active) { active.stop = stop; if (!valid(active)) finish(); }
      else stop();
    }}
    onPointerMove={event => {
      const active = drag.current; if (!active || active.pointer !== event.pointerId) return;
      if (!valid(active)) { finish(); return; }
      active.clientX = event.clientX;
      active.clientY = event.clientY;
      updatePreview(active);
      if (drag.current !== active) return;
      active.scroller?.move(active.clientX);
      active.verticalScroller?.move(active.clientY);
      if (active.moved && !active.scroller && active.target.scroll) {
        const scroller = startHorizontalEdgeScroll(active.target.scroll, active.clientX, {
          isActive: () => { if (drag.current !== active) return false; if (valid(active)) return true; finish(); return false; },
          onScroll: () => updatePreview(active),
        });
        if (drag.current === active) active.scroller = scroller; else scroller.stop();
      }
      if (active.moved && !active.edge && !active.verticalScroller && active.target.scroll && active.target.scroll.scrollHeight > active.target.scroll.clientHeight) {
        const scroller = startVerticalEdgeScroll(active.target.scroll, active.clientY, {
          isActive: () => { if (drag.current !== active) return false; if (valid(active)) return true; finish(); return false; },
          onScroll: () => updatePreview(active),
        });
        if (drag.current === active) active.verticalScroller = scroller; else scroller.stop();
      }
    }}
    onPointerUp={event => {
      const active = drag.current; if (!active || active.pointer !== event.pointerId) return;
      if (!valid(active)) { finish(); return; }
      // Selecting a clip can resize the heading and move the viewport under a
      // stationary pointer. Only a real pointer/scroll displacement is a drag.
      if (!active.moved && !movedFromAnchor(active, event.clientX, event.clientY)) { finish(); return; }
      const { tick, preview: next } = planFor(active, event.clientX, event.clientY);
      finish();
      // Releasing capture may synchronously dispatch another edit or teardown.
      if (!valid(active)) return;
      if (!active.edge && !active.copying && onChordDrop?.(region, event.clientX, event.clientY)) return;
      if (next.blocked) return;
      if (next.region.start !== active.region.start || next.region.length !== active.region.length || next.region.trackId !== active.region.trackId) {
        if (active.edge) onTrimRegion(region.id, active.edge, tick);
        else if (active.copying) onCopy?.([{ id: region.id, start: next.region.start, trackId: next.region.trackId }]);
        else onRegionChange(region.id, { start: next.region.start, ...(next.region.trackId !== active.region.trackId ? { trackId: next.region.trackId } : {}) });
      }
    }}
    onPointerCancel={event => { if (drag.current?.pointer === event.pointerId) finish(); }} onLostPointerCapture={event => { if (drag.current?.pointer === event.pointerId) finish(); }}>
    {copying && <div data-testid="region-copy-origin" aria-hidden="true" style={{ position: 'absolute', left: (region.start - shown.start) * scale, top: -(preview?.offsetY ?? 0), width: Math.max(12, region.length * scale), height: 44, '--region-color': track.color, background: 'color-mix(in srgb, var(--region-color) 49%, #202832)', border: '1px dashed #def8e8', borderRadius: 4, opacity: .6, pointerEvents: 'none', overflow: 'hidden' } as React.CSSProperties}><span className="region-label">{pattern.name}</span></div>}
    {(visibleLane || !!preview?.track) && previewEnd > previewStart && <MiniNotes pattern={pattern} region={shown} offset={previewStart} width={previewEnd - previewStart} regionWidth={regionWidth - 2} indexes={indexes} prepend={preview?.prepend} />}
    {shown.chords?.length ? <div className="audio-region-chords" aria-label="片段和弦">{midiRegionChords(shown)?.filter(chord =>
      chord.end * scale >= previewStart && chord.start * scale <= previewEnd).map(chord =>
        <span key={chord.start} style={{ left: chord.start * scale, width: (chord.end - chord.start) * scale }} title={chord.name}>{chord.name}</span>)}</div> : null}
    <span className="region-label">{pattern.name}{shown.loop ? ' ↻' : ''}</span><span className="region-resize region-resize-start" title="调整片段开始边界" /><span className="region-resize" title="调整片段结束边界" />
    {preview && !drag.current?.edge && (!externalPreview || externalLabel) && <span className="region-drop-label" role="status">{externalLabel ?? (preview.blocked ? preview.track ? '目标轨道已锁定' : '请移回音符轨道' : `${copying ? '复制 ' : ''}→ ${preview.track?.name}`)}</span>}
  </div>;
}

type ChordMenuTarget = { tick: number } | ChordTrackPosition;
const isChordDeleteKey = (event: React.KeyboardEvent) => (event.key === 'Delete' || event.key === 'Backspace')
  && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

function navigateClipMenu(event: React.KeyboardEvent<HTMLDivElement>, close: () => void) {
  event.stopPropagation();
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
}

export function Arrangement(props: Props) {
  const [trackMenu,setTrackMenu]=useState<{id:string;x:number;y:number;owner:Project}>();
  const trackMenuElement=useRef<HTMLDivElement>(null);
  const closeTrackMenu=()=>{const id=trackMenu?.id;setTrackMenu(undefined);const header=[...document.querySelectorAll<HTMLElement>('[data-testid="track-header"]')].find(n=>n.dataset.trackId===id);header?.focus();};
  const showTrackMenu=(track:Track,x:number,y:number)=>{props.onTrack(track);setAudioMenu(undefined);setRegionMenu(undefined);setTrackMenu({id:track.id,x,y,owner:props.project});};
  useEffect(()=>{if(!trackMenu)return;const outside=(e:PointerEvent)=>{if(!trackMenuElement.current?.contains(e.target as Node))setTrackMenu(undefined);};document.addEventListener('pointerdown',outside);const frame=requestAnimationFrame(()=>(trackMenuElement.current?.querySelector<HTMLElement>('button:not([disabled])')??trackMenuElement.current)?.focus());return()=>{document.removeEventListener('pointerdown',outside);cancelAnimationFrame(frame);};},[trackMenu]);
  useEffect(()=>setTrackMenu(undefined),[props.project,props.instrumentFilter]);
  const [audioMenu,setAudioMenu]=useState<{clip:AudioClip;x:number;y:number;section?: 'processing' | 'chords' | 'tempo'}>();
  const [regionMenu, setRegionMenu] = useState<{ region: Region; x: number; y: number; chords?: boolean }>();
  const clipMenuElement = useRef<HTMLDivElement>(null), clipMenuTrigger = useRef<HTMLElement | null>(null);
  const clipMenuId = audioMenu?.clip.id ?? regionMenu?.region.id;
  const closeClipMenu = (restoreFocus = false) => {
    setAudioMenu(undefined); setRegionMenu(undefined);
    if (restoreFocus) clipMenuTrigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!clipMenuId) return;
    const outside = (event: PointerEvent) => { if (!clipMenuElement.current?.contains(event.target as Node)) closeClipMenu(); };
    (clipMenuElement.current?.querySelector<HTMLElement>('button:not(:disabled)') ?? clipMenuElement.current)?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [clipMenuId]);
  const [chordMenu, setChordMenu] = useState<{ target: ChordMenuTarget; x: number; y: number; trigger: HTMLElement }>();
  const chordMenuElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chordMenu) return;
    chordMenuElement.current?.querySelector('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!chordMenuElement.current?.contains(event.target as Node)) setChordMenu(undefined);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [chordMenu]);
  useEffect(() => setChordMenu(undefined), [props.project, props.showChordTrack]);
  useEffect(() => { setRegionMenu(undefined); setAudioMenu(undefined); }, [props.project]);
  const showRegionMenu = (region: Region, x: number, y: number) => {
    clipMenuTrigger.current = document.activeElement as HTMLElement | null;
    setAudioMenu(undefined); setRegionMenu({ region, x, y });
  };
  const showAudioMenu = (clip: AudioClip, x: number, y: number) => {
    clipMenuTrigger.current = document.activeElement as HTMLElement | null;
    setRegionMenu(undefined); setAudioMenu({ clip, x, y });
  };
  const { project, zoom, meter } = props, scale = zoom / project.ppq, end = playbackEndTick(project, props.referencePeaks?.duration);
  function showChordMenu(target: ChordMenuTarget, trigger: HTMLElement, x: number, y: number) {
    setTrackMenu(undefined);
    setAudioMenu(undefined);
    setRegionMenu(undefined);
    if (!('tick' in target)) props.onSelectGlobalChord?.(target);
    setChordMenu({ target, trigger, x, y });
  }
  const visibleTracks = useMemo(() => filterTracks(project.tracks, props.instrumentFilter ?? '').filter(track => !audioTrackParents(project.tracks, track).some(parent => parent.audioGroup?.collapsed)), [project.tracks, props.instrumentFilter]);
  const trackNumbers = useMemo(() => new Map(project.tracks.map((track, index) => [track.id, index + 1])), [project.tracks]);
  const previewIndexes = useRef<ArrangementNoteCache | null>(null);
  if (!previewIndexes.current) previewIndexes.current = new ArrangementNoteCache();
  const indexes = useMemo(() => { previewIndexes.current!.update(project.patterns); return previewIndexes.current!; }, [project.patterns]);
  const patternsById = useMemo(() => new Map(project.patterns.map(pattern => [pattern.id, pattern])), [project.patterns]);
  const instrumentsById = useMemo(() => new Map(project.instruments.map(instrument => [instrument.id, instrument])), [project.instruments]);
  const regionsByTrack = useMemo(() => {
    const grouped = new Map<string, Region[]>();
    for (const region of project.regions) {
      const lane = grouped.get(region.trackId);
      if (lane) lane.push(region); else grouped.set(region.trackId, [region]);
    }
    return grouped;
  }, [project.regions]);
  const selectedHeader=visibleTracks.find(t=>t.id===props.selectedTrack);
  const headerDeleteCheck=selectedHeader?{ok:!selectedHeader.locked&&!audioTrackChildren(project.tracks, selectedHeader.id).some(track => track.locked)}:undefined;
  const menuDeleteCheck=useMemo(()=>trackMenu?inspectTrackDelete(project,trackMenu.id,new Set(visibleTracks.map(t=>t.id))):undefined,[project,trackMenu?.id,visibleTracks]);
  const referenceAsset = project.assets.find(asset => asset.id === project.reference?.assetId), referenceHeight = (referenceAsset ? 52 : 0) + (props.showChordTrack ? 44 : 0);
  const [previewExtent, setPreviewExtent] = useState<{ owner: object; end: number } | null>(null);
  const [trackDrop, setTrackDrop] = useState<{ owner: object; trackId?: string; blocked: boolean } | null>(null);
  const [groupPreview, setGroupPreview] = useState<ArrangementGroupPreview | null>(null);
  const onTrackDropPreview = (owner: object, trackId?: string, blocked?: boolean) => setTrackDrop(previous => blocked === undefined
    ? previous?.owner === owner ? null : previous
    : previous?.owner === owner && previous.trackId === trackId && previous.blocked === blocked ? previous : { owner, trackId, blocked });
  const onPreviewExtent = (owner: object, endTick?: number) => setPreviewExtent(previous => endTick === undefined
    ? previous?.owner === owner ? null : previous
    : previous?.owner === owner && previous.end === endTick ? previous : { owner, end: endTick });
  const lastEvent = project.timeSignatures.reduce((last, event) => Math.max(last, event.tick), project.tempos.reduce((last, event) => Math.max(last, event.tick), Math.max(end, previewExtent?.end ?? 0, props.cycleRange?.end ?? 0, project.chordTrack?.at(-1)?.end ?? 0)));
  const extent = meter.at(meter.at(lastEvent).barEnd).barEnd;
  const scroll = useRef<HTMLDivElement>(null), headers = useRef<HTMLDivElement>(null);
  const trackHeaders = useRef<HTMLDivElement>(null);
  const chordLane = useRef<HTMLDivElement>(null);
  const acceptsChordDrop = (x: number, y: number) => !!current.current.onMidiChordAction
    && !!chordLane.current?.contains(document.elementFromPoint(x, y));
  const ruler = useRef<HTMLDivElement>(null), rulerDrag = useRef<{ pointer: number; x: number; originX: number; anchor: number; kind: 'seek' | 'cycle'; project: Project; meter: MeterMap; scale: number; step: number; owner?: object; stop: () => void } | null>(null), rulerAnimation = useRef(0);
  const [cyclePreview, setCyclePreview] = useState<{ start: number; end: number }>();
  const [fileDragOver, setFileDragOver] = useState(false);
  const current = useRef(props); current.current = props;
  const [viewport, setViewport] = useState({ left: 0, top: 0, width: 900, height: 230 });
  const syncViewport = () => {
    const element = scroll.current;
    // A hidden workspace has a zero-sized layout. Retain the last visible paint.
    if (!element?.clientWidth) return;
    if (headers.current) headers.current.scrollTop = element.scrollTop;
    setViewport(value => value.left === element.scrollLeft && value.top === element.scrollTop && value.width === element.clientWidth && value.height === element.clientHeight
      ? value : { left: element.scrollLeft, top: element.scrollTop, width: element.clientWidth, height: element.clientHeight });
  };
  // Virtual canvases must not keep a removed / shortened far-away clip scrollable.
  const width = Math.max(700, extent * scale), left = Math.min(viewport.left, Math.max(0, width - viewport.width));
  useLayoutEffect(() => {
    const element = scroll.current!;
    const measure = () => syncViewport();
    const observer = new ResizeObserver(measure); observer.observe(element); measure(); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = scroll.current; if (!element?.clientWidth) return;
    const maximum = Math.max(0, 26 + referenceHeight + visibleTracks.length * 52 - element.clientHeight);
    let top = Math.max(0, Math.min(element.scrollTop, maximum));
    const index = visibleTracks.findIndex(track => track.id === props.selectedTrack);
    if (index >= 0 && element.clientHeight > 26) {
      const start = 26 + referenceHeight + index * 52, end = start + 52;
      if (start < top + 26) top = start - 26;
      else if (end > top + element.clientHeight) top = end - element.clientHeight;
    }
    top = Math.max(0, Math.min(top, maximum));
    if (element.scrollTop !== top) element.scrollTop = top;
    syncViewport();
  }, [props.selectedTrack, visibleTracks, referenceHeight, viewport.height]);
  useEffect(() => {
    const element = trackHeaders.current; if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (!scroll.current || event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      scroll.current.scrollTop += event.deltaY;
      syncViewport();
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);
  const marks = useMemo(() => meter.grid(left / scale, (left + viewport.width) / scale, scale), [meter, left, viewport.width, scale]);
  const step = props.snap ? project.ppq * 4 / props.snap : 1;
  const chordGesture = useChordGroupGesture({ project, meter, scale, step, lane: chordLane, scroll,
    owner: props.gestureOwner, getOwner: props.getGestureOwner, onCommit: props.onEditChordGroup, onExtent: onPreviewExtent });
  const selectedRegionIds = props.selectedRegions ?? new Set(props.selectedRegion ? [props.selectedRegion] : []);
  const groupContext = useRef<ArrangementGestureContext>({ project, tracks: visibleTracks, selected: selectedRegionIds, primary: props.selectedRegion,
    scale, meter, step, trackTop: 26 + referenceHeight, scroll: scroll.current, owner: props.gestureOwner, liveOwner: props.getGestureOwner, preset: props.preset, copyAllowed: !!props.onRegionGroupCopy });
  groupContext.current = { project, tracks: visibleTracks, selected: selectedRegionIds, primary: props.selectedRegion, scale, meter, step,
    trackTop: 26 + referenceHeight, scroll: scroll.current, owner: props.gestureOwner, liveOwner: props.getGestureOwner, preset: props.preset, copyAllowed: !!props.onRegionGroupCopy };
  const groupGesture = useRef<ArrangementGroupGesture | null>(null);
  if (!groupGesture.current) groupGesture.current = new ArrangementGroupGesture({
    read: () => ({ ...groupContext.current, scroll: scroll.current }),
    publish: (preview, owner) => {
      setGroupPreview(previous => preview ?? (previous?.owner === owner ? null : previous));
      onPreviewExtent(owner, preview?.end);
    },
    select: (ids, primary) => current.current.onRegionSelection?.(ids, primary),
    commit: changes => current.current.onRegionGroupChange?.(changes),
    copy: changes => current.current.onRegionGroupCopy?.(changes),
    acceptsChordDrop,
    dropChords: (region, ids) => current.current.onMidiChordAction?.(region, 'drop-chords', ids),
    message: message => current.current.onGestureMessage?.(message),
  });
  useLayoutEffect(() => { groupGesture.current!.refresh(); });
  useEffect(() => () => groupGesture.current!.cancel(false), []);
  const beginMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !props.onRegionSelection) return;
    event.preventDefault(); event.stopPropagation(); props.onFocus(); groupGesture.current!.startMarquee(event);
  };
  const toggleRegion = (region: Region) => {
    const ids = new Set(selectedRegionIds); if (ids.has(region.id)) ids.delete(region.id); else ids.add(region.id);
    const primary = ids.has(region.id) ? region.id : ids.has(props.selectedRegion) ? props.selectedRegion : project.regions.find(item => ids.has(item.id))?.id;
    props.onRegionSelection?.(ids, primary);
  };
  const shownSelection = groupPreview?.kind === 'select' ? groupPreview.selected : selectedRegionIds;
  const dropTarget = groupPreview?.kind === 'move' ? { trackId: groupPreview.target, blocked: groupPreview.blocked } : trackDrop;
  const seekRuler = (clientX: number) => {
    if (!ruler.current) return;
    const p = current.current, pixels = p.zoom / p.project.ppq;
    p.onSeek(Math.max(0, p.meter.snap((clientX - ruler.current.getBoundingClientRect().left) / pixels, p.snap ? p.project.ppq * 4 / p.snap : 1)));
  };
  const rulerTick = (clientX: number) => {
    const p = current.current, pixels = p.zoom / p.project.ppq;
    return Math.min(1e12, Math.max(0, p.meter.snap((clientX - ruler.current!.getBoundingClientRect().left) / pixels, p.snap ? p.project.ppq * 4 / p.snap : 1)));
  };
  const rulerValid = (active: NonNullable<typeof rulerDrag.current>) => {
    const p = current.current;
    return p.project === active.project && p.meter === active.meter && p.zoom / p.project.ppq === active.scale && (p.snap ? p.project.ppq * 4 / p.snap : 1) === active.step
      && p.gestureOwner === active.owner && (!p.getGestureOwner || p.getGestureOwner() === active.owner);
  };
  const updateRuler = (clientX: number) => {
    const active = rulerDrag.current; if (!active) return;
    if (!rulerValid(active)) { finishRuler(); return; }
    if (active.kind === 'seek') seekRuler(clientX);
    else { const tick = rulerTick(clientX), start = Math.min(active.anchor, tick, 1e12 - 1); setCyclePreview({ start, end: Math.min(1e12, Math.max(start + 1, active.anchor, tick)) }); }
  };
  const animateRuler = () => {
    rulerAnimation.current = 0;
    const active = rulerDrag.current, element = scroll.current;
    if (!active || !element) return;
    const bounds = element.getBoundingClientRect(), distance = active.x < bounds.left + 24 ? -Math.min(18, (bounds.left + 24 - active.x) * .45) : active.x > bounds.right - 24 ? Math.min(18, (active.x - bounds.right + 24) * .45) : 0;
    if (distance) { const previous = element.scrollLeft; element.scrollLeft += distance; if (element.scrollLeft !== previous) updateRuler(active.x); }
    rulerAnimation.current = requestAnimationFrame(animateRuler);
  };
  const finishRuler = () => { const active = rulerDrag.current; rulerDrag.current = null; setCyclePreview(undefined); cancelAnimationFrame(rulerAnimation.current); rulerAnimation.current = 0; active?.stop(); };
  useLayoutEffect(() => { const active = rulerDrag.current; if (active && !rulerValid(active)) finishRuler(); });
  useEffect(() => () => { const active = rulerDrag.current; rulerDrag.current = null; cancelAnimationFrame(rulerAnimation.current); active?.stop(); }, []);
  const displayedCycle = cyclePreview ?? props.cycleRange;
  const dropFiles = props.onFilesDrop ?? props.onAudioDrop;
  return <div className="arrangement" data-file-drag-over={fileDragOver || undefined} onDragOver={event => {
    if (!dropFiles || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setFileDragOver(true);
  }} onDragLeave={event => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFileDragOver(false);
  }} onDrop={event => {
    setFileDragOver(false);
    const files = Array.from(event.dataTransfer.files);
    if (!dropFiles || !files.length) return;
    event.preventDefault();
    event.stopPropagation();
    const timeline = scroll.current, bounds = timeline?.getBoundingClientRect();
    const tick = timeline && bounds && event.clientX >= bounds.left && event.clientX <= bounds.right
      ? Math.max(0, meter.snap((event.clientX - bounds.left + timeline.scrollLeft) / scale, step))
      : props.playhead;
    const track = (event.target as Element).closest('[data-track-id]');
    dropFiles(files, tick, track?.getAttribute('data-track-id') ?? undefined);
  }} tabIndex={0} role="region" aria-label="编曲区" onFocus={props.onFocus} onPointerDownCapture={e => {
    if(e.button!==0)return;
    props.onFocus();
    // Keep native controls focused, including controls that prevent pointer defaults.
    // Empty lanes, regions and the ruler transfer focus away from inspector inputs.
    const control = (e.target as Element).closest<HTMLElement>('button,input,select,textarea,a[href],[contenteditable]:not([contenteditable="false"]),[tabindex]');
    (control ?? e.currentTarget).focus({ preventScroll: true });
  }}>
    <div className="track-headers" ref={trackHeaders}>
      <div className="track-caption">
        <span>轨道</span>
        <div className="track-caption-actions">
          <button type="button" aria-label="和弦轨" title="显示或隐藏全局和弦轨" aria-pressed={!!props.showChordTrack} onClick={props.onToggleChordTrack}>和弦</button>
          {props.onAddDrumTrack && <button type="button" aria-label="添加鼓组轨道" title="添加鼓组轨道" onClick={props.onAddDrumTrack}><Plus size={11} />鼓组</button>}
          <button type="button" aria-label="删除选中轨道" disabled={!selectedHeader || !headerDeleteCheck?.ok || !props.onTrackDelete} title={selectedHeader ? `删除 ${selectedHeader.name}${selectedHeader.audioGroup ? ' 及全部子轨' : ''}，可撤销` : '请先选择轨道'} onClick={() => selectedHeader && props.onTrackDelete?.(selectedHeader.id)}>删除</button>
          <button className="new-track-button" aria-label="添加轨道" title="添加轨道" onClick={props.onAddTrack}><Plus size={15} /></button>
        </div>
      </div>
      <div className="track-header-list" ref={headers} style={{ maxHeight: Math.max(0, viewport.height - 26) }}>{props.showChordTrack && <div className="chord-track-header"><span>全局 · 和弦</span>
        <button type="button" aria-label="在播放头添加和弦" title="在播放头添加和弦" disabled={!props.onCreateGlobalChord} onClick={() => props.onCreateGlobalChord?.()}><Plus size={14} /></button>
      </div>}{referenceAsset && project.reference && <ReferenceHeader name={referenceAsset.name} reference={project.reference} ppq={project.ppq} contextKey={project.id} gestureOwner={props.gestureOwner} getGestureOwner={props.getGestureOwner} onNumberPending={props.onNumberPending} onChange={props.onReferenceChange} onRemove={props.onReferenceRemove} />}{visibleTracks.map(track => <div className={`track-header ${props.selectedTrack === track.id ? 'active' : ''}`} role="group" aria-label={`轨道 ${trackNumbers.get(track.id)} · ${track.name}`} key={track.id} data-testid="track-header" data-track-id={track.id} style={{ '--track-color': track.color, '--stack-indent': `${audioTrackParents(project.tracks, track).length * 7}px` } as React.CSSProperties} title="单击选择；右键打开轨道菜单；轨道焦点下 Delete 删除。鼓组轨可双击编辑预置。" tabIndex={0} onPointerDown={e=>{if(e.button===2)e.preventDefault();}} onFocus={e=>{if(e.target===e.currentTarget || (e.target as HTMLElement).classList.contains('track-name-button'))props.onTrack(track);}} onContextMenu={e=>{e.preventDefault();e.stopPropagation();showTrackMenu(track,e.clientX,e.clientY);}} onKeyDown={e=>{
        if(e.target!==e.currentTarget && !(e.target as HTMLElement).classList.contains('track-name-button'))return;
        if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();e.stopPropagation();const b=e.currentTarget.getBoundingClientRect();showTrackMenu(track,b.left,b.bottom);}
        else if((e.key==='Delete'||e.key==='Backspace')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey){e.preventDefault();e.stopPropagation();if(e.repeat)return;props.onTrackDelete?.(track.id);}
      }} onClick={e => {props.onTrack(track);if(e.target===e.currentTarget)e.currentTarget.focus();}} onDoubleClick={event => {
        const control = (event.target as Element).closest('button,input,select,textarea,a,[role="slider"]');
        if (control && !control.classList.contains('track-name-button')) return;
        if (!track.drumPresetId || track.locked) return;
        event.preventDefault(); event.stopPropagation(); props.onTrackOpen?.(track);
      }}>
        <span className="track-number">{String(trackNumbers.get(track.id)).padStart(2, '0')}</span>
        <span className="track-color" aria-hidden="true" />
        {track.kind === 'audio'
          ? <span className="audio-track-icon" title={track.audioGroup ? '分轨汇总组' : '音频轨道'}>{track.audioGroup
            ? <button aria-label={track.audioGroup.collapsed ? '展开分轨组' : '折叠分轨组'} aria-expanded={!track.audioGroup.collapsed} onClick={e => { e.stopPropagation(); props.onTrackChange(track.id, { audioGroup: { ...track.audioGroup!, collapsed: !track.audioGroup!.collapsed } }); }}>{track.audioGroup.collapsed ? '▸' : '▾'}</button>
            : <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 8v2m3-4v6m3-9v12m3-10v8m3-7v6m2-4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
          </span>
          : <InstrumentBlock instrumentId={track.instrumentId} size={23} />}
        <div className="track-info">
          <strong><button type="button" className="track-name-button" aria-label={`选择轨道 ${track.name}`} aria-pressed={props.selectedTrack === track.id} onClick={event => { event.stopPropagation(); props.onTrack(track); }}>{track.name}</button></strong>
          <div className="track-buttons">
            <button className={track.muted ? 'on' : ''} aria-label="静音" aria-pressed={track.muted} onClick={e => { e.stopPropagation(); props.onTrackChange(track.id, { muted: !track.muted }); }} title="静音">M</button>
            <button className={track.solo ? 'solo on' : ''} aria-label="独奏" aria-pressed={track.solo} onClick={e => { e.stopPropagation(); props.onTrackChange(track.id, { solo: !track.solo }); }} title="独奏">S</button>
            <button className={track.locked ? 'on' : ''} aria-label="锁定" aria-pressed={track.locked} onClick={e => { e.stopPropagation(); props.onTrackChange(track.id, { locked: !track.locked }); }} title="锁定"><LockSimple size={11} /></button>
            <span>{track.kind === 'audio' ? (track.audioGroup ? '分轨汇总' : track.parentTrackId ? '分轨子轨' : '音频') : instrumentsById.get(track.instrumentId)?.name}</span>
          </div>
        </div>
      </div>)}</div>
      <button className="add-track" onClick={props.onAddTrack}><Plus size={13} /> 添加轨道</button>
    </div>
    <div className="arrangement-scroll" ref={scroll} onScroll={syncViewport}
      onPointerMove={event => groupGesture.current!.move(event)} onPointerUp={event => groupGesture.current!.end(event)}
      onPointerCancel={event => groupGesture.current!.pointerCancel(event.pointerId)} onLostPointerCapture={event => groupGesture.current!.pointerCancel(event.pointerId)}>
      <div className="arrangement-content" tabIndex={-1} onPointerDown={event => { if (event.target === event.currentTarget) beginMarquee(event); }} style={{ width, minWidth: '100%', height: visibleTracks.length * 52 + referenceHeight + 26 }}>
        <svg className="arrangement-grid" aria-hidden="true" style={{ left, width: viewport.width, maxWidth: `calc(100% - ${left}px)`, height: 'calc(100% - 26px)' }}>{marks.map(mark => <line key={mark.tick} className={mark.kind} x1={mark.tick * scale - left + .5} x2={mark.tick * scale - left + .5} y1="0" y2="100%" />)}</svg>
        <div className="arrangement-ruler" ref={ruler} aria-label="编曲时间标尺：下方拖动定位，上方拖动设置循环范围" title="上方 10 像素拖出局部循环；下方定位播放头；Esc 取消拖动"
          onPointerDown={e => {
            if (e.button !== 0 || rulerDrag.current) return;
            e.preventDefault();
            const kind = props.onCycleChange && e.clientY - e.currentTarget.getBoundingClientRect().top < 10 ? 'cycle' : 'seek';
            const active = { pointer: e.pointerId, x: e.clientX, originX: e.clientX, anchor: rulerTick(e.clientX), kind: kind as 'seek' | 'cycle', project, meter, scale, step, owner: props.gestureOwner, stop: () => {} };
            rulerDrag.current = active;
            const stop = captureEditorPointer(e.currentTarget, e.pointerId, finishRuler);
            if (rulerDrag.current !== active) { stop(); return; }
            active.stop = stop; updateRuler(e.clientX); rulerAnimation.current = requestAnimationFrame(animateRuler);
          }}
          onPointerMove={e => { const active = rulerDrag.current; if (active?.pointer === e.pointerId) { active.x = e.clientX; updateRuler(e.clientX); } }}
          onPointerUp={e => {
            const active = rulerDrag.current; if (!active || active.pointer !== e.pointerId) return;
            if (!rulerValid(active)) { finishRuler(); return; }
            if (active.kind === 'seek') { updateRuler(e.clientX); finishRuler(); return; }
            if(Math.abs(e.clientX-active.originX)<4 || rulerTick(e.clientX)===active.anchor){const tick=rulerTick(e.clientX);finishRuler();if(rulerValid(active))current.current.onSeek(tick);return;}
            const tick = rulerTick(e.clientX), start = Math.min(active.anchor, tick, 1e12 - 1), range = { start, end: Math.min(1e12, Math.max(start + 1, active.anchor, tick)) };
            finishRuler(); if (rulerValid(active)) current.current.onCycleChange?.(range);
          }}
          onPointerCancel={e => { if (rulerDrag.current?.pointer === e.pointerId) finishRuler(); }} onLostPointerCapture={e => { if (rulerDrag.current?.pointer === e.pointerId) finishRuler(); }}>
          {displayedCycle && <i data-testid="arrangement-cycle-range" aria-label={`循环范围 ${meter.format(displayedCycle.start)} 至 ${meter.format(displayedCycle.end)}`} style={{ position: 'absolute', left: displayedCycle.start * scale, width: Math.max(1, (displayedCycle.end - displayedCycle.start) * scale), top: 0, height: 10, background: cyclePreview || props.cycleEnabled ? '#e1ba4b' : '#84784f', opacity: cyclePreview || props.cycleEnabled ? .9 : .5, border: '1px solid #f5d986', pointerEvents: 'none' }} />}
          {marks.map(mark => <span key={mark.tick} className={mark.kind} data-tick={mark.tick} data-bar={mark.bar} title={mark.signature ? `${mark.label} · ${mark.signature}` : meter.format(mark.tick)} style={{ left: mark.tick * scale }}>{mark.kind === 'bar' ? mark.label : ''}{mark.signature && (meter.at(mark.tick).barEnd - mark.tick) * scale > 70 && <em className="meter-change">{mark.signature}</em>}</span>)}
        </div>
        {props.showChordTrack && <div ref={chordLane} className={`chord-track-lane${groupPreview?.chordDrop ? ' chord-drop-target' : ''}`} data-chord-track role="group" aria-label="全局和弦轨" tabIndex={-1}
          title="右键空白处创建和弦，或拖入音频或 MIDI 片段"
          onPointerMove={chordGesture.move} onPointerUp={chordGesture.end} onPointerCancel={chordGesture.cancel} onLostPointerCapture={chordGesture.cancel}
          onKeyDown={event => {
            if (isChordDeleteKey(event)) { event.preventDefault(); event.stopPropagation(); }
          }}
          onContextMenu={event => {
            if (!props.onCreateGlobalChord) return;
            event.preventDefault(); event.stopPropagation();
            const tick = Math.max(0, (event.clientX - event.currentTarget.getBoundingClientRect().left) / scale);
            showChordMenu({ tick: meter.barSnap(tick, 'floor') }, event.currentTarget, event.clientX, event.clientY);
          }}>
          {!project.chordTrack?.length && <span className="chord-track-hint">点按加号添加和弦，或拖入片段进行分析</span>}
          {project.chordTrack?.filter(group => group.end * scale >= left && group.start * scale <= left + viewport.width).map(group =>
            <div key={group.start} className="chord-track-group" aria-label={group.name} data-group-start={group.start}
              style={{ left: group.start * scale, width: (group.end - group.start) * scale, opacity: chordGesture.preview?.group === group && chordGesture.preview.edit !== 'copy' ? .35 : undefined }}>
              <button type="button" className="chord-track-grip" aria-label={`和弦组 ${group.name}`} title="拖动移动和弦组，Option 拖动复制，拖动两端裁剪"
                onFocus={() => props.onSelectGlobalChord?.()} onPointerDown={event => chordGesture.start(event, group)}>
                <span className="chord-group-edge" data-chord-group-edge="start" />
                {group.name}
                <span className="chord-group-edge" data-chord-group-edge="end" />
              </button>
              {group.chords.map(chord => <button type="button" className="chord-track-symbol" key={chord.start} title={`${chord.name} · ${meter.format(chord.start)} · 双击编辑`}
                aria-pressed={props.selectedGlobalChord?.groupStart === group.start && props.selectedGlobalChord.chordStart === chord.start}
                style={{ left: (chord.start - group.start) * scale, width: (chord.end - chord.start) * scale }}
                onFocus={() => props.onSelectGlobalChord?.({ groupStart: group.start, chordStart: chord.start })}
                onDoubleClick={() => props.onEditGlobalChord?.(group.start, chord.start)}
                onContextMenu={event => {
                  if (!props.onEditGlobalChord) return;
                  event.preventDefault(); event.stopPropagation();
                  showChordMenu({ groupStart: group.start, chordStart: chord.start }, event.currentTarget, event.clientX, event.clientY);
                }} onKeyDown={event => {
                  if (props.onDeleteGlobalChord && isChordDeleteKey(event)) {
                    event.preventDefault(); event.stopPropagation();
                    if (!event.repeat) {
                      chordLane.current?.focus({ preventScroll: true });
                      props.onDeleteGlobalChord(group.start, chord.start);
                    }
                    return;
                  }
                  if (!props.onEditGlobalChord || event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                  event.preventDefault(); event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  showChordMenu({ groupStart: group.start, chordStart: chord.start }, event.currentTarget, rect.left, rect.bottom);
                }}>{chord.name}</button>)}
            </div>
          )}
          {chordGesture.preview && (() => {
            const { group, edit, start, end } = chordGesture.preview;
            const moving = edit === 'move' || edit === 'copy', delta = moving ? start - group.start : 0;
            const chords = moving ? group.chords : group.trimSource?.chords ?? group.chords;
            return <div className="chord-track-group chord-group-preview" aria-hidden="true" data-chord-group-preview={edit}
              style={{ left: start * scale, width: (end - start) * scale }}>
              <span className="chord-track-grip">{group.name}</span>
              {chords.map(chord => {
                const left = Math.max(start, chord.start + delta), right = Math.min(end, chord.end + delta);
                return right > left && <span className="chord-track-symbol" key={chord.start}
                  style={{ left: (left - start) * scale, width: (right - left) * scale }}>{chord.name}</span>;
              })}
            </div>;
          })()}
        </div>}
        {referenceAsset && <ReferenceLane project={project} name={referenceAsset.name} peaks={props.referencePeaks} meter={meter} step={step} scale={scale} scroll={scroll} left={left} width={viewport.width} gestureOwner={props.gestureOwner} getGestureOwner={props.getGestureOwner} onPreviewExtent={onPreviewExtent} onChange={props.onReferenceChange} onSeek={props.onSeek} />}
        {visibleTracks.map((track, index) => <div className={`arrangement-lane ${track.muted ? 'muted' : ''}${dropTarget?.trackId === track.id ? dropTarget.blocked ? ' track-drop-blocked' : ' track-drop-target' : ''}`} tabIndex={-1} key={track.id} data-track-id={track.id} data-track-selected={props.selectedTrack === track.id} title="拖动空白框选片段；Shift 点击片段增减选择；Ctrl 从任意位置框选；双击空白创建片段" onPointerDown={event => { if (event.target === event.currentTarget) beginMarquee(event); }} onDoubleClick={e => { if (e.target !== e.currentTarget || track.locked || track.kind==='audio') return; const bounds = e.currentTarget.getBoundingClientRect(); props.onCreateRegion(track.id, meter.barSnap((e.clientX - bounds.left) / scale, 'floor')); }}>
          {(project.audioClips??[]).filter(c=>c.trackId===track.id).map(clip=><AudioRegion key={clip.id} project={project} clip={clip} scale={scale} viewportLeft={left} viewportWidth={viewport.width} meter={meter} step={step} selected={props.selectedAudioClips?.has(clip.id)} peaks={props.audioPeaks?.[clip.assetId]} onSelect={additive=>{if(!props.onAudioSelect){props.onTrack(track);return;}const ids=new Set(additive?props.selectedAudioClips:[]);if(additive&&ids.has(clip.id))ids.delete(clip.id);else ids.add(clip.id);props.onAudioSelect(ids,ids.has(clip.id)?clip.id:ids.values().next().value);}} onMove={(id,start,target)=>props.onAudioMove?.(id,start,target)} onTrim={props.onAudioTrim} onChordDrop={props.onAudioAction ? () => props.onAudioAction?.(clip,'drop-chords') : undefined} onMenu={showAudioMenu}/>)}
          {(regionsByTrack.get(track.id) ?? []).map(region => {
            const pattern = patternsById.get(region.patternId); if (!pattern) return null;
            const laneTop = 26 + referenceHeight + index * 52;
            return <RegionClip key={region.id} pattern={pattern} region={region} track={track} tracks={visibleTracks} trackTop={26 + referenceHeight} scale={scale} meter={meter} step={step} selected={shownSelection.has(region.id)} selectedRegions={selectedRegionIds}
              preset={props.preset} onCopy={props.onRegionGroupCopy} onContextMenu={props.onRegionAction || props.onMidiChordAction ? showRegionMenu : undefined} chordMenuAvailable={!!props.onMidiChordAction}
              onChordDrop={(item, x, y) => {
                if (!acceptsChordDrop(x, y)) return false;
                props.onMidiChordAction?.(item, 'drop-chords', new Set([item.id]));
                return true;
              }} externalPreview={groupPreview?.regions?.get(region.id)} externalLabel={groupPreview?.kind === 'move' && region.id === props.selectedRegion ? groupPreview.message ?? `移动 ${selectedRegionIds.size} 个片段` : undefined}
              isGroupGestureActive={() => groupGesture.current!.busy} onMarqueeStart={props.onRegionSelection ? beginMarquee : undefined}
              onToggleSelect={props.onRegionSelection ? toggleRegion : undefined} onSelectOnly={props.onRegionSelection ? region => props.onRegionSelection!(new Set([region.id]), region.id) : undefined}
              onGroupMoveStart={props.onRegionGroupChange ? (event, region) => groupGesture.current!.startMove(event, region) : undefined}
              scroll={scroll} left={left} viewportWidth={viewport.width} visibleLane={laneTop + 48 > viewport.top && laneTop + 4 < viewport.top + viewport.height} indexes={indexes} gestureOwner={props.gestureOwner} getGestureOwner={props.getGestureOwner} onPreviewExtent={onPreviewExtent} onTrackDropPreview={onTrackDropPreview} onSelect={props.onSelect} onFocus={props.onFocus} onRegionChange={props.onRegionChange} onTrimRegion={props.onTrimRegion} />;
          })}
        </div>)}
        {groupPreview?.box && <div className="arrangement-selection-box" data-testid="region-marquee" style={groupPreview.box} />}
        {groupPreview?.message && <div className="arrangement-group-status" role="status">{groupPreview.message}</div>}
        <div className="arrangement-playhead" style={{ left: props.playhead * scale }}><i /></div>
        {!props.instrumentFilter && <div className="audio-drop-zone" style={{top:visibleTracks.length*52+referenceHeight+30}} data-testid="audio-drop-zone">拖入音频新建轨道 <span>{ARRANGEMENT_AUDIO_FORMAT_LABEL}</span></div>}
        {!visibleTracks.length ? <div className="arrangement-empty" role="status" style={{ top: 26 + referenceHeight + 16 }}>{props.instrumentFilter ? '没有使用所选音色的轨道' : '尚无轨道，请添加轨道'}</div> : !project.regions.length && !project.audioClips?.length && <div className="arrangement-empty">双击轨道空白处创建片段</div>}
      </div>
    </div>
    {trackMenu && (()=>{const track=project.tracks.find(t=>t.id===trackMenu.id);if(!track||!menuDeleteCheck)return null;const children=audioTrackChildren(project.tracks, track.id),inspection=menuDeleteCheck,clips=project.audioClips?.filter(c=>c.trackId===track.id)??[];
      return <div ref={trackMenuElement} tabIndex={-1} className="audio-region-menu context-menu track-context-menu" data-glass-surface="menu" role="menu" aria-label={`轨道菜单 ${track.name}`} style={{ "--context-x": trackMenu.x + "px", "--context-y": trackMenu.y + "px" } as React.CSSProperties} onPointerDown={e=>e.stopPropagation()} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{e.stopPropagation();const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')],i=buttons.indexOf(document.activeElement as HTMLButtonElement);if(e.key==='Escape'){e.preventDefault();closeTrackMenu();}else if(e.key==='Tab')setTrackMenu(undefined);else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}}>
      <strong title={track.name}>轨道：{track.name}</strong>
      {track.drumPresetId&&<button role="menuitem" disabled={track.locked} onClick={()=>{setTrackMenu(undefined);props.onTrackOpen?.(track);}}>编辑鼓组预置…</button>}
      {track.kind === 'audio' && !track.audioGroup && props.onImportAudio && <button role="menuitem" disabled={track.locked}
        onClick={() => { setTrackMenu(undefined); props.onImportAudio?.(track.id); }}>导入音频文件…</button>}
      {clips.length===1&&<button role="menuitem" onClick={()=>{setTrackMenu(undefined);showAudioMenu(clips[0],trackMenu.x,trackMenu.y);}}>片段处理…</button>}
      <button role="menuitem" disabled={!inspection.ok||!props.onTrackDelete} title={inspection.ok?'可撤销，保留磁盘音频':inspection.reason} onClick={()=>{if(current.current.project!==trackMenu.owner)return;setTrackMenu(undefined);props.onTrackDelete?.(track.id);}}>{track.audioGroup?`删除分轨组及 ${children.length} 条子轨`:'删除轨道'}</button>
      <small>{track.audioGroup?'同时删除全部子轨及其片段。':'删除此轨道及其片段。'}磁盘资源保留，可撤销。{!inspection.ok&&inspection.reason}</small>
      </div>;})()}
    {chordMenu && (() => {
      const { target, trigger, x, y } = chordMenu;
      const close = (focusTarget = trigger) => {
        focusTarget.focus({ preventScroll: true });
        setChordMenu(undefined);
      };
      return <div ref={chordMenuElement} className="audio-region-menu context-menu" data-chord-menu data-glass-surface="menu" role="menu" aria-label="全局和弦菜单"
        style={{ "--context-x": x + "px", "--context-y": y + "px" } as React.CSSProperties} onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setChordMenu(undefined);
        }} onKeyDown={event => {
          if (isChordDeleteKey(event)) { event.preventDefault(); event.stopPropagation(); return; }
          if (event.key === 'Escape') close();
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
          } else return;
          event.preventDefault(); event.stopPropagation();
        }}>
        {'tick' in target ? <button type="button" role="menuitem" onClick={() => {
          close();
          props.onCreateGlobalChord?.(target.tick);
        }}>创建和弦</button> : <>
          <button type="button" role="menuitem" onClick={() => {
            close();
            props.onEditGlobalChord?.(target.groupStart, target.chordStart);
          }}>编辑和弦…</button>
          {props.onDeleteGlobalChord && <button type="button" role="menuitem" onClick={() => {
            close(chordLane.current ?? trigger);
            props.onDeleteGlobalChord?.(target.groupStart, target.chordStart);
          }}>删除和弦</button>}
        </>}
      </div>;
    })()}
    {audioMenu && (() => {
      const { clip, section } = audioMenu;
      const locked = project.tracks.find(track => track.id === clip.trackId)?.locked;
      const splitIds = props.selectedAudioClips?.has(clip.id) ? props.selectedAudioClips : new Set([clip.id]);
      const cut = planAudioSplit(project, splitIds, props.playhead, new Set(visibleTracks.map(track => track.id)));
      const multipleSources = splitIds.size > 1;
      const act = (action: Parameters<NonNullable<Props['onAudioAction']>>[1]) => {
        setAudioMenu(undefined);
        props.onAudioAction?.(clip, action);
      };
      return <div ref={clipMenuElement} tabIndex={-1} className="audio-region-menu context-menu" data-glass-surface="menu" role="menu" aria-label={`音频片段菜单 ${clip.name}`} style={{ "--context-x": audioMenu.x + "px", "--context-y": audioMenu.y + "px" } as React.CSSProperties} onKeyDown={event => navigateClipMenu(event, () => closeClipMenu(true))} onClick={event => event.stopPropagation()}>
        <div className="context-heading"><strong title={clip.name}>{clip.name}</strong>{clip.tempoAnalysis && <span>{clip.tempoAnalysis.stable === false ? '≈ ' : ''}{clip.tempoAnalysis.bpm} BPM</span>}</div>
        <div className="context-divider" role="separator" />
        {props.hasUsedStemSplitter && <button role="menuitem" aria-label="大分轨拆分器（快捷入口）" disabled={locked || multipleSources}
          title={multipleSources ? '请选择一个音频片段进行分轨。' : undefined} onClick={() => act('split')}>大分轨拆分器…</button>}
        <button role="menuitem" disabled={!cut.ok} title={cut.ok ? undefined : cut.reason} onClick={() => act('split-at-playhead')}>在播放头拆分片段</button>
        <button role="menuitem" aria-label="处理 ▸" aria-expanded={section === 'processing'} onClick={() => setAudioMenu({ ...audioMenu, section: section === 'processing' ? undefined : 'processing' })}>处理 {section === 'processing' ? <CaretDown size={12} /> : <CaretRight size={12} />}</button>
        {section === 'processing' && <button className="region-menu-child" role="menuitem" disabled={locked || multipleSources}
          title={multipleSources ? '请选择一个音频片段进行分轨。' : undefined} onClick={() => act('split')}>大分轨拆分器…</button>}
        <button role="menuitem" aria-label="和弦 ▸" aria-expanded={section === 'chords'} onClick={() => setAudioMenu({ ...audioMenu, section: section === 'chords' ? undefined : 'chords' })}>和弦 {section === 'chords' ? <CaretDown size={12} /> : <CaretRight size={12} />}</button>
        {section === 'chords' && <>
          <button className="region-menu-child" role="menuitem" disabled={locked} onClick={() => act('chords')}>分析和弦</button>
          {!!regionChords(clip)?.length && <button className="region-menu-child" role="menuitem" disabled={locked} onClick={() => act('edit-chords')}>编辑片段和弦…</button>}
          <button className="region-menu-child" role="menuitem" disabled={locked} onClick={() => act('apply-chords')}>将片段和弦应用到和弦轨</button>
          <button className="region-menu-child" role="menuitem" disabled={locked || !project.chordTrack?.length} onClick={() => act('read-chords')}>应用全局和弦轨的和弦</button>
        </>}
        <button role="menuitem" aria-expanded={section === 'tempo'} onClick={() => setAudioMenu({ ...audioMenu, section: section === 'tempo' ? undefined : 'tempo' })}>智能速度 {section === 'tempo' ? <CaretDown size={12} /> : <CaretRight size={12} />}</button>
        {section === 'tempo' && <>
          <button className="region-menu-child" role="menuitem" disabled={locked || multipleSources || !window.desktop?.startAudioAssist} onClick={() => act('detect-tempo')}>{clip.tempoAnalysis ? '重新检测曲速与首拍' : '检测曲速与首拍'}</button>
          <button className="region-menu-child" role="menuitem" disabled={locked || multipleSources || visibleFirstBeat(clip) === undefined} onClick={() => act('align-tempo')}>对齐首拍到小节</button>
          <button className="region-menu-child" role="menuitem" disabled={locked || multipleSources || visibleFirstBeat(clip) === undefined} onClick={() => act('apply-tempo')}>{clip.tempoAnalysis?.stable === false ? '应用估算曲速并对齐' : '应用曲速并对齐'}</button>
          {clip.tempoAnalysis && <div className="context-tempo-correction" role="group" aria-label="修正检测曲速">
            <span>拍速倍数</span>
            <button role="menuitem" aria-label="将检测曲速减半" disabled={locked || multipleSources || clip.tempoAnalysis.bpm < 90} onClick={() => act('halve-tempo')}>½</button>
            <button role="menuitem" aria-label="将检测曲速加倍" disabled={locked || multipleSources || clip.tempoAnalysis.bpm > 120} onClick={() => act('double-tempo')}>2×</button>
          </div>}
        </>}
        <div className="context-divider" role="separator" />
        <button role="menuitem" disabled={locked} onClick={() => act('mute')}>{clip.muted ? '取消片段静音' : '静音片段'}</button>
        <button role="menuitem" disabled={!window.desktop?.exportAudioRegions} onClick={() => act('export-wav')}>{multipleSources ? '导出所选音频片段为 WAV…' : '导出音频片段为 WAV…'}</button>
        <button role="menuitem" onClick={() => act('relink')}>重新定位音频素材…</button>
        <button className="context-danger" role="menuitem" disabled={locked} onClick={() => act('delete')}>删除片段</button>
        <small>位置 {meter.format(clip.start)} · {clip.durationSeconds.toFixed(2)} 秒</small>
      </div>;
    })()}
    {regionMenu && (() => {
      const { region, chords } = regionMenu;
      const locked = !!project.tracks.find(track => track.id === region.trackId)?.locked;
      const act = (action: RegionChordAction) => { setRegionMenu(undefined); props.onMidiChordAction?.(region, action); };
      return <div ref={clipMenuElement} tabIndex={-1} className="audio-region-menu context-menu" data-glass-surface="menu" role="menu" aria-label={`片段菜单 ${patternsById.get(region.patternId)?.name ?? ''}`} style={{ "--context-x": regionMenu.x + "px", "--context-y": regionMenu.y + "px" } as React.CSSProperties} onKeyDown={event => navigateClipMenu(event, () => closeClipMenu(true))} onClick={event=>event.stopPropagation()}>
        <strong>{patternsById.get(region.patternId)?.name}</strong>
        {props.onMidiChordAction && <>
          <button role="menuitem" aria-label="和弦 ▸" aria-expanded={!!chords} onClick={() => setRegionMenu({ ...regionMenu, chords: !chords })}>和弦 {chords ? <CaretDown size={12} /> : <CaretRight size={12} />}</button>
          {chords && <>
            <button className="region-menu-child" role="menuitem" disabled={locked} onClick={() => act('chords')}>分析和弦</button>
            {!!region.chords?.length && <button className="region-menu-child" role="menuitem" disabled={locked} onClick={() => act('edit-chords')}>编辑片段和弦…</button>}
            <button className="region-menu-child" role="menuitem" disabled={locked} onClick={() => act('apply-chords')}>将片段和弦应用到和弦轨</button>
            <button className="region-menu-child" role="menuitem" disabled={locked || !project.chordTrack?.length} onClick={() => act('read-chords')}>应用全局和弦轨的和弦</button>
          </>}
        </>}
        {props.onRegionAction && ([['copy','复制片段'],['cut','剪切片段'],['paste','在播放头粘贴'],['duplicate','独立复制'],['delete','删除所选片段']] as const)
          .map(([action,label]) => <button key={action} role="menuitem" disabled={action!=='copy' && locked} onClick={()=>{props.onRegionAction?.(region,action);setRegionMenu(undefined);}}>{label}</button>)}
      </div>;
    })()}
  </div>;
}
