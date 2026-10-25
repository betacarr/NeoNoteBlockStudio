import { describe, expect, it } from 'vitest';
import { previewBackendForProject } from '../src/audio/preview';
import { openNbsx, saveNbsx } from '../src/core/container';
import { createProject } from '../src/core/project';
import type { SampleLibrary } from '../src/core/types';

const original: SampleLibrary = { root: 'fixture', version: '1.16.5', profileId: 'java-1.16.5', samples: {}, nativeLibrary: 'original-openal' };
describe('local playback mode selection', () => {
  it.each([undefined, 'native', 'web'] as const)('defaults a saved %s project to realtime without changing its persisted preference', saved => {
    const project = createProject(); project.audio.previewEngine = saved;
    const before = structuredClone(project);
    expect(previewBackendForProject(project, original, true)).toEqual({ type: 'web' });
    expect(previewBackendForProject(project, undefined, true)).toEqual({ type: 'web' });
    expect(project).toEqual(before);
    expect(openNbsx(saveNbsx(project)).audio).toEqual(before.audio);
  });
  it('retains the original native library only for explicit native comparison, including a saved Web preference', () => {
    const project = createProject(); project.audio.previewEngine = 'web';
    expect(previewBackendForProject(project, original, true, 'native-compare')).toEqual({ type: 'native', library: original });
  });
  it('rejects missing desktop resources without changing the saved native preference', () => {
    const project = createProject(), before = structuredClone(project.audio);
    expect(() => previewBackendForProject(project, undefined, true, 'native-compare')).toThrow('加载工程目标版本');
    expect(() => previewBackendForProject(project, { ...original, nativeLibrary: undefined }, true, 'native-compare')).toThrow('原生声音库');
    expect(project.audio).toEqual(before);
  });
  it('rejects a different original resource version before native rendering', () => {
    const project = createProject(); project.audio.profileId = 'java-1.20.5';
    expect(() => previewBackendForProject(project, original, true, 'native-compare')).toThrow('加载匹配资源');
  });
  it('permits realtime playback independently of original-library availability', () => {
    const project = createProject(); project.audio.previewEngine = 'web';
    expect(previewBackendForProject(project, undefined, true)).toEqual({ type: 'web' });
    project.audio.profileId = 'java-1.20.5'; expect(previewBackendForProject(project, original, true)).toEqual({ type: 'web' });
  });
  it('keeps the browser UI preview on Web Audio without claiming a desktop native renderer', () => {
    expect(previewBackendForProject(createProject(), original, false)).toEqual({ type: 'web' });
    expect(() => previewBackendForProject(createProject(), original, false, 'native-compare')).toThrow('仅在桌面程序');
  });
});
