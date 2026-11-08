import { describe, expect, it } from 'vitest';
import { openNbsx, saveNbsx } from '../src/core/container';
import { createProject } from '../src/core/project';

describe('harp labels in new and existing projects', () => {
  it('uses the corrected label for a new default track and instrument', () => {
    const project = createProject();
    expect(project.tracks[0]).toMatchObject({ name: '竖琴', instrumentId: 'harp' });
    expect(project.instruments.find(instrument => instrument.id === 'harp')?.name).toBe('竖琴');
  });

  it('corrects an embedded old default label without changing sound data or a stored track name', () => {
    const project = createProject();
    const instrument = project.instruments.find(instrument => instrument.id === 'harp')!;
    instrument.name = '钢琴'; project.tracks[0].name = '钢琴';
    const before = structuredClone(instrument), reopened = openNbsx(saveNbsx(project));
    expect(reopened.instruments.find(instrument => instrument.id === 'harp')).toEqual({ ...before, name: '竖琴' });
    expect(reopened.tracks).toEqual(project.tracks);
    expect(instrument.name).toBe('钢琴');
    expect(openNbsx(saveNbsx(reopened)).instruments).toEqual(reopened.instruments);
  });

  it.each(['custom-name', 'custom-sample', 'custom-definition'] as const)('preserves a %s harp entry', kind => {
    const project = createProject(), instrument = project.instruments.find(instrument => instrument.id === 'harp')!;
    instrument.name = kind === 'custom-name' ? '我的钢琴' : '钢琴';
    if (kind === 'custom-sample') {
      instrument.assetId = 'my-sample';
      project.assets.push({ id: 'my-sample', name: 'piano.wav', mime: 'audio/wav', data: 'AQID' });
    }
    if (kind === 'custom-definition') instrument.rootMidi = 60;
    const before = structuredClone(instrument), reopened = openNbsx(saveNbsx(project));
    expect(reopened.instruments.find(instrument => instrument.id === 'harp')).toEqual(before);
    expect(reopened.instruments.find(instrument => instrument.id === 'pling')?.name).toBe('电钢琴');
  });
});
