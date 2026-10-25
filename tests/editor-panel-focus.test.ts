import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { clamp } from '../src/core/project';

// Actual component callbacks with inert hooks/refs and a small closest/contains
// element model. This is unit coverage, not physical pointer or Tab delivery.
const source = readFileSync(new URL('../src/ui/ResizableEditorPanels.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('const HANDLE =');
if (start < 0) throw new Error('ResizableEditorPanels constants were not found');
const code = transformSync(source.slice(start).replace('export function ResizableEditorPanels(', 'function ResizableEditorPanels('), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'renderElement' }).code;
type Panel = 'arrangement' | 'piano';
type InertElement = { type: unknown; props: Record<string, any> };

class ElementStub {
  focus = vi.fn();
  constructor(readonly tag: string, readonly attributes: Record<string, string> = {}, readonly parent?: ElementStub) {}
  contains(element: ElementStub): boolean { for (let node: ElementStub | undefined = element; node; node = node.parent) if (node === this) return true; return false; }
  closest(selectors: string): ElementStub | null {
    const matches = (node: ElementStub, selector: string) => {
      if (selector === '[contenteditable]:not([contenteditable="false"])') return 'contenteditable' in node.attributes && node.attributes.contenteditable !== 'false';
      if (/^[a-z]+$/.test(selector)) return node.tag === selector;
      const match = selector.match(/^([a-z]+)?\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (!match) throw new Error(`Unsupported inert selector ${selector}`);
      return (!match[1] || match[1] === node.tag) && match[2] in node.attributes && (match[3] === undefined || node.attributes[match[2]] === match[3]);
    };
    for (let node: ElementStub | undefined = this; node; node = node.parent) if (selectors.split(',').some(selector => matches(node!, selector.trim()))) return node;
    return null;
  }
}

function panelFixture() {
  const hooks: any[] = [], pending: (() => void)[] = [], stored = new Map<string, string>();
  let hook = 0, dirty = false;
  const container = { clientHeight: 800 };
  const useRef = (initial: unknown) => { const index = hook++; hooks[index] ??= { current: initial }; return hooks[index]; };
  const useState = (initial: any) => { const index = hook++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], (next: any) => { const value = typeof next === 'function' ? next(hooks[index]) : next; if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; } }]; };
  const useLayoutEffect = (effect: () => unknown) => { const index = hook++; if (!(index in hooks)) { hooks[index] = true; pending.push(effect); } };
  const renderElement = (type: unknown, attributes: any, ...children: any[]): InertElement => { if (attributes?.ref) attributes.ref.current = container; return { type, props: { ...attributes, children } }; };
  class ResizeObserverStub { constructor(private readonly callback: () => void) {} observe() { this.callback(); } disconnect() {} }
  const dependencies = { useRef, useState, useLayoutEffect, useId: () => 'editor-panels-unit', renderElement, clamp, ResizeObserver: ResizeObserverStub, localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) } };
  const Component = Function(...Object.keys(dependencies), `${code}\nreturn ResizableEditorPanels;`)(...Object.values(dependencies));
  const onActivePanel = vi.fn((activePanel: Panel) => { props = { ...props, activePanel }; dirty = true; });
  let props = { arrangement: 'Arrangement content', piano: 'Piano content', activePanel: 'arrangement' as Panel, onActivePanel };
  const render = (): InertElement => { let tree: InertElement, attempts = 0; do { dirty = false; hook = 0; tree = Component(props); while (pending.length) pending.shift()!(); if (++attempts > 10) throw new Error('Panel callback harness did not settle'); } while (dirty); return tree; };
  const wrappers = { arrangement: new ElementStub('div', { tabindex: '-1' }), piano: new ElementStub('div', { tabindex: '-1' }) };
  const node = (panel: Panel) => render().props.children.find((child: InertElement) => child.props['data-editor-area'] === panel) as InertElement;
  const event = (panel: Panel, target: ElementStub) => ({ target, currentTarget: wrappers[panel], button: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  render();
  return { node, wrappers, event, render, onActivePanel, active: () => props.activePanel };
}

describe('editor panel focus callbacks (no browser input)', () => {
  it.each(['arrangement', 'piano'] as const)('%s title/blank clicks focus only their wrapper without cancelling the event', panel => {
    const state = panelFixture(), other = panel === 'arrangement' ? 'piano' : 'arrangement', wrapper = state.wrappers[panel];
    for (const target of [wrapper, new ElementStub('div', {}, wrapper), new ElementStub('span', {}, wrapper), new ElementStub('div', { contenteditable: 'false' }, wrapper)]) {
      const event = state.event(panel, target);
      state.node(panel).props.onPointerDownCapture(event);
      expect(state.active()).toBe(panel); expect(state.onActivePanel).toHaveBeenLastCalledWith(panel);
      expect(wrapper.focus).toHaveBeenLastCalledWith({ preventScroll: true }); expect(state.wrappers[other].focus).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    expect(wrapper.focus).toHaveBeenCalledTimes(4);
    expect(state.node(panel).props).toMatchObject({ role: 'region', tabIndex: -1, 'data-active': true, 'aria-label': panel === 'piano' ? '钢琴编辑面板' : '编曲编辑面板' });
    expect(state.node(other).props['data-active']).toBe(false);
  });

  it('preserves native control focus and default handling, including nested button and slider targets', () => {
    const controls: [string, Record<string, string>][] = [
      ['button', {}], ['input', {}], ['input', { type: 'range' }], ['select', {}], ['textarea', {}], ['a', { href: '#item' }],
      ['div', { tabindex: '0' }], ['div', { contenteditable: '' }], ['div', { contenteditable: 'true' }],
      ['div', { role: 'button' }], ['div', { role: 'slider' }], ['div', { role: 'scrollbar' }],
    ];
    for (const panel of ['arrangement', 'piano'] as const) {
      const state = panelFixture();
      for (const [tag, attributes] of controls) {
        const control = new ElementStub(tag, attributes, state.wrappers[panel]), target = new ElementStub('span', {}, control), event = state.event(panel, target);
        state.node(panel).props.onPointerDownCapture(event);
        expect(state.active()).toBe(panel); expect(state.onActivePanel).toHaveBeenLastCalledWith(panel);
        expect(state.wrappers.arrangement.focus).not.toHaveBeenCalled(); expect(state.wrappers.piano.focus).not.toHaveBeenCalled(); expect(control.focus).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.stopPropagation).not.toHaveBeenCalled();
      }
    }
  });

  it('focus capture changes the active area in either direction without forcing focus onto a wrapper', () => {
    const state = panelFixture();
    // Represents focus arriving through Tab or a native control. No key is sent.
    for (const panel of ['piano', 'arrangement'] as const) {
      const input = new ElementStub('input', {}, state.wrappers[panel]);
      state.node(panel).props.onFocusCapture(state.event(panel, input));
      expect(state.active()).toBe(panel); expect(state.node(panel).props['data-active']).toBe(true);
      expect(state.node(panel === 'piano' ? 'arrangement' : 'piano').props['data-active']).toBe(false);
    }
    expect(state.onActivePanel.mock.calls).toEqual([['piano'], ['arrangement']]);
    expect(state.wrappers.arrangement.focus).not.toHaveBeenCalled(); expect(state.wrappers.piano.focus).not.toHaveBeenCalled();
  });

  it('leaves divider keyboard resizing independent from editor-area activation', () => {
    const state = panelFixture();
    for (const panel of ['arrangement', 'piano'] as const) {
      expect(state.node(panel).props.onKeyDown).toBeUndefined(); expect(state.node(panel).props.onKeyDownCapture).toBeUndefined();
    }
    const divider = () => state.render().props.children.find((child: InertElement) => child.props.role === 'separator') as InertElement;
    const before = divider().props['aria-valuenow'], key = { key: 'ArrowDown', shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    divider().props.onKeyDown(key);
    expect(divider().props['aria-valuenow']).toBe(before + 12); expect(key.preventDefault).toHaveBeenCalledOnce(); expect(key.stopPropagation).toHaveBeenCalledOnce();
    const ignored = { key: 'Delete', shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    divider().props.onKeyDown(ignored);
    expect(ignored.preventDefault).not.toHaveBeenCalled(); expect(ignored.stopPropagation).not.toHaveBeenCalled();
    expect(state.onActivePanel).not.toHaveBeenCalled(); expect(state.active()).toBe('arrangement');
  });
});
