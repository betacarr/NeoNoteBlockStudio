const FOCUSABLE = 'button,input,select,textarea,a[href],[tabindex],[contenteditable]:not([contenteditable="false"])';
const backgroundLocks = new WeakMap<HTMLElement, { count: number; inert: boolean }>();
const modalStack: HTMLElement[] = [];

export function modalFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => {
    if (element.tabIndex < 0 || element.hasAttribute('disabled') || element.closest('[inert],[hidden],[aria-hidden="true"]')) return false;
    const view = element.ownerDocument.defaultView;
    if (view && ['hidden', 'collapse'].includes(view.getComputedStyle(element).visibility)) return false;
    return element.getClientRects().length > 0;
  });
}

export function focusInsideModal(dialog: HTMLElement): void {
  const elements = modalFocusableElements(dialog);
  const requested = elements.find(element => element.hasAttribute('autofocus') || element.hasAttribute('data-autofocus'));
  (requested ?? elements[0] ?? dialog).focus({ preventScroll: true });
}

/** Wrap only at the ends; ordinary Tab navigation remains native. */
export function cycleModalFocus(dialog: HTMLElement, backwards: boolean): boolean {
  const elements = modalFocusableElements(dialog), active = dialog.ownerDocument.activeElement;
  if (!elements.length) { dialog.focus({ preventScroll: true }); return true; }
  const index = elements.indexOf(active as HTMLElement);
  if (index < 0 || backwards && index === 0 || !backwards && index === elements.length - 1) {
    elements[backwards ? elements.length - 1 : 0].focus({ preventScroll: true });
    return true;
  }
  return false;
}

/** Isolate every sibling branch, including when a dialog is nested in .studio.
 * Locks preserve pre-existing inert state and survive overlapping modal cleanup.
 */
export function mountModalFocus(dialog: HTMLElement, backdrop: HTMLElement): () => void {
  const document = dialog.ownerDocument, before = document.activeElement as HTMLElement | null;
  const locked: HTMLElement[] = [];
  let branch: HTMLElement | null = backdrop;
  while (branch?.parentElement) {
    const parent: HTMLElement = branch.parentElement;
    for (const sibling of [...parent.children]) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      const state = backgroundLocks.get(sibling) ?? { count: 0, inert: sibling.inert };
      state.count++; backgroundLocks.set(sibling, state); sibling.inert = true; locked.push(sibling);
    }
    if (parent === document.body) break;
    branch = parent;
  }
  modalStack.push(dialog);
  let moving = false;
  const contain = (event: FocusEvent) => {
    if (moving || modalStack.at(-1) !== dialog || dialog.contains(event.target as Node)) return;
    moving = true;
    try { focusInsideModal(dialog); } finally { moving = false; }
  };
  document.addEventListener('focusin', contain, true);
  focusInsideModal(dialog);
  return () => {
    document.removeEventListener('focusin', contain, true);
    const index = modalStack.lastIndexOf(dialog); if (index >= 0) modalStack.splice(index, 1);
    for (const element of locked) {
      const state = backgroundLocks.get(element); if (!state || --state.count > 0) continue;
      element.inert = state.inert; backgroundLocks.delete(element);
    }
    if (before?.isConnected && !before.closest('[inert]')) before.focus({ preventScroll: true });
    else if (modalStack.length) focusInsideModal(modalStack.at(-1)!);
  };
}
