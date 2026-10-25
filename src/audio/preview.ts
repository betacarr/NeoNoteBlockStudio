import type { Project, SampleLibrary } from '../core/types';

type PreviewBackend = { type: 'web' } | { type: 'native'; library: SampleLibrary & { nativeLibrary: string } };
export type PlaybackMode = 'realtime' | 'native-compare';

/** Playback is a local choice; retain the saved project's legacy preview flag. */
export function previewBackendForProject(project: Project, library: SampleLibrary | undefined, desktop: boolean, mode: PlaybackMode = 'realtime'): PreviewBackend {
  if (mode === 'realtime') return { type: 'web' };
  if (!desktop) throw new Error('原生离线对照仅在桌面程序中可用，请选择实时试听。');
  if (!library) throw new Error('请先加载工程目标版本的 Minecraft 声音资源，或在设置中选择实时试听。');
  if (project.audio.profileId !== library.profileId) throw new Error(`工程目标为 ${project.audio.profileId}，当前资源为 ${library.version}。请加载匹配资源，或在设置中选择实时试听。`);
  if (!library.nativeLibrary) throw new Error('当前资源没有适用于此应用的原生声音库。请加载匹配资源，或在设置中选择实时试听。');
  return { type: 'native', library: { ...library, nativeLibrary: library.nativeLibrary } };
}
