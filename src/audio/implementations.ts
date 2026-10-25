import { audioFacts } from './profiles';
import legacyData from '../data/legacy-audio-facts.json';
import type { JavaRelease } from '../core/releases';
import type { SampleLibrary } from '../core/types';

/** Only independently reviewed clients may supply a bundled legacy codec. */
export function clientEmbeddedLegacyCodec(release: JavaRelease): boolean {
  return legacyData.profiles.some(profile => profile.id === `java-${release.id}` && profile.clientSha1 === release.clientSha1
    && 'codecContainer' in profile && profile.codecContainer === 'original-client-embedded');
}

// Dependency presence alone is insufficient: Minecraft 1.13 ships STB for other
// uses while registering the original Paulscode JOrbis audio codec.
export function audioImplementation(release: JavaRelease): Pick<SampleLibrary, 'decoderKind' | 'attenuationModel'> {
  const modern = audioFacts(`java-${release.id}`);
  if (modern && modern.clientSha1 === release.clientSha1) return { decoderKind: modern.decoder === 'jorbis' ? 'jorbis' : 'stb', attenuationModel: 'openal-linear' };
  const legacy = legacyData.profiles.find(profile => profile.id === `java-${release.id}` && profile.clientSha1 === release.clientSha1);
  const originalLibrary = release.audioLibraries.some(library => library.name === 'com.paulscode:librarylwjglopenal:20100824' && library.downloads?.artifact?.sha1 === '73e80d0794c39665aec3f62eee88ca91676674ef');
  return originalLibrary || legacy ? { decoderKind: 'legacy-jorbis', attenuationModel: 'paulscode-linear' } : { decoderKind: 'unknown' };
}
