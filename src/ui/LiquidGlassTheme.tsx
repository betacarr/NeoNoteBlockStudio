/*
 * Liquid Glass displacement core adapted from shuding/liquid-glass (MIT).
 * Copyright (c) 2025 Shu Ding. See third_party/liquid-glass/LICENSE and NOTICE.txt.
 * Web material approximation; this does not use Apple's native platform implementation.
 */
import { useEffect, useRef, type RefObject } from 'react';

const SVG = 'http://www.w3.org/2000/svg';
const SURFACES = '.control-bar, .toolbar, .library, .inspector, .modal, .menu-items, .section-heading, .editor-heading, .status-bar';
const smoothStep = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};
const roundedRectSDF = (x: number, y: number, halfWidth: number, halfHeight: number, radius: number) => {
  const qx = Math.abs(x) - halfWidth + radius, qy = Math.abs(y) - halfHeight + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
};
interface Displacement { href: string; scale: number; }

/** Sample the rounded glass edge in CSS pixels, then encode its inward refraction vector in RG. */
function displacementMap(width: number, height: number, radius: number): Displacement | undefined {
  const resolution = Math.min(1, Math.sqrt(96000 / (width * height)));
  const w = Math.max(2, Math.round(width * resolution)), h = Math.max(2, Math.round(height * resolution));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const context = canvas.getContext('2d'); if (!context) return;
  const image = context.createImageData(w, h), data = image.data;
  const band = Math.min(18, Math.min(width, height) * .32), strength = Math.min(8, band * .48), scale = strength * 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = (x + .5) / w * width - width / 2, py = (y + .5) / h * height - height / 2;
    const qx = Math.abs(px) - width / 2 + radius, qy = Math.abs(py) - height / 2 + radius;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), length = Math.hypot(ox, oy);
    const nx = length ? Math.sign(px) * ox / length : qx > qy ? Math.sign(px) : 0;
    const ny = length ? Math.sign(py) * oy / length : qy >= qx ? Math.sign(py) : 0;
    const depth = -roundedRectSDF(px, py, width / 2, height / 2, radius);
    const bend = 1 - smoothStep(0, band, Math.max(0, depth)), offset = (y * w + x) * 4;
    data[offset] = (.5 - nx * bend * strength / scale) * 255;
    data[offset + 1] = (.5 - ny * bend * strength / scale) * 255;
    data[offset + 2] = 0; data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return { href: canvas.toDataURL(), scale };
}

interface Surface { node: HTMLElement; layer: HTMLSpanElement; filter: SVGFilterElement; image: SVGFEImageElement; displacement: SVGFEDisplacementMapElement; position: string; scroll?: () => void; key?: string; }
interface Props { enabled: boolean; root: RefObject<HTMLElement | null>; }

/** The optical layer owns no input handlers and only regenerates a map when its host is resized. */
export function LiquidGlassTheme({ enabled, root }: Props) {
  const definitions = useRef<SVGDefsElement>(null);
  useEffect(() => {
    const studio = root.current, defs = definitions.current; if (!enabled || !studio || !defs) return;
    const forcedColors = window.matchMedia('(forced-colors: active)'), reducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)');
    const supported = typeof ResizeObserver !== 'undefined' && typeof CSS !== 'undefined' && (CSS.supports('backdrop-filter', 'url("#liquid-glass-support")') || CSS.supports('-webkit-backdrop-filter', 'url("#liquid-glass-support")'));
    const surfaces = new Map<HTMLElement, Surface>(), maps = new Map<string, Displacement>(), pending = new Set<Surface>();
    let frame = 0, serial = 0, active = false;
    const remove = (surface: Surface) => {
      resizeObserver?.unobserve(surface.node); pending.delete(surface);
      if (surface.scroll) surface.node.removeEventListener('scroll', surface.scroll);
      surface.layer.remove(); surface.filter.remove(); surface.node.classList.remove('liquid-glass-surface');
      surface.node.style.position = surface.position; surfaces.delete(surface.node);
    };
    const draw = (surface: Surface) => {
      const bounds = surface.node.getBoundingClientRect(), width = Math.round(bounds.width), height = Math.round(bounds.height);
      if (width < 2 || height < 2 || !surface.node.isConnected) return;
      surface.layer.style.width = `${surface.node.clientWidth}px`; surface.layer.style.height = `${surface.node.clientHeight}px`;
      const style = getComputedStyle(surface.node), radius = Math.min(width / 2, height / 2, parseFloat(style.borderTopLeftRadius) || 0);
      const key = `${width}:${height}:${radius}`; if (surface.key === key) return;
      let map = maps.get(key);
      if (!map) {
        try { map = displacementMap(width, height, radius); } catch { map = undefined; }
        if (!map) { surface.layer.style.backdropFilter = 'none'; return; }
        maps.set(key, map); if (maps.size > 24) maps.delete(maps.keys().next().value!);
      }
      surface.filter.setAttribute('width', String(width)); surface.filter.setAttribute('height', String(height));
      surface.image.setAttribute('width', String(width)); surface.image.setAttribute('height', String(height));
      surface.image.setAttribute('href', map.href); surface.displacement.setAttribute('scale', String(map.scale)); surface.key = key;
    };
    const schedule = (surface: Surface) => {
      pending.add(surface); if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; for (const item of pending) draw(item); pending.clear(); });
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => { for (const entry of entries) { const surface = surfaces.get(entry.target as HTMLElement); if (surface) schedule(surface); } });
    const scan = () => {
      if (!active) return;
      for (const surface of surfaces.values()) if (!studio.contains(surface.node)) remove(surface);
      for (const node of studio.querySelectorAll<HTMLElement>(SURFACES)) {
        if (surfaces.has(node)) continue;
        const id = `nbsx-liquid-glass-${serial++}`, filter = document.createElementNS(SVG, 'filter'), image = document.createElementNS(SVG, 'feImage'), displacement = document.createElementNS(SVG, 'feDisplacementMap');
        filter.id = id; filter.setAttribute('filterUnits', 'userSpaceOnUse'); filter.setAttribute('color-interpolation-filters', 'sRGB');
        filter.setAttribute('x', '0'); filter.setAttribute('y', '0'); image.setAttribute('result', 'displacement-map'); image.setAttribute('preserveAspectRatio', 'none');
        displacement.setAttribute('in', 'SourceGraphic'); displacement.setAttribute('in2', 'displacement-map');
        displacement.setAttribute('xChannelSelector', 'R'); displacement.setAttribute('yChannelSelector', 'G');
        filter.append(image, displacement); defs.append(filter);
        const layer = document.createElement('span'); layer.className = 'liquid-glass-backdrop'; layer.setAttribute('aria-hidden', 'true');
        layer.style.backdropFilter = `url("#${id}") blur(.6px) saturate(1.22)`;
        layer.style.setProperty('-webkit-backdrop-filter', `url("#${id}") blur(.6px) saturate(1.22)`);
        const position = node.style.position; if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
        const surface: Surface = { node, layer, filter, image, displacement, position };
        if (/auto|scroll/.test(getComputedStyle(node).overflowY)) {
          surface.scroll = () => { layer.style.transform = `translate(${node.scrollLeft}px, ${node.scrollTop}px)`; };
          node.addEventListener('scroll', surface.scroll, { passive: true }); surface.scroll();
        }
        node.classList.add('liquid-glass-surface'); node.prepend(layer); surfaces.set(node, surface); resizeObserver?.observe(node); schedule(surface);
      }
    };
    const mutationObserver = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node instanceof HTMLElement && !node.classList.contains('liquid-glass-backdrop')))) scan();
    });
    const updateMode = () => {
      active = supported && !forcedColors.matches && !reducedTransparency.matches;
      studio.dataset.glassMode = active ? 'refracted' : 'solid';
      if (active) { scan(); mutationObserver.observe(studio, { childList: true, subtree: true }); }
      else {
        mutationObserver.disconnect(); for (const surface of [...surfaces.values()]) remove(surface);
        if (frame) cancelAnimationFrame(frame); frame = 0; pending.clear();
      }
    };
    forcedColors.addEventListener('change', updateMode); reducedTransparency.addEventListener('change', updateMode); updateMode();
    return () => {
      active = false; mutationObserver.disconnect(); resizeObserver?.disconnect(); if (frame) cancelAnimationFrame(frame);
      forcedColors.removeEventListener('change', updateMode); reducedTransparency.removeEventListener('change', updateMode);
      for (const surface of [...surfaces.values()]) remove(surface); maps.clear(); pending.clear(); delete studio.dataset.glassMode;
    };
  }, [enabled, root]);
  return enabled ? <svg className="liquid-glass-definitions" width="0" height="0" aria-hidden="true" focusable="false"><defs ref={definitions} /></svg> : null;
}
