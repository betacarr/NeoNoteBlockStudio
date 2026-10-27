import { readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export async function installMacNative(arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported macOS architecture.');
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const name = `@koromix/koffi-darwin-${arch}`;
  const artifact = lock.packages[`node_modules/${name}`];
  if (!artifact || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(artifact.version) || !artifact.integrity?.startsWith('sha512-') || new URL(artifact.resolved).origin !== 'https://registry.npmjs.org') throw new Error('Missing locked native dependency.');
  const destination = path.resolve('.local/native', `koffi-darwin-${arch}-${artifact.version}`);
  if (path.dirname(destination) !== path.resolve('.local/native')) throw new Error('Native extraction must target its owned cache.');
  const binary = path.join(destination, `darwin_${arch}/koffi.node`);
  const archive = path.resolve('.local', `koffi-darwin-${arch}-${artifact.version}.tgz`);
  const valid = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}` === artifact.integrity;
  let bytes = await readFile(archive).catch(() => undefined);
  if (!bytes || !valid(bytes)) {
    const response = await fetch(artifact.resolved);
    if (!response.ok) throw new Error(`Native dependency download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error('Native dependency integrity mismatch.');
    await mkdir(path.dirname(archive), { recursive: true }); await writeFile(archive, bytes);
  }
  // The tarball is pinned by the committed lockfile, including its integrity.
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  if (names.some(name => !name.startsWith('package/') || name.split('/').includes('..'))) throw new Error('Unsafe native dependency archive.');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', destination]);
  await access(binary);
  return destination;
}
