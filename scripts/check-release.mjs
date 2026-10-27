import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractFile, listPackage, statFile } from '@electron/asar';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const metadata = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const mac = process.argv[2] === '--mac';
const architectures = mac ? process.argv.slice(3) : ['x64'];
if (mac && (!architectures.length || architectures.some(arch => !['arm64', 'x64'].includes(arch)))) throw new Error('Usage: check-release.mjs --mac arm64 [x64]');
const root = path.resolve(mac ? `release/${metadata.version}` : process.argv[2] ?? `release/${metadata.version}`);
const issues = [], archives = [], assets = [];
const previewBank = JSON.parse(fs.readFileSync('third_party/minecraft-samples/manifest.json', 'utf8'));
const previewFiles = new Map(previewBank.samples.map(sample => [`dist/sounds/${sample.file}`, sample]));

for (const arch of new Set(architectures)) {
  const bundle = path.join(root, arch === 'arm64' ? 'mac-arm64' : 'mac', 'NeoNBS.app', 'Contents');
  const resources = mac ? path.join(bundle, 'Resources') : path.join(root, 'win-unpacked/resources');
  const archive = path.join(resources, 'app.asar');
  const names = listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
  const unpacked = path.join(resources, 'app.asar.unpacked');
  const privateStrings = [process.cwd(), homedir()].filter(Boolean).flatMap(value => [value, value.replaceAll('\\', '/')]).map(value => value.toLowerCase());
  for (const name of names) {
    if (/^(?:src|tests|scripts|docs)\/|(?:^|\/)(?:\.local|\.research|\.git)(?:\/|$)|\.map$|liquid.?glass|\.(?:nbsx|nbs|mid|midi|flp|wav|ogg|mp3|pcm|jar)$/i.test(name) && !previewFiles.has(name)) issues.push({ file: name, rule: 'unexpected-release-file' });
    const nativeName = path.join(...name.split('/'));
    if (statFile(archive, nativeName).files) continue;
    let bytes;
    try { bytes = extractFile(archive, nativeName); } catch { issues.push({ file: name, rule: 'unreadable-release-file' }); continue; }
    const preview = previewFiles.get(name);
    if (preview && (bytes.length !== preview.bytes || createHash('sha1').update(bytes).digest('hex') !== preview.sha1 || createHash('sha256').update(bytes).digest('hex') !== preview.sha256)) issues.push({ file: name, rule: 'preview-sample-checksum' });
    const text = bytes.toString('utf8').toLowerCase();
    if (privateStrings.some(value => text.includes(value) || text.includes(value.replaceAll('\\', '\\\\')))) issues.push({ file: name, rule: 'developer-absolute-path' });
    if (/\.(?:cjs|js|css|json|md|txt)$/.test(name) && /liquid glass|仅供内测|内测功能/.test(text)) issues.push({ file: name, rule: 'unpublished-feature-text' });
  }
  const packaged = JSON.parse(extractFile(archive, 'package.json').toString());
  if (packaged.version !== metadata.version || packaged.build?.productName && packaged.build.productName !== 'NeoNBS') issues.push({ file: 'package.json', rule: 'release-metadata-mismatch' });
  if (mac) {
    const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(bundle, 'Info.plist')], { encoding: 'utf8' }));
    if (plist.CFBundleIdentifier !== metadata.build.appId || plist.CFBundleShortVersionString !== metadata.version || plist.CFBundleName !== 'NeoNBS' || plist.LSMinimumSystemVersion !== metadata.build.mac.minimumSystemVersion) issues.push({ file: 'Info.plist', rule: 'release-metadata-mismatch' });
    const framework = path.join(bundle, 'Frameworks/Electron Framework.framework/Versions/A/Electron Framework');
    const minimums = [...execFileSync('otool', ['-l', framework], { encoding: 'utf8' }).matchAll(/\bminos\s+(\d+(?:\.\d+)+)/g)].map(match => match[1]);
    const versionNumber = value => value.split('.').reduce((total, part, index) => total + Number(part) * 1000 ** (2 - index), 0);
    if (!minimums.length || minimums.some(value => versionNumber(value) > versionNumber(plist.LSMinimumSystemVersion))) issues.push({ file: 'Info.plist', rule: 'minimum-system-older-than-electron' });
    if (!plist.CFBundleDocumentTypes?.some(type => type.CFBundleTypeExtensions?.includes('nbsx') && type.CFBundleTypeRole === 'Editor')) issues.push({ file: 'Info.plist', rule: 'missing-file-association' });
    for (const file of ['LICENSE.electron.txt', 'LICENSES.chromium.html', plist.CFBundleIconFile]) if (!file || !fs.existsSync(path.join(resources, file))) issues.push({ file, rule: 'missing-runtime-file' });
    const binaries = [path.join(bundle, 'MacOS/NeoNBS'), path.join(resources, 'koffi', `darwin_${arch}`, 'koffi.node')];
    for (const file of binaries) {
      if (!fs.existsSync(file)) { issues.push({ file: path.relative(bundle, file), rule: 'missing-native-binary' }); continue; }
      const actual = execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }).trim().split(/\s+/);
      if (!actual.includes(arch === 'x64' ? 'x86_64' : arch)) issues.push({ file: path.relative(bundle, file), rule: 'binary-architecture-mismatch' });
    }
    execFileSync('codesign', ['--verify', '--deep', '--strict', bundle.replace(/\/Contents$/, '')], { stdio: 'pipe' });
    assets.push(...['dmg', 'zip'].map(ext => `NeoNBS-${metadata.version}-mac-${arch}.${ext}`));
  } else {
    for (const file of ['LICENSE.electron.txt', 'LICENSES.chromium.html', 'NeoNBS.exe']) if (!fs.existsSync(path.join(root, 'win-unpacked', file))) issues.push({ file, rule: 'missing-runtime-file' });
    assets.push(...['setup', 'portable'].map(kind => `NeoNBS-${metadata.version}-x64-${kind}.exe`));
  }
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third_party/flp2nbs/LICENSE', 'third_party/flp2nbs/NOTICE.txt', 'third_party/minecraft-samples/NOTICE.md', 'third_party/minecraft-samples/manifest.json']) if (!names.includes(file)) issues.push({ file, rule: 'missing-license' });
  for (const file of previewFiles.keys()) if (!names.includes(file)) issues.push({ file, rule: 'missing-preview-sample' });
  if (names.includes('third_party/minecraft-samples/manifest.json') && extractFile(archive, path.join('third_party', 'minecraft-samples', 'manifest.json')).toString() !== fs.readFileSync('third_party/minecraft-samples/manifest.json', 'utf8')) issues.push({ file: 'third_party/minecraft-samples/manifest.json', rule: 'preview-manifest-mismatch' });
  if (names.some(name => name.startsWith('third_party/opennbs-samples/'))) issues.push({ rule: 'obsolete-preview-bank' });
  if (!fs.existsSync(path.join(unpacked, 'dist-electron/java/studio/nbsx/audio/NbsxVorbisDecoder.class'))) issues.push({ file: 'java adapter', rule: 'missing-java-adapter' });
  archives.push({ platform: mac ? 'darwin' : 'win32', arch, ...(mac ? { minimumSystemVersion: metadata.build.mac.minimumSystemVersion } : {}), archiveEntries: names.length });
}
if (issues.length) { console.error(JSON.stringify({ status: 'failed', issues }, null, 2)); process.exit(1); }
const records = assets.map(name => { const bytes = fs.readFileSync(path.join(root, name)); return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; });
// Re-auditing one architecture keeps checksums for other audited assets, while
// detecting any file modified since the prior audit.
let previous = {};
const auditFile = path.join(root, 'release-audit.json');
if (fs.existsSync(auditFile)) previous = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
const allRecords = [...new Map([...(previous.assets ?? []).filter(record => fs.existsSync(path.join(root, record.name))), ...records].map(record => [record.name, record])).values()].sort((a, b) => a.name.localeCompare(b.name));
for (const record of allRecords) if (createHash('sha256').update(fs.readFileSync(path.join(root, record.name))).digest('hex') !== record.sha256) throw new Error(`Previously audited release asset changed: ${record.name}`);
fs.writeFileSync(path.join(root, 'SHA256SUMS.txt'), allRecords.map(record => `${record.sha256}  ${record.name}`).join('\n') + '\n');
const allArchives = [...new Map([...(previous.archives ?? []), ...archives].map(record => [`${record.platform}-${record.arch}`, record])).values()];
const report = { version: metadata.version, status: 'passed', archives: allArchives, assets: allRecords };
fs.writeFileSync(auditFile, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
