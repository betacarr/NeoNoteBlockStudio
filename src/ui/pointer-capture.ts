/** A gesture owns these listeners only until it ends or is cancelled.
 * Callers clear their active gesture before invoking the returned cleanup so a
 * synchronous lostpointercapture callback cannot commit or cancel it again.
 */
export function captureEditorPointer(target: HTMLElement, pointerId: number, onCancel: () => void): () => void {
  target.focus({ preventScroll: true });
  target.setPointerCapture(pointerId);
  const view = target.ownerDocument.defaultView;
  let active = true, cancelling = false;

  const cleanup = () => {
    if (!active) return;
    active = false;
    view?.removeEventListener('keydown', keydown, true);
    view?.removeEventListener('blur', cancel, false);
    target.removeEventListener('blur', cancel, false);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  };
  const cancel = () => {
    if (!active || cancelling) return;
    cancelling = true;
    // Let the caller clear its gesture before releasing pointer capture.
    try { onCancel(); } finally { cleanup(); }
  };
  const keydown = (event: KeyboardEvent) => {
    if (!active || cancelling || event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    cancel();
  };
  view?.addEventListener('keydown', keydown, true);
  view?.addEventListener('blur', cancel, false);
  target.addEventListener('blur', cancel, false);
  return cleanup;
}
