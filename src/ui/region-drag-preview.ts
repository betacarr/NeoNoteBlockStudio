import type { Region } from '../core/types';
import { planRegionTrim } from '../core/editor-interaction';

export interface RegionDragPreview { region: Region; prepend: number }

/** Match a committed border edit without copying or mutating the source notes. */
export function regionDragPreview(region: Region, sourceLength: number, edge: 'start' | 'end' | null, projectTick: number): RegionDragPreview {
  return edge ? planRegionTrim(region, sourceLength, edge, projectTick) : { region: { ...region, start: Math.max(0, projectTick) }, prepend: 0 };
}
