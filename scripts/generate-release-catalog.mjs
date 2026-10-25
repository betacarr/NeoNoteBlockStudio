import { readFile, writeFile, mkdir } from 'node:fs/promises';

const matrix = JSON.parse(await readFile('.research/audio-version-matrix.json', 'utf8'));
const versions = matrix.versions.map(v => ({
  id: v.id, type: v.type, released: v.released, clientSha1: v.client?.sha1,
  assetIndex: v.assetIndex?.id, assetIndexSha1: v.assetIndex?.sha1, metadataUrl: v.metadataUrl,
  audioLibraries: v.libraries.filter(l => /^(?:org\.lwjgl:lwjgl(?::|-openal:|-stb:)|org\.lwjgl\.lwjgl:lwjgl(?:_util|-platform)?:|com\.paulscode:|(?:com|org)\.jcraft:(?:jorbis|jogg):)/.test(l.name)).map(l => ({ name: l.name, rules: l.rules, natives: l.natives, downloads: l.downloads })),
  evidence: { bytecode: 'indexed', behaviour: 'pending', gameRecording: 'pending' },
}));
await mkdir('src/data', { recursive: true });
await writeFile('src/data/java-releases.json', JSON.stringify({ schema: 1, source: matrix.source, generatedAt: matrix.generatedAt, versions }, null, 2));
await writeFile('src/data/java-release-identities.json', JSON.stringify(versions.map(v => ({ id: v.id, assetIndex: v.assetIndex, clientSha1: v.clientSha1 })), null, 2));
console.log(JSON.stringify({ versions: versions.length, output: 'src/data/java-releases.json' }));
