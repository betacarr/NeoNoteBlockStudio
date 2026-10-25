import type { Preferences } from './types';

// Keep false in public builds. Internal testing uses a separate build of the source.
export const INTERNAL_LIQUID_GLASS = false;

export function availableAppearance(value: unknown, internalPreview: boolean = INTERNAL_LIQUID_GLASS): Preferences['appearance'] {
  return internalPreview && value === 'liquid-glass' ? 'liquid-glass' : 'classic';
}
