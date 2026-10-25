import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { commandForShortcut, inspectShortcuts, isTransportSpace, shortcutForEvent } from '../src/core/shortcuts';

// Actual App effect registration, callbacks and play-table expression. Listener
// phases and control targets are inert boundaries, not browser or keyboard input.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('  useEffect(() => {\n    const onSpaceDown ='), end = source.indexOf('\n  useEffect(() => { const timer', start);
const tableStart = source.indexOf('    play: ', source.indexOf('  commands.current = {')), tableEnd = source.indexOf(', new:', tableStart);
if (start < 0 || end < 0 || tableStart < 0 || tableEnd < 0) throw new Error('Actual App keyboard effect/play binding was not found');
const code = transformSync(source.slice(start, end), { loader: 'ts', target: 'es2022' }).code;
const playCode = transformSync(`const bound = {${source.slice(tableStart, tableEnd)}};`, { loader: 'ts', target: 'es2022' }).code;

function fixture(options: { modal?: string; shortcuts?: Record<string, string>; keyboardEnabled?: boolean; platform?: string } = {}) {
  type Listener = { name: string; callback: (event: any) => void; capture: boolean };
  const listeners: Listener[] = [];
  const window = {
    addEventListener: vi.fn((name: string, callback: Listener['callback'], capture = false) => { listeners.push({ name, callback, capture }); }),
    removeEventListener: vi.fn((name: string, callback: Listener['callback'], capture = false) => { const index = listeners.findIndex(item => item.name === name && item.callback === callback && item.capture === capture); if (index >= 0) listeners.splice(index, 1); }),
  };
  const togglePlay = vi.fn(), play = Function('togglePlay', `${playCode}\nreturn bound.play;`)(togglePlay);
  const duplicate = vi.fn(), quantize = vi.fn(), commands = { current: { play, duplicate, quantize } as Record<string, () => void> };
  const midiDown = { current: vi.fn() }, midiUp = { current: vi.fn() }, setModal = vi.fn();
  const isShortcutInput = vi.fn((target: any) => !!target?.editable);
  let cleanup = () => {};
  const platform = options.platform ?? 'win32';
  const scope = { useEffect: (effect: () => () => void) => { cleanup = effect(); }, window, isTransportSpace, isShortcutInput, shortcutForEvent, commandForShortcut,
    shortcutPlatform: platform, modal: options.modal ?? null, setModal, keyboardEnabled: !!options.keyboardEnabled, recording: false, midiDown, midiUp, commands,
    bindings: inspectShortcuts('fl', options.shortcuts ?? {}, platform).effective };
  Function(...Object.keys(scope), code)(...Object.values(scope));
  const target = (kind: string) => ({ kind, editable: ['number', 'text', 'textarea', 'select', 'checkbox', 'range', 'contenteditable'].includes(kind), closest: vi.fn(() => ['button', 'link', 'menuitem', 'slider', 'scrollbar'].includes(kind) ? {} : null) });
  const fire = (name: 'keydown' | 'keyup', patch: Record<string, any> = {}) => {
    let stopped = false;
    const event: any = { key: ' ', code: 'Space', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false,
      defaultPrevented: false, getModifierState: () => false, target: target('canvas'), ...patch };
    event.preventDefault = vi.fn(() => { event.defaultPrevented = true; }); event.stopPropagation = vi.fn(() => { stopped = true; });
    for (const capture of [true, false]) {
      for (const listener of [...listeners].filter(listener => listener.name === name && listener.capture === capture)) listener.callback(event);
      if (stopped) break;
    }
    return event;
  };
  return { window, listeners, commands, togglePlay, duplicate, quantize, midiDown, midiUp, isShortcutInput, setModal, target, fire, cleanup: () => cleanup() };
}

describe('App global Space transport listeners (source-derived unit integration)', () => {
  it.each(['button', 'checkbox', 'range', 'select', 'number', 'text', 'textarea', 'contenteditable', 'link', 'menuitem', 'slider', 'scrollbar', 'modal'])('captures Space before the focused %s can consume it, including keyup', kind => {
    const test = fixture({ modal: kind === 'modal' ? 'settings' : undefined }), target = test.target(kind);
    for (const shiftKey of [false, true]) {
      const down = test.fire('keydown', { target, shiftKey }), up = test.fire('keyup', { target, shiftKey });
      for (const event of [down, up]) { expect(event.defaultPrevented).toBe(true); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce(); }
    }
    expect(test.togglePlay).toHaveBeenCalledTimes(2); expect(test.isShortcutInput).not.toHaveBeenCalled(); expect(target.closest).not.toHaveBeenCalled();
    expect(test.duplicate).not.toHaveBeenCalled(); expect(test.midiDown.current).not.toHaveBeenCalled(); expect(test.midiUp.current).not.toHaveBeenCalled();
    expect(test.setModal).not.toHaveBeenCalled(); test.cleanup();
  });

  it.each([{ key: ' ', code: '' }, { key: 'Spacebar', code: '' }, { key: 'Space', code: '' }, { key: 'Unidentified', code: 'Space' }])('supports bare Space event identity %j', identity => {
    const test = fixture(); expect(test.fire('keydown', identity).defaultPrevented).toBe(true); expect(test.fire('keyup', identity).defaultPrevented).toBe(true);
    expect(test.togglePlay).toHaveBeenCalledOnce(); test.cleanup();
  });

  it('blocks all held repeats and uses the latest command ref on the next distinct press', () => {
    const test = fixture(); test.fire('keydown'); for (let i = 0; i < 5; i++) expect(test.fire('keydown', { repeat: true }).defaultPrevented).toBe(true);
    test.fire('keyup'); expect(test.togglePlay).toHaveBeenCalledOnce();
    const latest = vi.fn(); test.commands.current.play = latest; test.fire('keydown', { defaultPrevented: true }); test.fire('keyup');
    expect(latest).toHaveBeenCalledOnce(); expect(test.togglePlay).toHaveBeenCalledOnce(); test.cleanup();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { getModifierState: (name: string) => name === 'AltGraph' }])('leaves system chords and composition untouched: %j', patch => {
    const test = fixture();
    for (const name of ['keydown', 'keyup'] as const) { const event = test.fire(name, patch); expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.stopPropagation).not.toHaveBeenCalled(); }
    expect(test.togglePlay).not.toHaveBeenCalled(); test.cleanup();
  });

  it('keeps custom play active and prevents a legacy conflicting Space command from executing', () => {
    const test = fixture({ shortcuts: { play: 'K', duplicate: 'Space' } });
    test.fire('keydown'); test.fire('keyup'); test.fire('keydown', { key: 'k', code: 'KeyK' });
    expect(test.togglePlay).toHaveBeenCalledTimes(2); expect(test.duplicate).not.toHaveBeenCalled(); test.cleanup();
  });

  it('leaves Enter, Tab, unrelated input text and the existing keyboard-note release behavior alone', () => {
    const test = fixture({ keyboardEnabled: true });
    for (const key of ['Enter', 'Tab']) {
      const event = test.fire('keydown', { key, code: key, target: test.target('button') }); expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    expect(test.fire('keydown', { key: 'q', code: 'KeyQ', target: test.target('text') }).defaultPrevented).toBe(false);
    expect(test.quantize).not.toHaveBeenCalled(); test.fire('keydown', { key: 'z', code: 'KeyZ' }); test.fire('keyup', { key: 'z', code: 'KeyZ' });
    expect(test.midiDown.current).toHaveBeenCalledExactlyOnceWith('keyboard:0', 60, .8); expect(test.midiUp.current).toHaveBeenCalledExactlyOnceWith('keyboard:0');
    expect(test.togglePlay).not.toHaveBeenCalled(); test.cleanup();
  });

  it('registers Space in capture phase and removes all four actual listeners on cleanup', () => {
    const test = fixture();
    expect(test.window.addEventListener.mock.calls.map(([name, , capture]) => [name, !!capture])).toEqual([['keydown', true], ['keyup', true], ['keydown', false], ['keyup', false]]);
    const registered = [...test.listeners]; test.cleanup(); expect(test.listeners).toEqual([]);
    expect(test.window.removeEventListener.mock.calls).toEqual(registered.map(({ name, callback, capture }) => capture ? [name, callback, true] : [name, callback]));
    const event = test.fire('keydown'); expect(event.preventDefault).not.toHaveBeenCalled(); expect(test.togglePlay).not.toHaveBeenCalled();
  });
});
