import { useLayoutEffect, useRef, useState } from 'react';

export interface CommitNumberInputProps {
  value: number;
  onCommit: (value: number) => void | boolean;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  disabled?: boolean;
  'aria-label': string;
  contextKey: string;
  onPendingChange?: (pending: boolean) => void;
}

const activeInputs = new WeakMap<HTMLInputElement, () => boolean>();

/** Flush only a currently focused input owned by this component. */
export function flushActiveNumberInput(): boolean {
  if (typeof document === 'undefined' || !document.activeElement) return true;
  return activeInputs.get(document.activeElement as HTMLInputElement)?.() ?? true;
}

interface Owner { value: number; contextKey: string; disabled: boolean }
const sameOwner = (a: Owner, b: Owner) => Object.is(a.value, b.value) && a.contextKey === b.contextKey && a.disabled === b.disabled;

function parseDraft(text: string, props: CommitNumberInputProps): number | undefined {
  const trimmed = text.trim();
  if (!trimmed || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return;
  const number = Number(trimmed);
  // Native stepMismatch is deliberately ignored: musical microtiming is valid.
  if (!Number.isFinite(number)) return;
  // Legacy model values outside today's input limits are still unchanged data.
  if (number === props.value) return number;
  if (props.min !== undefined && number < props.min || props.max !== undefined && number > props.max || props.integer && !Number.isInteger(number)) return;
  return number;
}

export function CommitNumberInput(props: CommitNumberInputProps) {
  const { value, contextKey, disabled } = props;
  const owner: Owner = { value, contextKey, disabled: !!disabled };
  const [draft, setDraft] = useState(() => String(value)), [invalid, setInvalid] = useState(false);
  const model = useRef(owner), text = useRef(String(value)), edited = useRef(false), committing = useRef(false);
  const rejected = useRef(false);
  const latest = useRef(props); latest.current = props;
  const input = useRef<HTMLInputElement>(null), flush = useRef<() => boolean>(() => true);
  const pending = useRef(false), reportedPending = useRef(false);
  const pendingCallback = useRef<CommitNumberInputProps['onPendingChange']>(undefined);

  // Invalidate before a blur/flush can pair an old draft with a new target.
  // Conditional local state reset also prevents a prior target's text resurfacing.
  const ownerChanged = !sameOwner(model.current, owner);
  if (ownerChanged) {
    model.current = owner; text.current = String(value); edited.current = false; pending.current = false; rejected.current = false;
    setDraft(String(value)); setInvalid(false);
  }

  const stillOwned = () => sameOwner(model.current, owner);
  function reportPending(next: boolean) {
    pending.current = next;
    if (reportedPending.current === next) return;
    const callback = next ? latest.current.onPendingChange : pendingCallback.current ?? latest.current.onPendingChange;
    reportedPending.current = next; pendingCallback.current = next ? callback : undefined;
    callback?.(next);
  }
  function reset() {
    if (!stillOwned()) return;
    text.current = String(latest.current.value); edited.current = false; rejected.current = false;
    setDraft(text.current); setInvalid(false); reportPending(false);
  }
  function commit(): boolean {
    if (!stillOwned() || latest.current.disabled || committing.current) return false;
    if (!edited.current) return true;
    const number = parseDraft(text.current, latest.current);
    if (number === undefined) { rejected.current = false; setInvalid(true); reportPending(true); return false; }
    const originalText = text.current;
    committing.current = true;
    try {
      // Clear synchronously before onCommit/blur, even if they immediately re-enter.
      edited.current = false; text.current = String(number); rejected.current = false;
      setDraft(text.current); setInvalid(false); reportPending(false);
      // A pending notification can synchronously replace the owner or disable it.
      if (stillOwned() && !latest.current.disabled && number !== latest.current.value && latest.current.onCommit(number) === false) {
        if (stillOwned() && !latest.current.disabled) {
          text.current = originalText; edited.current = true; rejected.current = true;
          setDraft(originalText); setInvalid(true); reportPending(true);
        }
        return false;
      }
      return true;
    } finally { committing.current = false; }
  }
  const blurInput = (element: HTMLInputElement) => element.blur();
  flush.current = () => {
    if (!stillOwned()) return false;
    if (latest.current.disabled) { reset(); if (input.current) blurInput(input.current); return true; }
    if (!commit()) return false;
    if (input.current) blurInput(input.current);
    return true;
  };
  useLayoutEffect(() => {
    const element = input.current;
    if (element) activeInputs.set(element, () => flush.current());
    return () => { if (element) activeInputs.delete(element); reportPending(false); };
  }, []);
  // Report external invalidation after commit, never set parent state in render.
  useLayoutEffect(() => { reportPending(pending.current); });

  const showInvalid = !ownerChanged && invalid;
  const range = props.min !== undefined && props.max !== undefined ? `${String(props.min)} 至 ${String(props.max)}`
    : props.min !== undefined ? `至少 ${String(props.min)}` : props.max !== undefined ? `最多 ${String(props.max)}` : '';
  const title = showInvalid ? `请输入有效${props.integer ? '整数' : '数字'}${range ? `（${range}）` : ''}。` : 'Enter 确认，Esc 取消；离开输入框时提交';
  return <input type="number" inputMode="decimal" aria-label={props['aria-label']} title={title} min={props.min} max={props.max} step={props.step} disabled={disabled}
    value={ownerChanged ? String(value) : draft} aria-invalid={showInvalid || undefined} ref={input}
    onChange={event => {
      if (!stillOwned() || latest.current.disabled) return;
      text.current = event.currentTarget.value; edited.current = true; rejected.current = false;
      setDraft(text.current); setInvalid(false);
      const number = parseDraft(text.current, latest.current);
      reportPending(number === undefined || number !== latest.current.value);
    }}
    onBlur={() => {
      if (!stillOwned() || latest.current.disabled || committing.current) return;
      // A model rejection remains pending after focus moves so saving cannot
      // silently omit it. Parse-invalid drafts retain the existing blur reset.
      if (!commit() && !rejected.current) reset();
    }}
    onKeyDown={event => {
      if (event.nativeEvent?.isComposing || event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      if (!stillOwned()) return;
      if (event.key === 'Escape') { reset(); blurInput(event.currentTarget); }
      else if (commit()) blurInput(event.currentTarget);
    }} />;
}
