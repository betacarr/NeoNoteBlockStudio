import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';

// Real-library component check. Playback devices are opened without playing
// any source; the audible signal exists only in the offline loopback output.
const childAt = process.argv.indexOf('--child');
if (childAt >= 0) {
  const [root, version, mode] = process.argv.slice(childAt + 1);
  const fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`, 'utf8'));
  const { render, createProject, hrtfContextForProject, outputLimiterForProject } = await import(pathToFileURL(path.join(root, 'renderer.mjs')).href);
  const project = createProject(); project.audio.profileId = `java-${version}`;
  const tone = Float32Array.from({ length: 24000 }, (_, i) => .18 * Math.sin(i * Math.PI * 880 / 48000));
  const base = { nativeLibrary: path.join(fixture.nativeDir, 'OpenAL.dll'), samples: [{ id: 'tone', channels: 1, sampleRate: 48000, data: [tone] }],
    sampleRate: 48000, duration: 1, directional: false, outputLimiter: outputLimiterForProject(project),
    events: [{ time: 0, instrument: 'tone', pitch: 1, gain: 1, x: 3, y: 1, z: -2, maxDistance: 48 }] };
  const policy = hrtfContextForProject(project), game = render({ ...base, hrtf: policy });
  const off = render(base), on = render({ ...base, directional: true, hrtf: 'first-profile' });
  assert.equal(off.directional, false); assert.equal(on.directional, true); assert(on.hrtfProfile);
  const expected = policy === 'device-default' && mode === 'headphones';
  assert.equal(game.directional, expected, 'Production policy must preserve the original device default or explicit off request');
  if (policy === 'device-default') {
    assert.equal(game.hrtfDefaultDevice.directional, expected); assert(game.hrtfDefaultDevice.name);
    assert.equal(game.hrtfProfile, expected ? game.hrtfDefaultDevice.profile : undefined);
  }
  assert.notDeepEqual(off.wav, on.wav, 'The actual spatial PCM must distinguish off/on');
  assert.deepEqual(game.wav, expected ? on.wav : off.wav, 'The production rule must render the matching actual HRTF state');
  project.audio.directional = true;
  if (version !== '1.13') assert.equal(hrtfContextForProject(project), { '1.19':'enable-only-reset', '1.19.2':'explicit-reset', '1.21.5':'context-attributes' }[version]);
  const result = { version, mode, status: 'passed', policy, requestedGameOption: false, appliedHrtf: game.directional,
    observedDefaultDevice: game.hrtfDefaultDevice, appliedHrtfProfile: game.hrtfProfile, appliedHrtfStatus: game.hrtfStatus,
    referenceOnHrtfProfile: on.hrtfProfile, referenceOnHrtfStatus: on.hrtfStatus, referenceOnRequestedProfile: on.hrtfRequestedProfile, backend: game.backend,
    gamePcmSha256: digest(Buffer.from(game.wav).subarray(44), 'sha256'), offPcmSha256: digest(Buffer.from(off.wav).subarray(44), 'sha256'), onPcmSha256: digest(Buffer.from(on.wav).subarray(44), 'sha256') };
  await writeFile(path.join(root, `${version}-${mode}.json`), JSON.stringify(result, null, 2));
} else {
  const root = path.resolve('.local/hrtf-context', `run-${Date.now()}`); await mkdir(root, { recursive: true });
  await build({ stdin: { contents: "export {render} from './electron/audio-worker.ts'; export {hrtfContextForProject,outputLimiterForProject} from './src/audio/context.ts'; export {createProject} from './src/core/project.ts';", resolveDir: process.cwd(), sourcefile: 'hrtf-context.ts' }, outfile: path.join(root, 'renderer.mjs'), bundle: true, platform: 'node', format: 'esm', external: ['koffi'] });
  const observations = [], natives = [];
  for (const version of ['1.13', '1.19', '1.19.2', '1.21.5']) {
    const fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`, 'utf8'));
    const metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`, 'utf8'));
    assert.equal(fixture.clientSha1, metadata.downloads.client.sha1);
    const nativeSha256 = digest(await readFile(path.join(fixture.nativeDir, 'OpenAL.dll')), 'sha256'); let artifactEvidence;
    const artifacts = metadata.libraries.flatMap(item => [item.downloads?.artifact, ...Object.values(item.downloads?.classifiers ?? {})]).filter(item => item && /lwjgl-openal.*natives-windows/.test(item.path));
    for (const artifact of artifacts) {
      const bytes = await readFile(path.join(fixture.root, 'libraries', artifact.path)); assert.equal(digest(bytes), artifact.sha1);
      if (Object.values(unzipSync(bytes, { filter: e => path.basename(e.name).toLowerCase() === 'openal.dll' })).some(bytes => digest(bytes, 'sha256') === nativeSha256)) artifactEvidence = { path: artifact.path, sha1: artifact.sha1 };
    }
    assert(artifactEvidence, 'Native library must match the original official archive');
    natives.push({ version, clientSha1: fixture.clientSha1, nativeSha256, artifact: artifactEvidence });
    for (const mode of ['speakers', 'headphones']) {
      const config = path.join(root, `${version}-${mode}.ini`); await writeFile(config, `[general]\nfrequency = 48000\nhrtf = auto\nstereo-mode = ${mode}\n`);
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', root, version, mode], { env: { ...process.env, ALSOFT_CONF: config }, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 1000000 });
      assert.equal(child.status, 0, `${version}/${mode}: ${child.stderr || child.stdout}`);
      observations.push(JSON.parse(await readFile(path.join(root, `${version}-${mode}.json`), 'utf8')));
    }
  }
  const sources = {};
  for (const file of ['scripts/verify-hrtf-context.mjs', 'electron/audio-worker.ts', 'src/audio/context.ts', 'src/audio/engine.ts', 'src/core/reference.ts', 'src/core/transport.ts', 'src/core/recording.ts', 'src/audio/profiles.ts', 'src/data/audio-facts.json', 'src/data/early-audio-facts.json', 'src/data/legacy-audio-facts.json']) sources[file] = digest(await readFile(file), 'sha256');
  const report = { schema: 1, status: 'passed', scope: 'Windows default playback device, original libraries, isolated auto-HRTF speaker/headphone configurations, 48 kHz mono synthetic source in stereo offline output. No source is played on the playback device. This is a component check, not additional integrated-world coverage; non-default game device selection remains outside scope.', natives, observations, sources };
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  if (process.argv.includes('--write-evidence')) await writeFile('docs/evidence/hrtf-context.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, cases: observations.length, report: path.join(root, 'report.json') }));
}
