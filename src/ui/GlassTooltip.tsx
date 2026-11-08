import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Decorative, keyboard-accessible tooltip. Only opted-in controls replace native titles. */
export function GlassTooltip({ root }: { root: RefObject<HTMLElement | null> }) {
  const id = useId(), tooltip = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null), [position, setPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    const studio = root.current; if (!studio) return;
    let timer: ReturnType<typeof setTimeout> | undefined, owner: HTMLElement | undefined, title: string | null = null;
    const hide = () => { clearTimeout(timer); if (owner && title !== null && !owner.hasAttribute('title')) owner.setAttribute('title', title); owner = undefined; title = null; setTarget(null); };
    const show = (event: Event) => {
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-glass-tooltip]') : null;
      if (node === owner) return; hide();
      if (!node || node.matches(':disabled') || node.closest('[inert]')) return;
      owner = node; title = node.getAttribute('title'); node.removeAttribute('title');
      timer = setTimeout(() => { if (node.isConnected) setTarget(node); }, event.type === 'focusin' ? 200 : 450);
    };
    const leave = (event: Event) => { const next = (event as MouseEvent).relatedTarget; if (!(next instanceof Node) || !owner?.contains(next)) hide(); };
    studio.addEventListener('pointerover', show); studio.addEventListener('focusin', show);
    studio.addEventListener('pointerout', leave); studio.addEventListener('focusout', leave);
    studio.addEventListener('pointerdown', hide); studio.addEventListener('keydown', hide); window.addEventListener('blur', hide); window.addEventListener('resize', hide);
    return () => { hide(); studio.removeEventListener('pointerover', show); studio.removeEventListener('focusin', show); studio.removeEventListener('pointerout', leave); studio.removeEventListener('focusout', leave); studio.removeEventListener('pointerdown', hide); studio.removeEventListener('keydown', hide); window.removeEventListener('blur', hide); window.removeEventListener('resize', hide); };
  }, [root]);
  useLayoutEffect(() => {
    if (!target || !tooltip.current) return;
    const rect = target.getBoundingClientRect(), box = tooltip.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(window.innerWidth - box.width - 8, rect.left + (rect.width - box.width) / 2)), top: rect.bottom + box.height + 16 < window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - box.height - 8) });
    const before = target.getAttribute('aria-describedby'); target.setAttribute('aria-describedby', [before, id].filter(Boolean).join(' '));
    return () => { if (before === null) target.removeAttribute('aria-describedby'); else target.setAttribute('aria-describedby', before); };
  }, [target, id]);
  return target ? <div className="glass-tooltip" role="tooltip" id={id} ref={tooltip} style={position}>{target.dataset.glassTooltip}</div> : null;
}
