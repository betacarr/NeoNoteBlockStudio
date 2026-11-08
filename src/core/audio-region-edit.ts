import { assertAudioProjectSize, inspectAudioClipSelection } from './audio-region-clipboard';
import { MAX_PROJECT_TICK } from './expansion';
import { createTempoMap, type TempoMap } from './time';
import type { AudioClip, Project } from './types';

export type AudioTrimEdge = 'start' | 'end';
type AudioRange = Pick<AudioClip, 'start' | 'offsetSeconds' | 'durationSeconds'>;
const MIN_AUDIO_DURATION = .001;
const MAX_AUDIO_DURATION = 7200;

/** Audio plays at file speed. Move the source boundary by elapsed seconds,
 * even when a trim crosses a tempo event in the project.
 */
export function planAudioTrim(clip: AudioClip, timing: TempoMap, edge: AudioTrimEdge, tick: number, sourceDuration: number): AudioRange | undefined {
  if (!Number.isFinite(tick)) return;
  const start = timing.seconds(clip.start);
  const end = start + clip.durationSeconds;
  const requestedTick = Math.max(0, Math.min(MAX_PROJECT_TICK, tick));
  const requested = timing.seconds(requestedTick);
  const minimum = Math.min(MIN_AUDIO_DURATION, clip.durationSeconds);
  if (edge === 'start') {
    const boundary = Math.max(0, start - clip.offsetSeconds, end - MAX_AUDIO_DURATION, Math.min(end - minimum, requested));
    if (Math.abs(boundary - start) < 1e-9) return;
    return { start: boundary === requested ? requestedTick : timing.tick(boundary),
      offsetSeconds: Math.max(0, clip.offsetSeconds + (boundary - start)), durationSeconds: end - boundary };
  }
  const max = Math.min(MAX_AUDIO_DURATION, timing.seconds(MAX_PROJECT_TICK) - start,
    Math.max(clip.durationSeconds, sourceDuration - clip.offsetSeconds));
  const durationSeconds = Math.min(max, Math.max(minimum, requested - start));
  if (durationSeconds < minimum || Math.abs(durationSeconds - clip.durationSeconds) < 1e-9) return;
  return { start: clip.start, offsetSeconds: clip.offsetSeconds, durationSeconds };
}

export function audioSourceDuration(project: Project, clip: AudioClip, decodedDuration?: number): number {
  const file = project.assets.find(asset => asset.id === clip.assetId)?.audioFile;
  return file ? file.frames / file.sampleRate : decodedDuration ?? clip.offsetSeconds + clip.durationSeconds;
}

export function audioClipWithRange(clip: AudioClip, range: AudioRange): AudioClip {
  const next = { ...clip, ...range };
  const markers = clip.chords ?? (clip.analysis?.analysisPerformed !== false ? clip.analysis?.chords : undefined);
  // A preview asset in analysis represents the old visible crop. Keep its
  // markers in source coordinates so expanding the clip reveals them again.
  if (markers) {
    next.chords = markers;
    next.chordOriginSeconds = clip.chordOriginSeconds ?? clip.offsetSeconds;
  }
  delete next.analysis;
  return next;
}

type AudioSplit = { ok: true; cuts: { clip: AudioClip; left: AudioRange; right: AudioRange }[] } | { ok: false; reason: string };

export function planAudioSplit(project: Project, ids: ReadonlySet<string>, tick: number, visible?: ReadonlySet<string>): AudioSplit {
  const selection = inspectAudioClipSelection(project, ids, visible);
  if (!selection.ok) return selection;
  if (!Number.isFinite(tick) || tick < 0 || tick > MAX_PROJECT_TICK) return { ok: false, reason: '播放头位置无效。' };
  const timing = createTempoMap(project), at = timing.seconds(tick);
  const cuts: Extract<AudioSplit, { ok: true }>['cuts'] = [];
  for (const clip of selection.clips) {
    const left = at - timing.seconds(clip.start);
    const right = clip.durationSeconds - left;
    if (left <= 1e-9 || right <= 1e-9) continue;
    if (left < MIN_AUDIO_DURATION || right < MIN_AUDIO_DURATION) return { ok: false, reason: '播放头两侧需各保留至少 1 毫秒的音频。' };
    cuts.push({ clip,
      left: { start: clip.start, offsetSeconds: clip.offsetSeconds, durationSeconds: left },
      right: { start: tick, offsetSeconds: clip.offsetSeconds + left, durationSeconds: right },
    });
  }
  if (!cuts.length) return { ok: false, reason: '请将播放头移到所选音频片段内部。' };
  if ((project.audioClips?.length ?? 0) + cuts.length > 100000) return { ok: false, reason: '拆分后音频片段数量超过安全上限。' };
  return { ok: true, cuts };
}

export function prepareAudioSplit(project: Project, cuts: Extract<AudioSplit, { ok: true }>['cuts']) {
  const pairs = new Map(cuts.map(({ clip, left, right }) => {
    const before = audioClipWithRange(clip, left);
    const after = audioClipWithRange(clip, right);
    after.id = crypto.randomUUID();
    if (after.chords) after.chords = after.chords.map(chord => ({ ...chord }));
    return [clip.id, { before, after }];
  }));
  const clips = (project.audioClips ?? []).flatMap(clip => {
    const split = pairs.get(clip.id);
    return split ? [split.before, split.after] : [clip];
  });
  assertAudioProjectSize({ ...project, audioClips: clips });
  return { clips, pairs };
}
