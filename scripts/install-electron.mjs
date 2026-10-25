import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url), electronRoot = path.resolve('node_modules/electron');
const version = JSON.parse(await readFile(path.join(electronRoot, 'package.json'), 'utf8')).version;
const executable = process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron';
try {
  const installed = (await readFile(path.join(electronRoot, 'dist/version'), 'utf8')).trim();
  const entry = (await readFile(path.join(electronRoot, 'path.txt'), 'utf8')).trim();
  if (installed.replace(/^v/, '') === version && entry === executable) { console.log(`Electron ${version} already installed.`); process.exit(0); }
} catch { /* install verified official binary */ }
await mkdir('.local', { recursive: true });
const name = `electron-v${version}-${process.platform}-${process.arch}.zip`, archive = path.resolve('.local', name);
const expected = JSON.parse(await readFile(path.join(electronRoot, 'checksums.json'), 'utf8'))[name];
if (!expected) throw new Error(`No official checksum for ${name}`);
const valid = async () => { try { return createHash('sha256').update(await readFile(archive)).digest('hex') === expected; } catch { return false; } };
if (!await valid()) {
  const url = `https://github.com/electron/electron/releases/download/v${version}/${name}`;
  const command = process.platform === 'win32' ? 'powershell.exe' : 'curl';
  const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-File', path.resolve('scripts/download-electron.ps1'), '-ArtifactUrl', url, '-Destination', archive] : ['--fail', '--location', '--max-time', '300', '--output', archive, url];
  console.log(`Downloading official Electron ${version} for ${process.platform}/${process.arch}…`);
  await new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: 'inherit', windowsHide: true }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Electron download exited with ${code}`))); });
}
if (!await valid()) throw new Error('Official Electron checksum mismatch; extraction canceled.');
const { extract } = require('@electron-internal/extract-zip');
await extract(archive, { dir: path.join(electronRoot, 'dist') });
await writeFile(path.join(electronRoot, 'path.txt'), executable);
console.log(`Electron ${version} installed and SHA-256 verified.`);
