/*
 * DOM lifecycle reuses shuding/liquid-glass integration; optical material ported from OpenNBS/NoteBlockStudio (MIT).
 * Copyright (c) 2025 Shu Ding; Copyright (c) 2026 OpenNBS. See third_party notices.
 * Edge chromatic separation adapted from rdev/liquid-glass-react (MIT, Max Rovensky).
 * Web material approximation; this does not use Apple's native platform implementation.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { glassDisplacement, glassGeometry, glassRenderingMode } from './glass-material';
import { GlassTooltip } from './GlassTooltip';
import './LiquidGlass.css';

const SVG = 'http://www.w3.org/2000/svg';
const SURFACES = '.menu-items, [data-glass-surface], .status-message, .glass-tooltip';
interface Displacement { href: string; scale: number; }

/** Sample the rounded glass edge in CSS pixels, then encode its inward refraction vector in RG. */
function displacementMap(width: number, height: number, radius: number): Displacement | undefined {
  const resolution = Math.min(1, Math.sqrt(96000 / (width * height)));
  const w = Math.max(2, Math.round(width * resolution)), h = Math.max(2, Math.round(height * resolution));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const context = canvas.getContext('2d'); if (!context) return;
  const image = context.createImageData(w, h), data = image.data;
  const scale = 40;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = (x + .5) / w * width - width / 2, py = (y + .5) / h * height - height / 2;
    const { distance, nx, ny } = glassGeometry(px, py, width, height, radius);
    const bend = glassDisplacement(-distance), offset = (y * w + x) * 4;
    data[offset] = (.5 - nx * bend / scale) * 255;
    data[offset + 1] = (.5 - ny * bend / scale) * 255;
    data[offset + 2] = 0; data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return { href: canvas.toDataURL(), scale };
}

/** The rdev effect separates RGB at the edge. The neutral center of our
 * shared vector map keeps all three channels aligned away from that edge. */
function chromaticFilter(filter: SVGFilterElement) {
  const displacements = ['r', 'g', 'b'].map((channel, index) => {
    const displacement = document.createElementNS(SVG, 'feDisplacementMap');
    displacement.setAttribute('in', 'SourceGraphic'); displacement.setAttribute('in2', 'displacement-map');
    displacement.setAttribute('xChannelSelector', 'R'); displacement.setAttribute('yChannelSelector', 'G');
    displacement.setAttribute('result', `bend-${channel}`);
    const isolate = document.createElementNS(SVG, 'feColorMatrix');
    isolate.setAttribute('in', `bend-${channel}`);
    isolate.setAttribute('result', channel);
    isolate.setAttribute('values', Array.from({ length: 20 }, (_, at) => at === index * 6 || at === 18 ? 1 : 0).join(' '));
    filter.append(displacement, isolate);
    return displacement;
  });
  for (const [first, second, result] of [['r', 'g', 'rg'], ['rg', 'b', 'rgb']]) {
    const merge = document.createElementNS(SVG, 'feBlend');
    merge.setAttribute('in', first); merge.setAttribute('in2', second);
    merge.setAttribute('mode', 'screen'); merge.setAttribute('result', result);
    filter.append(merge);
  }
  return displacements;
}

interface Surface { node: HTMLElement; layer: HTMLSpanElement; filter: SVGFilterElement; image: SVGFEImageElement; displacements: SVGFEDisplacementMapElement[]; position: string; scroll?: () => void; key?: string; }
interface Props { enabled: boolean; root: RefObject<HTMLElement | null>; quality?: 'auto' | 'solid'; }

/** The optical layer owns no input handlers and only regenerates a map when its host is resized. */
export function LiquidGlassTheme({ enabled, root, quality = 'auto' }: Props) {
  const definitions = useRef<SVGDefsElement>(null);
  useEffect(() => {
    const studio = root.current, defs = definitions.current; if (!enabled || !studio || !defs) return;
    const forcedColors = window.matchMedia('(forced-colors: active)'), reducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)'), reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const supported = typeof ResizeObserver !== 'undefined' && typeof CSS !== 'undefined' && (CSS.supports('backdrop-filter', 'url("#liquid-glass-support")') || CSS.supports('-webkit-backdrop-filter', 'url("#liquid-glass-support")'));
    const surfaces = new Map<HTMLElement, Surface>(), maps = new Map<string, Displacement>(), pending = new Set<Surface>();
    let frame = 0, hoverFrame = 0, serial = 0, active = false;
    let hover: Surface | undefined, pointer: PointerEvent | undefined;
    const clearHover = () => {
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      hoverFrame = 0; pointer = undefined;
      if (hover) delete hover.layer.dataset.glassShine;
      hover = undefined;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!active || event.pointerType === 'touch') return;
      pointer = event;
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        const move = pointer;
        const target = move?.target instanceof Element ? move.target.closest<HTMLElement>(SURFACES) : null;
        const next = target ? surfaces.get(target) : undefined;
        if (hover && hover !== next) delete hover.layer.dataset.glassShine;
        hover = next;
        if (!hover || !move) return;
        const { left, top } = hover.node.getBoundingClientRect();
        hover.layer.style.setProperty('--glass-shine-x', `${move.clientX - left}px`);
        hover.layer.style.setProperty('--glass-shine-y', `${move.clientY - top}px`);
        hover.layer.dataset.glassShine = '';
      });
    };
    const remove = (surface: Surface) => {
      if (hover === surface) clearHover();
      resizeObserver?.unobserve(surface.node); pending.delete(surface);
      if (surface.scroll) surface.node.removeEventListener('scroll', surface.scroll);
      surface.layer.remove(); surface.filter.remove(); surface.node.classList.remove('liquid-glass-surface');
      surface.node.style.position = surface.position; surfaces.delete(surface.node);
    };
    const draw = (surface: Surface) => {
      const width = surface.node.clientWidth, height = surface.node.clientHeight;
      if (width < 2 || height < 2 || !surface.node.isConnected) return;
      surface.layer.style.width = `${surface.node.clientWidth}px`; surface.layer.style.height = `${surface.node.clientHeight}px`;
      const style = getComputedStyle(surface.node), radius = Math.min(width / 2, height / 2, parseFloat(style.borderTopLeftRadius) || 0);
      const key = `${width}:${height}:${radius}`; if (surface.key === key) return;
      let map = maps.get(key);
      if (!map) {
        try { map = displacementMap(width, height, radius); } catch { map = undefined; }
        if (!map) { surface.layer.style.display = 'none'; surface.node.classList.remove('liquid-glass-surface'); return; }
        maps.set(key, map); if (maps.size > 24) maps.delete(maps.keys().next().value!);
      }
      surface.filter.setAttribute('width', String(width)); surface.filter.setAttribute('height', String(height));
      surface.image.setAttribute('width', String(width)); surface.image.setAttribute('height', String(height));
      surface.image.setAttribute('href', map.href);
      surface.displacements.forEach((displacement, channel) => displacement.setAttribute('scale', String(map.scale + (channel - 1) * 7)));
      surface.key = key;
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
        const id = `nbsx-liquid-glass-${serial++}`, filter = document.createElementNS(SVG, 'filter'), image = document.createElementNS(SVG, 'feImage');
        filter.id = id; filter.setAttribute('filterUnits', 'userSpaceOnUse'); filter.setAttribute('color-interpolation-filters', 'sRGB');
        filter.setAttribute('x', '0'); filter.setAttribute('y', '0'); image.setAttribute('result', 'displacement-map'); image.setAttribute('preserveAspectRatio', 'none');
        filter.append(image);
        const displacements = chromaticFilter(filter);
        defs.append(filter);
        const layer = document.createElement('span'); layer.className = 'liquid-glass-backdrop'; layer.setAttribute('aria-hidden', 'true');
        layer.style.backdropFilter = `url("#${id}") blur(3px) saturate(1.08)`;
        layer.style.setProperty('-webkit-backdrop-filter', `url("#${id}") blur(3px) saturate(1.08)`);
        const position = node.style.position; if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
        const surface: Surface = { node, layer, filter, image, displacements, position };
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
      active = glassRenderingMode({ quality, supported, forcedColors: forcedColors.matches, reducedTransparency: reducedTransparency.matches, reducedMotion: reducedMotion.matches, cores: navigator.hardwareConcurrency, memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory }) === 'refracted';
      studio.dataset.glassMode = active ? 'refracted' : 'solid';
      if (active) { scan(); mutationObserver.observe(studio, { childList: true, subtree: true }); }
      else {
        mutationObserver.disconnect(); for (const surface of [...surfaces.values()]) remove(surface);
        if (frame) cancelAnimationFrame(frame); frame = 0; pending.clear();
      }
    };
    studio.addEventListener('pointermove', onPointerMove, { passive: true });
    studio.addEventListener('pointerleave', clearHover);
    forcedColors.addEventListener('change', updateMode); reducedTransparency.addEventListener('change', updateMode); reducedMotion.addEventListener('change', updateMode); updateMode();
    return () => {
      active = false; mutationObserver.disconnect(); resizeObserver?.disconnect(); if (frame) cancelAnimationFrame(frame);
      forcedColors.removeEventListener('change', updateMode); reducedTransparency.removeEventListener('change', updateMode); reducedMotion.removeEventListener('change', updateMode);
      studio.removeEventListener('pointermove', onPointerMove); studio.removeEventListener('pointerleave', clearHover); clearHover();
      for (const surface of [...surfaces.values()]) remove(surface); maps.clear(); pending.clear(); delete studio.dataset.glassMode;
    };
  }, [enabled, root, quality]);
  return enabled ? <><GlassTooltip root={root}/><svg className="liquid-glass-definitions" width="0" height="0" aria-hidden="true" focusable="false"><defs ref={definitions} /></svg></> : null;
}
