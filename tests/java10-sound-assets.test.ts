import { describe, expect, it } from 'vitest';
import fixture from './fixtures/java10-sound-assets.json';
import { loadNoteBlockSoundAssets, soundAssetLayout, soundAssetObjectPath, type SoundAssetObject } from '../src/core/sound-assets';
import { releaseById } from '../src/core/releases';
import { audioProfile } from '../src/audio/profiles';
import { audioImplementation, clientEmbeddedLegacyCodec } from '../src/audio/implementations';
import coreEvidence from '../src/data/legacy-audio-facts.json';
import measurementEvidence from '../src/data/audio-validation.json';

const hash = 'b679fea27f2284836202e9365e13a82552092e5d';
const readPlaceholder = async () => new Uint8Array([1]);

describe('original Java1.0 installed resource dispatch', () => {
  it('selects newsound for the individually checked client and preserves its bassattack event', async () => {
    expect(releaseById('1.0')?.clientSha1).toBe(hash);
    expect(soundAssetLayout(hash, fixture)).toBe('legacy-newsound');
    const reads: string[] = [];
    const result = await loadNoteBlockSoundAssets(fixture, 'legacy-newsound', async object => { reads.push(object.hash); return readPlaceholder(); });
    expect(Object.keys(result.samples).sort()).toEqual(['basedrum', 'bass', 'harp', 'hat', 'pling', 'snare']);
    expect(result.samples.harp.name).toBe('newsound/note/harp.ogg');
    expect(result.samples.bass.name).toBe('newsound/note/bassattack.ogg');
    expect(result.soundEvents?.bass.event).toBe('note.bassattack');
    expect(reads).toHaveLength(6);
    expect(reads).not.toContain(fixture.objects['newsound/note/bass.ogg'].hash);
    // Resource selection is independent of the later source/component review.
    const release = releaseById('1.0')!;
    const core = coreEvidence.profiles.find(profile => profile.id === 'java-1.0');
    expect(core?.clientSha1).toBe(hash);
    expect(core?.sourceEvidence).toBe('docs/evidence/java-1.0-pre13-audio-source.json');
    expect(audioProfile('java-1.0').status).toBe('code-reviewed');
    expect(audioImplementation(release).decoderKind).toBe('legacy-jorbis');
    expect(clientEmbeddedLegacyCodec(release)).toBe(true);
    expect(clientEmbeddedLegacyCodec({ ...release, clientSha1: '0'.repeat(40) })).toBe(false);
    expect(measurementEvidence.profiles.some(profile => profile.id === 'java-1.0')).toBe(false);
  });
  it('does not give another client support merely because its asset index has the same paths', () => {
    expect(() => soundAssetLayout(releaseById('b1.8.1')!.clientSha1, fixture)).toThrow('尚未核对');
    expect(() => soundAssetLayout('unknown', fixture)).toThrow('尚未核对');
  });
  it('ignores sound3 and a conflicting modern definition for the checked client', async () => {
    const conflicting = { objects: { ...fixture.objects, 'sound3/note/harp.ogg': { hash: 'ignored' }, 'minecraft/sounds.json': { hash: 'ignored-definition' } } };
    const result = await loadNoteBlockSoundAssets(conflicting, soundAssetLayout(hash, conflicting), readPlaceholder);
    expect(result.samples.harp.sha1).toBe(fixture.objects['newsound/note/harp.ogg'].hash);
  });
  it('does not substitute sound3 when the actual installed newsound file is missing', async () => {
    const missing = { objects: { ...fixture.objects } as Record<string, SoundAssetObject> }; delete missing.objects['newsound/note/harp.ogg'];
    await expect(loadNoteBlockSoundAssets(missing, 'legacy-newsound', readPlaceholder)).rejects.toThrow('newsound/note/harp.ogg');
  });
  it.each(['sound/note/harp.ogg', 'newsound/note/harp1.ogg'])('rejects an additional original-pool variant at %s', async key => {
    const variants = { objects: { ...fixture.objects, [key]: { hash: 'additional-original-variant' } } };
    await expect(loadNoteBlockSoundAssets(variants, 'legacy-newsound', readPlaceholder)).rejects.toThrow('多个变体');
  });
  it('limits legacy mapping to canonical sound paths', () => {
    expect(soundAssetObjectPath('legacy-newsound', 'minecraft/sounds/note/harp.ogg')).toBe('newsound/note/harp.ogg');
    expect(() => soundAssetObjectPath('legacy-newsound', 'minecraft/other/harp.ogg')).toThrow('路径');
    expect(() => soundAssetObjectPath('legacy-newsound', 'minecraft/sounds/../harp.ogg')).toThrow('路径');
  });
});
