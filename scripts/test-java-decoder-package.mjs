import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { release as osRelease } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const script = fileURLToPath(import.meta.url), hash = (b, algorithm = 'sha256') => createHash(algorithm).update(b).digest('hex');
const versions = ['1.0', '1.1', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.13', '1.13.2', '1.21.5'];
const publicFile = 'docs/evidence/java-decoder-package-fix.json';

async function stage(root) {
  const inputs = {}, ref = async file => { const b = await readFile(file); inputs[path.resolve(file)] = hash(b); return b; };
  const beforeManifest = JSON.parse(await ref('.local/decoder-before-package-fix/manifest.json'));
  for (const r of beforeManifest.refs) assert.equal(hash(await ref(r.path)), r.sha256);
  const oldJava = await ref('.local/decoder-before-package-fix/electron_java_NbsxVorbisDecoder.java');
  const currentJava = await ref('electron/java/NbsxVorbisDecoder.java');
  assert.equal(currentJava.toString().replace(/^package studio\.nbsx\.audio;\r?\n\r?\n/, ''), oldJava.toString(), 'Java decoder algorithm must remain byte-for-byte unchanged after the package declaration');
  assert(!existsSync('dist-electron/java/NbsxVorbisDecoder.class'));
  for (const name of ['NbsxVorbisDecoder', 'NbsxVorbisDecoder$Audio', 'NbsxVorbisDecoder$Modern']) {
    const bytes = await ref('dist-electron/java/studio/nbsx/audio/' + name + '.class');
    assert.equal(bytes.readUInt32BE(0), 0xcafebabe); assert.equal(bytes.readUInt16BE(6), 52);
  }
  const production = path.join(root, 'production.cjs');
  const built = await build({ stdin: { contents: "export {decodeJavaVorbis} from './electron/java-decoder.ts'; export {releaseByClientHash,libraryAllowed} from './src/core/releases.ts'; export {audioImplementation,clientEmbeddedLegacyCodec} from './src/audio/implementations.ts'; export {loadNoteBlockSoundAssets,soundAssetLayout} from './src/core/sound-assets.ts';", resolveDir: process.cwd(), sourcefile: 'decoder-package-regression.ts' }, outfile: production, platform: 'node', format: 'cjs', bundle: true, metafile: true });
  await writeFile(root + '/production.metafile.json', JSON.stringify(built.metafile, null, 2) + '\n');
  for (const f of Object.keys(built.metafile.inputs)) if (!f.startsWith('<') && f !== 'decoder-package-regression.ts') await ref(f);
  await ref(production);
  const beforeBundle = path.join(root, 'before.cjs');
  await build({ entryPoints: ['.local/decoder-before-package-fix/electron_java-decoder.ts'], outfile: beforeBundle, platform: 'node', format: 'cjs', bundle: true });
  await ref(beforeBundle);
  const require = createRequire(import.meta.url), api = require(production), before = require(beforeBundle);
  const oldRoot = path.resolve('release/0.1.21-before-decoder-package-fix/win-unpacked/resources/app.asar.unpacked/dist-electron/java');
  for (const name of ['NbsxVorbisDecoder', 'NbsxVorbisDecoder$Audio', 'NbsxVorbisDecoder$Modern']) await ref(path.join(oldRoot, name + '.class'));
  assert.equal(hash(await readFile(path.join(oldRoot, 'NbsxVorbisDecoder.class'))), beforeManifest.refs.find(r => r.original === 'dist-electron/java/NbsxVorbisDecoder.class').sha256);
  const failed = JSON.parse(await ref('.local/world-profile-desktop/run-1.0-RaufuD/report.json'));
  const executable = failed.nativeWorkerTraffic.requests[0].javaDecoder.executable;
  await ref(executable);
  const cp = require('node:child_process'), originalSpawn = cp.spawnSync, processes = [], records = [];
  let label = '';
  cp.spawnSync = (...args) => {
    const startedAt = new Date().toISOString(), result = originalSpawn(...args);
    const process = { label, executable: args[0], args: args[1], pid: result.pid, terminal: result.status !== null || result.signal !== null, code: result.status, signal: result.signal, error: result.error?.message, startedAt, finishedAt: new Date().toISOString() };
    const n = String(processes.length).padStart(2, '0'), prefix = root + '/java-' + n + '-' + label;
    writeFileSync(prefix + '.stdout.log', result.stdout || ''); writeFileSync(prefix + '.stderr.log', result.stderr || '');
    process.stdoutSha256 = hash(Buffer.from(result.stdout || '')); process.stderrSha256 = hash(Buffer.from(result.stderr || ''));
    const output = args[1]?.[5]; if (output && existsSync(output)) { const bytes = readFileSync(output); writeFileSync(prefix + '.nbsj', bytes); process.output = { file: prefix + '.nbsj', sha256: hash(bytes), bytes: bytes.length }; }
    writeFileSync(prefix + '.process.json', JSON.stringify(process, null, 2) + '\n'); processes.push(process); return result;
  };
  try {
    for (const version of versions) {
      const fixtureFile = `.local/game-fixtures/${version}/fixture.json`, fixture = JSON.parse(await ref(fixtureFile));
      const client = path.join(fixture.root, 'versions', version, version + '.jar'), clientBytes = await ref(client), clientSha1 = hash(clientBytes, 'sha1'), release = api.releaseByClientHash(clientSha1);
      assert(release); assert.equal(release.id, version); assert.equal(clientSha1, fixture.clientSha1);
      const indexFile = path.join(fixture.root, 'assets/indexes', fixture.assetIndex.id + '.json'), indexBytes = await ref(indexFile); assert.equal(hash(indexBytes, 'sha1'), fixture.assetIndex.sha1);
      const index = JSON.parse(indexBytes), loaded = await api.loadNoteBlockSoundAssets(index, api.soundAssetLayout(clientSha1, index), async object => { const file = path.join(fixture.root, 'assets/objects', object.hash.slice(0, 2), object.hash), bytes = await ref(file); assert.equal(hash(bytes, 'sha1'), object.hash); return bytes; });
      assert.deepEqual(Object.keys(loaded.samples), Object.keys(fixture.sounds));
      const { decoderKind: kind } = api.audioImplementation(release); assert(['legacy-jorbis', 'jorbis'].includes(kind));
      if (version === '1.21.5') assert.equal(kind, 'jorbis');
      const libraries = release.audioLibraries.filter(l => api.libraryAllowed(l, process.platform, process.arch, osRelease()) && (kind === 'jorbis' ? /^org\.jcraft:jorbis:/.test(l.name) : /^com\.paulscode:(?:codecjorbis|soundsystem):/.test(l.name)));
      const dependencies = [];
      if (kind === 'legacy-jorbis' && api.clientEmbeddedLegacyCodec(release)) dependencies.push(client);
      for (const l of libraries) { const a = l.downloads.artifact, file = path.join(fixture.root, 'libraries', a.path); assert.equal(hash(await ref(file), 'sha1'), a.sha1); dependencies.push(file); }
      const encoded = Object.entries(loaded.samples).map(([id, sample]) => ({ id, bytes: new Uint8Array(sample.bytes) }));
      label = version + '-current';
      const decoded = api.decodeJavaVorbis({ executable, classpath: [path.resolve('dist-electron/java'), ...dependencies], kind }, encoded);
      assert.equal(decoded.length, encoded.length); assert.equal(processes.at(-1).code, 0); assert.equal(processes.at(-1).args[3], 'studio.nbsx.audio.NbsxVorbisDecoder');
      const pcm = decoded.map(d => { assert(d.pcm16.length > 0); assert(d.pcm16.some(n => n !== 0)); return { id: d.id, rate: d.sampleRate, channels: d.channels, samples: d.pcm16.length, sha256: hash(Buffer.from(d.pcm16.buffer, d.pcm16.byteOffset, d.pcm16.byteLength)) }; });
      label = version + '-before'; let oldError = '', previous;
      try { previous = before.decodeJavaVorbis({ executable, classpath: [oldRoot, ...dependencies], kind }, encoded); } catch (e) { oldError = String(e); }
      const oldProcess = processes.at(-1); assert.equal(oldProcess.args[3], 'NbsxVorbisDecoder');
      if (versions.indexOf(version) < 7) { assert.match(oldError, /signer information does not match/); assert.notEqual(oldProcess.code, 0); }
      else { assert.equal(oldError, ''); assert.equal(oldProcess.code, 0); for (let i = 0; i < decoded.length; i++) assert.deepEqual(previous[i].pcm16, decoded[i].pcm16); }
      records.push({ version, kind, clientSha1, clientSha256: hash(clientBytes), samples: pcm, beforeSignerMismatch: !!oldError, unchangedPcmControl: !oldError });
    }
  } finally { cp.spawnSync = originalSpawn; }
  assert(records.some(r => r.kind === 'jorbis' && r.unchangedPcmControl));
  assert(records.some(r => r.kind === 'legacy-jorbis' && r.unchangedPcmControl));
  for (const [file, expected] of Object.entries(inputs)) assert.equal(hash(await readFile(file)), expected, 'Input changed while testing: ' + file);
  await ref('scripts/build-electron.mjs'); await ref('tests/java-decoder.test.ts'); await ref(script);
  const report = { schema: 1, status: 'passed', scope: 'Actual production Java-only Vorbis decoding against unmodified official signed clients and checked external codec artifacts. No OpenAL/device/game/world execution.', nodePid: process.pid, versions: records.length, decodedSamples: records.reduce((n, r) => n + r.samples.length, 0), signedClientRegressions: 7, unchangedExternalCodecPcmControls: records.filter(r => r.unchangedPcmControl).reduce((n, r) => n + r.samples.length, 0), worldScenesAdded: 0, nativeContextsOpened: 0, clientSignaturesOrBytesChanged: false, records, processes, inputs };
  await writeFile(root + '/report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', report: root + '/report.json', decodedSamples: report.decodedSamples, signedClientRegressions: 7, unchangedExternalCodecPcmControls: report.unchangedExternalCodecPcmControls }));
}

async function launch() {
  const root = path.resolve('.local/java-decoder-package-fix', 'run-' + Date.now()); await mkdir(root, { recursive: true });
  const p = { command: process.execPath, args: [script, '--stage', root], startedAt: new Date().toISOString(), terminal: false };
  const child = spawn(process.execPath, p.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); p.pid = child.pid;
  await writeFile(root + '/process.json', JSON.stringify(p, null, 2) + '\n'); let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; process.stdout.write(b); }); child.stderr.on('data', b => { stderr += b; process.stderr.write(b); });
  Object.assign(p, await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); }));
  p.terminal = true; p.finishedAt = new Date().toISOString(); await writeFile(root + '/stdout.log', stdout); await writeFile(root + '/stderr.log', stderr); await writeFile(root + '/process.json', JSON.stringify(p, null, 2) + '\n');
  if (p.code === 0) { const report = JSON.parse(await readFile(root + '/report.json')); await writeFile(publicFile, JSON.stringify({ ...report, execution: { root, process: p, reportSha256: hash(await readFile(root + '/report.json')) } }, null, 2) + '\n'); }
  console.log(JSON.stringify({ root, pid: p.pid, terminal: true, code: p.code, signal: p.signal, publicReport: p.code === 0 ? publicFile : null })); process.exitCode = p.code ?? 1;
}
if (process.argv[2] === '--stage') await stage(process.argv[3]); else await launch();
