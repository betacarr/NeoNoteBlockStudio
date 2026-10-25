import { useEffect, useRef, useState } from 'react';

export interface MenuEntry { label: string; command: string; shortcut?: string; disabled?: boolean; checked?: boolean; separatorBefore?: boolean }
export interface StudioMenu { label: string; items?: MenuEntry[]; command?: string }
export function MenuBar({ menus, onCommand }: { menus: StudioMenu[]; onCommand: (command: string) => void }) {
  const [open, setOpen] = useState<number | null>(null), root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open === null) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener('pointerdown', outside);
    const focus = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('.menu-items [role^="menuitem"]:not([disabled])')?.focus());
    return () => { document.removeEventListener('pointerdown', outside); cancelAnimationFrame(focus); };
  }, [open]);
  return <nav className="studio-menu" aria-label="主菜单" role="menubar" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(null);
  }} onKeyDown={event => {
    // Focused menu controls own keys even when only a closed trigger is focused.
    // Keep native activation and Tab; editor shortcuts must not receive the event.
    event.stopPropagation();
    if (open === null) return;
    const items = [...root.current!.querySelectorAll<HTMLButtonElement>('.menu-items [role^="menuitem"]:not([disabled])')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { setOpen(null); root.current?.querySelectorAll<HTMLButtonElement>('.menu-trigger')[open]?.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { const direction = event.key === 'ArrowRight' ? 1 : -1; for (let n = 1; n <= menus.length; n++) { const next = (open + direction * n + menus.length) % menus.length; if (menus[next].items) { setOpen(next); break; } } }
    else return;
    event.preventDefault();
  }}>{menus.map((menu, index) => <div className="menu-group" key={menu.label}>
    <button className={`menu-trigger ${open === index ? 'expanded' : ''}`} role="menuitem" aria-haspopup={menu.items ? 'menu' : undefined} aria-expanded={menu.items ? open === index : undefined} onClick={() => { if (menu.items) setOpen(open === index ? null : index); else { setOpen(null); if (menu.command) onCommand(menu.command); } }}>{menu.label}</button>
    {open === index && menu.items && <div className="menu-items" role="menu" aria-label={menu.label}>{menu.items.map(item => <div key={item.command}>
      {item.separatorBefore && <div className="menu-separator" role="separator" />}
      <button role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} disabled={item.disabled} onClick={() => { setOpen(null); onCommand(item.command); }}><span className="menu-check">{item.checked ? '✓' : ''}</span><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button>
    </div>)}</div>}
  </div>)}</nav>;
}
