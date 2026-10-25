import { describe, expect, it } from 'vitest';
import { nativeArtifacts, nativeFileMatches, releaseById } from '../src/core/releases';

describe('official native archive platform selection', () => {
  it('respects the legacy macOS classifier and Mojang platform overrides', () => {
    expect(nativeArtifacts(releaseById('1.7.10')!, 'openal', 'darwin', 'x64')[0]?.sha1).toBe('2d12c83fdfbc04ecabf02c7bc8cc54d034f0daac');
    expect(nativeArtifacts(releaseById('1.12.2')!, 'openal', 'darwin', 'x64')[0]?.sha1).toBe('79f5ce2fea02e77fe47a3c745219167a542121d7');
    expect(nativeArtifacts(releaseById('1.12.2')!, 'openal', 'win32', 'x64')[0]?.sha1).toBe('b84d5102b9dbfabfeb5e43c7e2828d98a7fc80e0');
    for (const platform of ['darwin', 'win32', 'linux']) expect(nativeArtifacts(releaseById('1.12.2')!, 'openal', platform, 'arm64')).toEqual([]);
  });
  it('keeps modern platform-specific overrides and ARM64 archives distinct', () => {
    expect(nativeArtifacts(releaseById('1.16.5')!, 'openal', 'darwin', 'x64')[0]?.sha1).toBe('9357ebfc82a0d6f64e17093dd963219367cd6fa2');
    expect(nativeArtifacts(releaseById('1.16.5')!, 'openal', 'win32', 'x64')[0]?.sha1).toBe('ec20a7d42a2438528fca87e60b1705f1e2339ddb');
    expect(nativeArtifacts(releaseById('1.19.2')!, 'openal', 'darwin', 'arm64')[0]?.sha1).toBe('23d55e7490b57495320f6c9e1936d78fd72c4ef8');
    expect(nativeFileMatches('openal.dylib', 'openal', 'darwin')).toBe(true);
    expect(nativeFileMatches('libopenal.dylib', 'openal', 'darwin')).toBe(true);
    expect(nativeFileMatches('openal.dylib', 'openal', 'win32')).toBe(false);
  });
});
