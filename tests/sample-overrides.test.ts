import { expect, it } from 'vitest';
import { importNbs } from '../src/core/nbs';
import { clearBuiltinSampleOverrides } from '../src/core/sample-overrides';
import { nbsFixture } from './fixtures/nbs-interop';

it.each([{ version: 2, builtinCount: 10 }, { version: 5, builtinCount: 16 }])('retains imported custom sample links across game-resource switches: %j', ({ version, builtinCount }) => {
  const project = importNbs(nbsFixture({ version, builtinCount, custom: [{ name: 'Marimba', soundFile: 'marimba.ogg', key: 57 }], notes: [{ tick: 0, instrument: builtinCount }] }), 'custom.nbs').project;
  const custom = project.instruments.find(instrument => instrument.assetId === 'external-0')!;
  project.assets[0].data = 'AAECAw==';
  const harp = project.instruments.find(instrument => instrument.id === 'harp')!; harp.assetId = 'game-harp';
  const copper = project.instruments.find(instrument => instrument.id === 'trumpet')!; copper.assetId = 'game-trumpet';
  const before = structuredClone({ custom, assets: project.assets, patterns: project.patterns });
  clearBuiltinSampleOverrides(project.instruments);
  expect(custom).toEqual(before.custom);
  expect(project.assets).toEqual(before.assets); expect(project.patterns).toEqual(before.patterns);
  expect(harp.assetId).toBeUndefined(); expect(copper.assetId).toBeUndefined();
});
