import { describe, expect, it } from 'vitest';
import { createProject, newTrack, validateProject } from '../src/core/project';

describe('Project graph reference validation', () => {
  it('accepts the full independent-pattern/region limit without mutating or replacing the input', () => {
    const project = createProject('Many independently pasted regions'), trackId = project.tracks[0].id;
    project.patterns = Array.from({ length: 100000 }, (_, index) => ({ id: `pattern-${index}`, name: '', length: 1, notes: [] }));
    project.regions = Array.from({ length: 100000 }, (_, index) => ({ id: `region-${index}`, trackId, patternId: `pattern-${index}`, start: index, length: 1, offset: 0, loop: false }));
    const first = project.regions[0], last = project.regions.at(-1), patterns = project.patterns, regions = project.regions;
    expect(validateProject(project)).toBe(project);
    expect(project.patterns).toBe(patterns); expect(project.regions).toBe(regions);
    expect(project.regions[0]).toBe(first); expect(project.regions.at(-1)).toBe(last);
    expect(project.regions.at(-1)).toMatchObject({ start: 99999, patternId: 'pattern-99999' });
  });

  it.each(['instrument', 'pattern', 'region', 'missing'] as const)('rejects a %s identity used as a region track reference', kind => {
    const project = createProject();
    project.regions[0].trackId = kind === 'instrument' ? project.instruments[0].id : kind === 'pattern' ? project.patterns[0].id : kind === 'region' ? project.regions[0].id : 'missing';
    expect(() => validateProject(project)).toThrow('片段引用或范围无效');
  });

  it.each(['track', 'instrument', 'region', 'missing'] as const)('rejects a %s identity used as a pattern reference', kind => {
    const project = createProject();
    project.regions[0].patternId = kind === 'track' ? project.tracks[0].id : kind === 'instrument' ? project.instruments[0].id : kind === 'region' ? project.regions[0].id : 'missing';
    expect(() => validateProject(project)).toThrow('片段引用或范围无效');
  });

  it('retains global duplicate rejection before a reference can look valid in its own category', () => {
    const project = createProject(); project.tracks.push({ ...newTrack('Duplicate'), id: project.patterns[0].id });
    expect(() => validateProject(project)).toThrow('重复的对象 ID');
  });
});
