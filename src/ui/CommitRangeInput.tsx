import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { captureEditorPointer } from './pointer-capture';
import './CommitRangeInput.css';

export interface CommitRangeInputProps {
  value: number; min: number; max: number; step?: number; disabled?: boolean;
  'aria-label': string; contextKey: string; owner: object; getOwner: () => object;
  onPrepare?: () => boolean; onCommit: (value: number) => void | boolean;
  onPreview: (value: number | undefined) => void;
  formatValue: (value: number) => string;
}
type Target = { owner: object; context: string; value: number; min: number; max: number };
type Drag = Target & { pointer: number; valuePreview: number; stop: () => void; epoch: number; onPreview: CommitRangeInputProps['onPreview'] };

/** A pointer drag auditions locally and publishes one document edit on release. */
export function CommitRangeInput(props: CommitRangeInputProps) {
  const current = useRef(props); current.current = props;
  const active = useRef<Drag | null>(null), alive = useRef(true), cancelled = useRef(false), epoch = useRef(0);
  const [preview, setPreview] = useState<number | null>(null);
  const target = (): Target => { const p = current.current; return { owner: p.owner, context: p.contextKey, value: p.value, min: p.min, max: p.max }; };
  const valid = (snapshot: Target) => {
    const p = current.current;
    return alive.current && !p.disabled && p.owner === snapshot.owner && p.getOwner() === snapshot.owner
      && p.contextKey === snapshot.context && Object.is(p.value, snapshot.value) && p.min === snapshot.min && p.max === snapshot.max;
  };
  const finish = (cancel = true, update = true, clear = true) => {
    const drag = active.current; if (!drag) return;
    active.current = null; cancelled.current = cancel;
    if (update) setPreview(null);
    try { drag.stop(); } finally { if (clear) drag.onPreview(undefined); }
  };
  const prepare = (element?: HTMLInputElement) => {
    const before = current.current;
    if (!alive.current || before.disabled || before.getOwner() !== before.owner) return false;
    let prepared = false;
    // A number draft can synchronously replace the immutable project. Choose
    // the range target only after that commit and its React render complete.
    flushSync(() => {
      if (current.current.onPrepare?.() === false) return;
      element?.focus({ preventScroll: true }); prepared = true;
    });
    return prepared && alive.current && current.current.contextKey === before.contextKey && valid(target());
  };
  const commit = (value: number, snapshot: Target) => {
    if (!valid(snapshot) || !Number.isFinite(value) || value < snapshot.min || value > snapshot.max) return false;
    if (!Object.is(value, current.current.value)) return current.current.onCommit(value);
    return true;
  };
  useLayoutEffect(() => { if (active.current && !valid(active.current)) finish(); });
  useEffect(() => { alive.current = true; return () => { alive.current = false; finish(true, false); }; }, []);
  const shown = preview ?? props.value;
  return <span className="commit-range-input"><input type="range" aria-label={props['aria-label']} aria-valuetext={props.formatValue(shown)}
    value={shown} min={props.min} max={props.max} step={props.step ?? 1} disabled={props.disabled}
    onBlur={() => finish()}
    onPointerDown={event => {
      if (event.button !== 0) return;
      if (active.current) { event.preventDefault(); event.stopPropagation(); return; }
      event.stopPropagation();
      if (!prepare(event.currentTarget) || active.current) {
        // Prevent a refused press from focusing the range and resetting a
        // parse-invalid number draft through its default blur. A residual
        // native change from this press must not retry the rejected action.
        cancelled.current = true; event.preventDefault(); return;
      }
      cancelled.current = false;
      const p = current.current, drag: Drag = { ...target(), pointer: event.pointerId, valuePreview: p.value, stop: () => {}, epoch: ++epoch.current, onPreview: p.onPreview };
      active.current = drag; setPreview(drag.valuePreview);
      const stop = captureEditorPointer(event.currentTarget, event.pointerId, () => finish());
      if (active.current === drag) { drag.stop = stop; if (!valid(drag)) finish(); } else stop();
    }}
    onChange={event => {
      const value = Number(event.currentTarget.value), drag = active.current;
      if (!Number.isFinite(value)) return;
      if (drag) {
        if (!valid(drag)) { finish(); return; }
        drag.valuePreview = Math.max(drag.min, Math.min(drag.max, value)); setPreview(drag.valuePreview); drag.onPreview(drag.valuePreview);
        if (active.current === drag && !valid(drag)) finish();
      } else if (!cancelled.current && prepare()) commit(value, target());
    }}
    onPointerUp={event => {
      const drag = active.current; if (!drag || drag.pointer !== event.pointerId) return;
      if (!valid(drag)) { finish(); return; }
      finish(false, true, false);
      try { if (!active.current && epoch.current === drag.epoch) commit(drag.valuePreview, drag); }
      finally { drag.onPreview(undefined); }
    }}
    onPointerCancel={event => { if (active.current?.pointer === event.pointerId) finish(); }}
    onLostPointerCapture={event => { if (active.current?.pointer === event.pointerId) finish(); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && active.current) { event.preventDefault(); event.stopPropagation(); finish(); }
      else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) cancelled.current = false;
    }} /><output>{props.formatValue(shown)}</output></span>;
}
