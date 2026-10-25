import catalog from '../data/java-releases.json';

export interface GameArtifact { path: string; sha1: string; size: number; url: string }
export interface GameLibrary {
  name: string; rules?: { action: string; os?: { name?: string; arch?: string; version?: string }; features?: Record<string, boolean> }[];
  natives?: Record<string, string>;
  downloads?: { artifact?: GameArtifact; classifiers?: Record<string, GameArtifact> };
}
export interface JavaRelease {
  id: string; type: string; released: string; clientSha1?: string; assetIndex?: string; assetIndexSha1?: string;
  metadataUrl: string; audioLibraries: GameLibrary[];
  evidence: { bytecode: string; behaviour: string; gameRecording: string };
}
export const JAVA_RELEASES = catalog.versions as JavaRelease[];
export const releaseByClientHash = (sha1: string) => JAVA_RELEASES.find(r => r.clientSha1 === sha1);
export const releaseById = (id: string) => JAVA_RELEASES.find(r => r.id === id);
export function libraryAllowed(library: GameLibrary, platform: string, arch: string, systemVersion = ''): boolean {
  if (!library.rules?.length) return true;
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux';
  const aliases = arch === 'x64' ? ['amd64', 'x86_64', 'x64'] : arch === 'arm64' ? ['aarch64', 'arm64'] : ['x86', 'i386'];
  let allowed = false;
  for (const rule of library.rules) {
    const matches = (!rule.os?.name || rule.os.name === os)
      && (!rule.os?.arch || aliases.some(a => new RegExp(`^(?:${rule.os!.arch})$`).test(a)))
      && (!rule.os?.version || new RegExp(rule.os.version).test(systemVersion))
      && (!rule.features || Object.values(rule.features).every(value => value === false));
    if (matches) allowed = rule.action === 'allow';
  }
  return allowed;
}
export function nativeArtifacts(release: JavaRelease, component: 'openal' | 'stb', platform: string, arch: string, systemVersion = ''): GameArtifact[] {
  if (!['win32', 'darwin', 'linux'].includes(platform)) return [];
  const suffix = platform === 'win32' ? arch === 'arm64' ? 'natives-windows-arm64' : arch === 'ia32' ? 'natives-windows-x86' : 'natives-windows'
    : platform === 'darwin' ? arch === 'arm64' ? 'natives-macos-arm64' : 'natives-macos'
    : arch === 'arm64' ? 'natives-linux-arm64' : 'natives-linux';
  const result: GameArtifact[] = [];
  for (const library of release.audioLibraries) {
    if (!libraryAllowed(library, platform, arch, systemVersion)) continue;
    const name = library.name.split(':')[1];
    if (component === 'stb' && name !== 'lwjgl-stb') continue;
    if (component === 'openal' && name !== 'lwjgl-openal' && name !== 'lwjgl-platform') continue;
    if (name === 'lwjgl-platform') {
      // LWJGL 2 uses Mojang's platform mapping (not LWJGL 3's macos suffix).
      // Its combined Intel archives do not provide an ARM64 library.
      if (!['x64', 'ia32'].includes(arch)) continue;
      const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux';
      const classifier = library.natives?.[os]?.replace('${arch}', arch === 'x64' ? '64' : '32');
      const artifact = classifier && library.downloads?.classifiers?.[classifier];
      if (artifact) result.push(artifact);
      continue;
    }
    const artifact = library.downloads?.artifact;
    if (artifact && artifact.path.endsWith(`-${suffix}.jar`)) result.push(artifact);
    const classifier = library.downloads?.classifiers?.[suffix]; if (classifier) result.push(classifier);
  }
  return [...new Map(result.map(a => [a.sha1, a])).values()];
}

export function nativeFileMatches(filename: string, component: 'openal' | 'stb', platform: string): boolean {
  const name = filename.split('/').pop() ?? '';
  if (component === 'stb') return platform === 'win32' ? /^lwjgl_stb\.dll$/i.test(name)
    : platform === 'darwin' ? /^liblwjgl_stb\.dylib$/i.test(name) : platform === 'linux' && /^liblwjgl_stb\.so$/i.test(name);
  return platform === 'win32' ? /^OpenAL(?:32|64)?\.dll$/i.test(name)
    : platform === 'darwin' ? /^(?:lib)?openal(?:32|64)?\.dylib$/i.test(name)
      : platform === 'linux' && /^libopenal(?:32|64)?\.so$/i.test(name);
}
