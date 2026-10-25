import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { release as osRelease } from 'node:os';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import { _electron as electron } from 'playwright';
import { digest, verifiedArtifact } from './research-utils.mjs';

// Resource/IPC integration only: no renderer interaction, playback, or world acceptance.
// node scripts/smoke-legacy-resources.mjs --prepare-only
// node scripts/smoke-legacy-resources.mjs --packaged "release/0.1.9/win-unpacked/NeoNBS.exe"
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = process.argv.slice(2);
let packaged, prepareOnly = false;
for (let i = 0; i < options.length; i++) {
  if (options[i] === '--prepare-only') prepareOnly = true;
  else if (options[i] === '--packaged') {
    assert(options[i + 1] && !options[i + 1].startsWith('--'), '--packaged requires an unpacked executable path');
    packaged = path.resolve(options[++i]);
  } else throw new Error(`Unknown option: ${options[i]}`);
}
if (packaged) {
  assert(!/(?:portable|setup)\.exe$/i.test(packaged), 'Use the unpacked executable, not a portable/setup launcher');
  assert((await stat(packaged)).isFile(), 'Packaged executable does not exist');
  assert((await stat(path.join(path.dirname(packaged), 'resources', 'app.asar'))).isFile(), 'Expected an unpacked Electron application beside resources/app.asar');
}
const local = path.join(workspace, '.local', 'legacy-resource-desktop');
await mkdir(local, { recursive: true });
const runRoot = await mkdtemp(path.join(local, 'run-'));
const reportPath = path.join(runRoot, 'report.json');
const report = {
  schema: 1, startedAt: new Date().toISOString(), packaged: !!packaged, executable: packaged,
  scope: 'Actual desktop preload IPC and Electron main-process Minecraft resource loading. No codec, playback, mixer, world or full-game asset acceptance.',
  scriptSha256: digest(await readFile(fileURLToPath(import.meta.url)), 'sha256'),
  fixtures: [], scenarios: [], rendererErrors: [], mainStderr: [], status: 'preparing',
};
const saveReport = async () => writeFile(reportPath, JSON.stringify(report, null, 2));
let application;
try {
  const catalog = JSON.parse(await readFile(path.join(workspace, 'src/data/java-releases.json'))).versions;
  const fixture = JSON.parse(await readFile(path.join(workspace, 'tests/fixtures/legacy-sound-assets.json')));
  // Only platform artifact selection is shared with production. Expected events,
  // paths and byte hashes below are independent of the production sound loader.
  const helper = await build({ stdin: { contents: "export { libraryAllowed, nativeArtifacts } from './src/core/releases.ts';", resolveDir: workspace, sourcefile: 'legacy-resource-fixture.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
  const { libraryAllowed, nativeArtifacts } = await import(`data:text/javascript;base64,${Buffer.from(helper.outputFiles[0].contents).toString('base64')}`);
  const expectedEvents = { harp: 'harp', bass: 'bassattack', basedrum: 'bd', snare: 'snare', hat: 'hat', pling: 'pling' };
  const platform = process.platform, arch = process.arch;
  const cacheCandidates = relative => [path.join(workspace, '.research', relative)];

  async function materialize(artifact, destination, candidates = []) {
    assert.match(artifact.sha1, /^[a-f0-9]{40}$/);
    for (const candidate of [destination, ...candidates]) {
      const bytes = await readFile(candidate).catch(() => undefined);
      if (bytes && digest(bytes) === artifact.sha1 && (!artifact.size || bytes.length === artifact.size)) {
        if (candidate !== destination) { await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, bytes); }
        return destination;
      }
    }
    return verifiedArtifact(artifact, destination);
  }

  async function prepare(version, supported) {
    const release = catalog.find(item => item.id === version);
    assert(release, `Missing original release ${version}`);
    const root = path.join(local, 'fixtures', version), versionRoot = path.join(root, 'versions', version);
    const metadataSha1 = new URL(release.metadataUrl).pathname.match(/\/packages\/([a-f0-9]{40})\//)?.[1];
    assert(metadataSha1, 'Official metadata URL must pin a package checksum');
    const metadataFile = path.join(versionRoot, `${version}.json`);
    await materialize({ url: release.metadataUrl, sha1: metadataSha1 }, metadataFile, cacheCandidates(`metadata/${version}.json`));
    const metadata = JSON.parse(await readFile(metadataFile));
    assert.equal(metadata.id, version); assert.equal(metadata.type, 'release');
    assert.equal(metadata.downloads.client.sha1, release.clientSha1);
    assert.equal(metadata.assetIndex.sha1, release.assetIndexSha1);
    await materialize(metadata.downloads.client, path.join(versionRoot, `${version}.jar`), cacheCandidates(`clients/${version}.jar`));
    const indexFile = path.join(root, 'assets', 'indexes', `${metadata.assetIndex.id}.json`);
    await materialize(metadata.assetIndex, indexFile, [
      ...cacheCandidates(`sound-indexes/${metadata.assetIndex.sha1}.json`),
      path.join(workspace, '.local/legacy-resource-layout/assets/indexes', `${metadata.assetIndex.id}.json`),
    ]);
    const index = JSON.parse(await readFile(indexFile));
    const record = { version, root, supported, metadataUrl: release.metadataUrl, metadataSha1, clientSha1: release.clientSha1, assetIndex: metadata.assetIndex, objects: [], libraries: [], nativeBinaries: [] };
    if (supported) {
      assert.equal(metadata.assetIndex.sha1, fixture.indexes.find(item => item.id === version).sha1);
      const objectNames = ['sounds.json', ...Object.values(expectedEvents).map(name => `sounds/note/${name}.ogg`)];
      for (const name of objectNames) {
        const object = index.objects[name]; assert.deepEqual(object, fixture.objects[name]);
        const relative = `assets/objects/${object.hash.slice(0, 2)}/${object.hash}`;
        const url = `https://resources.download.minecraft.net/${object.hash.slice(0, 2)}/${object.hash}`;
        await materialize({ url, sha1: object.hash, size: object.size }, path.join(root, relative), [
          path.join(workspace, '.local/legacy-resource-layout', relative),
          ...cacheCandidates(`sound-indexes/${object.hash}.sounds.json`),
        ]);
        record.objects.push({ path: name, sha1: object.hash, size: object.size, url });
      }
      assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(await readFile(path.join(root, 'assets/objects', fixture.objects['sounds.json'].hash.slice(0, 2), fixture.objects['sounds.json'].hash)))).filter(([key]) => key.startsWith('note.'))), fixture.definitions);
      // The index also contains note.bass, but the canonical bass event is bassattack.
      assert.deepEqual(index.objects['sounds/note/bass.ogg'], fixture.objects['sounds/note/bass.ogg']);
      const artifacts = release.audioLibraries.filter(item => libraryAllowed(item, platform, arch, osRelease())).flatMap(item => item.downloads?.artifact ? [{ ...item.downloads.artifact, name: item.name }] : []);
      const natives = nativeArtifacts(release, 'openal', platform, arch, osRelease());
      assert(natives.length, `${version}: expected an official OpenAL native archive for ${platform}/${arch}`);
      for (const artifact of [...new Map([...artifacts, ...natives].map(item => [item.path, item])).values()]) {
        assert(!artifact.path.includes('..') && !path.isAbsolute(artifact.path), 'Library artifact must remain inside the fixture');
        const filename = path.join(root, 'libraries', ...artifact.path.split('/'));
        await materialize(artifact, filename, cacheCandidates(`libraries/${artifact.path}`));
        record.libraries.push({ name: artifact.name, path: artifact.path, sha1: artifact.sha1, size: artifact.size, url: artifact.url });
        if (natives.some(item => item.path === artifact.path)) {
          const files = unzipSync(await readFile(filename), { filter: entry => /(?:^|\/)(?:OpenAL(?:32|64)?\.dll|libopenal(?:32|64)?\.(?:dylib|so))$/i.test(entry.name) && !/(?:x86|arm32)\//i.test(entry.name) });
          record.nativeBinaries.push(...Object.entries(files).map(([name, bytes]) => ({ name, sha256: digest(bytes, 'sha256'), size: bytes.length, archiveSha1: artifact.sha1 })));
        }
      }
      assert(record.nativeBinaries.length, `${version}: official native archive must contain OpenAL`);
    } else {
      // A genuine unreviewed legacy index, rather than a fabricated/tampered input.
      assert.equal(metadata.assetIndex.id, 'legacy');
      assert(!index.objects['minecraft/sounds.json']);
    }
    await writeFile(path.join(root, 'fixture.json'), JSON.stringify(record, null, 2));
    report.fixtures.push(record); await saveReport();
    console.log(`${version}: verified original client/index${supported ? ', seven resource objects and official audio libraries' : '; unsupported-layout rejection fixture'}`);
    return record;
  }

  const fixtures = [];
  for (const version of ['1.7.3', '1.7.4']) fixtures.push(await prepare(version, true));
  fixtures.push(await prepare('1.7.2', false));
  if (prepareOnly) {
    report.status = 'prepared'; report.finishedAt = new Date().toISOString(); await saveReport();
    console.log(JSON.stringify({ status: report.status, fixtureVersions: fixtures.map(item => item.version), supportedResourceObjects: fixtures.filter(item => item.supported).reduce((sum, item) => sum + item.objects.length, 0), report: reportPath }));
  } else {
    const profile = path.join(runRoot, 'profile');
    const env = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
    application = await electron.launch({ ...(packaged ? { executablePath: packaged } : {}), args: [...(packaged ? [] : [workspace]), '--mute-audio', `--user-data-dir=${profile}`], env, timeout: 60000 });
    application.process().stderr?.on('data', bytes => report.mainStderr.push(bytes.toString().slice(0, 16000)));
    const page = await application.firstWindow();
    page.on('pageerror', error => report.rendererErrors.push(error.message));
    await page.waitForFunction(() => typeof window.desktop?.loadMinecraft === 'function', null, { timeout: 30000 });
    const identity = await application.evaluate(({ app }) => ({ userData: app.getPath('userData'), isPackaged: app.isPackaged, version: app.getVersion(), appPath: app.getAppPath(), pid: process.pid }));
    assert.equal(path.resolve(identity.userData), profile); assert.equal(identity.isPackaged, !!packaged);
    report.application = identity;
    for (const item of fixtures) {
      const request = { root: item.root, index: `${item.assetIndex.id}.json`, version: item.version };
      const unauthorized = await page.evaluate(async ({ root, index, version }) => {
        try { await window.desktop.loadMinecraft(root, index, version); return { loaded: true }; }
        catch (error) { return { loaded: false, error: String(error) }; }
      }, request);
      assert.equal(unauthorized.loaded, false); assert.match(unauthorized.error, /请选择已发现的 Minecraft 资源目录/);
      report.scenarios.push({ version: item.version, scenario: 'unselected-root-rejected', exact: true, error: unauthorized.error });
      // Mock only the OS directory chooser. Authorization and all filesystem/
      // checksum/resource work still run through the actual packaged main IPC.
      await application.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, item.root);
      const selected = await page.evaluate(() => window.desktop.selectMinecraftRoot());
      assert.equal(path.resolve(selected.root), item.root);
      assert(selected.versions.includes(item.version)); assert(selected.indexes.includes(request.index));
      if (!item.supported) {
        const rejected = await page.evaluate(async ({ root, index, version }) => {
          try { await window.desktop.loadMinecraft(root, index, version); return { loaded: true }; }
          catch (error) { return { loaded: false, error: String(error) }; }
        }, request);
        assert.equal(rejected.loaded, false); assert.match(rejected.error, /声音资源索引布局尚未核对/);
        assert.match(rejected.error, /不会凭根目录 sounds\.json 或采样文件名猜测路径/);
        report.scenarios.push({ version: item.version, scenario: 'unreviewed-layout-rejected', exact: true, error: rejected.error });
      } else {
        const loaded = await page.evaluate(async ({ root, index, version }) => {
          const library = await window.desktop.loadMinecraft(root, index, version);
          return { ...library, samples: Object.fromEntries(Object.entries(library.samples).map(([id, sample]) => [id, { ...sample, bytes: Array.from(sample.bytes) }])) };
        }, request);
        assert.equal(path.resolve(loaded.root), item.root); assert.equal(loaded.version, item.version); assert.equal(loaded.instanceVersion, item.version);
        assert.equal(loaded.profileId, `java-${item.version}`); assert.equal(loaded.clientSha1, item.clientSha1);
        assert.equal(loaded.assetIndex, request.index); assert.equal(loaded.resourceIndexSha1, item.assetIndex.sha1);
        assert.equal(loaded.decoderKind, 'legacy-jorbis'); assert.deepEqual(loaded.warnings, []);
        assert(loaded.javaDecoder, 'Official Java dependencies and an installed runtime must be available'); assert.equal(loaded.javaDecoder.kind, 'legacy-jorbis');
        assert.equal(loaded.javaDecoder.classpath.length, 3);
        const helperPath = path.resolve(loaded.javaDecoder.classpath[0]);
        assert((await stat(path.join(helperPath, 'studio/nbsx/audio/NbsxVorbisDecoder.class'))).isFile(), 'Actual desktop helper class must exist');
        for (const filename of loaded.javaDecoder.classpath.slice(1)) {
          const relative = path.relative(path.join(item.root, 'libraries'), filename).replaceAll('\\', '/');
          const artifact = item.libraries.find(entry => entry.path === relative); assert(artifact, 'Java decoder must use an official fixture dependency');
          assert.equal(digest(await readFile(filename)), artifact.sha1);
        }
        assert(loaded.nativeLibrary, 'Official OpenAL archive must be extracted by the real main process');
        const nativeRelative = path.relative(profile, loaded.nativeLibrary);
        assert(nativeRelative && !nativeRelative.startsWith('..') && !path.isAbsolute(nativeRelative), 'OpenAL cache must remain in this isolated user-data directory');
        const nativeSha256 = digest(await readFile(loaded.nativeLibrary), 'sha256');
        assert(item.nativeBinaries.some(entry => entry.sha256 === nativeSha256 && path.basename(entry.name) === path.basename(loaded.nativeLibrary)), 'Extracted native bytes must match the official archive');
        assert.deepEqual(Object.keys(loaded.samples).sort(), Object.keys(expectedEvents).sort());
        assert.deepEqual(Object.keys(loaded.soundEvents).sort(), Object.keys(expectedEvents).sort());
        const samples = {};
        for (const [id, event] of Object.entries(expectedEvents)) {
          const name = `sounds/note/${event}.ogg`, sample = loaded.samples[id], expected = fixture.objects[name];
          assert.equal(sample.name, name); assert.equal(sample.sha1, expected.hash);
          assert.equal(sample.bytes.length, expected.size); assert.equal(digest(Uint8Array.from(sample.bytes)), expected.hash);
          assert.deepEqual(loaded.soundEvents[id], { event: `note.${event}`, path: `minecraft/${name}`, volume: 1, pitch: 1, attenuationDistance: 16 });
          samples[id] = { event: loaded.soundEvents[id].event, path: sample.name, sha1: sample.sha1, actualBytesSha1: digest(Uint8Array.from(sample.bytes)), size: sample.bytes.length };
        }
        assert.notEqual(samples.bass.actualBytesSha1, fixture.objects['sounds/note/bass.ogg'].hash);
        report.scenarios.push({ version: item.version, scenario: 'selected-root-real-main-load', exact: true, clientSha1: loaded.clientSha1, resourceIndexSha1: loaded.resourceIndexSha1, decoderKind: loaded.decoderKind, javaDecoder: loaded.javaDecoder, nativeLibrary: loaded.nativeLibrary, nativeSha256, samples });
      }
      await saveReport(); console.log(`${item.version}: actual desktop IPC ${item.supported ? 'loaded six canonical samples with exact original bytes' : 'rejected the unreviewed layout explicitly'}`);
    }
    assert.deepEqual(report.rendererErrors, []);
    report.status = 'passed'; report.scenarioCount = report.scenarios.length;
    report.sampleByteChecks = report.scenarios.reduce((sum, item) => sum + Object.keys(item.samples ?? {}).length, 0);
    report.finishedAt = new Date().toISOString(); await saveReport();
    console.log(JSON.stringify({ status: report.status, packaged: !!packaged, applicationVersion: identity.version, scenarios: report.scenarioCount, sampleByteChecks: report.sampleByteChecks, rendererErrors: report.rendererErrors, report: reportPath }));
  }
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error); report.finishedAt = new Date().toISOString();
  await saveReport(); console.error(`Legacy resource integration failed; report: ${reportPath}`); throw error;
} finally {
  if (application) {
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
    await application.close().catch(() => {});
  }
}
