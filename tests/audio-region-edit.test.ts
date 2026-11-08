import { describe, expect, it } from 'vitest';
import { audioClipEnd } from '../src/core/audio-clips';
import { audioClipWithRange, audioSourceDuration, planAudioSplit, planAudioTrim, prepareAudioSplit } from '../src/core/audio-region-edit';
import { regionChords } from '../src/core/chord-track';
import { openNbsx, saveNbsx } from '../src/core/container';
import { createProject, newTrack } from '../src/core/project';
import { createTempoMap } from '../src/core/time';
import type { AudioClip } from '../src/core/types';

function fixture() {
  const project = createProject();
  project.ppq = 480;
  project.tempos = [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }];
  const track = { ...newTrack('Audio', 1), kind: 'audio' as const };
  project.tracks.push(track);
  const sha256 = 'a'.repeat(64);
  project.assets = [{ id: 'file', name: 'test.wav', mime: 'audio/wav',
    audioFile: { sha256, file: `audio/${sha256}.wav`, sampleRate: 44100, frames: 5 * 44100, channels: 2, bytes: 5 * 44100 * 8 + 44 } }];
  const clip: AudioClip = {
    id: 'clip', name: 'A', trackId: track.id, assetId: 'file', start: 480, offsetSeconds: 1, durationSeconds: 3, muted: true,
    separation: { sourceClipId: 'original', role: 'bass', model: 'test' },
    chords: [{ id: 'c', name: 'C', start: 0, end: 1, confidence: .8 }, { id: 'g', name: 'G', start: 1, end: 3, confidence: .7 }],
  };
  project.audioClips = [clip];
  return { project, track, clip, timing: createTempoMap(project) };
}

describe('non-destructive audio region editing', () => {
  it('moves the source boundary by elapsed seconds and reveals source-anchored chords again on expansion', () => {
    const { project, clip, timing } = fixture();
    const duration = audioSourceDuration(project, clip, 50);
    expect(duration).toBe(5);
    const trim = planAudioTrim(clip, timing, 'start', 1440, duration)!;
    expect(trim).toEqual({ start: 1440, offsetSeconds: 2.5, durationSeconds: 1.5 });
    const cropped = audioClipWithRange(clip, trim);
    expect(cropped.chordOriginSeconds).toBe(1);
    expect(regionChords(cropped)).toEqual([{ id: 'g', name: 'G', start: 0, end: 1.5, confidence: .7 }]);
    expect(audioClipEnd(project, cropped)).toBe(audioClipEnd(project, clip));
    const restore = planAudioTrim(cropped, timing, 'start', clip.start, duration)!;
    expect(regionChords(audioClipWithRange(cropped, restore))).toEqual(clip.chords);
    expect(clip.offsetSeconds).toBe(1);
    expect(project.assets).toHaveLength(1);
  });

  it('clamps both trim boundaries to the available file and timeline', () => {
    const { project, clip, timing } = fixture();
    const duration = audioSourceDuration(project, clip);
    expect(planAudioTrim(clip, timing, 'end', 50000, duration)).toEqual({ start: 480, offsetSeconds: 1, durationSeconds: 4 });
    expect(planAudioTrim(clip, timing, 'start', -10, duration)).toEqual({ start: 0, offsetSeconds: .5, durationSeconds: 3.5 });
    expect(planAudioTrim(clip, timing, 'end', audioClipEnd(project, clip), duration)).toBeUndefined();
  });

  it('splits only selected audio regions, retaining exact source continuity, mute and provenance through save', () => {
    const { project, clip } = fixture();
    const untouched = { ...clip, id: 'other' };
    project.audioClips!.push(untouched);
    const result = planAudioSplit(project, new Set(['clip']), 1440);
    if (!result.ok) throw new Error(result.reason);
    const { clips } = prepareAudioSplit(project, result.cuts);
    expect(clips[0]).toMatchObject({ id: 'clip', start: 480, offsetSeconds: 1, durationSeconds: 1.5, muted: true });
    expect(clips[1]).toMatchObject({ start: 1440, offsetSeconds: 2.5, durationSeconds: 1.5, muted: true, separation: clip.separation });
    expect(clips[1].assetId).toBe(clips[0].assetId);
    expect(clips[2]).toBe(untouched);
    expect(clips[1].chords?.[1]).not.toBe(clips[0].chords?.[1]);
    expect(project.audioClips).toHaveLength(2);
    const reopened = openNbsx(saveNbsx({ ...project, audioClips: clips }));
    expect(reopened.audioClips).toEqual(clips);
    expect(regionChords(reopened.audioClips![1])?.[0]).toMatchObject({ name: 'G', start: 0 });
  });

  it('refuses a group containing a locked track or a playhead on a clip boundary', () => {
    const { project, track, clip } = fixture();
    expect(planAudioSplit(project, new Set([clip.id]), clip.start).ok).toBe(false);
    track.locked = true;
    expect(planAudioSplit(project, new Set([clip.id]), 1440)).toMatchObject({ ok: false, reason: expect.stringContaining('锁定') });
  });
});
