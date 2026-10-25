import type { MeterMap } from '../core/meter';
import type { Project, Region, Track } from '../core/types';
import { planRegionGroupMove, type RegionMove } from '../core/region-batch';
import { arrangementTrackAt } from './arrangement-track-drop';
import { captureEditorPointer } from './pointer-capture';
import { startHorizontalEdgeScroll, startVerticalEdgeScroll, type HorizontalEdgeScrollController } from './edge-scroll';

export interface ArrangementGestureContext {
  project: Project; tracks: readonly Track[]; selected: ReadonlySet<string>; primary?: string;
  scale: number; meter: MeterMap; step: number; trackTop: number; scroll: HTMLElement | null;
  owner?: object; liveOwner?: () => object;
}
export interface ArrangementGroupRegionPreview {
  region: Region; track?: Track; offsetY: number; blocked: boolean; prepend: number;
}
export interface ArrangementGroupPreview {
  owner: object; kind: 'select' | 'move'; selected: ReadonlySet<string>;
  box?: { left: number; top: number; width: number; height: number };
  regions?: ReadonlyMap<string, ArrangementGroupRegionPreview>;
  target?: string; blocked?: boolean; message?: string; end?: number;
}
interface Pointer {
  clientX: number; clientY: number; pointerId: number; currentTarget: HTMLElement;
  shiftKey?: boolean;
}
interface Options {
  read: () => ArrangementGestureContext;
  publish: (preview: ArrangementGroupPreview | null, owner: object) => void;
  select: (ids: Set<string>, primary?: string) => void;
  commit: (changes: RegionMove[]) => void;
  message: (message: string) => void;
}
interface Active {
  epoch: number;
  context: ArrangementGestureContext; kind: 'select' | 'move'; pointer: number; element: HTMLElement;
  x: number; y: number; clientX: number; clientY: number; scrollX: number; scrollY: number;
  contentX: number; contentY: number; moved: boolean; additive: boolean; anchor?: Region;
  selected: Set<string>; stop: () => void; horizontal?: HorizontalEdgeScrollController; vertical?: HorizontalEdgeScrollController;
  geometry: string;
}

/** One temporary arrangement gesture; document writes are delegated only on release. */
export class ArrangementGroupGesture {
  private active?: Active;
  private epoch = 0;
  constructor(private readonly options: Options) {}
  get busy(): boolean { return !!this.active; }

  private valid(active: Active): boolean {
    const now = this.options.read(), before = active.context;
    return now.project === before.project && now.tracks === before.tracks && now.scale === before.scale
      && now.meter === before.meter && now.step === before.step && now.trackTop === before.trackTop
      && now.scroll === before.scroll && now.owner === before.owner && (!now.liveOwner || now.liveOwner() === before.owner)
      && now.selected.size === active.selected.size && [...active.selected].every(id => now.selected.has(id));
  }
  private geometry(active: Active): string {
    const element = active.context.scroll!;
    const bounds = element.getBoundingClientRect();
    return [element.scrollLeft, element.scrollTop, element.clientWidth, element.clientHeight, bounds.left, bounds.top].join(':');
  }
  private point(active: Active) {
    const element = active.context.scroll!, bounds = element.getBoundingClientRect();
    return { x: active.clientX - bounds.left - (element.clientLeft || 0) + element.scrollLeft,
      y: Math.max(active.context.trackTop, active.clientY - bounds.top - (element.clientTop || 0) + element.scrollTop) };
  }
  private plan(active: Active) {
    const context = active.context, element = context.scroll!, bounds = element.getBoundingClientRect();
    const target = arrangementTrackAt(context.tracks, active.clientY, { top: bounds.top + (element.clientTop || 0), height: element.clientHeight, scrollTop: element.scrollTop, trackTop: context.trackTop });
    const outsideX = target?.id !== active.anchor!.trackId
      && (active.clientX < bounds.left + (element.clientLeft || 0) || active.clientX >= bounds.left + (element.clientLeft || 0) + element.clientWidth);
    if (!target || outsideX) return { ok: false as const, reason: '请将整组选区移回可见音符轨道。' };
    const delta = active.clientX - active.x + element.scrollLeft - active.scrollX;
    const start = Math.abs(delta) < 2 ? active.anchor!.start : context.meter.snap(active.anchor!.start + delta / context.scale, context.step);
    return planRegionGroupMove(context.project, active.selected, active.anchor!.id, target.id, start, context.tracks.map(track => track.id));
  }
  private preview(active: Active): ArrangementGroupPreview {
    const context = active.context;
    if (active.kind === 'select') {
      const point = this.point(active), left = Math.min(active.contentX, point.x), right = Math.max(active.contentX, point.x);
      const top = Math.min(active.contentY, point.y), bottom = Math.max(active.contentY, point.y);
      const selected = new Set(active.additive ? active.selected : []), rows = new Map(context.tracks.map((track, index) => [track.id, index]));
      for (const region of context.project.regions) {
        const row = rows.get(region.trackId); if (row === undefined) continue;
        const x = region.start * context.scale, y = context.trackTop + row * 52 + 4;
        if (x <= right && x + Math.max(12, region.length * context.scale) >= left && y <= bottom && y + 44 >= top) selected.add(region.id);
      }
      return { owner: active, kind: 'select', selected, box: { left, top, width: right - left, height: bottom - top } };
    }
    const plan = this.plan(active), regions = new Map<string, ArrangementGroupRegionPreview>();
    const byId = new Map(context.project.regions.map(region => [region.id, region])), tracks = new Map(context.tracks.map((track, index) => [track.id, { track, index }]));
    let end: number | undefined;
    if (plan.ok) for (const change of plan.changes) {
      const original = byId.get(change.id)!, source = tracks.get(original.trackId)!, destination = tracks.get(change.trackId)!;
      const region = { ...original, start: change.start, trackId: change.trackId };
      regions.set(change.id, { region, track: destination.track, offsetY: (destination.index - source.index) * 52, blocked: false, prepend: 0 });
      end = Math.max(end ?? 0, region.start + region.length);
    }
    else for (const id of active.selected) {
      const region = byId.get(id); if (region) regions.set(id, { region, track: tracks.get(region.trackId)?.track, offsetY: 0, blocked: true, prepend: 0 });
    }
    return { owner: active, kind: 'move', selected: active.selected, regions, target: plan.ok ? regions.get(active.anchor!.id)?.region.trackId : undefined,
      blocked: !plan.ok, message: plan.ok ? undefined : plan.reason, end };
  }
  private update(active: Active) {
    if (this.active !== active) return;
    if (!this.valid(active)) { this.cancel(); return; }
    active.geometry = this.geometry(active);
    this.options.publish(this.preview(active), active);
    if (this.active === active && !this.valid(active)) this.cancel();
  }
  private start(event: Pointer, kind: Active['kind'], anchor?: Region) {
    if (this.active) return;
    const context = this.options.read(), scroll = context.scroll;
    if (!scroll || context.liveOwner && context.liveOwner() !== context.owner) return;
    const bounds = scroll.getBoundingClientRect(), top = bounds.top + (scroll.clientTop || 0);
    const contentY = event.clientY - top + scroll.scrollTop;
    if (kind === 'select' && (event.clientY < top + 26 || event.clientY >= top + scroll.clientHeight || contentY < context.trackTop)) return;
    const active: Active = { epoch: ++this.epoch, context, kind, pointer: event.pointerId, element: event.currentTarget, x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY,
      scrollX: scroll.scrollLeft, scrollY: scroll.scrollTop, contentX: event.clientX - bounds.left - (scroll.clientLeft || 0) + scroll.scrollLeft,
      contentY, selected: new Set(context.selected), additive: !!event.shiftKey, moved: false, anchor, stop: () => {}, geometry: '' };
    this.active = active;
    const stop = captureEditorPointer(event.currentTarget, event.pointerId, () => this.cancel());
    if (this.active !== active) { stop(); return; }
    active.stop = stop; this.update(active);
  }
  startMarquee(event: Pointer) { this.start(event, 'select'); }
  startMove(event: Pointer, anchor: Region) { this.start(event, 'move', anchor); }
  move(event: Pick<Pointer, 'clientX' | 'clientY' | 'pointerId'>) {
    const active = this.active; if (!active || active.pointer !== event.pointerId) return;
    active.clientX = event.clientX; active.clientY = event.clientY;
    const element = active.context.scroll!;
    active.moved ||= Math.abs(active.clientX - active.x) >= 2 || Math.abs(active.clientY - active.y) >= 2 || element.scrollLeft !== active.scrollX || element.scrollTop !== active.scrollY;
    this.update(active); if (this.active !== active || !active.moved) return;
    const options = { isActive: () => { if (this.active !== active) return false; if (this.valid(active)) return true; this.cancel(); return false; }, onScroll: () => this.update(active) };
    active.horizontal?.move(active.clientX); active.vertical?.move(active.clientY);
    if (!active.horizontal) {
      const controller = startHorizontalEdgeScroll(element, active.clientX, options);
      if (this.active === active) active.horizontal = controller; else controller.stop();
    }
    if (this.active === active && !active.vertical && element.scrollHeight > element.clientHeight) {
      const controller = startVerticalEdgeScroll(element, active.clientY, options);
      if (this.active === active) active.vertical = controller; else controller.stop();
    }
  }
  end(event: Pick<Pointer, 'clientX' | 'clientY' | 'pointerId'>) {
    const active = this.active; if (!active || active.pointer !== event.pointerId) return;
    active.clientX = event.clientX; active.clientY = event.clientY;
    if (!this.valid(active)) { this.cancel(); return; }
    const preview = active.kind === 'select' ? this.preview(active) : undefined, plan = active.kind === 'move' ? this.plan(active) : undefined;
    const clicked = active.kind === 'move' && !active.moved && Math.abs(event.clientX - active.x) < 2 && Math.abs(event.clientY - active.y) < 2
      && active.context.scroll!.scrollLeft === active.scrollX && active.context.scroll!.scrollTop === active.scrollY;
    this.finish(active, true); if (this.active || active.epoch !== this.epoch || !this.valid(active)) return;
    if (preview) {
      const ids = new Set(preview.selected), primary = active.context.primary && ids.has(active.context.primary) ? active.context.primary : active.context.project.regions.find(region => ids.has(region.id))?.id;
      this.options.select(ids, primary);
    } else if (clicked) this.options.select(new Set([active.anchor!.id]), active.anchor!.id);
    else if (plan?.ok) { if (plan.deltaTick !== 0 || plan.trackDelta !== 0) this.options.commit(plan.changes); }
    else if (plan) this.options.message(plan.reason);
  }
  refresh() {
    const active = this.active; if (!active) return;
    if (!this.valid(active)) this.cancel();
    else if (this.geometry(active) !== active.geometry) this.update(active);
  }
  private finish(active: Active, render: boolean) {
    if (this.active !== active) return;
    this.active = undefined; active.horizontal?.stop(); active.vertical?.stop(); active.stop();
    if (render) this.options.publish(null, active);
  }
  cancel(render = true) {
    const active = this.active; if (!active) return;
    this.finish(active, render);
    if (render && active.kind === 'move' && !this.active && active.epoch === this.epoch && this.valid(active)) this.options.select(new Set(active.selected), active.context.primary);
  }
  pointerCancel(pointerId: number) { if (this.active?.pointer === pointerId) this.cancel(); }
}
