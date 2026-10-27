import { readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url), electronRoot = path.resolve('node_modules/electron');
export async function installElectron({ platform = process.platform, arch = process.arch, destination = path.join(electronRoot, 'dist') } = {}) {
  if (!['arm64', 'x64', 'ia32'].includes(arch) || !['darwin', 'win32', 'linux'].includes(platform)) throw new Error('Unsupported Electron target.');
  const version = JSON.parse(await readFile(path.join(electronRoot, 'package.json'), 'utf8')).version;
  const executable = platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron';
  const identity = `${version}-${platform}-${arch}`;
  try {
    const installed = (await readFile(path.join(destination, '.verified-target'), 'utf8')).trim();
    await access(path.join(destination, executable));
    if (installed === identity) {
      if (path.resolve(destination) === path.join(electronRoot, 'dist')) await writeFile(path.join(electronRoot, 'path.txt'), executable);
      console.log(`Electron ${identity} already installed.`); return destination;
    }
  } catch { /* install verified official binary */ }
  await mkdir('.local', { recursive: true });
  const name = `electron-v${version}-${platform}-${arch}.zip`, archive = path.resolve('.local', name);
  const expected = JSON.parse(await readFile(path.join(electronRoot, 'checksums.json'), 'utf8'))[name];
  if (!expected) throw new Error(`No official checksum for ${name}`);
  const valid = async () => { try { return createHash('sha256').update(await readFile(archive)).digest('hex') === expected; } catch { return false; } };
  if (!await valid()) {
    const url = `https://github.com/electron/electron/releases/download/v${version}/${name}`;
    const command = process.platform === 'win32' ? 'powershell.exe' : 'curl';
    const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-File', path.resolve('scripts/download-electron.ps1'), '-ArtifactUrl', url, '-Destination', archive] : ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '300', '--output', archive, url];
    console.log(`Downloading official Electron ${version} for ${platform}/${arch}…`);
    await new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: 'inherit', windowsHide: true }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Electron download exited with ${code}`))); });
  }
  if (!await valid()) throw new Error('Official Electron checksum mismatch; extraction canceled.');
  const { extract } = require('@electron-internal/extract-zip');
  await rm(destination, { recursive: true, force: true });
  await extract(archive, { dir: path.resolve(destination) });
  await writeFile(path.join(destination, '.verified-target'), identity);
  if (path.resolve(destination) === path.join(electronRoot, 'dist')) await writeFile(path.join(electronRoot, 'path.txt'), executable);
  console.log(`Electron ${identity} installed and SHA-256 verified.`);
  return destination;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await installElectron();
