import { describe, expect, it } from 'vitest';
import fixture from './fixtures/java10-sound-assets.json';
import { loadNoteBlockSoundAssets, soundAssetLayout, soundAssetObjectPath, type SoundAssetIndex } from '../src/core/sound-assets';
import { releaseById } from '../src/core/releases';
import { audioProfile } from '../src/audio/profiles';
import { audioImplementation, clientEmbeddedLegacyCodec } from '../src/audio/implementations';
import coreEvidence from '../src/data/legacy-audio-facts.json';
import measurementEvidence from '../src/data/audio-validation.json';

const hash = (version: string) => releaseById(version)!.clientSha1;
const readPlaceholder = async () => new Uint8Array([1]);
const sound3Fixture: SoundAssetIndex = { objects: Object.fromEntries(Object.entries(fixture.objects).filter(([key]) => key.startsWith('newsound/')).map(([key, object]) => [key.replace(/^newsound\//, 'sound3/'), object])) };
const soundFixture: SoundAssetIndex = { objects: Object.fromEntries(Object.entries(sound3Fixture.objects!).map(([key, object]) => [key.replace(/^sound3\//, 'sound/'), object])) };

describe('independent pre-1.7 resource dispatch families', () => {
  it.each(['1.6.1', '1.6.2', '1.6.4'])('loads Java %s from singular sound paths despite conflicting prefixes', async version => {
    const conflicting = { objects: { ...fixture.objects, ...sound3Fixture.objects, ...soundFixture.objects, 'minecraft/sounds.json': { hash: 'ignore-json' } } };
    const layout = soundAssetLayout(hash(version), conflicting);
    expect(layout).toBe('legacy-sound');
    const result = await loadNoteBlockSoundAssets(conflicting, layout, readPlaceholder);
    expect(result.samples.harp.name).toBe('sound/note/harp.ogg');
    expect(result.samples.bass.name).toBe('sound/note/bassattack.ogg');
    expect(result.soundEvents?.bass.event).toBe('note.bassattack');
    expect(Object.keys(result.samples)).toHaveLength(6);
    const missing = structuredClone(conflicting);
    delete (missing.objects as Record<string, unknown>)['sound/note/harp.ogg'];
    await expect(loadNoteBlockSoundAssets(missing, layout, readPlaceholder)).rejects.toThrow('sound/note/harp.ogg');
  });
  it('keeps separate bass events and rejects active singular-sound variants', async () => {
    const withBass = { objects: { ...soundFixture.objects, 'sound/note/bass.ogg': { hash: 'different-bass' }, 'newsound/note/harp1.ogg': { hash: 'ignored' } } };
    expect((await loadNoteBlockSoundAssets(withBass, 'legacy-sound', readPlaceholder)).samples.bass.name).toBe('sound/note/bassattack.ogg');
    await expect(loadNoteBlockSoundAssets({ objects: { ...withBass.objects, 'sound/note/harp1.ogg': { hash: 'variant' } } }, 'legacy-sound', readPlaceholder)).rejects.toThrow('多个变体');
    await expect(loadNoteBlockSoundAssets({ objects: { ...withBass.objects, 'SOUND/note/harp1.ogg': { hash: 'variant' } } }, 'legacy-sound', readPlaceholder)).rejects.toThrow('多个变体');
    const distinct = { objects: { ...withBass.objects, 'sound/note/harp𝟘.ogg': { hash: 'supplementary-digit' }, 'sound/note/Harp1.ogg': { hash: 'different-case-event' } } };
    expect((await loadNoteBlockSoundAssets(distinct, 'legacy-sound', readPlaceholder)).samples.harp.name).toBe('sound/note/harp.ogg');
    expect(soundAssetObjectPath('legacy-sound', 'minecraft/sounds/note/harp.ogg')).toBe('sound/note/harp.ogg');
  });
  it('keeps opposite prefixes when the same index and a modern definition coexist', async () => {
    const both = { objects: { ...fixture.objects, ...sound3Fixture.objects, 'minecraft/sounds.json': { hash: 'ignore-modern-definition' } } };
    const before = await loadNoteBlockSoundAssets(both, soundAssetLayout(hash('1.3.2'), both), readPlaceholder);
    const after = await loadNoteBlockSoundAssets(both, soundAssetLayout(hash('1.4.7'), both), readPlaceholder);
    expect(before.samples.harp.name).toBe('newsound/note/harp.ogg');
    expect(after.samples.harp.name).toBe('sound3/note/harp.ogg');
    expect(after.samples.bass.name).toBe('sound3/note/bassattack.ogg');
    expect(after.soundEvents?.bass.event).toBe('note.bassattack');
    for (const version of ['1.3.2', '1.4.7']) {
      const release = releaseById(version)!;
      const core = coreEvidence.profiles.find(profile => profile.id === `java-${version}`);
      expect(core?.clientSha1).toBe(release.clientSha1);
      expect(core?.sourceEvidence).toBe(`docs/evidence/java-${version}-audio-source.json`);
      expect(audioProfile(`java-${version}`).status).toBe('code-reviewed');
      expect(audioImplementation(release).decoderKind).toBe('legacy-jorbis');
      expect(clientEmbeddedLegacyCodec(release)).toBe(true);
      expect(clientEmbeddedLegacyCodec({ ...release, clientSha1: '0'.repeat(40) })).toBe(false);
      expect(measurementEvidence.profiles.some(profile => profile.id === `java-${version}`)).toBe(false);
    }
  });
  it('refuses a missing sound3 file even when the same newsound sample exists', async () => {
    const missing: { objects: NonNullable<SoundAssetIndex['objects']> } = { objects: { ...fixture.objects, ...sound3Fixture.objects } };
    delete missing.objects['sound3/note/harp.ogg'];
    await expect(loadNoteBlockSoundAssets(missing, 'legacy-sound3', readPlaceholder)).rejects.toThrow('sound3/note/harp.ogg');
  });
  it('rejects sound3 variants but does not count an ignored newsound variant', async () => {
    const ignored = { objects: { ...sound3Fixture.objects, 'newsound/note/harp1.ogg': { hash: 'ignored' } } };
    expect((await loadNoteBlockSoundAssets(ignored, 'legacy-sound3', readPlaceholder)).samples.harp.name).toBe('sound3/note/harp.ogg');
    const active = { objects: { ...ignored.objects, 'sound3/note/harp1.ogg': { hash: 'active-variant' } } };
    await expect(loadNoteBlockSoundAssets(active, 'legacy-sound3', readPlaceholder)).rejects.toThrow('多个变体');
  });
  it('maps only canonical paths and rejects traversal for sound3 too', () => {
    expect(soundAssetObjectPath('legacy-sound3', 'minecraft/sounds/note/harp.ogg')).toBe('sound3/note/harp.ogg');
    expect(() => soundAssetObjectPath('legacy-sound3', 'minecraft/other/harp.ogg')).toThrow('路径');
    expect(() => soundAssetObjectPath('legacy-sound3', 'minecraft/sounds/../harp.ogg')).toThrow('路径');
  });
});
