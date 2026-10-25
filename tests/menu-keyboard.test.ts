import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import type { StudioMenu } from '../src/ui/MenuBar';

// Invoke the actual component's callbacks with lazy hooks and inert DOM objects.
// This is a component unit test, not physical keyboard or browser acceptance.
const source = readFileSync(new URL('../src/ui/MenuBar.tsx', import.meta.url), 'utf8');
const start = source.indexOf('export function MenuBar(');
if (start < 0) throw new Error('MenuBar component was not found');
const component = transformSync(source.slice(start).replace('export function MenuBar(', 'function MenuBar('), { loader: 'tsx', target: 'es2022', jsx: 'transform', jsxFactory: 'element' }).code;
type Tree = { type: unknown; props: Record<string, any> };
type Effect = { deps: unknown[]; cleanup?: () => void };

function menuFixture() {
  const menus: StudioMenu[] = [
    { label: '文件', items: [{ label: '新建', command: 'new' }, { label: '不可用', command: 'disabled', disabled: true }, { label: '打开', command: 'open' }] },
    { label: '设置', command: 'settings' },
    { label: '编辑', items: [{ label: '复制', command: 'copy' }, { label: '删除', command: 'delete' }] },
  ];
  const hooks: any[] = [], pending: (() => void)[] = [], frames = new Map<number, () => void>();
  let hook = 0, frame = 0, tree: Tree;
  const doc = { activeElement: null as object | null, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const button = () => { const node = { focus: vi.fn(() => { doc.activeElement = node; }) }; return node; };
  const triggers = menus.map(button), items = menus.map(menu => menu.items?.map(button) ?? []);
  const root = {
    contains: (node: object | null) => node === root || triggers.includes(node as typeof triggers[number]) || items.some(group => group.includes(node as typeof triggers[number])),
    querySelectorAll: (selector: string) => selector === '.menu-trigger' ? triggers : hooks[0] === null ? [] : items[hooks[0]].filter((_item, i) => !menus[hooks[0]].items![i].disabled),
    querySelector: (selector: string) => root.querySelectorAll(selector)[0],
  };
  const useState = (initial: unknown) => { const index = hook++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], (next: unknown) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; };
  const useRef = (initial: unknown) => { const index = hook++; hooks[index] ??= { current: initial }; return hooks[index]; };
  const useEffect = (callback: () => void | (() => void), deps: unknown[]) => {
    const index = hook++, previous: Effect | undefined = hooks[index];
    if (!previous || previous.deps.length !== deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      const slot: Effect = { deps }; hooks[index] = slot;
      pending.push(() => { previous?.cleanup?.(); const cleanup = callback(); if (typeof cleanup === 'function') slot.cleanup = cleanup; });
    }
  };
  const element = (type: unknown, props: any, ...children: any[]): Tree => { if (props?.ref) props.ref.current = root; return { type, props: { ...props, children } }; };
  const dependencies = { useState, useRef, useEffect, element, document: doc, requestAnimationFrame: (callback: () => void) => { frames.set(++frame, callback); return frame; }, cancelAnimationFrame: (id: number) => frames.delete(id) };
  const Component = Function(...Object.keys(dependencies), `${component}\nreturn MenuBar;`)(...Object.values(dependencies));
  const onCommand = vi.fn();
  const render = () => { hook = 0; tree = Component({ menus, onCommand }); while (pending.length) pending.shift()!(); return tree; };
  const all = (node: Tree): Tree[] => [node, ...node.props.children.flat(Infinity).filter((child: any) => child && typeof child === 'object').flatMap(all)];
  const buttons = () => all(render()).filter(node => node.type === 'button');
  const openMenu = (index = 0) => { buttons().filter(node => node.props.className?.startsWith('menu-trigger'))[index].props.onClick(); render(); };
  const flushFrames = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
  const event = (key: string) => ({ key, currentTarget: root, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  const key = (name: string) => { const e = event(name); render().props.onKeyDown(e); render(); return e; };
  const blur = (relatedTarget: object | null) => { render().props.onBlur({ currentTarget: root, relatedTarget }); render(); };
  render();
  return { render, openMenu, flushFrames, event, key, blur, root, doc, frames, triggers, items, onCommand, buttons, open: () => hooks[0] as number | null };
}

describe('MenuBar keyboard ownership', () => {
  it.each(['Delete', 'Backspace', 'P', 'D', 'Z'])('isolates %s while a menu is open without suppressing browser defaults', name => {
    const state = menuFixture(); state.openMenu();
    const event = state.key(name);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1); expect(event.preventDefault).not.toHaveBeenCalled();
    expect(state.open()).toBe(0); expect(state.onCommand).not.toHaveBeenCalled();
  });

  it('also isolates closed top-level triggers from editor Delete and tool shortcuts', () => {
    const state = menuFixture(); state.triggers[0].focus();
    for (const name of ['Delete', 'Backspace', 'P']) {
      const event = state.key(name);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1); expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(state.open()).toBeNull(); expect(state.onCommand).not.toHaveBeenCalled();
  });

  it('closes with Escape, prevents its default, and returns focus to the owning trigger', () => {
    const state = menuFixture(); state.openMenu(2); state.flushFrames();
    expect(state.doc.activeElement).toBe(state.items[2][0]);
    const event = state.key('Escape');
    expect(event.stopPropagation).toHaveBeenCalledTimes(1); expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(state.open()).toBeNull(); expect(state.doc.activeElement).toBe(state.triggers[2]);
  });

  it('retains up/down navigation across enabled items and left/right menu navigation', () => {
    const state = menuFixture(); state.openMenu(); state.flushFrames();
    expect(state.doc.activeElement).toBe(state.items[0][0]);
    expect(state.key('ArrowDown').preventDefault).toHaveBeenCalledTimes(1);
    expect(state.doc.activeElement).toBe(state.items[0][2]);
    state.key('ArrowUp'); expect(state.doc.activeElement).toBe(state.items[0][0]);
    state.key('ArrowRight'); expect(state.open()).toBe(2); state.flushFrames();
    expect(state.doc.activeElement).toBe(state.items[2][0]);
    state.key('ArrowLeft'); expect(state.open()).toBe(0);
  });

  it.each(['Enter', ' '])('retains native %j activation for triggers and menu items', name => {
    const state = menuFixture();
    expect(state.key(name).preventDefault).not.toHaveBeenCalled();
    // Native button activation supplies the click; the menu must not double-dispatch it.
    state.openMenu(); const event = state.key(name);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1); expect(event.preventDefault).not.toHaveBeenCalled();
    expect(state.onCommand).not.toHaveBeenCalled();
    state.buttons().find(node => node.props.children.flat(Infinity).some((child: any) => child?.props?.children.includes('新建')))?.props.onClick();
    expect(state.onCommand).toHaveBeenCalledExactlyOnceWith('new'); expect(state.open()).toBeNull();
  });

  it('allows Tab to leave, closes on external blur, and cancels pending focus without stealing it back', () => {
    const state = menuFixture(); state.openMenu();
    const event = state.key('Tab');
    expect(event.stopPropagation).toHaveBeenCalledTimes(1); expect(event.preventDefault).not.toHaveBeenCalled();
    const outside = {}; state.doc.activeElement = outside; state.blur(outside); state.flushFrames();
    expect(state.open()).toBeNull(); expect(state.doc.activeElement).toBe(outside); expect(state.frames.size).toBe(0);
  });

  it('keeps the menu open while focus moves between its descendants, including by Tab', () => {
    const state = menuFixture(); state.openMenu();
    expect(state.key('Tab').preventDefault).not.toHaveBeenCalled();
    state.blur(state.items[0][2]); expect(state.open()).toBe(0);
    state.blur(state.triggers[2]); expect(state.open()).toBe(0);
  });

  it('closes when focus leaves the document and relatedTarget is null', () => {
    const state = menuFixture(); state.openMenu(); state.blur(null);
    expect(state.open()).toBeNull();
  });
});
