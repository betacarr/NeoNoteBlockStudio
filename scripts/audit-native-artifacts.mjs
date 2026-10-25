import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import { digest, verifiedArtifact } from './research-utils.mjs';

// Binary identities select research boundaries; they never confer game accuracy.
const root = path.resolve('.local/native-archive-audit', `run-${Date.now()}`);
await mkdir(root, { recursive: true });
const bundle = path.join(root, 'selection.mjs');
await build({ stdin: { contents: "export { JAVA_RELEASES, nativeArtifacts, nativeFileMatches } from './src/core/releases.ts';", resolveDir: process.cwd(), sourcefile: 'native-selection.ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'esm' });
const { JAVA_RELEASES, nativeArtifacts, nativeFileMatches } = await import(pathToFileURL(bundle).href);
const targets = [{ platform: 'win32', arch: 'x64' }, { platform: 'darwin', arch: 'x64' }, { platform: 'darwin', arch: 'arm64' }];
const versions = JAVA_RELEASES.filter(release => release.type === 'release');
const pending = new Map(), archives = new Map(), records = [], failures = [];
const cpu = value => ({ 7: 'ia32', 16777223: 'x64', 12: 'arm', 16777228: 'arm64', 18: 'ppc', 16777234: 'ppc64', 332: 'ia32', 34404: 'x64', 43620: 'arm64' })[value] ?? `unknown-${value}`;
function architectures(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), magic = view.getUint32(0);
  if (bytes[0] === 77 && bytes[1] === 90) {
    const pe = view.getUint32(60, true); assert.equal(view.getUint32(pe, true), 0x4550);
    return { format: 'PE', architectures: [cpu(view.getUint16(pe + 4, true))] };
  }
  if ([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)) {
    const little = [0xbebafeca, 0xbfbafeca].includes(magic), count = view.getUint32(4, little), stride = [0xcafebabf, 0xbfbafeca].includes(magic) ? 32 : 20;
    assert(count > 0 && count < 20 && 8 + count * stride <= bytes.length);
    return { format: 'Mach-O universal', architectures: Array.from({ length: count }, (_, i) => cpu(view.getUint32(8 + i * stride, little))) };
  }
  assert([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(magic), `Unrecognized binary header ${magic.toString(16)}`);
  return { format: 'Mach-O', architectures: [cpu(view.getUint32(4, [0xcefaedfe, 0xcffaedfe].includes(magic)))] };
}
async function artifactRecord(artifact, component, platform, arch) {
  let task = pending.get(artifact.sha1);
  if (!task) {
    task = (async () => {
      const file = await verifiedArtifact(artifact, path.resolve('.research/libraries', artifact.path));
      const bytes = await readFile(file); assert.equal(bytes.length, artifact.size);
      const entries = unzipSync(bytes, { filter: entry => /\.(dll|dylib)$/i.test(entry.name) });
      const binaries = Object.entries(entries).map(([name, data]) => ({ name, bytes: data.length, sha256: digest(data, 'sha256'), ...architectures(data) }));
      const record = { ...artifact, sha256: digest(bytes, 'sha256'), binaries };
      archives.set(artifact.sha1, record); return record;
    })(); pending.set(artifact.sha1, task);
  }
  const record = await task;
  const matches = record.binaries.filter(binary => nativeFileMatches(binary.name, component, platform) && binary.architectures.includes(arch));
  assert.equal(matches.length, 1, `Expected one ${component} ${platform}/${arch} binary in ${artifact.path}`);
  return { archiveSha1: artifact.sha1, binary: matches[0] };
}
async function inspect(release) {
  const metadataSha1 = new URL(release.metadataUrl).pathname.split('/')[3];
  assert(/^[a-f0-9]{40}$/.test(metadataSha1));
  const metadataFile = await verifiedArtifact({ url: release.metadataUrl, sha1: metadataSha1 }, path.resolve('.research/native-archive-metadata', `${release.id}.json`));
  const metadataBytes = await readFile(metadataFile), metadata = JSON.parse(metadataBytes);
  assert.equal(metadata.id, release.id); assert.equal(metadata.downloads.client.sha1, release.clientSha1);
  const names = new Set(release.audioLibraries.map(library => library.name));
  const select = library => JSON.parse(JSON.stringify({ name: library.name, rules: library.rules, natives: library.natives, downloads: library.downloads }));
  assert.deepEqual(metadata.libraries.filter(library => names.has(library.name)).map(select), release.audioLibraries);
  const selection = [];
  for (const target of targets) for (const component of ['openal', 'stb']) {
    const artifacts = nativeArtifacts(release, component, target.platform, target.arch, target.platform === 'win32' ? '10.0.26200' : '26.0');
    assert(artifacts.length <= 1, `Ambiguous ${release.id} ${component} ${target.platform}/${target.arch}`);
    selection.push({ ...target, component, status: artifacts.length ? 'binary-identity-checked' : 'no-matching-archive', ...(artifacts.length ? await artifactRecord(artifacts[0], component, target.platform, target.arch) : {}) });
  }
  return { version: release.id, released: release.released, clientSha1: release.clientSha1, metadata: { url: release.metadataUrl, sha1: metadataSha1, sha256: digest(metadataBytes, 'sha256') }, selection };
}
let cursor = 0;
async function worker() {
  while (cursor < versions.length) {
    const release = versions[cursor++];
    try { records.push(await inspect(release)); }
    catch (error) { failures.push({ version: release.id, error: String(error) }); }
    if ((records.length + failures.length) % 20 === 0) console.log(JSON.stringify({ processed: records.length + failures.length, expected: versions.length, failures: failures.length }));
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
records.sort((a, b) => a.released.localeCompare(b.released));
const boundaries = [];
for (const target of targets) for (const component of ['openal', 'stb']) {
  let previous;
  for (const record of records) {
    const selected = record.selection.find(item => item.platform === target.platform && item.arch === target.arch && item.component === component);
    const hash = selected.binary?.sha256 ?? null;
    if (hash !== previous) boundaries.push({ ...target, component, firstVersion: record.version, status: selected.status, binarySha256: hash });
    previous = hash;
  }
}
const sources = {};
for (const file of ['src/core/releases.ts', 'src/data/java-releases.json', 'electron/main.ts', 'scripts/audit-native-artifacts.mjs', 'tests/native-artifacts.test.ts']) sources[file] = digest(await readFile(file), 'sha256');
const report = { schema: 1, status: failures.length ? 'failed' : 'passed', scope: 'Official catalog formal releases only; Windows x64 and macOS Intel/ARM64 OpenAL/STB archive selection, official SHA-1/size verification and native binary header/identity checks. Static evidence only: no Mac execution, original sound context, decoding, game behavior, waveform or measured-profile promotion.', versions: records.length, expectedVersions: versions.length, targets, sources, boundaries, archives: [...archives.values()].sort((a, b) => a.path.localeCompare(b.path)), records, failures };
await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
if (process.argv.includes('--write-evidence')) { assert.equal(failures.length, 0); await writeFile('docs/evidence/native-archive-census.json', JSON.stringify({ ...report, rawReport: { path: path.relative(process.cwd(), path.join(root, 'report.json')).replaceAll('\\', '/'), sha256: digest(await readFile(path.join(root, 'report.json')), 'sha256') } }, null, 2)); }
console.log(JSON.stringify({ root, versions: records.length, archives: archives.size, boundaries: boundaries.length, failures }));
assert.equal(failures.length, 0);
