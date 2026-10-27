import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

if (process.platform !== 'darwin') throw new Error('Run macOS release verification on a Mac.');
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const architectures = process.argv.slice(2);
if (!architectures.length) architectures.push('arm64', 'x64');
if (architectures.some(arch => !['arm64', 'x64'].includes(arch))) throw new Error('Usage: verify-mac-release.mjs [arm64] [x64]');
const root = path.resolve('release', metadata.version), checks = [];
async function run(script, args) {
  console.log(`Checking ${path.basename(script)} ${args.join(' ')}`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(script)} failed (${code})`)));
  });
}
for (const arch of new Set(architectures)) {
  const executable = path.join(root, arch === 'arm64' ? 'mac-arm64' : 'mac', 'NeoNBS.app/Contents/MacOS/NeoNBS');
  if (!(await stat(executable)).isFile()) throw new Error(`Build the ${arch} macOS application first.`);
  for (const script of ['smoke-macos.mjs', 'smoke-preview-desktop.mjs', 'smoke-diagnostics-desktop.mjs', 'smoke-file-lifecycle.mjs', 'smoke-midi-desktop.mjs', 'smoke-nbs-desktop.mjs']) {
    await run(`scripts/${script}`, ['--packaged', executable]);
    checks.push({ arch, check: script, status: 'passed' });
  }
}
await run('scripts/check-release.mjs', ['--mac', ...architectures]);
const audit = JSON.parse(await readFile(path.join(root, 'release-audit.json'), 'utf8'));
const assets = [];
for (const arch of new Set(architectures)) for (const ext of ['dmg', 'zip']) {
  const name = `NeoNBS-${metadata.version}-mac-${arch}.${ext}`, bytes = await readFile(path.join(root, name));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (!audit.assets.some(item => item.name === name && item.bytes === bytes.length && item.sha256 === sha256)) throw new Error('Release artifact no longer matches its audit.');
  assets.push({ name, bytes: bytes.length, sha256 });
}
// This summary contains fixed check names and artifact hashes, without the
// private paths, screenshots or project data in the local detailed reports.
const report = { schema: 1, status: 'passed', version: metadata.version,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  host: { platform: 'darwin', arch: process.arch }, checks, assets,
  limitations: ['Software playback signals do not verify physical audio or MIDI hardware.', 'An x64 application run through Rosetta is not physical Intel Mac validation.', 'Ad-hoc signature validation is not Apple Developer ID signing or notarization.'] };
await writeFile(path.join(root, 'macos-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
