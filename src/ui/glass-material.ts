/* Adapted from OpenNBS/NoteBlockStudio sh_liquid_glass.fsh and
 * liquid_glass_settings.gml at 5f57b1ac2f9d0e09730f5f048a866cb0a3fb3602.
 * Copyright (c) 2026 OpenNBS, MIT. See third_party/noteblockstudio-glass. */
export const GLASS_MENU_MATERIAL = Object.freeze({ innerAmount: 10, innerHeight: 32, outerAmount: -2, outerHeight: 5, edgeAmount: -8, edgeWidth: 1 });
export const smoothStep = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

/** Fourth-order continuous corner distance and its outward unit normal. CSS pixels. */
export function glassGeometry(x: number, y: number, width: number, height: number, cornerRadius: number) {
  const radius = Math.max(0, Math.min(cornerRadius, width / 2, height / 2));
  const qx = Math.abs(x) - width / 2 + radius, qy = Math.abs(y) - height / 2 + radius;
  const cx = Math.max(qx, 0), cy = Math.max(qy, 0), extent = Math.max(cx, cy);
  if (extent < .00001) return { distance: Math.max(qx, qy) - radius, nx: qx > qy ? Math.sign(x) : 0, ny: qx > qy ? 0 : Math.sign(y) };
  const ux = cx / extent, uy = cy / extent, norm = Math.sqrt(Math.sqrt(ux ** 4 + uy ** 4));
  const length = Math.hypot(ux ** 3, uy ** 3), gradient = length / norm ** 3;
  return { distance: (extent * norm - radius) / gradient, nx: ux ** 3 / length * Math.sign(x), ny: uy ** 3 / length * Math.sign(y) };
}

/** Port of the shader's two refractive bands and thin, reversed edge lip. */
export function glassDisplacement(depth: number) {
  const m = GLASS_MENU_MATERIAL, d = Math.max(0, depth);
  const inner = 1 - smoothStep(0, m.innerHeight, d), outer = 1 - smoothStep(0, m.outerHeight, d);
  const lip = 1 - smoothStep(0, m.edgeWidth, d);
  return m.innerAmount * inner ** 2 + m.outerAmount * outer ** 2 + m.edgeAmount * lip;
}

export function glassRenderingMode({ quality, supported, forcedColors, reducedTransparency, reducedMotion, cores, memory }: {
  quality: 'auto' | 'solid'; supported: boolean; forcedColors: boolean; reducedTransparency: boolean; reducedMotion: boolean; cores?: number; memory?: number;
}): 'refracted' | 'solid' {
  return quality === 'solid' || !supported || forcedColors || reducedTransparency || reducedMotion || !!cores && cores <= 2 || !!memory && memory <= 4 ? 'solid' : 'refracted';
}
