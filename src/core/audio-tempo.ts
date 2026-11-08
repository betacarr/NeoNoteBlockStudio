import { createMeterMap } from './meter';
import { createTempoMap } from './time';
import type { AudioClip, Project, Tempo } from './types';

export type SmartTempoMode = 'auto' | 'keep' | 'adapt';
export type AudioTempoAction = 'detect-tempo' | 'align-tempo' | 'apply-tempo' | 'halve-tempo' | 'double-tempo';

export interface AudioTempoAnalysis {
  bpm: number;
  /** First detected downbeat (or first beat), in original audio seconds. */
  firstBeatSeconds: number;
  confidence: number;
  method?: 'beat-this' | 'spectral';
  stable?: boolean;
  downbeat?: boolean;
}

export function validateAudioTempo(value: AudioTempoAnalysis, duration: number) {
  if (!value || !Number.isFinite(value.bpm) || value.bpm < 45 || value.bpm > 240
      || !Number.isFinite(value.firstBeatSeconds) || value.firstBeatSeconds < 0 || value.firstBeatSeconds >= duration
      || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1
      || value.method !== undefined && value.method !== 'beat-this' && value.method !== 'spectral'
      || value.stable !== undefined && typeof value.stable !== 'boolean'
      || value.downbeat !== undefined && typeof value.downbeat !== 'boolean') throw new Error('音频曲速或首拍分析无效。');
}

export function visibleFirstBeat(clip: Pick<AudioClip, 'offsetSeconds' | 'durationSeconds' | 'tempoAnalysis'>): number | undefined {
  if (!clip.tempoAnalysis) return;
  const { bpm, firstBeatSeconds } = clip.tempoAnalysis, period = 60 / bpm;
  const lead = firstBeatSeconds - clip.offsetSeconds;
  if (lead < -1e-8 && clip.tempoAnalysis.stable === false) return;
  const beat = Math.max(0, lead + Math.max(0, Math.ceil(-lead / period - 1e-8)) * period);
  return beat < clip.durationSeconds ? beat : undefined;
}

export interface AudioTempoPlan { start: number; anchor?: number; tempos?: Tempo[] }

/** Align the detected beat without trimming or retiming the source samples.
 * A pickup before bar one is placed before the first bar that can contain it. */
export function planAudioTempo(
  project: Project, at: number, clip: Pick<AudioClip, 'id' | 'offsetSeconds' | 'durationSeconds' | 'tempoAnalysis'>,
  mode: SmartTempoMode, metronome = false, applyEstimate = false,
): AudioTempoPlan {
  const lead = visibleFirstBeat(clip);
  if (lead === undefined) return { start: at };
  const bpm = clip.tempoAnalysis!.bpm, meter = createMeterMap(project), original = createTempoMap(project);
  const place = (timing: ReturnType<typeof createTempoMap>) => {
    let anchor = meter.barSnap(at);
    if (timing.seconds(anchor) + 1e-8 < lead) anchor = meter.barSnap(timing.tick(lead), 'ceil');
    const start = Math.max(0, timing.tick(Math.max(0, timing.seconds(anchor) - lead)));
    return { start, anchor };
  };
  const placement = place(original);
  const from = Math.min(at, placement.start);
  const to = Math.max(original.tick(original.seconds(at) + clip.durationSeconds),
    original.tick(original.seconds(placement.start) + clip.durationSeconds),
    placement.anchor + (clip.durationSeconds - lead) * bpm * project.ppq / 60);
  const overlap = (start: number, end: number) => start < to && end > from;
  const otherAudio = (project.audioClips ?? []).filter(other => other.id !== clip.id);
  const musicalPatterns = new Set(project.patterns.filter(pattern => pattern.notes.length).map(pattern => pattern.id));
  const musicalRegions = project.regions.filter(region => musicalPatterns.has(region.patternId));
  const reference = metronome || project.reference || project.tempos.some(event => event.tick > 0 && overlap(event.tick, event.tick + 1e-7))
    || musicalRegions.some(region => overlap(region.start, region.start + region.length))
    || otherAudio.some(other => overlap(other.start, original.tick(original.seconds(other.start) + other.durationSeconds)));
  if (mode === 'keep' || !applyEstimate && clip.tempoAnalysis?.stable === false || mode === 'auto' && reference) return placement;
  if (!project.reference && !musicalRegions.length && !otherAudio.length && project.tempos.length === 1) {
    if (original.at(0).bpm === bpm) return placement;
    const tempos = [{ tick: 0, bpm }];
    return { ...place(createTempoMap({ ppq: project.ppq, tempos })), tempos };
  }
  const { anchor } = placement;
  const restore = Math.min(1e12, Math.ceil(anchor + (clip.durationSeconds - lead) * bpm * project.ppq / 60));
  if (restore <= anchor) return placement;
  const existing = original.at(anchor).bpm;
  if (existing === bpm && !project.tempos.some(event => event.tick > anchor && event.tick < restore && event.bpm !== bpm)) return placement;
  const tempos = [
    ...project.tempos.filter(event => event.tick < anchor || event.tick >= restore),
    { tick: anchor, bpm },
    ...(!project.tempos.some(event => event.tick === restore) ? [{ tick: restore, bpm: original.at(restore).bpm }] : []),
  ].sort((a, b) => a.tick - b.tick);
  return { ...placement, tempos };
}
