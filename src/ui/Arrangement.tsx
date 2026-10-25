import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LockSimple, Plus } from '@phosphor-icons/react';
import type { Pattern, Project, Region, Track } from '../core/types';
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

function MiniNotes({ pattern, region, color, offset, width, regionWidth, indexes, prepend = 0 }: { pattern: Pattern; region: Region; color: string; offset: number; width: number; regionWidth: number; indexes: ArrangementNoteCache; prepend?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const index = indexes.get(pattern.id)!;
  const pitches = useMemo(() => ({ low: Math.min(48, index.lowPitch), high: Math.max(84, index.highPitch) }), [index]);
  useLayoutEffect(() => {
    const element = ref.current!;
    const draw = () => {
      const w = element.clientWidth, h = element.clientHeight, dpr = window.devicePixelRatio || 1;
      element.width = w * dpr; element.height = h * dpr; const c = element.getContext('2d')!; c.scale(dpr, dpr);
      c.fillStyle = '#172b23aa';
      // A left extension will prepend source silence on commit. Apply that shift
      // to the preview origin, without cloning a potentially large note array.
      const geometry = regionPreviewGeometry(pattern, prepend ? { ...region, offset: region.offset - prepend } : region, { offset, width: w, regionWidth }, index);
      for (const note of geometry.notes) c.fillRect(note.x, 18 + (pitches.high - note.midi) / (pitches.high - pitches.low + 1) * (h - 23), note.width, 2);
      c.strokeStyle = '#ffffff33';
      for (const x of geometry.dividers) { c.beginPath(); c.moveTo(x, 17); c.lineTo(x, h); c.stroke(); }
    };
    const observer = new ResizeObserver(draw); observer.observe(element); draw(); return () => observer.disconnect();
  }, [pattern, region, color, offset, width, regionWidth, prepend, pitches, index]);
  return <canvas ref={ref} className="region-notes" style={{ left: offset, width }} />;
}
interface Props {
  project: Project; meter: MeterMap; snap: number; selectedRegion: string; selectedTrack: string; zoom: number; playhead: number;
  gestureOwner?: object; getGestureOwner?: () => object;
  instrumentFilter?: string;
  selectedRegions?: ReadonlySet<string>;
  onRegionSelection?: (ids: Set<string>, primaryId?: string) => void;
  onRegionGroupChange?: (changes: RegionMove[]) => void;
  onGestureMessage?: (message: string) => void;
  onSelect: (region: Region) => void; onTrack: (track: Track) => void;
  onTrackChange: (id: string, patch: Partial<Track>) => void;
  onRegionChange: (id: string, patch: Partial<Region>) => void;
  onTrimRegion: (id: string, edge: 'start' | 'end', tick: number) => void;
  onAddTrack: () => void; onCreateRegion: (trackId: string, tick: number) => void; onSeek: (tick: number) => void; onFocus: () => void;
  referencePeaks?: WaveformPeaks;
  onReferenceChange: (patch: { startTick?: number; gain?: number }) => void; onReferenceRemove: () => void;
}
type Drag = {
  region: Region; x: number; scroll: number; pointer: number; edge: 'start' | 'end' | null; stop: () => void;
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
  isGroupGestureActive?: () => boolean;
  onSelect: Props['onSelect']; onFocus: Props['onFocus']; onRegionChange: Props['onRegionChange']; onTrimRegion: Props['onTrimRegion'];
}

function RegionClip({ pattern, region, track, tracks, trackTop, scale, meter, step, selected, selectedRegions, externalPreview, externalLabel, onMarqueeStart, onGroupMoveStart, onToggleSelect, onSelectOnly, isGroupGestureActive, scroll, left, viewportWidth, visibleLane, indexes, gestureOwner, getGestureOwner, onPreviewExtent, onTrackDropPreview, onSelect, onFocus, onRegionChange, onTrimRegion }: RegionClipProps) {
  const drag = useRef<Drag | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const current = useRef({ pattern, region, track, tracks, trackTop, scale, meter, step, scroll, gestureOwner, getGestureOwner });
  current.current = { pattern, region, track, tracks, trackTop, scale, meter, step, scroll, gestureOwner, getGestureOwner };
  const [localPreview, setPreview] = useState<TrackPreview | null>(null);
  const preview = externalPreview ?? localPreview;
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
  return <div ref={element} tabIndex={-1} data-testid="region" data-region-id={region.id} data-track-id={region.trackId} data-drop-track-id={preview?.track?.id} data-drop-blocked={preview?.blocked || undefined} className={`region ${selected ? 'selected' : ''}${preview ? ' dragging' : ''}${preview?.blocked ? ' drop-blocked' : ''}`} style={{ left: shown.start * scale, width: regionWidth, backgroundColor: preview?.track?.color ?? track.color, transform: preview?.offsetY ? `translateY(${preview.offsetY}px)` : undefined }} title="拖动移动片段到其它轨道；拖动左右手柄裁剪；Esc 取消当前拖动"
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
      const active: Drag = { region: { ...region }, x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY, scrollY: scroll.current?.scrollTop ?? 0, lastScrollTop: scroll.current?.scrollTop ?? 0, moved: false, onPreviewExtent, onTrackDropPreview, scroll: scroll.current?.scrollLeft ?? 0, pointer: event.pointerId, edge: handle.classList.contains('region-resize') ? handle.classList.contains('region-resize-start') ? 'start' : 'end' : null, stop: () => {},
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
      if (!valid(active) || next.blocked) return;
      if (next.region.start !== active.region.start || next.region.length !== active.region.length || next.region.trackId !== active.region.trackId) {
        if (active.edge) onTrimRegion(region.id, active.edge, tick);
        else onRegionChange(region.id, { start: next.region.start, ...(next.region.trackId !== active.region.trackId ? { trackId: next.region.trackId } : {}) });
      }
    }}
    onPointerCancel={event => { if (drag.current?.pointer === event.pointerId) finish(); }} onLostPointerCapture={event => { if (drag.current?.pointer === event.pointerId) finish(); }}>
    {(visibleLane || !!preview?.track) && previewEnd > previewStart && <MiniNotes pattern={pattern} region={shown} color={track.color} offset={previewStart} width={previewEnd - previewStart} regionWidth={regionWidth - 2} indexes={indexes} prepend={preview?.prepend} />}
    <span className="region-label">{pattern.name}{shown.loop ? ' ↻' : ''}</span><span className="region-resize region-resize-start" title="调整片段开始边界" /><span className="region-resize" title="调整片段结束边界" />
    {preview && !drag.current?.edge && (!externalPreview || externalLabel) && <span className="region-drop-label" role="status">{externalLabel ?? (preview.blocked ? preview.track ? '目标轨道已锁定' : '请移回音符轨道' : `→ ${preview.track?.name}`)}</span>}
  </div>;
}

export function Arrangement(props: Props) {
  const { project, zoom, meter } = props, scale = zoom / project.ppq, end = playbackEndTick(project, props.referencePeaks?.duration);
  const visibleTracks = useMemo(() => filterTracks(project.tracks, props.instrumentFilter ?? ''), [project.tracks, props.instrumentFilter]);
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
  const referenceAsset = project.assets.find(asset => asset.id === project.reference?.assetId), referenceHeight = referenceAsset ? 52 : 0;
  const [previewExtent, setPreviewExtent] = useState<{ owner: object; end: number } | null>(null);
  const [trackDrop, setTrackDrop] = useState<{ owner: object; trackId?: string; blocked: boolean } | null>(null);
  const [groupPreview, setGroupPreview] = useState<ArrangementGroupPreview | null>(null);
  const onTrackDropPreview = (owner: object, trackId?: string, blocked?: boolean) => setTrackDrop(previous => blocked === undefined
    ? previous?.owner === owner ? null : previous
    : previous?.owner === owner && previous.trackId === trackId && previous.blocked === blocked ? previous : { owner, trackId, blocked });
  const onPreviewExtent = (owner: object, endTick?: number) => setPreviewExtent(previous => endTick === undefined
    ? previous?.owner === owner ? null : previous
    : previous?.owner === owner && previous.end === endTick ? previous : { owner, end: endTick });
  const lastEvent = project.timeSignatures.reduce((last, event) => Math.max(last, event.tick), project.tempos.reduce((last, event) => Math.max(last, event.tick), Math.max(end, previewExtent?.end ?? 0)));
  const extent = meter.at(meter.at(lastEvent).barEnd).barEnd;
  const scroll = useRef<HTMLDivElement>(null), headers = useRef<HTMLDivElement>(null);
  const trackHeaders = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null), rulerDrag = useRef<{ pointer: number; x: number } | null>(null), rulerAnimation = useRef(0);
  const current = useRef(props); current.current = props;
  const [viewport, setViewport] = useState({ left: 0, top: 0, width: 900, height: 230 });
  const syncViewport = () => {
    const element = scroll.current; if (!element) return;
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
    const element = scroll.current; if (!element) return;
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
  const selectedRegionIds = props.selectedRegions ?? new Set(props.selectedRegion ? [props.selectedRegion] : []);
  const groupContext = useRef<ArrangementGestureContext>({ project, tracks: visibleTracks, selected: selectedRegionIds, primary: props.selectedRegion,
    scale, meter, step, trackTop: 26 + referenceHeight, scroll: scroll.current, owner: props.gestureOwner, liveOwner: props.getGestureOwner });
  groupContext.current = { project, tracks: visibleTracks, selected: selectedRegionIds, primary: props.selectedRegion, scale, meter, step,
    trackTop: 26 + referenceHeight, scroll: scroll.current, owner: props.gestureOwner, liveOwner: props.getGestureOwner };
  const groupGesture = useRef<ArrangementGroupGesture | null>(null);
  if (!groupGesture.current) groupGesture.current = new ArrangementGroupGesture({
    read: () => ({ ...groupContext.current, scroll: scroll.current }),
    publish: (preview, owner) => {
      setGroupPreview(previous => preview ?? (previous?.owner === owner ? null : previous));
      onPreviewExtent(owner, preview?.end);
    },
    select: (ids, primary) => current.current.onRegionSelection?.(ids, primary),
    commit: changes => current.current.onRegionGroupChange?.(changes),
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
  const animateRuler = () => {
    rulerAnimation.current = 0;
    const active = rulerDrag.current, element = scroll.current;
    if (!active || !element) return;
    const bounds = element.getBoundingClientRect(), distance = active.x < bounds.left + 24 ? -Math.min(18, (bounds.left + 24 - active.x) * .45) : active.x > bounds.right - 24 ? Math.min(18, (active.x - bounds.right + 24) * .45) : 0;
    if (distance) { const previous = element.scrollLeft; element.scrollLeft += distance; if (element.scrollLeft !== previous) seekRuler(active.x); }
    rulerAnimation.current = requestAnimationFrame(animateRuler);
  };
  const finishRuler = () => { rulerDrag.current = null; cancelAnimationFrame(rulerAnimation.current); rulerAnimation.current = 0; };
  useEffect(() => () => cancelAnimationFrame(rulerAnimation.current), []);
  return <div className="arrangement" tabIndex={0} role="region" aria-label="编曲区" onFocus={props.onFocus} onPointerDownCapture={e => {
    props.onFocus();
    // Keep native controls focused, including controls that prevent pointer defaults.
    // Empty lanes, regions and the ruler transfer focus away from inspector inputs.
    const control = (e.target as Element).closest<HTMLElement>('button,input,select,textarea,a[href],[contenteditable]:not([contenteditable="false"]),[tabindex]');
    (control ?? e.currentTarget).focus({ preventScroll: true });
  }}>
    <div className="track-headers" ref={trackHeaders}><div className="track-caption"><span>轨道</span><button aria-label="添加轨道" title="添加轨道" onClick={props.onAddTrack}><Plus size={14} /></button></div>
      <div className="track-header-list" ref={headers}>{referenceAsset && project.reference && <ReferenceHeader name={referenceAsset.name} reference={project.reference} ppq={project.ppq} onChange={props.onReferenceChange} onRemove={props.onReferenceRemove} />}{visibleTracks.map(track => <div className={`track-header ${props.selectedTrack === track.id ? 'active' : ''}`} role="group" aria-label={`轨道 ${trackNumbers.get(track.id)} · ${track.name}`} key={track.id} data-testid="track-header" data-track-id={track.id} style={{ '--track-color': track.color } as React.CSSProperties} onClick={() => props.onTrack(track)}>
        <span className="track-number">{String(trackNumbers.get(track.id)).padStart(2, '0')}</span><span className="track-color" /><InstrumentBlock instrumentId={track.instrumentId} size={24} /><div className="track-info"><strong><button type="button" className="track-name-button" aria-label={`选择轨道 ${track.name}`} aria-pressed={props.selectedTrack === track.id} style={{ padding: 0, border: 0, borderRadius: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={event => { event.stopPropagation(); props.onTrack(track); }}>{track.name}</button></strong><div className="track-buttons"><button className={track.muted ? 'on' : ''} onClick={e => { e.stopPropagation(); props.onTrackChange(track.id, { muted: !track.muted }); }} title="静音">M</button><button className={track.solo ? 'solo on' : ''} onClick={e => { e.stopPropagation(); props.onTrackChange(track.id, { solo: !track.solo }); }} title="独奏">S</button><button className={track.locked ? 'on' : ''} onClick={e => { e.stopPropagation(); props.onTrackChange(track.id, { locked: !track.locked }); }} title="锁定"><LockSimple size={10} /></button><span>{instrumentsById.get(track.instrumentId)?.name}</span></div></div>
        <div className="mini-meter"><i style={{ width: `${track.muted ? 0 : track.volume * 70}%`, background: track.color }} /></div>
      </div>)}</div>
      <button className="add-track" onClick={props.onAddTrack}><Plus size={13} /> 添加轨道</button>
    </div>
    <div className="arrangement-scroll" ref={scroll} onScroll={syncViewport}
      onPointerMove={event => groupGesture.current!.move(event)} onPointerUp={event => groupGesture.current!.end(event)}
      onPointerCancel={event => groupGesture.current!.pointerCancel(event.pointerId)} onLostPointerCapture={event => groupGesture.current!.pointerCancel(event.pointerId)}>
      <div className="arrangement-content" tabIndex={-1} onPointerDown={event => { if (event.target === event.currentTarget) beginMarquee(event); }} style={{ width, minWidth: '100%', height: visibleTracks.length * 52 + referenceHeight + 26 }}>
        <svg className="arrangement-grid" aria-hidden="true" style={{ left, width: viewport.width, maxWidth: `calc(100% - ${left}px)`, height: 'calc(100% - 26px)' }}>{marks.map(mark => <line key={mark.tick} className={mark.kind} x1={mark.tick * scale - left + .5} x2={mark.tick * scale - left + .5} y1="0" y2="100%" />)}</svg>
        <div className="arrangement-ruler" ref={ruler} aria-label="编曲时间标尺：按住并拖动定位" onPointerDown={e => { if (e.button !== 0 || rulerDrag.current) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); rulerDrag.current = { pointer: e.pointerId, x: e.clientX }; seekRuler(e.clientX); rulerAnimation.current = requestAnimationFrame(animateRuler); }} onPointerMove={e => { const active = rulerDrag.current; if (active?.pointer === e.pointerId) { active.x = e.clientX; seekRuler(e.clientX); } }} onPointerUp={e => { if (rulerDrag.current?.pointer !== e.pointerId) return; seekRuler(e.clientX); finishRuler(); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={finishRuler} onLostPointerCapture={finishRuler}>{marks.map(mark => <span key={mark.tick} className={mark.kind} data-tick={mark.tick} data-bar={mark.bar} title={mark.signature ? `${mark.label} · ${mark.signature}` : meter.format(mark.tick)} style={{ left: mark.tick * scale }}>{mark.kind === 'bar' ? mark.label : ''}{mark.signature && (meter.at(mark.tick).barEnd - mark.tick) * scale > 70 && <em className="meter-change">{mark.signature}</em>}</span>)}</div>
        {referenceAsset && <ReferenceLane project={project} name={referenceAsset.name} peaks={props.referencePeaks} meter={meter} step={step} scale={scale} scroll={scroll} left={left} width={viewport.width} gestureOwner={props.gestureOwner} getGestureOwner={props.getGestureOwner} onPreviewExtent={onPreviewExtent} onChange={props.onReferenceChange} onSeek={props.onSeek} />}
        {visibleTracks.map((track, index) => <div className={`arrangement-lane ${track.muted ? 'muted' : ''}${dropTarget?.trackId === track.id ? dropTarget.blocked ? ' track-drop-blocked' : ' track-drop-target' : ''}`} tabIndex={-1} key={track.id} data-track-id={track.id} title="拖动空白框选片段；Shift 点击片段增减选择；Ctrl 从任意位置框选；双击空白创建片段" onPointerDown={event => { if (event.target === event.currentTarget) beginMarquee(event); }} onDoubleClick={e => { if (e.target !== e.currentTarget || track.locked) return; const bounds = e.currentTarget.getBoundingClientRect(); props.onCreateRegion(track.id, meter.barSnap((e.clientX - bounds.left) / scale, 'floor')); }}>
          {(regionsByTrack.get(track.id) ?? []).map(region => {
            const pattern = patternsById.get(region.patternId); if (!pattern) return null;
            const laneTop = 26 + referenceHeight + index * 52;
            return <RegionClip key={region.id} pattern={pattern} region={region} track={track} tracks={visibleTracks} trackTop={26 + referenceHeight} scale={scale} meter={meter} step={step} selected={shownSelection.has(region.id)} selectedRegions={selectedRegionIds}
              externalPreview={groupPreview?.regions?.get(region.id)} externalLabel={groupPreview?.kind === 'move' && region.id === props.selectedRegion ? groupPreview.message ?? `移动 ${selectedRegionIds.size} 个片段` : undefined}
              isGroupGestureActive={() => groupGesture.current!.busy} onMarqueeStart={props.onRegionSelection ? beginMarquee : undefined}
              onToggleSelect={props.onRegionSelection ? toggleRegion : undefined} onSelectOnly={props.onRegionSelection ? region => props.onRegionSelection!(new Set([region.id]), region.id) : undefined}
              onGroupMoveStart={props.onRegionGroupChange ? (event, region) => groupGesture.current!.startMove(event, region) : undefined}
              scroll={scroll} left={left} viewportWidth={viewport.width} visibleLane={laneTop + 48 > viewport.top && laneTop + 4 < viewport.top + viewport.height} indexes={indexes} gestureOwner={props.gestureOwner} getGestureOwner={props.getGestureOwner} onPreviewExtent={onPreviewExtent} onTrackDropPreview={onTrackDropPreview} onSelect={props.onSelect} onFocus={props.onFocus} onRegionChange={props.onRegionChange} onTrimRegion={props.onTrimRegion} />;
          })}
        </div>)}
        {groupPreview?.box && <div className="arrangement-selection-box" data-testid="region-marquee" style={groupPreview.box} />}
        {groupPreview?.message && <div className="arrangement-group-status" role="status">{groupPreview.message}</div>}
        <div className="arrangement-playhead" style={{ left: props.playhead * scale }}><i /></div>
        {!visibleTracks.length ? <div className="arrangement-empty" role="status" style={{ top: 26 + referenceHeight + 16 }}>{props.instrumentFilter ? '没有使用所选音色的轨道' : '尚无轨道，请添加轨道'}</div> : !project.regions.length && <div className="arrangement-empty">双击轨道空白处创建片段</div>}
      </div>
    </div>
  </div>;
}
