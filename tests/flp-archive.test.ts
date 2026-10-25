import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { bytesToBase64, openNbsx, saveNbsx } from '../src/core/container';
import { createProject, validateProject } from '../src/core/project';

const fixture = () => {
  const project = createProject('FLP archive');
  project.assets = [{ id: 'source-flp', name: 'source.flp', mime: 'application/x-fl-studio-project', data: bytesToBase64(Uint8Array.of(0, 1, 2, 255)) }];
  project.provenance = { kind: 'flp', filename: 'source.flp', metadata: { sourceAssetId: 'source-flp' } };
  return project;
};
describe('NBSX original FLP archive', () => {
  it('roundtrips the complete original asset and provenance', () => {
    const project = fixture(), reopened = openNbsx(saveNbsx(project));
    reopened.modifiedAt = project.modifiedAt; expect(reopened).toEqual(project);
  });
  it('rejects missing/wrong original references and absent embedded bytes on save/open', () => {
    const project = fixture(); project.assets[0].mime = 'audio/midi'; expect(() => validateProject(project)).toThrow('FLP');
    project.assets[0].mime = 'application/x-fl-studio-project'; delete project.assets[0].data;
    expect(() => saveNbsx(project)).toThrow('原始 FLP');
    const bytes = zipSync({ 'project.json': strToU8(JSON.stringify(project)) });
    expect(() => openNbsx(bytes)).toThrow('原始 FLP');
  });
});
