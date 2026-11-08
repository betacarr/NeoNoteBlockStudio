import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { cycleModalFocus, mountModalFocus } from './modal-focus';

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const backdrop = useRef<HTMLDivElement>(null), dialog = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (dialog.current && backdrop.current) return mountModalFocus(dialog.current, backdrop.current);
  }, []);
  return <div className="modal-backdrop" ref={backdrop} onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={dialog}
      onKeyDown={event => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === 'Tab') { if (cycleModalFocus(event.currentTarget, event.shiftKey)) event.preventDefault(); event.stopPropagation(); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      }}>
      <header><h2>{title}</h2><button className="icon-button" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>{children}
    </section>
  </div>;
}
