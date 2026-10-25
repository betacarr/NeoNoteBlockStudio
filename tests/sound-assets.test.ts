import { describe, expect, it } from 'vitest';
import fixture from './fixtures/legacy-sound-assets.json';
import layouts from '../src/data/sound-asset-layouts.json';
import { loadNoteBlockSoundAssets, soundAssetLayout, soundAssetObjectPath, type SoundAssetObject } from '../src/core/sound-assets';
import { releaseById } from '../src/core/releases';

const definitions = new TextEncoder().encode(JSON.stringify(fixture.definitions));
const readMetadataFixture = async (object: SoundAssetObject) => object.hash === fixture.objects['sounds.json'].hash ? definitions : new Uint8Array([1]);

describe('original default-domain sound-index layout', () => {
  it.each(Object.entries(layouts.defaultDomainRoot.clients))('resolves the checked %s client (%s) using the official root-key fixture', async (hash, version) => {
    expect(releaseById(version)?.clientSha1).toBe(hash);
    expect(soundAssetLayout(hash, fixture)).toBe('default-domain-root');
    const reads: string[] = [];
    const result = await loadNoteBlockSoundAssets(fixture, 'default-domain-root', async object => { reads.push(object.hash); return readMetadataFixture(object); });
    expect(Object.keys(result.samples).sort()).toEqual(['basedrum', 'bass', 'harp', 'hat', 'pling', 'snare'].sort());
    expect(result.samples.harp.name).toBe('sounds/note/harp.ogg');
    expect(result.samples.bass.name).toBe('sounds/note/bassattack.ogg');
    expect(result.samples.bass.sha1).toBe(fixture.objects['sounds/note/bassattack.ogg'].hash);
    expect(reads).not.toContain(fixture.objects['sounds/note/bass.ogg'].hash);
    expect(result.soundEvents?.bass.event).toBe('note.bassattack');
    expect(result.soundEvents?.bass.path).toBe('minecraft/sounds/note/bassattack.ogg');
  });

  it('keeps namespaced index keys for a modern client', async () => {
    const namespaced = { objects: Object.fromEntries(Object.entries(fixture.objects).map(([name, object]) => [`minecraft/${name}`, object])) };
    const hash = releaseById('1.20.5')!.clientSha1;
    const layout = soundAssetLayout(hash, namespaced);
    expect(layout).toBe('namespaced');
    const result = await loadNoteBlockSoundAssets(namespaced, layout, readMetadataFixture);
    expect(result.samples.harp.name).toBe('minecraft/sounds/note/harp.ogg');
  });

  it('chooses the original client layout when conflicting root and namespace entries coexist', async () => {
    const conflicting = { objects: { ...fixture.objects, 'minecraft/sounds.json': { hash: 'not-the-original-definition' } } };
    const layout = soundAssetLayout(releaseById('1.7.3')!.clientSha1, conflicting);
    const result = await loadNoteBlockSoundAssets(conflicting, layout, readMetadataFixture);
    expect(result.samples.harp.sha1).toBe(fixture.objects['sounds/note/harp.ogg'].hash);
  });

  it('does not guess a root or pre-1.6 sample layout for an unchecked client', () => {
    expect(() => soundAssetLayout(releaseById('a1.2.6')!.clientSha1, fixture)).toThrow('尚未核对');
    expect(() => soundAssetLayout('unknown-client', fixture)).toThrow('尚未核对');
    const ambiguous = { objects: { 'newsound/note/harp.ogg': fixture.objects['sounds/note/harp.ogg'], 'sound3/note/harp.ogg': fixture.objects['sounds/note/harp.ogg'] } };
    expect(() => soundAssetLayout(releaseById('b1.8.1')!.clientSha1, ambiguous)).toThrow('尚未核对');
  });

  it('resolves the independently checked 1.7.2 virtual directory without inheriting later ResourceIndex clients', async () => {
    const hash = releaseById('1.7.2')!.clientSha1!;
    expect(layouts.virtualLegacyRoot.clients[hash as keyof typeof layouts.virtualLegacyRoot.clients]).toBe('1.7.2');
    expect(hash in layouts.defaultDomainRoot.clients).toBe(false);
    const conflicting = { objects: { ...fixture.objects, 'minecraft/sounds.json': { hash: 'wrong-namespace' } } };
    const layout = soundAssetLayout(hash, conflicting);
    expect(layout).toBe('default-domain-root');
    const loaded = await loadNoteBlockSoundAssets(conflicting, layout, readMetadataFixture);
    expect(loaded.samples.bass.name).toBe('sounds/note/bassattack.ogg');
    expect(loaded.soundEvents?.bass.event).toBe('note.bassattack');
  });

  it('reports a missing checked path instead of substituting a differently prefixed sample', async () => {
    const missing = { objects: { ...fixture.objects } };
    delete (missing.objects as Record<string, SoundAssetObject>)['sounds/note/harp.ogg'];
    (missing.objects as Record<string, SoundAssetObject>)['minecraft/sounds/note/harp.ogg'] = fixture.objects['sounds/note/harp.ogg'];
    await expect(loadNoteBlockSoundAssets(missing, 'default-domain-root', readMetadataFixture)).rejects.toThrow('sounds/note/harp.ogg');
    await expect(loadNoteBlockSoundAssets({ objects: {} }, 'default-domain-root', readMetadataFixture)).rejects.toThrow('sounds.json');
  });

  it('rejects paths outside the canonical Minecraft resource namespace', () => {
    expect(() => soundAssetObjectPath('default-domain-root', 'other/sounds/note/harp.ogg')).toThrow('路径');
    expect(() => soundAssetObjectPath('default-domain-root', 'minecraft/../sounds/note/harp.ogg')).toThrow('路径');
  });
});
