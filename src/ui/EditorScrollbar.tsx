import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clamp } from '../core/project';

interface Props {
  orientation: 'horizontal' | 'vertical';
  label: string;
  value: number;
  viewportSize: number;
  contentSize: number;
  onChange: (value: number) => void;
  className?: string;
  controls?: string;
}

/** A pixel-based scrollbar for canvas editors, with the same range as native scrolling. */
export function EditorScrollbar({ orientation, label, value, viewportSize, contentSize, onChange, className = '', controls }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; position: number; value: number } | null>(null);
  const [length, setLength] = useState(0), [dragging, setDragging] = useState(false);
  const horizontal = orientation === 'horizontal';
  const maximum = Math.max(0, contentSize - viewportSize), offset = clamp(value, 0, maximum);
  const thumbLength = maximum ? Math.min(length, Math.max(28, length * viewportSize / Math.max(1, contentSize))) : length;
  const travel = Math.max(0, length - thumbLength), position = maximum ? offset / maximum * travel : 0;
  const update = (next: number) => onChange(clamp(next, 0, maximum));
  const wheel = useRef<(event: WheelEvent) => void>(() => {});
  wheel.current = event => {
    if (!maximum || event.ctrlKey || event.metaKey) return;
    event.preventDefault(); event.stopPropagation();
    const units = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? viewportSize : 1;
    update(offset + (horizontal ? event.deltaX || event.deltaY : event.deltaY) * units);
  };
  const finish = (pointer: number) => {
    if (drag.current?.pointer !== pointer) return;
    drag.current = null; setDragging(false);
    if (track.current?.hasPointerCapture(pointer)) track.current.releasePointerCapture(pointer);
  };

  useLayoutEffect(() => {
    const element = track.current; if (!element) return;
    const measure = () => setLength(horizontal ? element.clientWidth : element.clientHeight);
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [horizontal]);
  useEffect(() => {
    const element = track.current; if (!element) return;
    const handleWheel = (event: WheelEvent) => wheel.current(event);
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  return <div ref={track} className={`editor-scrollbar ${orientation} ${dragging ? 'dragging' : ''} ${maximum ? '' : 'inactive'} ${className}`}
    role="scrollbar" aria-label={label} aria-controls={controls} aria-orientation={orientation} aria-valuemin={0} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(offset)} aria-disabled={!maximum} tabIndex={maximum ? 0 : -1}
    onPointerDown={event => {
      if (event.button !== 0 || !maximum) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      const bounds = event.currentTarget.getBoundingClientRect(), point = horizontal ? event.clientX - bounds.left : event.clientY - bounds.top;
      if (point < position || point > position + thumbLength) { update(offset + (point < position ? -1 : 1) * viewportSize * .9); return; }
      drag.current = { pointer: event.pointerId, position: horizontal ? event.clientX : event.clientY, value: offset };
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    }}
    onPointerMove={event => {
      const active = drag.current; if (!active || active.pointer !== event.pointerId || !travel) return;
      update(active.value + ((horizontal ? event.clientX : event.clientY) - active.position) / travel * maximum);
    }}
    onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)} onLostPointerCapture={event => finish(event.pointerId)}
    onKeyDown={event => {
      let next = offset;
      const backward = horizontal ? 'ArrowLeft' : 'ArrowUp', forward = horizontal ? 'ArrowRight' : 'ArrowDown';
      if (event.key === backward) next -= event.shiftKey ? viewportSize * .9 : 32;
      else if (event.key === forward) next += event.shiftKey ? viewportSize * .9 : 32;
      else if (event.key === 'PageUp') next -= viewportSize * .9;
      else if (event.key === 'PageDown') next += viewportSize * .9;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = maximum;
      else return;
      event.preventDefault(); event.stopPropagation(); update(next);
    }}>
    <div className="editor-scrollbar-thumb" style={horizontal ? { width: thumbLength, transform: `translateX(${position}px)` } : { height: thumbLength, transform: `translateY(${position}px)` }} />
  </div>;
}
