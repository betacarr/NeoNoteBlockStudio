import type { Preferences } from './types';

// Optional floating-surface effect; the editor still starts in classic mode.
export const LIQUID_GLASS_AVAILABLE = true;
// Retained for the archived full-chrome optical fixture; it is not the public feature.
export const INTERNAL_LIQUID_GLASS = false;

export function availableAppearance(value: unknown, enabled: boolean = LIQUID_GLASS_AVAILABLE): Preferences['appearance'] {
  return enabled && (value === 'liquid-glass' || value === 'native-glass') ? value : 'classic';
}

/** Keep the saved choice portable; unsupported desktops render the Web variant. */
export function displayedAppearance(value: Preferences['appearance'], supportsNative: boolean): Preferences['appearance'] {
  return value === 'native-glass' && !supportsNative ? 'liquid-glass' : value;
}
