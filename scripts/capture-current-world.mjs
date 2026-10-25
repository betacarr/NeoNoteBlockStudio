import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest, verifiedArtifact } from './research-utils.mjs';

// A separate, named-class Java 25 / SDL adapter. It does not modify the older capture harness.
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const version = option('--version') ?? '26.3';
assert.equal(version, '26.3', 'This world adapter is only inspected for Java 26.3');
const volume = (name, fallback) => { const value = Number(option(name) ?? fallback); assert(Number.isFinite(value) && value >= 0 && value <= 1, `Invalid ${name}`); return value; };
const master = volume('--master', 1), records = volume('--records', 1), hrtf = process.argv.includes('--hrtf'), polyphony = process.argv.includes('--polyphony');
const timeoutSeconds = Number(option('--timeout') ?? 300); assert(Number.isInteger(timeoutSeconds) && timeoutSeconds >= 30 && timeoutSeconds <= 1200);
const processors = option('--processors') === undefined ? undefined : Number(option('--processors')); if (processors !== undefined) assert(Number.isInteger(processors) && processors >= 1 && processors <= 64);
const graphicsBackend = option('--graphics-backend') ?? 'OPENGL'; assert(['OPENGL', 'VULKAN'].includes(graphicsBackend));
const runId = String(Date.now()), target = path.resolve('.local/game-world-comparison', version), output = path.join(target, `capture-${runId}`), game = path.join(output, 'game');
await mkdir(game, { recursive: true });
const fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`, 'utf8'));
const manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const manifestBytes = Buffer.from(await fetch(manifestUrl, { signal: AbortSignal.timeout(30000) }).then(response => { assert(response.ok, `Official manifest HTTP ${response.status}`); return response.arrayBuffer(); }));
const official = JSON.parse(manifestBytes).versions.find(item => item.id === version); assert(official && official.type === 'release');
const metadataFile = path.join(output, 'official-metadata.json'); await verifiedArtifact(official, metadataFile);
const metadataBytes = await readFile(metadataFile), metadata = JSON.parse(metadataBytes);
assert.equal(metadata.id, version); assert(!metadata.downloads.client_mappings, 'This adapter expects the officially named client, not guessed mappings');
await writeFile(path.join(output, 'official-version-manifest.json'), manifestBytes);
const client = path.join(fixture.root, 'versions', version, `${version}.jar`), clientBytes = await readFile(client);
assert.equal(digest(clientBytes), metadata.downloads.client.sha1, 'Client no longer matches official release metadata');
assert.equal(clientBytes.length, metadata.downloads.client.size); assert.equal(fixture.clientSha1, metadata.downloads.client.sha1);
const runtime = JSON.parse(await readFile(`.local/runtimes/temurin-${metadata.javaVersion.majorVersion}/runtime.json`, 'utf8')), java = runtime.executable;
const officialArtifacts = metadata.libraries.flatMap(item => [item.downloads?.artifact, ...Object.values(item.downloads?.classifiers ?? {})]).filter(Boolean);
const libraryProvenance = [];
for (const filename of fixture.classpath) {
  if (path.resolve(filename) === path.resolve(client)) continue;
  const artifact = officialArtifacts.find(item => filename.endsWith(item.path.replaceAll('/', path.sep))); assert(artifact, `Classpath entry lacks official provenance: ${filename}`);
  const bytes = await readFile(filename); assert.equal(digest(bytes), artifact.sha1, `Library checksum mismatch: ${artifact.path}`);
  libraryProvenance.push({ path: artifact.path, sha1: artifact.sha1 });
}
const assetIndexBytes = await readFile(path.join(fixture.root, 'assets', 'indexes', `${metadata.assetIndex.id}.json`));
assert.equal(digest(assetIndexBytes), metadata.assetIndex.sha1, 'Asset index no longer matches official metadata');
const assetIndex = JSON.parse(assetIndexBytes);
// The existing fixture intentionally contains audio only. Newer clients also require a few
// external title/font resources. Keep bootstrap downloads in this adapter's own verified cache.
const assets = path.join(target, 'assets'); await mkdir(path.join(assets, 'indexes'), { recursive: true });
await writeFile(path.join(assets, 'indexes', `${metadata.assetIndex.id}.json`), assetIndexBytes);
const bootstrapAssets = Object.entries(assetIndex.objects).filter(([name]) => !name.includes('/sounds/') && (!name.includes('/lang/') || name.endsWith('/en_us.json')));
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < bootstrapAssets.length) {
    const [, object] = bootstrapAssets[cursor++];
    await verifiedArtifact({ url: `https://resources.download.minecraft.net/${object.hash.slice(0, 2)}/${object.hash}`, sha1: object.hash, size: object.size }, path.join(assets, 'objects', object.hash.slice(0, 2), object.hash));
  }
}));
const instruments = ['harp', 'bass', 'basedrum', 'snare', 'hat', 'guitar', 'flute', 'bell', 'chime', 'xylophone', 'iron_xylophone', 'cow_bell', 'didgeridoo', 'bit', 'banjo', 'pling', 'trumpet', 'trumpet_exposed', 'trumpet_weathered', 'trumpet_oxidized'];
const samples = [];
for (const instrument of instruments) {
  const sample = assetIndex.objects[fixture.sounds[instrument].path]; assert(sample, `Missing original ${instrument} asset`);
  assert.equal(digest(await readFile(path.join(fixture.root, 'assets', 'objects', sample.hash.slice(0, 2), sample.hash))), sample.hash);
  await mkdir(path.join(assets, 'objects', sample.hash.slice(0, 2)), { recursive: true });
  await copyFile(path.join(fixture.root, 'assets', 'objects', sample.hash.slice(0, 2), sample.hash), path.join(assets, 'objects', sample.hash.slice(0, 2), sample.hash));
  samples.push({ instrument, path: fixture.sounds[instrument].path, sha1: sample.hash });
}
const nativeProvenance = [];
for (const filename of await readdir(fixture.nativeDir)) {
  const bytes = await readFile(path.join(fixture.nativeDir, filename)), hash = digest(bytes, 'sha256'); let source;
  for (const artifact of officialArtifacts.filter(item => /natives-windows/.test(item.path))) {
    const archive = path.join(fixture.root, 'libraries', artifact.path);
    let jar; try { jar = await readFile(archive); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const entries = unzipSync(jar, { filter: entry => path.basename(entry.name).toLowerCase() === filename.toLowerCase() });
    if (Object.values(entries).some(entry => digest(entry, 'sha256') === hash)) { assert.equal(digest(jar), artifact.sha1); source = { path: artifact.path, sha1: artifact.sha1 }; break; }
  }
  assert(source, `Native DLL lacks an exact official-archive match: ${filename}`); nativeProvenance.push({ filename, sha256: hash, artifact: source });
}
const asmVersion = '9.11.1', asmUrl = `https://repo.maven.apache.org/maven2/org/ow2/asm/asm/${asmVersion}/asm-${asmVersion}.jar`;
const asmSha256 = (await fetch(`${asmUrl}.sha256`, { signal: AbortSignal.timeout(30000) }).then(response => { assert(response.ok); return response.text(); })).trim();
const asm = path.resolve(`.research/tools/asm-${asmVersion}.jar`); await verifiedArtifact({ url: asmUrl, sha256: asmSha256 }, asm, 'sha256');
const config = {
  worldName: `nbsx-audio-verification-${runId}`, output: output.replaceAll('\\', '/'), hrtf: String(hrtf), master: String(master), records: String(records),
  minecraft: 'net.minecraft.client.Minecraft', library: 'com.mojang.blaze3d.audio.Library', channel: 'com.mojang.blaze3d.audio.Channel', noteBlock: 'net.minecraft.world.level.block.NoteBlock', window: 'com.mojang.blaze3d.platform.Window',
  openDevice: '', tick: 'runTick', channelPlay: 'play', noteEvent: 'triggerEvent', sourceId: 'source', loaded: 'isGameLoadFinished', server: 'getSingleplayerServer', player: 'player', stop: 'stop',
  levelSettings: 'net.minecraft.world.level.LevelSettings', difficultySettings: 'net.minecraft.world.level.LevelSettings$DifficultySettings', gameType: 'net.minecraft.world.level.GameType', creative: 'CREATIVE', difficulty: 'net.minecraft.world.Difficulty', peaceful: 'PEACEFUL',
  dataPackConfig: 'net.minecraft.world.level.WorldDataConfiguration', defaultDataPack: 'DEFAULT', worldOptions: 'net.minecraft.world.level.levelgen.WorldOptions', demoOptions: 'DEMO_OPTIONS', worldPresets: 'net.minecraft.world.level.levelgen.presets.WorldPresets', normalDimensions: 'createNormalWorldDimensions', worldFlows: 'createWorldOpenFlows', createFreshLevel: 'createFreshLevel',
  noGravity: 'setNoGravity', moveTo: 'absSnapTo', execute: 'execute', playerList: 'getPlayerList', players: 'getPlayers', connection: 'connection', teleport: 'teleport', overworld: 'overworld',
  blocks: 'net.minecraft.world.level.block.Blocks', noteBlockConstant: 'NOTE_BLOCK', air: 'AIR', dirt: 'DIRT', defaultState: 'defaultBlockState', blockPos: 'net.minecraft.core.BlockPos', noteProperty: 'NOTE', setValue: 'setValue', getValue: 'getValue', setBlock: 'setBlock', blockEvent: 'blockEvent',
  instrumentProperty: 'INSTRUMENT', instrumentType: 'net.minecraft.world.level.block.state.properties.NoteBlockInstrument', instrumentName: 'getSerializedName', setInstrument: 'setInstrument', woolColor: 'white', copperWeathering: 'weathering',
  options: 'options', soundSource: 'net.minecraft.sounds.SoundSource', sourceMaster: 'MASTER', sourceRecords: 'RECORDS', sourceBlocks: 'BLOCKS', optionVolume: 'getSoundSourceVolume', optionFinalVolume: 'getFinalSoundSourceVolume',
};
const bases = ['DIRT', 'OAK_PLANKS', 'STONE', 'SAND', 'GLASS', 'WOOL', 'CLAY', 'GOLD_BLOCK', 'PACKED_ICE', 'BONE_BLOCK', 'IRON_BLOCK', 'SOUL_SAND', 'PUMPKIN', 'EMERALD_BLOCK', 'HAY_BLOCK', 'GLOWSTONE', 'COPPER_BLOCK', 'COPPER_BLOCK', 'COPPER_BLOCK', 'COPPER_BLOCK'];
for (let i = 0; i < instruments.length; i++) { config[`instrument.${i}`] = instruments[i]; config[`base.${i}`] = bases[i]; }
for (let i = 16; i < 20; i++) config[`copperStage.${i}`] = ['unaffected', 'exposed', 'weathered', 'oxidized'][i - 16];
const cases = [[0, 0, 12, 0], [2, 0, 12, 0], [-2, 0, 12, 0], [0, 12, 12, 0], [0, -12, 12, 0], [0, 40, 12, 0], [0, 48, 12, 0], [0, 0, 0, 0], [0, 0, 24, 0]];
for (let i = 1; i < instruments.length; i++) for (const note of [0, 12, 24]) cases.push([0, 0, note, i]);
const grid = (count, mixed) => Array.from({ length: count }, (_, i) => [(i % 8) * 3 - 10, Math.floor(i / 8) * 3 - 10, mixed ? [0, 4, 7, 12, 16, 19, 24][i % 7] : 12, mixed ? i % 20 : 0]);
const scenes = polyphony ? [
  { name: 'harp-triad', notes: [[-3, 0, 0, 0], [0, 0, 12, 0], [3, 0, 24, 0]] },
  { name: 'mixed-six-including-trumpets', notes: Array.from({ length: 6 }, (_, i) => [i * 3 - 7, 0, [0, 7, 12, 16, 19, 24][i], [0, 1, 16, 17, 18, 19][i]]) },
  { name: 'all-twenty-instruments', notes: grid(20, true) },
  { name: 'thirty-two-identical-harps', notes: grid(32, false) },
  { name: 'sixty-four-mixed-notes', notes: grid(64, true) },
] : process.argv.includes('--instrument-midpoints') ? instruments.map((instrument, i) => ({ name: `${instrument}-midpoint`, notes: [[0, 0, 12, i]] }))
  : cases.slice(0, process.argv.includes('--quick') ? 9 : cases.length).map((note, i) => ({ name: `single-${i}`, notes: [note] }));
config.caseLimit = String(scenes.length);
for (let i = 0; i < scenes.length; i++) { config[`scene.${i}`] = scenes[i].notes.map(note => note.join(',')).join(';'); config[`sceneName.${i}`] = scenes[i].name; }
await writeFile(path.join(output, 'cases.json'), JSON.stringify(scenes));
const configFile = path.join(output, 'agent.properties'); await writeFile(configFile, Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n'));
const classes = path.join(output, 'classes'); await mkdir(classes, { recursive: true });
const compile = spawnSync('javac', ['--release', '8', '-cp', [asm, ...fixture.classpath].join(path.delimiter), '-d', classes, 'scripts/java/CurrentWorldCaptureAgent.java'], { windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 }); assert.equal(compile.status, 0, compile.stderr);
const manifestFile = path.join(output, 'MANIFEST.MF'); await writeFile(manifestFile, 'Manifest-Version: 1.0\nPremain-Class: studio.nbsx.research.CurrentWorldCaptureAgent\n\n');
const agent = path.join(output, 'current-world-capture-agent.jar'); const packed = spawnSync('jar', ['cfm', agent, manifestFile, '-C', classes, '.'], { windowsHide: true, encoding: 'utf8' }); assert.equal(packed.status, 0, packed.stderr);
await copyFile('scripts/java/CurrentWorldCaptureAgent.java', path.join(output, 'CurrentWorldCaptureAgent.java'));
await copyFile('scripts/capture-current-world.mjs', path.join(output, 'capture-current-world.mjs'));
await writeFile(path.join(game, 'options.txt'), `renderDistance:2\nmaxFps:30\npauseOnLostFocus:false\ntutorialStep:none\ndirectionalAudio:${hrtf}\nsoundCategory_master:${master}\nsoundCategory_record:${records}\nsoundCategory_music:0.0\nsoundCategory_weather:0.0\nsoundCategory_hostile:0.0\nsoundCategory_neutral:0.0\nsoundCategory_player:0.0\nsoundCategory_ambient:0.0\nsoundCategory_block:0.0\n`);
const args = ['-Xmx2G', `-XX:ErrorFile=${path.join(output, 'hs_err_pid%p.log')}`, ...(processors ? [`-XX:ActiveProcessorCount=${processors}`] : []), '--enable-native-access=ALL-UNNAMED', `-Dorg.lwjgl.librarypath=${fixture.nativeDir}`, `-Djava.library.path=${fixture.nativeDir}`, `-javaagent:${agent}=${configFile}`, '-cp', [agent, asm, ...fixture.classpath].join(path.delimiter), 'net.minecraft.client.main.Main', '--version', version, '--username', 'NBSX_Audio_Probe', '--uuid', '00000000000000000000000000000001', '--accessToken', '0', '--offlineDeveloperMode', '--graphicsBackend', graphicsBackend, '--gameDir', game, '--assetsDir', assets, '--assetIndex', metadata.assetIndex.id, '--width', '640', '--height', '480'];
const originalClasses = unzipSync(clientBytes, { filter: entry => [...new Set([config.minecraft, config.library, config.channel, config.noteBlock, config.window, config.levelSettings, config.difficultySettings, config.worldPresets])].some(name => entry.name === `${name.replaceAll('.', '/')}.class`) });
const provenance = {
  schema: 3, version, clientSha1: digest(clientBytes), clientUrl: metadata.downloads.client.url, officialMetadata: { url: official.url, sha1: digest(metadataBytes) }, manifest: { url: manifestUrl, sha256: digest(manifestBytes, 'sha256') }, mappings: 'officially-named-client; no mappings artifact',
  agentFile: 'current-world-capture-agent.jar', agentSourceFile: 'CurrentWorldCaptureAgent.java', agentSha256: digest(await readFile(agent), 'sha256'), agentSourceSha256: digest(await readFile('scripts/java/CurrentWorldCaptureAgent.java'), 'sha256'), asm: { version: asmVersion, url: asmUrl, sha256: asmSha256 },
  java: { version: metadata.javaVersion.majorVersion, executable: java, executableSha256: digest(await readFile(java), 'sha256'), archiveProvenance: runtime },
  assetIndex: { id: metadata.assetIndex.id, sha1: digest(assetIndexBytes) }, assetsDirectory: assets, bootstrapAssets: bootstrapAssets.map(([name, object]) => ({ name, sha1: object.hash, size: object.size })), samples, libraryProvenance, nativeProvenance,
  originalClasses: Object.fromEntries(Object.entries(originalClasses).map(([name, bytes]) => [name, digest(bytes, 'sha256')])),
  world: path.join(game, 'saves', config.worldName), output, hrtf, polyphony, master, records, instruments,
  recordingMethod: 'real integrated world, original named NoteBlock/SoundEngine and original material selection; captured via deterministic OpenAL loopback; SDL window hidden by research agent',
  captureScope: '48 kHz stereo PCM16, 1024-frame mixer blocks, three seconds per scene; aligned after original Channel.play; excludes hardware output and musical/server onset latency',
  captureScriptFile: 'capture-current-world.mjs', captureScriptSha256: digest(await readFile('scripts/capture-current-world.mjs'), 'sha256'), processors: processors ?? 'JVM default',
  graphicsBackend: `${graphicsBackend} (original supported client backend)`, status: 'prepared-not-recorded',
};
await writeFile(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2)); await writeFile(path.join(target, 'latest.json'), JSON.stringify(provenance, null, 2));
const log = createWriteStream(path.join(output, 'client.log')), child = spawn(java, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: game });
const finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
const terminate = () => child.kill(); process.once('SIGINT', terminate); process.once('SIGTERM', terminate);
provenance.pid = child.pid; provenance.status = 'running';
await writeFile(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2)); await writeFile(path.join(target, 'latest.json'), JSON.stringify(provenance, null, 2));
console.log(JSON.stringify({ pid: child.pid, output, scenes: scenes.length, master, records, hrtf, status: 'running' }));
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log.write(chunk); for (const line of String(chunk).split(/\r?\n/)) if (line.includes('NBSX_CAPTURE')) console.log(line.slice(0, 300)); });
const timer = setTimeout(() => { console.error('Current world capture timeout'); child.kill(); }, timeoutSeconds * 1000);
let exit;
try { exit = await finished; }
finally { clearTimeout(timer); process.removeListener('SIGINT', terminate); process.removeListener('SIGTERM', terminate); log.end(); }
provenance.exit = exit; provenance.status = exit === 0 ? 'exited-awaiting-artifact-check' : 'failed';
await writeFile(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2));
await writeFile(path.join(target, 'latest.json'), JSON.stringify(provenance, null, 2));
if (exit !== 0) throw new Error(`Original current client exited ${exit}; see ${path.join(output, 'client.log')}`);
await readFile(path.join(output, 'complete.txt'));
const actualOptions = Object.fromEntries((await readFile(path.join(output, 'actual-options.properties'), 'utf8')).split(/\r?\n/).filter(line => /^options\./.test(line)).map(line => { const separator = line.indexOf('='); return [line.slice(0, separator), Number(line.slice(separator + 1))]; }));
assert(Math.abs(actualOptions['options.master'] - master) < 1e-6, 'Original Options did not load the requested master volume');
assert(Math.abs(actualOptions['options.records'] - records) < 1e-6, 'Original Options did not load the requested record volume');
provenance.actualOptions = actualOptions;
for (let i = 0; i < scenes.length; i++) { const pcm = await readFile(path.join(output, `case-${i}.pcm`)); assert.equal(pcm.length, 144000 * 4); await readFile(path.join(output, `case-${i}.properties`)); }
provenance.status = 'capture-complete-not-yet-compared';
await writeFile(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2)); await writeFile(path.join(target, 'latest.json'), JSON.stringify(provenance, null, 2));
console.log(JSON.stringify({ exit, scenes: scenes.length, output, status: provenance.status }));
