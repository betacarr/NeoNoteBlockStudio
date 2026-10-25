export interface HorizontalEdgeScrollOptions {
  isActive: () => boolean;
  onScroll: () => void;
}
export interface HorizontalEdgeScrollController { move(x: number): void; stop(): void }

/** Vertical arrangement motion keeps the sticky ruler out of the scrolling band. */
export function startVerticalEdgeScroll(element: HTMLElement, clientY: number, options: HorizontalEdgeScrollOptions): HorizontalEdgeScrollController {
  const view = element.ownerDocument.defaultView;
  if (!view) return { move() {}, stop() {} };
  let pointer = clientY, previous: number | undefined, frame: number | undefined, stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
  };
  const tick = (timestamp: number) => {
    frame = undefined;
    if (stopped) return;
    if (!options.isActive()) { stop(); return; }
    if (stopped) return;
    const elapsed = Number.isFinite(timestamp) && previous !== undefined ? Math.max(0, Math.min(50, timestamp - previous)) : 0;
    previous = Number.isFinite(timestamp) ? timestamp : undefined;
    const bounds = element.getBoundingClientRect(), inset = Number.isFinite(element.clientTop) ? element.clientTop : 0;
    const top = bounds.top + inset + 26, bottom = bounds.top + inset + element.clientHeight;
    const height = bottom - top, band = Math.min(24, height / 2), center = (top + bottom) / 2;
    const before = element.scrollTop, maximum = Math.max(0, element.scrollHeight - element.clientHeight);
    if (elapsed > 0 && height > 0 && [pointer, top, bottom, before, maximum].every(Number.isFinite)) {
      const velocity = pointer < center ? -780 * Math.max(0, Math.min(1, (top + band - pointer) / band))
        : pointer > center ? 780 * Math.max(0, Math.min(1, (pointer - bottom + band) / band)) : 0;
      const next = Math.max(0, Math.min(maximum, before + velocity * elapsed / 1000));
      if (next !== before && !stopped) {
        element.scrollTop = next;
        if (!stopped && element.scrollTop !== before) options.onScroll();
      }
    }
    if (!stopped) frame = view.requestAnimationFrame(tick);
  };
  frame = view.requestAnimationFrame(tick);
  return { move(y) { if (!stopped) pointer = y; }, stop };
}

/** A temporary, horizontal-only RAF loop owned by one active editor gesture. */
export function startHorizontalEdgeScroll(element: HTMLElement, clientX: number, options: HorizontalEdgeScrollOptions): HorizontalEdgeScrollController {
  const view = element.ownerDocument.defaultView;
  if (!view) return { move() {}, stop() {} };
  let pointer = clientX, previous: number | undefined, frame: number | undefined, stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
  };
  const tick = (timestamp: number) => {
    frame = undefined;
    if (stopped) return;
    if (!options.isActive()) { stop(); return; }
    if (stopped) return; // isActive may synchronously cancel the gesture.
    const elapsed = Number.isFinite(timestamp) && previous !== undefined ? Math.max(0, Math.min(50, timestamp - previous)) : 0;
    previous = Number.isFinite(timestamp) ? timestamp : undefined;
    if (elapsed > 0 && Number.isFinite(pointer)) {
      const width = element.clientWidth, scrollWidth = element.scrollWidth, before = element.scrollLeft;
      const bounds = element.getBoundingClientRect(), inset = Number.isFinite(element.clientLeft) ? element.clientLeft : 0;
      const left = bounds.left + inset, right = left + width, band = Math.min(24, width / 2), center = left + width / 2;
      if (width > 0 && [left, right, scrollWidth, before].every(Number.isFinite)) {
        // In tiny viewports the two bands meet at the center with zero speed;
        // the nearest edge owns each half, so the directions never compete.
        const velocity = pointer < center ? -1080 * Math.max(0, Math.min(1, (left + band - pointer) / band))
          : pointer > center ? 1080 * Math.max(0, Math.min(1, (pointer - right + band) / band)) : 0;
        if (!stopped && velocity !== 0) {
          const next = Math.max(0, Math.min(Math.max(0, scrollWidth - width), before + velocity * elapsed / 1000));
          if (next !== before) {
            element.scrollLeft = next;
            if (!stopped && element.scrollLeft !== before) options.onScroll();
          }
        }
      }
    }
    if (!stopped) frame = view.requestAnimationFrame(tick);
  };
  frame = view.requestAnimationFrame(tick);
  return { move(x) { if (!stopped) pointer = x; }, stop };
}
