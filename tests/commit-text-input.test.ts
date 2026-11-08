import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import type { CommitTextInputProps } from '../src/ui/CommitTextInput';

// Run the component's real callbacks and registry; native browser focus/IME is
// verified separately by the desktop smoke, rather than simulated by this test.
const source = readFileSync(new URL('../src/ui/CommitTextInput.tsx', import.meta.url), 'utf8');
const code = transformSync(source.slice(source.indexOf('const activeInputs =')).replaceAll('export function ', 'function '), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'element' }).code;
function fixture(options: Partial<CommitTextInputProps> = {}) {
  const hooks: any[] = [], effects: (() => void)[] = [];
  let hook = 0, dirty = false, node: any;
  const document = { activeElement: null as any }, onCommit = vi.fn(), onPendingChange = vi.fn();
  let props: CommitTextInputProps = { value: 'Track', contextKey: 'project-a/track-a', 'aria-label': '名称', onCommit, onPendingChange, ...options };
  const input = { value: '', focus: () => { document.activeElement = input; }, blur: vi.fn(() => {
    if (document.activeElement !== input) return;
    document.activeElement = null; node.props.onBlur({ currentTarget: input });
  }) };
  const useRef = (initial: unknown) => { const index = hook++; return hooks[index] ??= { current: initial }; };
  const useState = (initial: any) => { const index = hook++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (next: any) => { const value = typeof next === 'function' ? next(hooks[index]) : next; if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; } }]; };
  const useLayoutEffect = (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = hook++, previous = hooks[index];
    if (previous && deps && previous.deps && deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    const slot: any = { deps }; hooks[index] = slot; effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
  };
  const element = (type: any, attributes: any) => { typeof attributes.ref === 'function' ? attributes.ref(input) : attributes.ref.current = input; input.value = attributes.value; return { type, props: attributes }; };
  const deps = { useRef, useState, useLayoutEffect, element, document };
  const { CommitTextInput, flushActiveTextInput } = Function(...Object.keys(deps), code + '\nreturn { CommitTextInput, flushActiveTextInput };')(...Object.values(deps));
  function render(layout = true) {
    let count = 0;
    do { hook = 0; dirty = false; node = CommitTextInput(props); if (layout) while (effects.length) effects.shift()!(); if (++count > 20) throw Error('Text harness did not settle'); } while (layout && dirty);
    return node;
  }
  const change = (text: string) => { render(); input.value = text; node.props.onChange({ currentTarget: input }); render(); };
  const key = (key: string, isComposing = false, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) => { const event = { key, nativeEvent: { isComposing }, currentTarget: input, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...modifiers }; render().props.onKeyDown(event); render(); return event; };
  render(); input.focus();
  return { input, document, onCommit, onPendingChange, change, key, render,
    blur: () => { input.blur(); render(); }, flush: () => { const result = flushActiveTextInput(); render(); return result; },
    update: (patch: Partial<CommitTextInputProps>, layout = true) => { props = { ...props, ...patch }; render(layout); },
    unmount: () => { for (const slot of hooks) slot?.cleanup?.(); } };
}

describe('CommitTextInput editing sessions', () => {
  it('commits the entire rename once instead of publishing intermediate characters', () => {
    const test = fixture();
    for (const value of ['T', 'Tr', 'Tra', 'Track ABC']) test.change(value);
    expect(test.onCommit).not.toHaveBeenCalled(); expect(test.render().props.value).toBe('Track ABC');
    test.key('Enter'); test.blur();
    expect(test.onCommit.mock.calls).toEqual([['Track ABC']]); expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]);
  });
  it('supports complete blank drafts and a single blur commit', () => {
    const test = fixture(); test.change(''); expect(test.onCommit).not.toHaveBeenCalled(); test.blur();
    expect(test.onCommit.mock.calls).toEqual([['']]);
  });
  it('Escape restores the original name and does not escape into the containing dialog', () => {
    const test = fixture(); test.change('Edited'); const e = test.key('Escape');
    expect(e.stopPropagation).toHaveBeenCalledOnce(); expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(test.render().props.value).toBe('Track'); expect(test.onCommit).not.toHaveBeenCalled();
    expect(test.document.activeElement).toBeNull(); expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]);
  });
  it('does not treat the Enter used to compose an IME character as confirmation', () => {
    const test = fixture(); test.change('鼓组'); const e = test.key('Enter', true);
    expect(e.preventDefault).not.toHaveBeenCalled(); expect(test.onCommit).not.toHaveBeenCalled();
    expect(test.document.activeElement).toBe(test.input);
  });
  it('keeps multiline Enter as a newline and commits a complete description with Ctrl/Cmd+Enter', () => {
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
      const test = fixture({ multiline: true }); expect(test.render().type).toBe('textarea');
      test.change('First line'); expect(test.key('Enter').preventDefault).not.toHaveBeenCalled();
      test.change('First line\nSecond line'); expect(test.onCommit).not.toHaveBeenCalled();
      const event = test.key('Enter', false, modifiers); expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(test.onCommit.mock.calls).toEqual([['First line\nSecond line']]);
    }
  });
  it.each([{ contextKey: 'project-a/track-b' }, { value: 'External' }, { disabled: true }, { readOnly: true }])('discards a stale draft after owner change %j', patch => {
    const test = fixture(); test.change('Wrong target'); const stale = test.render(); test.update(patch, false);
    stale.props.onBlur(); expect(test.onCommit).not.toHaveBeenCalled();
    expect(test.render().props.value).toBe(patch.value ?? 'Track'); expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]);
  });
  it('flush commits pending text before a save snapshot and refuses a rejected rename', () => {
    const test = fixture(); test.change('New name'); expect(test.flush()).toBe(true); expect(test.flush()).toBe(true);
    expect(test.onCommit.mock.calls).toEqual([['New name']]);
    const rejected = fixture(); rejected.onCommit.mockReturnValue(false); rejected.change('Rejected');
    expect(rejected.flush()).toBe(false); expect(rejected.render().props.value).toBe('Rejected');
    expect(rejected.render().props['aria-invalid']).toBe(true); expect(rejected.document.activeElement).toBe(rejected.input);
    rejected.key('Escape'); expect(rejected.onCommit).toHaveBeenCalledOnce(); expect(rejected.render().props.value).toBe('Track');
  });
  it('clears pending state and does not create history for an unchanged session', () => {
    const test = fixture(); test.change('Other'); test.change('Track'); test.blur();
    expect(test.onCommit).not.toHaveBeenCalled(); expect(test.onPendingChange.mock.calls).toEqual([[true], [false]]);
    const changed = fixture(); changed.change('Draft'); changed.unmount(); expect(changed.onPendingChange.mock.calls).toEqual([[true], [false]]);
  });
});
