import { sortedTempos } from './time';
import type { Project } from './types';

export type NbsTempoPreset = 'bpm-7.5' | 'bpm-5';

/** Derive the fixed NBS grid without modifying the project's musical tempo map. */
export function nbsExportTiming(project: Pick<Project, 'tempos'>, preset: NbsTempoPreset = 'bpm-7.5'): { bpm: number; ticksPerSecond: number } {
  if (preset !== 'bpm-7.5' && preset !== 'bpm-5') throw new Error('未知的 NBS 速度预设。');
  if (!project || !Array.isArray(project.tempos) || project.tempos.some(tempo => !tempo || !Number.isFinite(tempo.tick) || tempo.tick < 0)) throw new Error('NBS 导出的速度事件位置必须是非负有限数值。');
  const tempos = sortedTempos(project.tempos);
  if (tempos.some(tempo => !Number.isFinite(tempo.bpm) || tempo.bpm <= 0)) throw new Error('NBS 导出需要有效的正数 BPM。');
  const bpm = tempos[0].bpm, raw = bpm / (preset === 'bpm-7.5' ? 7.5 : 5);
  // Match exportNbs: reject an unrepresentable rate before rounding, rather
  // than silently bringing an out-of-range value back inside the format limit.
  if (!Number.isFinite(raw) || raw < .01 || raw > 327.67) throw new Error('按当前 BPM 换算的 NBS 速度超出 0.01～327.67 tick/s 范围，请选择其他预设或调整工程速度。');
  return { bpm, ticksPerSecond: Math.round(raw * 100) / 100 };
}
