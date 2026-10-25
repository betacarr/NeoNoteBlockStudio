import type { NativeRenderRequest, Project } from '../core/types';
import { audioFacts, gameHrtfControl } from './profiles';

/** Preserve an explicit game request; an omitted attribute leaves the original library default. */
export function outputLimiterForProject(project: Project): boolean | undefined {
  return project.audio.mode === 'vanilla' && audioFacts(project.audio.profileId)?.outputLimiter === 'enabled' ? true : undefined;
}

/** A disabled game option in 1.19 does not ask OpenAL to disable HRTF. */
export function hrtfContextForProject(project: Project): NativeRenderRequest['hrtf'] {
  if (project.audio.mode !== 'vanilla') return undefined;
  const facts = audioFacts(project.audio.profileId);
  if (gameHrtfControl(project.audio.profileId) === false || (facts?.hrtfControlMode === 'enable-only-reset' && !project.audio.directional)) return 'device-default';
  switch (facts?.hrtfControlMode) {
    case 'enable-only-reset': return 'enable-only-reset';
    case 'explicit-reset': return 'explicit-reset';
    case 'context-attributes': return 'context-attributes';
    default: return undefined;
  }
}

export function hrtfOptionHint(project: Project): string {
  if (project.audio.mode !== 'vanilla') return '完整试听模式可手动选择方向音频。';
  if (gameHrtfControl(project.audio.profileId) === false) return '该版本没有游戏内方向音频开关。游戏预览沿用原版音频库默认设置，实际状态可能受设备设置影响。';
  if (audioFacts(project.audio.profileId)?.hrtfControlMode === 'enable-only-reset') return 'Java 1.19 关闭此选项时仍沿用音频库默认设置，因此设备可能继续启用方向音频。';
  return '使用目标版本的方向音频设置。音频库的全局设置可能覆盖开关，试听时会显示实际状态。';
}
