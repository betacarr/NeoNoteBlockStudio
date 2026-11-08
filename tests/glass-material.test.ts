import { describe, expect, it } from 'vitest';
import { glassDisplacement, glassGeometry, glassRenderingMode } from '../src/ui/glass-material';

describe('OpenNBS continuous glass material port', () => {
  it('has finite outward normals and symmetric distances including the corner singularity', () => {
    for (const x of [0, 80, 90, 95, 100]) for (const y of [0, 30, 40, 45, 50]) {
      const g = glassGeometry(x, y, 200, 100, 10), mirrored = glassGeometry(-x, -y, 200, 100, 10);
      expect(Number.isFinite(g.distance)).toBe(true);
      if (g.nx || g.ny) expect(Math.hypot(g.nx,g.ny)).toBeCloseTo(1);
      else expect(glassDisplacement(-g.distance)).toBe(0); // Interior axis singularity has no optical displacement.
      expect(g.distance).toBeCloseTo(mirrored.distance); expect(g.nx + mirrored.nx).toBeCloseTo(0); expect(g.ny + mirrored.ny).toBeCloseTo(0);
    }
  });
  it('retains fourth-order corners instead of an ordinary circular rounded rectangle', () => {
    // x=y=90/40 lies on the corner origin; the continuous corner extends farther
    // into the diagonal than a circle of the same radius.
    expect(glassGeometry(90, 40, 200, 100, 10).distance).toBe(-10);
    expect(glassGeometry(98, 48, 200, 100, 10).distance).toBeLessThan(0);
    expect(glassGeometry(100, 0, 200, 100, 10).distance).toBe(0);
    expect(glassGeometry(0, 0, 200, 100, 1000).distance).toBe(-50);
  });
  it('preserves the upstream reversed edge lip and positive inner band without center warping', () => {
    expect(glassDisplacement(0)).toBe(0); expect(glassDisplacement(1)).toBeGreaterThan(7);
    expect(glassDisplacement(5)).toBeCloseTo(8.730916976928711);
    expect(glassDisplacement(32)).toBe(0); expect(glassDisplacement(100)).toBe(0);
    for(let depth=0;depth<100;depth+=.1) expect(Math.abs(glassDisplacement(depth))).toBeLessThan(20);
  });
});
describe('bounded optional rendering', () => {
  const capable = { quality:'auto' as const,supported:true,forcedColors:false,reducedTransparency:false,reducedMotion:false,cores:8,memory:8 };
  it('uses the live refractive backdrop only on capable opted-in devices', () => expect(glassRenderingMode(capable)).toBe('refracted'));
  it.each([{quality:'solid' as const},{supported:false},{forcedColors:true},{reducedTransparency:true},{reducedMotion:true},{cores:2},{memory:4}])('falls back without requiring a GPU runtime (%o)', patch => expect(glassRenderingMode({...capable,...patch})).toBe('solid'));
});
