import { describe, expect, it, vi } from 'vitest';
import { captureEditorPointer } from '../src/ui/pointer-capture';

type Listener = EventListenerOrEventListenerObject;
type Registration = { type: string; listener: Listener; capture: boolean };
const captureOption = (options?: boolean | AddEventListenerOptions | EventListenerOptions) => typeof options === 'boolean' ? options : !!options?.capture;

/** Inert listener ownership, not a browser or synthesized physical input. */
class InertTarget {
  listeners: Registration[] = [];
  added: Registration[] = [];
  removed: Registration[] = [];
  addEventListener(type: string, listener: Listener, options?: boolean | AddEventListenerOptions) {
    const registration = { type, listener, capture: captureOption(options) };
    this.listeners.push(registration); this.added.push(registration);
  }
  removeEventListener(type: string, listener: Listener, options?: boolean | EventListenerOptions) {
    const registration = { type, listener, capture: captureOption(options) };
    this.removed.push(registration);
    this.listeners = this.listeners.filter(item => item.type !== type || item.listener !== listener || item.capture !== registration.capture);
  }
  dispatchEvent(event: Event) {
    for (const item of [...this.listeners]) {
      if (item.type !== event.type || !this.listeners.includes(item)) continue;
      if (typeof item.listener === 'function') item.listener.call(this, event);
      else item.listener.handleEvent(event);
    }
    return !event.defaultPrevented;
  }
}
class InertElement extends InertTarget {
  ownerDocument: { defaultView: InertTarget | null };
  captures = new Set<number>();
  operations: string[] = [];
  focus = vi.fn((_options?: FocusOptions) => { this.operations.push('focus'); });
  setPointerCapture = vi.fn((pointer: number) => { this.operations.push(`capture:${pointer}`); this.captures.add(pointer); });
  hasPointerCapture = vi.fn((pointer: number) => this.captures.has(pointer));
  releasePointerCapture = vi.fn((pointer: number) => { this.operations.push(`release:${pointer}`); this.captures.delete(pointer); this.dispatchEvent(new Event('lostpointercapture')); });
  constructor(view: InertTarget | null) { super(); this.ownerDocument = { defaultView: view }; }
}
const keyEvent = (key: string) => Object.assign(new Event('keydown', { cancelable: true, bubbles: true }), { key });
function fixture() {
  const view = new InertTarget(), target = new InertElement(view), cancel = vi.fn();
  const start = (onCancel: () => void = cancel, pointer = 7) => captureEditorPointer(target as unknown as HTMLElement, pointer, onCancel);
  return { view, target, cancel, start };
}

describe('active editor pointer capture', () => {
  it('focuses without scrolling, captures one pointer and installs only the scoped active listeners', () => {
    const { view, target, cancel, start } = fixture();
    expect(view.listeners).toEqual([]); expect(target.listeners).toEqual([]);
    const cleanup = start();
    expect(target.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(target.setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    expect(target.operations).toEqual(['focus', 'capture:7']);
    expect(view.listeners.map(({ type, capture }) => ({ type, capture }))).toEqual([{ type: 'keydown', capture: true }, { type: 'blur', capture: false }]);
    expect(target.listeners.map(({ type, capture }) => ({ type, capture }))).toEqual([{ type: 'blur', capture: false }]);
    expect(cancel).not.toHaveBeenCalled(); cleanup();
    expect(view.listeners).toEqual([]); expect(target.listeners).toEqual([]);
  });

  it('consumes Escape before cancelling and cleans up even if the owner relies on the fallback', () => {
    const { view, target, start } = fixture(), event = keyEvent('Escape');
    const stop = vi.spyOn(event, 'stopPropagation');
    const cancel = vi.fn(() => {
      expect(event.defaultPrevented).toBe(true); expect(stop).toHaveBeenCalledTimes(1);
      expect(target.captures.has(7)).toBe(true); target.operations.push('cancel');
    });
    const cleanup = start(cancel);
    expect(view.dispatchEvent(event)).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(target.operations).toEqual(['focus', 'capture:7', 'cancel', 'release:7']);
    expect(view.listeners).toEqual([]); expect(target.listeners).toEqual([]);
    cleanup(); expect(target.releasePointerCapture).toHaveBeenCalledTimes(1);
    view.dispatchEvent(keyEvent('Escape')); target.dispatchEvent(new Event('blur'));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(['Delete', 'Backspace', 'Enter', ' ', 'Tab', 'ArrowLeft', 'a'])('does not consume or cancel non-Escape key %s', key => {
    const { view, cancel, start } = fixture(), cleanup = start(), event = keyEvent(key), stop = vi.spyOn(event, 'stopPropagation');
    expect(view.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false); expect(stop).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
    expect(view.listeners).toHaveLength(2); cleanup();
  });

  it.each(['window', 'target'] as const)('cancels once on %s blur and removes every owned listener', where => {
    const { view, target, cancel, start } = fixture(), cleanup = start();
    (where === 'window' ? view : target).dispatchEvent(new Event('blur'));
    expect(cancel).toHaveBeenCalledTimes(1); expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    expect(view.listeners).toEqual([]); expect(target.listeners).toEqual([]);
    view.dispatchEvent(new Event('blur')); target.dispatchEvent(new Event('blur')); cleanup();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('allows an owner to clear active state and call cleanup before a lost-capture reentry', () => {
    const { view, target, start } = fixture();
    let active: { cleanup: () => void } | null = { cleanup: () => {} }, reentries = 0;
    target.addEventListener('lostpointercapture', () => { if (active) reentries++; });
    const cancel = vi.fn(() => { const previous = active; active = null; previous?.cleanup(); });
    active.cleanup = start(cancel);
    view.dispatchEvent(keyEvent('Escape'));
    expect(active).toBeNull(); expect(cancel).toHaveBeenCalledTimes(1); expect(reentries).toBe(0);
    expect(target.releasePointerCapture).toHaveBeenCalledTimes(1);
    expect(view.listeners).toEqual([]);
    expect(target.listeners.map(item => item.type)).toEqual(['lostpointercapture']);
  });

  it('guards reentrant blur during cancellation and removes listeners before release', () => {
    const { view, target, start } = fixture();
    const cancel = vi.fn(() => { target.dispatchEvent(new Event('blur')); view.dispatchEvent(new Event('blur')); });
    target.releasePointerCapture.mockImplementation(pointer => {
      expect(view.listeners).toEqual([]); expect(target.listeners).toEqual([]);
      target.captures.delete(pointer);
    });
    start(cancel); view.dispatchEvent(keyEvent('Escape'));
    expect(cancel).toHaveBeenCalledTimes(1); expect(target.releasePointerCapture).toHaveBeenCalledTimes(1);
  });

  it('does not release a foreign pointer or a capture already removed by the platform', () => {
    const { target, cancel, start } = fixture(); target.captures.add(99);
    const cleanup = start(); target.captures.delete(7); cleanup(); cleanup();
    expect(target.captures).toEqual(new Set([99]));
    expect(target.hasPointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    expect(target.releasePointerCapture).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
  });

  it('makes explicit completion or unmount cleanup idempotent without invoking cancellation', () => {
    const { view, target, cancel, start } = fixture(), cleanup = start();
    cleanup(); cleanup(); cleanup();
    expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7); expect(cancel).not.toHaveBeenCalled();
    expect(view.removed).toEqual(view.added); expect(target.removed).toEqual(target.added);
    const event = keyEvent('Escape'); view.dispatchEvent(event); view.dispatchEvent(new Event('blur')); target.dispatchEvent(new Event('blur'));
    expect(event.defaultPrevented).toBe(false); expect(cancel).not.toHaveBeenCalled();
  });

  it('scopes cancellation to the target owning window and permits a clean later session', () => {
    const { view, target, cancel, start } = fixture(), foreign = new InertTarget(), cleanup = start();
    foreign.dispatchEvent(keyEvent('Escape')); foreign.dispatchEvent(new Event('blur')); expect(cancel).not.toHaveBeenCalled();
    cleanup(); const next = start(cancel, 8); view.dispatchEvent(keyEvent('Escape'));
    expect(cancel).toHaveBeenCalledTimes(1); expect(target.releasePointerCapture.mock.calls.map(call => call[0])).toEqual([7, 8]);
    next(); expect(view.listeners).toEqual([]);
  });

  it('supports a detached document without a window and ignores blur during initial focus', () => {
    const target = new InertElement(null), cancel = vi.fn();
    target.focus.mockImplementation(() => { target.dispatchEvent(new Event('blur')); });
    const cleanup = captureEditorPointer(target as unknown as HTMLElement, 3, cancel);
    expect(cancel).not.toHaveBeenCalled(); target.dispatchEvent(new Event('blur'));
    expect(cancel).toHaveBeenCalledTimes(1); cleanup();
    expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(3); expect(target.listeners).toEqual([]);
  });

  it('does not leave listeners if native pointer capture fails at the start', () => {
    const { view, target, start } = fixture(), failure = new Error('Pointer is no longer active');
    target.setPointerCapture.mockImplementation(() => { throw failure; });
    expect(() => start()).toThrow(failure);
    expect(target.focus).toHaveBeenCalledTimes(1); expect(view.listeners).toEqual([]); expect(target.listeners).toEqual([]);
  });

  it('still performs cleanup when the owner cancellation callback throws', () => {
    const { view, target, start } = fixture(), failure = new Error('Owner failure');
    const cleanup = start(() => { throw failure; });
    expect(() => view.dispatchEvent(keyEvent('Escape'))).toThrow(failure);
    expect(view.listeners).toEqual([]); expect(target.listeners).toEqual([]);
    expect(target.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7); cleanup();
  });
});
