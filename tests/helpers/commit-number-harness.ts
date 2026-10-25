import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { vi } from 'vitest';
import type { CommitNumberInputProps } from '../../src/ui/CommitNumberInput';

// Run the real component and module-level flush in one eval scope. Inert hooks
// and input callbacks provide unit coverage, not browser input or focus delivery.
const source = readFileSync(new URL('../../src/ui/CommitNumberInput.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('const activeInputs =');
if (start < 0) throw new Error('CommitNumberInput registry was not found');
const code = transformSync(source.slice(start).replaceAll('export function ', 'function '), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'renderNumberElement' }).code;
type InputElement = { props: Record<string, any> };
type EffectSlot = { deps?: unknown[]; cleanup?: () => void };

export function createNumberInputHarness(options: Partial<CommitNumberInputProps> = {}) {
  const hooks: any[] = [], effects: (() => void)[] = [];
  let hook = 0, dirty = false, mounted = true, node: InputElement;
  const document = { activeElement: null as unknown };
  const onCommit = vi.fn(), onPendingChange = vi.fn();
  let props: CommitNumberInputProps = { value: 1, contextKey: 'note-a', 'aria-label': '音符数值', min: -10, max: 10, step: .25, onCommit, onPendingChange, ...options };
  const input = { value: '', validity: { stepMismatch: false }, focus: vi.fn(() => { document.activeElement = input; }), blur: vi.fn(() => {
    if (document.activeElement !== input) return;
    document.activeElement = null; node.props.onBlur({ currentTarget: input });
  }) };
  const useRef = (initial: unknown) => { const index = hook++; hooks[index] ??= { current: initial }; return hooks[index]; };
  const useState = (initial: any) => { const index = hook++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], (next: any) => { const value = typeof next === 'function' ? next(hooks[index]) : next; if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; } }]; };
  const useLayoutEffect = (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = hook++, previous: EffectSlot | undefined = hooks[index];
    if (!previous || !deps || !previous.deps || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
      const slot: EffectSlot = { deps }; hooks[index] = slot;
      effects.push(() => { previous?.cleanup?.(); const cleanup = effect(); if (typeof cleanup === 'function') slot.cleanup = cleanup; });
    }
  };
  const renderNumberElement = (_type: unknown, attributes: Record<string, any>): InputElement => { attributes.ref.current = input; input.value = String(attributes.value); return { props: attributes }; };
  const dependencies = { useRef, useState, useLayoutEffect, renderNumberElement, document };
  const { CommitNumberInput, flushActiveNumberInput } = Function(...Object.keys(dependencies), `${code}\nreturn { CommitNumberInput, flushActiveNumberInput };`)(...Object.values(dependencies));
  const render = (layoutEffects = true) => {
    let attempts = 0;
    do { hook = 0; dirty = false; node = CommitNumberInput(props); if (layoutEffects) while (effects.length) effects.shift()!(); if (++attempts > 20) throw new Error('Number input callback harness did not settle'); } while (layoutEffects && dirty);
    return node;
  };
  const change = (text: string) => { const current = render(); input.value = text; current.props.onChange({ currentTarget: input }); render(); };
  const key = (key: string) => { const event = { key, currentTarget: input, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() }; render().props.onKeyDown(event); render(); return event; };
  const blur = () => { input.blur(); render(); };
  const blurEvent = () => { document.activeElement = null; render().props.onBlur({ currentTarget: input }); render(); };
  const flush = (): boolean => { const result = flushActiveNumberInput(); if (mounted) render(); return result; };
  render(); input.focus();
  return { input, document, render, change, key, blur, blurEvent, flush, onCommit, onPendingChange, props: () => props,
    update: (change: Partial<CommitNumberInputProps>, layoutEffects = true) => { props = { ...props, ...change }; return render(layoutEffects); },
    unmount: () => { mounted = false; for (const slot of hooks) slot?.cleanup?.(); } };
}
