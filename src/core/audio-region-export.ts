import type { AudioFileAsset } from './types';

export const MAX_AUDIO_EXPORT_REGIONS = 128;

export interface AudioRegionExportRequest {
  sources: ({ file: AudioFileAsset } | { data: string })[];
  regions: { source: number; name: string; offsetSeconds: number; durationSeconds: number }[];
}
