import type { Project } from './types';
import { createTempoMap, type TempoMap } from './time';
import { projectEnd } from './project';

export interface WaveformPeaks { duration: number; values: Float32Array }
/** Peaks include every channel, including a silent left / audible right stereo file. */
export function waveformPeaks(channels: readonly Float32Array[], sampleRate: number, bins = 16384): WaveformPeaks {
  const frames = channels[0]?.length ?? 0, count = Math.min(bins, frames), values = new Float32Array(count);
  for (const channel of channels) for (let frame = 0; frame < frames; frame++) {
    const bin = Math.min(count - 1, Math.floor(frame * count / frames));
    values[bin] = Math.max(values[bin], Math.abs(channel[frame] ?? 0));
  }
  return { duration: frames / sampleRate, values };
}
export function referenceEndTick(project: Project, duration: number): number {
  const timing = createTempoMap(project);
  return project.reference ? timing.tick(timing.seconds(project.reference.startTick) + Math.max(0, duration)) : 0;
}
export const playbackEndTick = (project: Project, duration = 0): number => Math.max(projectEnd(project), referenceEndTick(project, duration));

/** A reference remains at its original speed. Tempo changes only change its position on a beat grid. */
export function waveformAmplitude(peaks: WaveformPeaks, timing: TempoMap, startTick: number, leftTick: number, rightTick: number): number {
  const offset = timing.seconds(startTick), from = timing.seconds(leftTick) - offset, to = timing.seconds(rightTick) - offset;
  if (!peaks.values.length || to <= 0 || from >= peaks.duration) return 0;
  const first = Math.max(0, Math.floor(from / peaks.duration * peaks.values.length));
  const last = Math.min(peaks.values.length, Math.max(first + 1, Math.ceil(to / peaks.duration * peaks.values.length)));
  let amplitude = 0;
  for (let i = first; i < last; i++) amplitude = Math.max(amplitude, peaks.values[i]);
  return amplitude;
}
/** One occurrence, cut at the project loop boundary without allocating a silent full-length buffer. */
export function referenceSegment(offset: number, duration: number, from: number, end: number): { delay: number; offset: number; duration: number } | undefined {
  const start = Math.max(from, offset, 0), finish = Math.min(end, offset + duration);
  if (finish <= start) return;
  return { delay: start - from, offset: start - offset, duration: finish - start };
}
