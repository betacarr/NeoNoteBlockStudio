import { useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

export interface CommitTextInputProps {
  value: string;
  contextKey: string;
  'aria-label': string;
  onCommit: (value: string) => void | boolean;
  onPendingChange?: (pending: boolean) => void;
  disabled?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  title?: string;
  multiline?: boolean;
}

const activeInputs = new WeakMap<HTMLInputElement | HTMLTextAreaElement, () => boolean>();

/** Flush the focused text editing session before Save, history or target changes. */
export function flushActiveTextInput(): boolean {
  if (typeof document === 'undefined' || !document.activeElement) return true;
  return activeInputs.get(document.activeElement as HTMLInputElement | HTMLTextAreaElement)?.() ?? true;
}

interface Owner { value: string; contextKey: string; disabled: boolean; readOnly: boolean; multiline: boolean }
const sameOwner = (a: Owner, b: Owner) => a.value === b.value && a.contextKey === b.contextKey && a.disabled === b.disabled && a.readOnly === b.readOnly && a.multiline === b.multiline;

/** Keystrokes stay in a local draft. Blur/Enter publishes one complete rename. */
export function CommitTextInput(props: CommitTextInputProps) {
  const { value, contextKey, disabled, readOnly } = props;
  const owner: Owner = { value, contextKey, disabled: !!disabled, readOnly: !!readOnly, multiline: !!props.multiline };
  const [draft, setDraft] = useState(value), [invalid, setInvalid] = useState(false);
  const model = useRef(owner), text = useRef(value), edited = useRef(false), committing = useRef(false);
  const latest = useRef(props); latest.current = props;
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null), flush = useRef<() => boolean>(() => true);
  const pending = useRef(false), reportedPending = useRef(false);
  const pendingCallback = useRef<CommitTextInputProps['onPendingChange']>(undefined);
  const ownerChanged = !sameOwner(model.current, owner);
  if (ownerChanged) {
    model.current = owner; text.current = value; edited.current = false; pending.current = false;
    setDraft(value); setInvalid(false);
  }
  const stillOwned = () => sameOwner(model.current, owner);
  function reportPending(next: boolean) {
    pending.current = next;
    if (reportedPending.current === next) return;
    const callback = next ? latest.current.onPendingChange : pendingCallback.current ?? latest.current.onPendingChange;
    reportedPending.current = next; pendingCallback.current = next ? callback : undefined; callback?.(next);
  }
  function reset() {
    if (!stillOwned()) return;
    text.current = latest.current.value; edited.current = false; setDraft(text.current); setInvalid(false); reportPending(false);
  }
  function commit(): boolean {
    if (!stillOwned() || latest.current.disabled || latest.current.readOnly || committing.current) return false;
    if (!edited.current) return true;
    const next = text.current;
    if (latest.current.maxLength !== undefined && next.length > latest.current.maxLength) { setInvalid(true); reportPending(true); return false; }
    committing.current = true;
    try {
      edited.current = false; setInvalid(false); reportPending(false);
      if (stillOwned() && !latest.current.disabled && !latest.current.readOnly && next !== latest.current.value && latest.current.onCommit(next) === false) {
        if (stillOwned() && !latest.current.disabled && !latest.current.readOnly) {
          text.current = next; edited.current = true; setDraft(next); setInvalid(true); reportPending(true);
        }
        return false;
      }
      return true;
    } finally { committing.current = false; }
  }
  flush.current = () => {
    if (!stillOwned()) return false;
    if (latest.current.disabled || latest.current.readOnly) { reset(); input.current?.blur(); return true; }
    if (!commit()) return false;
    input.current?.blur(); return true;
  };
  useLayoutEffect(() => {
    const element = input.current; if (element) activeInputs.set(element, () => flush.current());
    return () => { if (element) activeInputs.delete(element); reportPending(false); };
  }, [!!props.multiline]);
  useLayoutEffect(() => { reportPending(pending.current); });
  const attributes = {
    ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => { input.current = element; },
    'aria-label': props['aria-label'], value: ownerChanged ? value : draft, disabled, readOnly,
    maxLength: props.maxLength, placeholder: props.placeholder, className: props.className,
    title: invalid ? '修改未能提交，请修正或按 Esc 取消。' : props.title ?? `${props.multiline ? 'Ctrl / Cmd+Enter' : 'Enter'} 确认，Esc 取消；离开输入框时提交`,
    'aria-invalid': !ownerChanged && invalid || undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!stillOwned() || latest.current.disabled || latest.current.readOnly) return;
      text.current = event.currentTarget.value; edited.current = true; setDraft(text.current); setInvalid(false);
      reportPending(text.current !== latest.current.value);
    },
    onBlur: () => { if (stillOwned() && !latest.current.disabled && !latest.current.readOnly && !committing.current) commit(); },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing || event.key !== 'Enter' && event.key !== 'Escape') return;
      if (event.key === 'Enter' && latest.current.multiline && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); event.stopPropagation(); if (!stillOwned()) return;
      if (event.key === 'Escape') { reset(); event.currentTarget.blur(); }
      else if (commit()) event.currentTarget.blur();
    },
  };
  return props.multiline ? <textarea {...attributes} /> : <input type="text" {...attributes} />;
}
