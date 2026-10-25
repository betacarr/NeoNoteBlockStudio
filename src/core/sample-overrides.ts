import { INSTRUMENTS } from './instruments';
import type { Instrument } from './types';

const builtinIds = new Set(INSTRUMENTS.map(instrument => instrument.id));

/** Switching game versions replaces game sounds, retaining custom sample links. */
export function clearBuiltinSampleOverrides(instruments: Instrument[]) {
  for (const instrument of instruments) if (builtinIds.has(instrument.id)) instrument.assetId = undefined;
}
