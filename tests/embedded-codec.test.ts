import {describe,it,expect} from 'vitest';
import {clientEmbeddedLegacyCodec} from '../src/audio/implementations';
import {releaseById} from '../src/core/releases';

describe('checked client-embedded codec selection', () => {
  it.each(['1.0','1.1','1.2.1','1.2.2','1.2.3','1.2.4','1.2.5','1.3.1','1.3.2','1.4.2','1.4.4','1.4.5','1.4.6','1.4.7','1.5.1','1.5.2'])('accepts only the original Java %s identity', version => {
    const release = releaseById(version)!;
    expect(clientEmbeddedLegacyCodec(release)).toBe(true);
    expect(clientEmbeddedLegacyCodec({...release,clientSha1:'modified-client'})).toBe(false);
    expect(clientEmbeddedLegacyCodec({...release,id:'b1.8.1'})).toBe(false);
  });
  it.each(['b1.8.1','1.6.1','1.6.2','1.6.4','1.20.5'])('does not infer an embedded codec for Java %s', version => {
    expect(clientEmbeddedLegacyCodec(releaseById(version)!)).toBe(false);
  });
});
