import { build } from 'esbuild';
import { mkdir, readdir, unlink, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import './build-app-icon.mjs';

await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/audio-worker.ts'],
  outdir: 'dist-electron', outExtension: { '.js': '.cjs' },
  platform: 'node', target: 'node22', format: 'cjs', bundle: true,
  external: ['electron', 'koffi'], sourcemap: false,
});
const javaOutput = 'dist-electron/java';
await copyFile('scripts/audio-assist-worker.py', 'dist-electron/audio-assist-worker.py');
await copyFile('scripts/audio_tempo.py', 'dist-electron/audio_tempo.py');
await copyFile('scripts/audio_neural_tempo.py', 'dist-electron/audio_neural_tempo.py');
await copyFile('scripts/smart-tempo-model.json', 'dist-electron/smart-tempo-model.json');
await copyFile('scripts/audio_mega.py', 'dist-electron/audio_mega.py');
await mkdir('dist-electron/mega_roformer', { recursive: true });
for (const filename of ['__init__.py','bs_roformer.py','attend.py','LICENSE','NOTICE.md']) await copyFile(path.join('third_party/mega_roformer',filename), path.join('dist-electron/mega_roformer',filename));
await mkdir(javaOutput, { recursive: true });
// Remove only this adapter's obsolete default-package outputs from older builds.
for (const entry of await readdir(javaOutput, { withFileTypes: true })) {
  if (entry.isFile() && /^NbsxVorbisDecoder(?:\$[\w$]+)?\.class$/.test(entry.name)) await unlink(path.join(javaOutput, entry.name));
}
const compiled = spawnSync('javac', ['--release', '8', '-encoding', 'UTF-8', '-d', javaOutput, 'electron/java/NbsxVorbisDecoder.java'], { windowsHide: true, encoding: 'utf8' });
if (compiled.status !== 0) throw new Error(`Java codec adapter compilation requires JDK 9+: ${compiled.stderr || compiled.error}`);
if (!(await stat(path.join(javaOutput, 'studio/nbsx/audio/NbsxVorbisDecoder.class'))).isFile()) throw new Error('Packaged Java codec adapter was not generated.');
