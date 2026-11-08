import type { BrowserWindow } from 'electron';

export const WINDOW_BACKGROUND = '#232426';
let appKit: ReturnType<typeof loadAppKit>, checked = false;
const installed = new WeakMap<BrowserWindow, bigint>();

// Electron exposes its NSView pointer. Bind only the public Objective-C methods
// needed for the glass layer; this keeps macOS 26 SDK headers out of the build.
function loadAppKit() {
  try {
    const koffi = require('koffi') as typeof import('koffi');
    const objc = koffi.load('/usr/lib/libobjc.A.dylib');
    const getClass = objc.func('void *objc_getClass(const char *)');
    const glass = getClass('NSGlassEffectView') as bigint | null;
    if (!glass) return;
    const selector = objc.func('void *sel_registerName(const char *)');
    const object = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
    const bool = objc.func('objc_msgSend', 'bool', ['void *', 'void *']);
    const invoke = objc.func('objc_msgSend', 'void', ['void *', 'void *']);
    const setObject = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'void *']);
    const setNumber = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'double']);
    const insert = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'void *', 'intptr_t', 'void *']);
    const rect = koffi.struct({ x: 'double', y: 'double', width: 'double', height: 'double' });
    const setFrame = objc.func('objc_msgSend', 'void', ['void *', 'void *', rect]);
    const color = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'double', 'double', 'double', 'double']);
    const string = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'str']);
    const objectWithObject = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']);
    const appearance = getClass('NSAppearance'), strings = getClass('NSString'), colors = getClass('NSColor');
    return {
      attach(window: BrowserWindow, oldView: bigint | undefined, bounds: { x: number; y: number; width: number; height: number }) {
        const handle = window.getNativeWindowHandle();
        const view = handle.readBigUInt64LE();
        const host = object(object(view, selector('window')), selector('contentView'));
        if (!host) return;
        const { x, y, width, height } = bounds;
        const frame = { x, y: bool(host, selector('isFlipped')) ? y : window.getContentSize()[1] - y - height, width, height };
        // Keep an owned reference until the window closes, including if AppKit
        // re-parents its content view while transitioning to/from full screen.
        const glassView = oldView ?? (object(object(glass, selector('alloc')), selector('init')) as bigint | null);
        if (!glassView) return;
        try {
          setFrame(glassView, selector('setFrame:'), frame);
          if (!oldView) {
            const darkAqua = string(strings, selector('stringWithUTF8String:'), 'NSAppearanceNameDarkAqua');
            setObject(glassView, selector('setAppearance:'), objectWithObject(appearance, selector('appearanceNamed:'), darkAqua));
            setNumber(glassView, selector('setCornerRadius:'), 16);
            setObject(glassView, selector('setTintColor:'), color(colors, selector('colorWithSRGBRed:green:blue:alpha:'), .17, .2, .26, .54));
          }
          if (object(glassView, selector('superview')) !== host) {
            // NSWindowBelow. The WebContents remains above it and handles every input event.
            insert(host, selector('addSubview:positioned:relativeTo:'), glassView, -1, null);
          }
          return glassView;
        } catch (error) {
          if (!oldView) invoke(glassView, selector('release'));
          throw error;
        }
      },
      detach(view: bigint) {
        invoke(view, selector('removeFromSuperview'));
        invoke(view, selector('release'));
      },
    };
  } catch {
    return undefined;
  }
}

export function nativeGlassSupported() {
  if (!checked) {
    checked = true;
    if (process.platform === 'darwin') appKit = loadAppKit();
  }
  return !!appKit;
}

export function clearNativeGlass(window: BrowserWindow) {
  const view = installed.get(window);
  if (!view) return;
  installed.delete(window);
  appKit?.detach(view);
  if (!window.isDestroyed()) window.setBackgroundColor(WINDOW_BACKGROUND);
}

export function setNativeGlass(window: BrowserWindow, request: unknown): boolean {
  if (!nativeGlassSupported() || !appKit || window.isDestroyed()) return false;
  if (request === null) { clearNativeGlass(window); return true; }
  if (!request || typeof request !== 'object') return false;
  const { x, y, width, height } = request as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number'
      || ![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) return false;
  const zoom = window.webContents.getZoomFactor(), [maxWidth, maxHeight] = window.getContentSize();
  // Clip renderer pixels to the real content area after browser zoom. Restrict
  // this bridge to the top chrome and keep it away from the native title bar.
  const bounds = { x: x * zoom, y: y * zoom, width: Math.min(width * zoom, maxWidth - x * zoom), height: Math.min(height * zoom, maxHeight - y * zoom) };
  if (bounds.width <= 0 || bounds.height <= 0 || bounds.y + bounds.height > Math.min(maxHeight, 280)) return false;
  try {
    const oldView = installed.get(window);
    const view = appKit.attach(window, oldView, bounds);
    if (!view) return false;
    installed.set(window, view);
    if (!oldView) window.setBackgroundColor('#00000000');
    return true;
  } catch {
    clearNativeGlass(window);
    return false;
  }
}
