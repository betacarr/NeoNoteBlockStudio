import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { hrtfContextForProject, outputLimiterForProject } from '../src/audio/context';
import { audioFacts, audioProfile, gameHrtfControl } from '../src/audio/profiles';
import { audioImplementation } from '../src/audio/implementations';
import { releaseById } from '../src/core/releases';
import { createProject } from '../src/core/project';
import validation from '../src/data/audio-validation.json';

describe('original HRTF option boundaries', () => {
  it.each(['1.13.1', '1.13.2', '1.14.1', '1.14.2'])('uses Java %s reviewed core without inheriting an anchor world pass', version => {
    const release = releaseById(version)!, profileId = `java-${version}`, project = createProject(); project.audio.profileId = profileId;
    expect(audioImplementation(release)).toEqual(version.startsWith('1.13') ? { decoderKind: 'legacy-jorbis', attenuationModel: 'paulscode-linear' } : { decoderKind: 'stb', attenuationModel: 'openal-linear' });
    expect(audioImplementation({ ...release, clientSha1: 'unrecognised' }).decoderKind).toBe('unknown');
    expect(audioProfile(profileId).status).toBe('code-reviewed'); expect(audioProfile(profileId).measurementSummary).toBeUndefined();
    expect(gameHrtfControl(profileId)).toBe(false); expect(hrtfContextForProject(project)).toBe('device-default'); expect(outputLimiterForProject(project)).toBeUndefined();
  });
  it('reports only the independently measured 1.14.3 cohort and leaves nearby patches unmeasured', () => {
    expect(audioProfile('java-1.14.3')).toMatchObject({ status: 'partially-measured' });
    expect(audioProfile('java-1.14.3').measurementSummary).toContain('127 个游戏场景');
    expect(gameHrtfControl('java-1.14.3')).toBe(false);
    expect(audioProfile('java-1.14.2').status).toBe('code-reviewed');
  });
  it.each(['1.21.8', '1.21.9'])('does not describe untested Java %s HRTF-on as an unsupported backend', version => {
    const profile = audioProfile(`java-${version}`);
    expect(profile.status).toBe('partially-measured');
    expect(profile.measurementSummary).toContain('23 个游戏场景');
    expect(profile.measurementSummary).toContain('开启待验收');
    expect(profile.measurementSummary).not.toContain('不支持');
  });
  it('keeps Java 1.12.2 source support without promoting its normalized context candidates', () => {
    expect(audioProfile('java-1.12.2').status).toBe('code-reviewed');
    expect(audioProfile('java-1.12.2').measurementSummary).toBeUndefined();
    expect(audioImplementation(releaseById('1.12.2')!)).toEqual({ decoderKind: 'legacy-jorbis', attenuationModel: 'paulscode-linear' });
    expect(validation.profiles.some(profile => profile.id === 'java-1.12.2')).toBe(false);
  });
  it.each([
    ['scripts/verify-lwjgl2-world.mjs', ['--candidate-only', '--evidence-name', 'must-not-publish']],
    ['scripts/reverify-world-captures.mjs', ['--version', '1.12.2']],
  ])('blocks acceptance publication through %s before reading captures', (script, args) => {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/cannot publish world acceptance|excluded from acceptance/);
  });
  it.each(['1.12.2', '1.13', '1.14', '1.16.5', '1.18.2'])('preserves Java %s device defaults instead of inventing a game off request', version => {
    const project = createProject(); project.audio.profileId = `java-${version}`;
    expect(gameHrtfControl(project.audio.profileId)).toBe(false);
    expect(hrtfContextForProject(project)).toBe('device-default');
  });
  it('distinguishes the enable-only 1.19 option from the explicit off request added in 1.19.1', () => {
    const project = createProject(); project.audio.profileId = 'java-1.19';
    expect(audioFacts(project.audio.profileId)?.hrtfControlMode).toBe('enable-only-reset');
    expect(hrtfContextForProject(project)).toBe('device-default');
    project.audio.directional = true; expect(hrtfContextForProject(project)).toBe('enable-only-reset');
    project.audio.directional = false; project.audio.profileId = 'java-1.19.1';
    expect(audioFacts(project.audio.profileId)?.hrtfControlMode).toBe('explicit-reset');
    expect(hrtfContextForProject(project)).toBe('explicit-reset');
  });
  it('records the 1.21.5 switch to context attributes without losing profile zero or the limiter', () => {
    expect(audioFacts('java-1.21.4')?.hrtfControlMode).toBe('explicit-reset');
    for (const version of ['1.21.5', '26.3']) {
      const project = createProject(); project.audio.profileId = `java-${version}`;
      expect(audioFacts(project.audio.profileId)?.hrtfControlMode).toBe('context-attributes');
      expect(audioFacts(project.audio.profileId)).toMatchObject({ hrtfProfile: 0 });
      expect(hrtfContextForProject(project)).toBe('context-attributes');
      expect(outputLimiterForProject(project)).toBe(true);
    }
  });
  it('preserves reset followed by a limiter-only context at the 1.20.2 boundary', () => {
    const project = createProject(); project.audio.profileId = 'java-1.20.1'; project.audio.directional = true;
    expect(hrtfContextForProject(project)).toBe('explicit-reset'); expect(outputLimiterForProject(project)).toBeUndefined();
    for (const version of ['1.20.2', '1.20.5']) {
      project.audio.profileId = `java-${version}`;
      expect(hrtfContextForProject(project)).toBe('explicit-reset'); expect(outputLimiterForProject(project)).toBe(true);
    }
  });
  it('keeps explicit studio controls separate from original game defaults', () => {
    const project = createProject(); project.audio.profileId = 'java-1.19'; project.audio.mode = 'studio';
    expect(hrtfContextForProject(project)).toBeUndefined();
  });
});
