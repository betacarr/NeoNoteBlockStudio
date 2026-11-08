import { afterEach, describe, expect, it, vi } from 'vitest';
import { cycleModalFocus, mountModalFocus } from '../src/ui/modal-focus';

// Minimal document boundary for focus policy. Browser Tab delivery and inert
// behavior themselves remain desktop-smoke assertions.
function fixture() {
  const listeners = new Set<(event: any) => void>();
  const document: any = { activeElement: null, defaultView: { getComputedStyle: () => ({ visibility: 'visible' }) },
    addEventListener: (_name: string, listener: any) => listeners.add(listener), removeEventListener: (_name: string, listener: any) => listeners.delete(listener) };
  class Element {
    inert = false; hidden = false; disabled = false; tabIndex = -1; attrs = new Map<string, string>(); parentElement: Element | null = null; children: Element[] = []; ownerDocument = document;
    constructor(public name: string, public focusable = false) { if (focusable) this.tabIndex = 0; }
    get isConnected(): boolean { return this === document.body || !!this.parentElement?.isConnected; }
    append(child: Element) { this.children.push(child); child.parentElement = this; return child; }
    hasAttribute(name: string): boolean { return name === 'disabled' ? this.disabled : this.attrs.has(name); }
    contains(target: Element): boolean { return target === this || this.children.some(child => child.contains(target)); }
    closest(_selector: string): Element | null { return this.inert || this.hidden || this.attrs.get('aria-hidden') === 'true' ? this : this.parentElement?.closest(_selector) ?? null; }
    querySelectorAll(_selector: string): Element[] { return this.children.flatMap(child => [...(child.focusable ? [child] : []), ...child.querySelectorAll(_selector)]); }
    getClientRects(): object[] { return this.hidden ? [] : [{}]; }
    focus() { if (this.closest('[inert]')) return; document.activeElement = this; for (const listener of [...listeners]) listener({ target: this }); }
  }
  vi.stubGlobal('HTMLElement', Element);
  const body = document.body = new Element('body'), studio = body.append(new Element('studio'));
  const toolbar = studio.append(new Element('toolbar')), opener = toolbar.append(new Element('open', true));
  const viewport = studio.append(new Element('viewport')), backgroundField = viewport.append(new Element('BPM', true));
  const disabledBackground = studio.append(new Element('already-inert')); disabledBackground.inert = true;
  const backdrop = studio.append(new Element('backdrop')), dialog = backdrop.append(new Element('dialog'));
  const close = dialog.append(new Element('close', true)), first = dialog.append(new Element('input', true)), last = dialog.append(new Element('apply', true));
  opener.focus();
  return { Element, document, studio, toolbar, opener, viewport, backgroundField, disabledBackground, backdrop, dialog, close, first, last, listeners };
}
afterEach(() => vi.unstubAllGlobals());

describe('modal focus containment and restoration', () => {
  it('moves initial focus inside, isolates underlying branches and restores prior focus/inert values', () => {
    const t = fixture(), cleanup = mountModalFocus(t.dialog as any, t.backdrop as any);
    expect(t.document.activeElement).toBe(t.close); expect(t.toolbar.inert).toBe(true); expect(t.viewport.inert).toBe(true);
    expect(t.dialog.closest('[inert]')).toBeNull(); t.backgroundField.focus(); expect(t.document.activeElement).toBe(t.close);
    cleanup(); expect(t.toolbar.inert).toBe(false); expect(t.viewport.inert).toBe(false); expect(t.disabledBackground.inert).toBe(true);
    expect(t.document.activeElement).toBe(t.opener); expect(t.listeners.size).toBe(0);
  });
  it('wraps Tab and Shift+Tab and keeps ordinary interior navigation native', () => {
    const t = fixture(), cleanup = mountModalFocus(t.dialog as any, t.backdrop as any);
    t.last.focus(); expect(cycleModalFocus(t.dialog as any, false)).toBe(true); expect(t.document.activeElement).toBe(t.close);
    expect(cycleModalFocus(t.dialog as any, true)).toBe(true); expect(t.document.activeElement).toBe(t.last);
    t.first.focus(); expect(cycleModalFocus(t.dialog as any, false)).toBe(false);
    cleanup();
  });
  it('skips disabled and hidden controls when wrapping', () => {
    const t = fixture(); t.close.disabled = true; t.last.hidden = true;
    const cleanup = mountModalFocus(t.dialog as any, t.backdrop as any);
    expect(t.document.activeElement).toBe(t.first); expect(cycleModalFocus(t.dialog as any, false)).toBe(true); expect(t.document.activeElement).toBe(t.first);
    cleanup();
  });
  it('retains background isolation when a child modal closes', () => {
    const t = fixture(), cleanFirst = mountModalFocus(t.dialog as any, t.backdrop as any);
    const secondBackdrop = t.studio.append(new t.Element('second backdrop')), second = secondBackdrop.append(new t.Element('second dialog'));
    const confirm = second.append(new t.Element('confirm', true));
    const cleanSecond = mountModalFocus(second as any, secondBackdrop as any);
    expect(t.document.activeElement).toBe(confirm); expect(t.backdrop.inert).toBe(true);
    cleanSecond(); expect(t.document.activeElement).toBe(t.close); expect(t.viewport.inert).toBe(true); expect(t.backdrop.inert).toBe(false);
    cleanFirst(); expect(t.document.activeElement).toBe(t.opener); expect(t.viewport.inert).toBe(false);
  });
});
