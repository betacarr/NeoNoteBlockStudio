import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const archive = path.resolve('.local/electron-v45.0.0-win32-x64.zip');
const name = path.basename(archive);
const expected = JSON.parse(await readFile('node_modules/electron/checksums.json', 'utf8'))[name];
const bytes = await readFile(archive), actual = createHash('sha256').update(bytes).digest('hex');
if (!expected || actual !== expected) throw new Error('Electron 官方校验值不匹配，停止安装。');
const { extract } = require('@electron-internal/extract-zip');
await extract(archive, { dir: path.resolve('node_modules/electron/dist') });
await writeFile('node_modules/electron/path.txt', 'electron.exe');
console.log(JSON.stringify({ verified: true, sha256: actual, installed: path.resolve('node_modules/electron/dist/electron.exe') }));
