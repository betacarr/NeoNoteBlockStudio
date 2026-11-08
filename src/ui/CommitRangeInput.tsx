import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { captureEditorPointer } from './pointer-capture';
import './CommitRangeInput.css';

export interface CommitRangeInputProps {
  value: number; min: number; max: number; step?: number; disabled?: boolean;
  'aria-label': string; contextKey: string; owner: object; getOwner: () => object;
  onPrepare?: () => boolean; onCommit: (value: number) => void | boolean;
  onPreview: (value: number | undefined) => void;
  formatValue: (value: number) => string;
  dial?: boolean;
  /** Give short times more travel, while retaining the entire stored range. */
  curve?: 'time' | 'centered-time';
}
type Target = { owner: object; context: string; value: number; min: number; max: number };
type Drag = Target & { pointer: number; valuePreview: number; stop: () => void; epoch: number; onPreview: CommitRangeInputProps['onPreview']; dial?: { x: number; y: number; position: number } };

const TRAVEL = 1024;
const RANGE_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'];
const limit = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function positionOf(props: CommitRangeInputProps, value: number) {
  const knee = props.step ?? 1;
  const compress = (amount: number, span: number) => limit(Math.log1p(amount / knee) / Math.log1p(span / knee), 0, 1);
  if (props.curve === 'centered-time') return .5 + Math.sign(value) * .5 * compress(Math.abs(value), value < 0 ? -props.min : props.max);
  if (props.curve === 'time') return compress(Math.max(0, value - props.min), props.max - props.min);
  const fraction = limit((value - props.min) / (props.max - props.min), 0, 1);
  return fraction;
}

function valueAt(props: CommitRangeInputProps, position: number) {
  const fraction = limit(position, 0, 1);
  if (fraction === 0) return props.min;
  if (fraction === 1) return props.max;
  const knee = props.step ?? 1;
  const expand = (amount: number, span: number) => knee * Math.expm1(amount * Math.log1p(span / knee));
  if (props.curve === 'centered-time') {
    const signed = fraction * 2 - 1;
    return signed < 0 ? -expand(-signed, -props.min) : expand(signed, props.max);
  }
  const span = props.max - props.min;
  return props.min + (props.curve === 'time' ? expand(fraction, span) : span * fraction);
}

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
  const position = positionOf(props, shown);
  const audition = (drag: Drag, value: number) => {
    if (!valid(drag)) { finish(); return; }
    drag.valuePreview = limit(value, drag.min, drag.max); setPreview(drag.valuePreview); drag.onPreview(drag.valuePreview);
    if (active.current === drag && !valid(drag)) finish();
  };
  return <span className={`commit-range-input${props.dial ? ' parameter-dial' : ''}${props.curve === 'centered-time' ? ' parameter-centered' : ''}`}
    style={{ '--parameter-fill': `${position * 100}%` } as CSSProperties}><input type="range" aria-label={props['aria-label']} aria-valuetext={props.formatValue(shown)}
    aria-valuemin={props.curve ? props.min : undefined} aria-valuemax={props.curve ? props.max : undefined} aria-valuenow={props.curve ? shown : undefined}
    value={props.curve ? position * TRAVEL : shown} min={props.curve ? 0 : props.min} max={props.curve ? TRAVEL : props.max}
    step={props.curve ? 1 : props.step ?? 1} disabled={props.disabled}
    title={props.dial ? '上下拖动，按住 Shift 微调' : undefined}
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
      if (p.dial) {
        event.preventDefault();
        drag.dial = { x: event.clientX, y: event.clientY, position: positionOf(p, p.value) };
      }
      active.current = drag; setPreview(drag.valuePreview);
      const stop = captureEditorPointer(event.currentTarget, event.pointerId, () => finish());
      if (active.current === drag) { drag.stop = stop; if (!valid(drag)) finish(); } else stop();
    }}
    onPointerMove={event => {
      const drag = active.current, dial = drag?.dial;
      if (!drag || !dial || drag.pointer !== event.pointerId) return;
      const delta = dial.y - event.clientY + (event.clientX - dial.x) * .35;
      if (!delta) return;
      dial.x = event.clientX; dial.y = event.clientY;
      dial.position = limit(dial.position + delta / (event.shiftKey ? 1600 : 160), 0, 1);
      audition(drag, valueAt(current.current, dial.position));
    }}
    onChange={event => {
      const raw = Number(event.currentTarget.value), drag = active.current, p = current.current;
      if (!Number.isFinite(raw) || drag?.dial) return;
      const value = p.curve ? valueAt(p, raw / TRAVEL) : raw;
      if (drag) audition(drag, value);
      else if (!cancelled.current && prepare()) commit(value, target());
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
      else if (RANGE_KEYS.includes(event.key)) {
        cancelled.current = false;
        if (!current.current.curve) return;
        event.preventDefault(); event.stopPropagation();
        if (active.current || !prepare()) return;
        const p = current.current, step = (p.step ?? 1) * (event.shiftKey ? .1 : 1), key = event.key;
        const value = key === 'Home' ? p.min : key === 'End' ? p.max
          : p.value + step * (key === 'PageUp' ? 10 : key === 'PageDown' ? -10 : key === 'ArrowUp' || key === 'ArrowRight' ? 1 : -1);
        commit(limit(+value.toPrecision(13), p.min, p.max), target());
      }
    }} />{props.dial && <svg className="parameter-dial-face" viewBox="0 0 40 40" aria-hidden="true">
      <path className="dial-track" d="M10.1 29.9a14 14 0 1 1 19.8 0" pathLength={1} />
      <path className="dial-level" d="M10.1 29.9a14 14 0 1 1 19.8 0" pathLength={1} strokeDasharray={`${position} 1`} />
      <circle cx={20} cy={20} r={10.5} />
      <line x1={20} y1={11} x2={20} y2={16} transform={`rotate(${-135 + position * 270} 20 20)`} />
    </svg>}<output data-value={shown}>{props.formatValue(shown)}</output></span>;
}
