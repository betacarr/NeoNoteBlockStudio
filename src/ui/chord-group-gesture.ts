import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { chordGroupEditRange, type ChordGroupEdit, type ChordTrackGroup } from '../core/chord-track';
import type { MeterMap } from '../core/meter';
import type { Project } from '../core/types';
import { startHorizontalEdgeScroll, type HorizontalEdgeScrollController } from './edge-scroll';
import { captureEditorPointer } from './pointer-capture';

interface Options {
  project: Project;
  meter: MeterMap;
  scale: number;
  step: number;
  lane: RefObject<HTMLDivElement | null>;
  scroll: RefObject<HTMLDivElement | null>;
  owner?: object;
  getOwner?: () => object;
  onCommit?: (project: Project, groupStart: number, edit: ChordGroupEdit, tick: number) => void;
  onExtent: (owner: object, endTick?: number) => void;
}

interface ActiveGesture {
  group: ChordTrackGroup;
  edit: ChordGroupEdit;
  pointer: number;
  initialX: number;
  x: number;
  left: number;
  moved: boolean;
  options: Options;
  target: HTMLDivElement;
  scroller: HTMLDivElement;
  release: () => void;
  autoScroll?: HorizontalEdgeScrollController;
}

type Preview = { group: ChordTrackGroup; edit: ChordGroupEdit; start: number; end: number };

export function useChordGroupGesture(options: Options) {
  const current = useRef(options);
  current.current = options;
  const active = useRef<ActiveGesture | null>(null);
  const [preview, setPreview] = useState<Preview>();

  function valid(gesture: ActiveGesture) {
    const next = current.current, original = gesture.options;
    return next.project === original.project && next.scale === original.scale && next.meter === original.meter
      && next.step === original.step && next.owner === original.owner && (!next.getOwner || next.getOwner() === original.owner)
      && next.lane.current === gesture.target && next.scroll.current === gesture.scroller;
  }
  function finish(clear = true) {
    const gesture = active.current;
    if (!gesture) return;
    active.current = null;
    gesture.autoScroll?.stop();
    gesture.release();
    if (clear) {
      setPreview(undefined);
      gesture.options.onExtent(gesture);
    }
  }
  function targetTick(gesture: ActiveGesture) {
    const { meter, scale, step } = gesture.options;
    const origin = gesture.edit === 'trim-end' ? gesture.group.end : gesture.group.start;
    const offset = gesture.x - gesture.initialX + gesture.scroller.scrollLeft - gesture.left;
    return Math.abs(offset) < 3 ? origin : meter.snap(Math.max(0, origin + offset / scale), step);
  }
  function update(gesture: ActiveGesture) {
    if (!valid(gesture)) { finish(); return; }
    gesture.moved ||= Math.abs(gesture.x - gesture.initialX) >= 3;
    if (!gesture.moved) return;
    const range = chordGroupEditRange(gesture.group, gesture.edit, targetTick(gesture));
    setPreview(previous => !range ? undefined : previous?.start === range.start && previous.end === range.end
      ? previous : { ...range, group: gesture.group, edit: gesture.edit });
    gesture.options.onExtent(gesture, range?.end);
  }
  function start(event: PointerEvent<HTMLButtonElement>, group: ChordTrackGroup) {
    if (event.button !== 0 || active.current || !options.onCommit || event.ctrlKey || event.metaKey) return;
    const target = options.lane.current, scroller = options.scroll.current;
    if (!target || !scroller) return;
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-chord-group-edge]')?.dataset.chordGroupEdge;
    const edit = edge === 'start' ? 'trim-start' : edge === 'end' ? 'trim-end' : event.altKey ? 'copy' : 'move';
    event.preventDefault();
    event.stopPropagation();
    const gesture: ActiveGesture = { group, edit, pointer: event.pointerId, initialX: event.clientX, x: event.clientX,
      left: scroller.scrollLeft, moved: false, options, target, scroller, release: () => {} };
    active.current = gesture;
    gesture.release = captureEditorPointer(target, event.pointerId, finish);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const gesture = active.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    gesture.x = event.clientX;
    update(gesture);
    if (active.current !== gesture || !gesture.moved) return;
    gesture.autoScroll ??= startHorizontalEdgeScroll(gesture.scroller, gesture.x, {
      isActive: () => active.current === gesture && valid(gesture),
      onScroll: () => update(gesture),
    });
    gesture.autoScroll.move(gesture.x);
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    const gesture = active.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    gesture.x = event.clientX;
    const commit = valid(gesture) && (gesture.moved || Math.abs(gesture.x - gesture.initialX) >= 3);
    const tick = targetTick(gesture);
    finish();
    if (commit) current.current.onCommit?.(gesture.options.project, gesture.group.start, gesture.edit, tick);
  }
  function cancel(event: PointerEvent<HTMLDivElement>) {
    if (active.current?.pointer === event.pointerId) finish();
  }
  useLayoutEffect(() => {
    if (active.current && !valid(active.current)) finish();
  });
  useLayoutEffect(() => () => {
    const gesture = active.current;
    if (!gesture) return;
    finish(false);
    gesture.options.onExtent(gesture);
  }, []);
  return { preview, start, move, end, cancel };
}
