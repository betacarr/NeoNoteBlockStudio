import { build } from 'electron-builder';
import path from 'node:path';
import { installElectron } from './install-electron.mjs';
import { installMacNative } from './install-mac-native.mjs';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

if (process.platform !== 'darwin') throw new Error('macOS packaging requires macOS (DMG and code signing tools).');
const architectures = process.argv.slice(2);
if (!architectures.length) architectures.push('arm64', 'x64');
if (architectures.some(arch => !['arm64', 'x64'].includes(arch))) throw new Error('Usage: node scripts/package-mac.mjs [arm64] [x64]');
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
async function run(script, args = []) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(script)} exited with ${code}`)));
  });
}
for (const arch of new Set(architectures)) {
  // Never reuse the host's arm64 Electron for an Intel-labelled package.
  const destination = await installElectron({ platform: 'darwin', arch, destination: path.resolve('.local', `electron-darwin-${arch}`) });
  const native = await installMacNative(arch);
  await build({ mac: [], [arch]: true, publish: 'never', config: { electronDist: destination, files: [...metadata.build.files, '!node_modules/@koromix/**/*'], extraResources: [
    { from: native, to: 'koffi', filter: ['**/*'] },
    { from: path.join(destination, 'LICENSE'), to: 'LICENSE.electron.txt' },
    { from: path.join(destination, 'LICENSES.chromium.html'), to: 'LICENSES.chromium.html' },
  ] } });
}
await run('scripts/check-release.mjs', ['--mac', ...architectures]);
