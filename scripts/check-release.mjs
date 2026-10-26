import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractFile, listPackage } from '@electron/asar';

const metadata = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const root = path.resolve(process.argv[2] ?? `release/${metadata.version}`);
const archive = path.join(root, 'win-unpacked/resources/app.asar');
const names = listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
const unpacked = path.join(root, 'win-unpacked/resources/app.asar.unpacked');
const issues = [];
const profile = process.env.USERPROFILE;
const privateStrings = [process.cwd(), profile].filter(Boolean).flatMap(value => [value, value.replaceAll('\\', '/')]).map(value => value.toLowerCase());
for (const name of names) {
  if (/^(?:src|tests|scripts|docs)\/|(?:^|\/)(?:\.local|\.research|\.git)(?:\/|$)|\.map$|liquid.?glass|\.(?:nbsx|nbs|mid|midi|flp|wav|ogg|mp3|pcm|jar)$/i.test(name)) issues.push({ file: name, rule: 'unexpected-release-file' });
  let bytes;
  try { bytes = extractFile(archive, name); } catch { const file = path.join(unpacked, name); if (fs.existsSync(file) && fs.statSync(file).isFile()) bytes = fs.readFileSync(file); }
  if (!bytes) continue;
  const text = bytes.toString('utf8').toLowerCase();
  if (privateStrings.some(value => text.includes(value) || text.includes(value.replaceAll('\\', '\\\\')))) issues.push({ file: name, rule: 'developer-absolute-path' });
  if (/\.(?:cjs|js|css|json|md|txt)$/.test(name) && /liquid glass|仅供内测|内测功能/.test(text)) issues.push({ file: name, rule: 'unpublished-feature-text' });
}
const packaged = JSON.parse(extractFile(archive, 'package.json').toString());
if (packaged.version !== metadata.version || packaged.build?.productName && packaged.build.productName !== 'NeoNBS') issues.push({ file: 'package.json', rule: 'release-metadata-mismatch' });
for (const file of ['LICENSE.electron.txt', 'LICENSES.chromium.html', 'NeoNBS.exe']) if (!fs.existsSync(path.join(root, 'win-unpacked', file))) issues.push({ file, rule: 'missing-runtime-file' });
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third_party/flp2nbs/LICENSE', 'third_party/flp2nbs/NOTICE.txt']) if (!names.includes(file)) issues.push({ file, rule: 'missing-license' });
if (issues.length) { console.error(JSON.stringify({ status: 'failed', issues }, null, 2)); process.exit(1); }
const assets = ['setup', 'portable'].map(kind => `NeoNBS-${metadata.version}-x64-${kind}.exe`);
const records = assets.map(name => { const bytes = fs.readFileSync(path.join(root, name)); return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; });
fs.writeFileSync(path.join(root, 'SHA256SUMS.txt'), records.map(record => `${record.sha256}  ${record.name}`).join('\n') + '\n');
fs.writeFileSync(path.join(root, 'release-audit.json'), JSON.stringify({ version: metadata.version, status: 'passed', archiveEntries: names.length, assets: records }, null, 2));
console.log(JSON.stringify({ version: metadata.version, status: 'passed', archiveEntries: names.length, assets: records }, null, 2));
