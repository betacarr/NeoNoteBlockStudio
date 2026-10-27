import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractFile, listPackage, statFile } from '@electron/asar';

const metadata = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const root = path.resolve(process.argv[2] ?? `release/${metadata.version}`);
const archive = path.join(root, 'win-unpacked/resources/app.asar');
const names = listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
const unpacked = path.join(root, 'win-unpacked/resources/app.asar.unpacked');
const issues = [];
const previewBank = JSON.parse(fs.readFileSync('third_party/opennbs-samples/manifest.json', 'utf8'));
const previewFiles = new Map(previewBank.samples.map(sample => [`dist/sounds/${sample.file}`, sample]));
const profile = process.env.USERPROFILE;
const privateStrings = [process.cwd(), profile].filter(Boolean).flatMap(value => [value, value.replaceAll('\\', '/')]).map(value => value.toLowerCase());
for (const name of names) {
  if (/^(?:src|tests|scripts|docs)\/|(?:^|\/)(?:\.local|\.research|\.git)(?:\/|$)|\.map$|liquid.?glass|\.(?:nbsx|nbs|mid|midi|flp|wav|ogg|mp3|pcm|jar)$/i.test(name) && !previewFiles.has(name)) issues.push({ file: name, rule: 'unexpected-release-file' });
  const nativeName = path.join(...name.split('/'));
  if (statFile(archive, nativeName).files) continue;
  let bytes;
  try { bytes = extractFile(archive, nativeName); } catch { issues.push({ file: name, rule: 'unreadable-release-file' }); continue; }
  const preview = previewFiles.get(name);
  if (preview && (bytes.length !== preview.bytes || createHash('sha256').update(bytes).digest('hex') !== preview.sha256)) issues.push({ file: name, rule: 'preview-sample-checksum' });
  const text = bytes.toString('utf8').toLowerCase();
  if (privateStrings.some(value => text.includes(value) || text.includes(value.replaceAll('\\', '\\\\')))) issues.push({ file: name, rule: 'developer-absolute-path' });
  if (/\.(?:cjs|js|css|json|md|txt)$/.test(name) && /liquid glass|仅供内测|内测功能/.test(text)) issues.push({ file: name, rule: 'unpublished-feature-text' });
}
const packaged = JSON.parse(extractFile(archive, 'package.json').toString());
if (packaged.version !== metadata.version || packaged.build?.productName && packaged.build.productName !== 'NeoNBS') issues.push({ file: 'package.json', rule: 'release-metadata-mismatch' });
for (const file of ['LICENSE.electron.txt', 'LICENSES.chromium.html', 'NeoNBS.exe']) if (!fs.existsSync(path.join(root, 'win-unpacked', file))) issues.push({ file, rule: 'missing-runtime-file' });
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third_party/flp2nbs/LICENSE', 'third_party/flp2nbs/NOTICE.txt', 'third_party/opennbs-samples/LICENSE', 'third_party/opennbs-samples/NOTICE.md', 'third_party/opennbs-samples/manifest.json']) if (!names.includes(file)) issues.push({ file, rule: 'missing-license' });
for (const file of previewFiles.keys()) if (!names.includes(file)) issues.push({ file, rule: 'missing-preview-sample' });
if (names.includes('third_party/opennbs-samples/manifest.json') && extractFile(archive, path.join('third_party', 'opennbs-samples', 'manifest.json')).toString() !== fs.readFileSync('third_party/opennbs-samples/manifest.json', 'utf8')) issues.push({ file: 'third_party/opennbs-samples/manifest.json', rule: 'preview-manifest-mismatch' });
if (issues.length) { console.error(JSON.stringify({ status: 'failed', issues }, null, 2)); process.exit(1); }
const assets = ['setup', 'portable'].map(kind => `NeoNBS-${metadata.version}-x64-${kind}.exe`);
const records = assets.map(name => { const bytes = fs.readFileSync(path.join(root, name)); return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; });
fs.writeFileSync(path.join(root, 'SHA256SUMS.txt'), records.map(record => `${record.sha256}  ${record.name}`).join('\n') + '\n');
fs.writeFileSync(path.join(root, 'release-audit.json'), JSON.stringify({ version: metadata.version, status: 'passed', archiveEntries: names.length, assets: records }, null, 2));
console.log(JSON.stringify({ version: metadata.version, status: 'passed', archiveEntries: names.length, assets: records }, null, 2));
