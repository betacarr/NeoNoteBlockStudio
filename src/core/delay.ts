import { createTempoMap } from './time';
import type { DelayEffect, Diagnostic, FlatNote, Project } from './types';

const MAX_TAPS = 4096;
const MAX_EVENTS = 2000000;
const WARNING_EVENTS = 100000;

export function createDefaultDelay(): DelayEffect {
  return { enabled: false, mode: 'gate', timeUnit: 'beats', interval: .5, feedback: .5, wet: .5, panAmount: 0,
    attack: 0, decay: .25, sustain: .7, release: .5, releaseOffset: 0, tail: 4 };
}

/** Optional settings are validated as a complete object, including when disabled. */
export function validateDelayEffect(value: unknown): value is DelayEffect {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const effect = value as DelayEffect;
  const finite = (number: unknown, min: number, max: number): boolean => typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max;
  return typeof effect.enabled === 'boolean' && (effect.mode === 'gate' || effect.mode === 'tail')
    && (effect.timeUnit === 'beats' || effect.timeUnit === 'seconds')
    && finite(effect.interval, effect.timeUnit === 'beats' ? 1 / 128 : .001, 256)
    && finite(effect.feedback, 0, 1) && finite(effect.wet, 0, 1) && finite(effect.sustain, 0, 1)
    && (effect.panAmount === undefined || finite(effect.panAmount, 0, 1))
    && finite(effect.attack, 0, 256) && finite(effect.decay, 0, 256) && finite(effect.release, 0, 256)
    && finite(effect.tail, 0, 256) && finite(effect.releaseOffset, -256, 256);
}

function adsLevel(effect: DelayEffect, elapsed: number): number {
  if (effect.attack > 0 && elapsed < effect.attack) return elapsed / effect.attack;
  if (effect.decay > 0 && elapsed < effect.attack + effect.decay) return 1 - (1 - effect.sustain) * (elapsed - effect.attack) / effect.decay;
  return effect.sustain;
}

/** All times use settings.timeUnit. This weights tap onsets, never sample playback. */
export function delayEnvelope(settings: DelayEffect, elapsed: number, noteDuration: number): number {
  if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(noteDuration) || noteDuration < 0) return 0;
  if (settings.mode === 'tail') return 1;
  const releaseStart = Math.max(0, noteDuration + settings.releaseOffset);
  if (elapsed < releaseStart) return adsLevel(settings, elapsed);
  if (settings.release === 0 || elapsed >= releaseStart + settings.release) return 0;
  return adsLevel(settings, releaseStart) * (1 - (elapsed - releaseStart) / settings.release);
}

function lastTap(effect: DelayEffect, duration: number): number {
  let end = effect.tail;
  if (effect.mode === 'gate') {
    const releaseStart = Math.max(0, duration + effect.releaseOffset);
    end = releaseStart + effect.release;
    // A release starting at zero cannot revive a silent sustain or an unstarted attack.
    if (adsLevel(effect, releaseStart) === 0) end = Math.min(releaseStart, effect.attack + effect.decay);
  }
  let count = Math.floor(end / effect.interval);
  const included = (tap: number) => effect.mode === 'tail' ? tap * effect.interval <= end : tap * effect.interval < end;
  if (count > 0 && !included(count)) count--;
  // Correct division rounding using the actual multiplication used for tap times.
  if (included(count + 1)) count++;
  return Math.max(0, count);
}

export interface DelayEventPlan { notes: FlatNote[]; diagnostics: Diagnostic[]; generated: number; endTick: number }

/** Pure, finite expansion from original occurrences only; dry note objects stay unchanged. */
export function expandDelayEvents(project: Project, dryNotes: FlatNote[]): DelayEventPlan {
  if (dryNotes.length > MAX_EVENTS) throw new Error('Delay 展开后的音符超过 200 万个，请缩短循环或效果范围。');
  const effects = new Map<string, DelayEffect>();
  for (const track of project.tracks) {
    if (track.delay === undefined) continue;
    if (!validateDelayEffect(track.delay)) throw new Error('轨道 Delay 参数无效。');
    if (track.delay.enabled && track.delay.wet > 0 && track.delay.feedback > 0) effects.set(track.id, track.delay);
  }
  let endTick = 0;
  for (const note of dryNotes) endTick = Math.max(endTick, note.absoluteTick + 1);
  if (!effects.size || !dryNotes.length) return { notes: dryNotes, diagnostics: [], generated: 0, endTick };

  const timing = createTempoMap(project);
  const plans: { note: FlatNote; effect: DelayEffect; duration: number; count: number; startSeconds: number }[] = [];
  let generated = 0;
  for (const note of dryNotes) {
    const effect = effects.get(note.trackId);
    if (!effect || note.delaySource) continue;
    const startSeconds = effect.timeUnit === 'seconds' ? timing.seconds(note.absoluteTick) : 0;
    const duration = effect.timeUnit === 'beats' ? note.duration / project.ppq : timing.seconds(note.absoluteTick + note.duration) - startSeconds;
    const count = lastTap(effect, duration);
    if (count > MAX_TAPS) throw new Error('Delay 每个原音符的回声超过 4096 个，请缩短包络或尾音，或增大间隔。');
    for (let tap = 1; tap <= count; tap++) {
      const factor = effect.wet * effect.feedback ** tap * delayEnvelope(effect, tap * effect.interval, duration);
      if (factor > 0 && ++generated + dryNotes.length > MAX_EVENTS) throw new Error('Delay 展开后的音符超过 200 万个，请缩短循环或效果范围。');
    }
    if (count) plans.push({ note, effect, duration, count, startSeconds });
  }
  if (!generated) return { notes: dryNotes, diagnostics: [], generated: 0, endTick };

  const notes = dryNotes.slice(), usedIds = new Set(dryNotes.map(note => note.id));
  for (const { note, effect, duration, count, startSeconds } of plans) {
    const panAmount = effect.panAmount ?? 0;
    for (let tap = 1; tap <= count; tap++) {
      const elapsed = tap * effect.interval;
      const factor = effect.wet * effect.feedback ** tap * delayEnvelope(effect, elapsed, duration);
      if (!(factor > 0)) continue;
      const absoluteTick = effect.timeUnit === 'beats' ? note.absoluteTick + elapsed * project.ppq : timing.tick(startSeconds + elapsed);
      const baseId = `delay:${JSON.stringify([note.regionId, note.id, note.absoluteTick, tap])}`;
      let id = baseId, suffix = 0;
      while (usedIds.has(id)) id = `${baseId}:${++suffix}`;
      usedIds.add(id);
      const echo: FlatNote = { ...note, id, absoluteTick, velocity: note.velocity * factor, gain: note.gain * factor,
        delaySource: { noteId: note.id, occurrenceTick: note.absoluteTick, tap, factor } };
      if (panAmount > 0) echo.effectivePan = Math.max(-1, Math.min(1, note.effectivePan + (tap % 2 ? -panAmount : panAmount)));
      delete echo.midiSource;
      notes.push(echo); endTick = Math.max(endTick, absoluteTick + 1);
    }
  }
  notes.sort((a, b) => a.absoluteTick - b.absoluteTick || a.midi - b.midi);
  const diagnostics: Diagnostic[] = generated > WARNING_EVENTS ? [{ severity: 'warning', code: 'delay-event-pressure',
    message: `Delay 已派生 ${generated} 个回声音符，试听、保存和导出可能需要更长时间；可缩短包络或尾音，或增大间隔。` }] : [];
  return { notes, diagnostics, generated, endTick };
}
