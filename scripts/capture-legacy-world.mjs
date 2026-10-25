import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest, verifiedArtifact } from './research-utils.mjs';

// These names are a version-specific, manually checked adapter, not official mappings.
const version = '1.13';
const fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`, 'utf8'));
const manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(20000) }); assert(response.ok);
const release = (await response.json()).versions.find(item => item.id === version); assert(release && release.type === 'release');
const metadataResponse = await fetch(release.url, { signal: AbortSignal.timeout(20000) }); assert(metadataResponse.ok);
const metadataBytes = Buffer.from(await metadataResponse.arrayBuffer()); assert.equal(digest(metadataBytes), release.sha1);
const metadata = JSON.parse(metadataBytes); assert.equal(metadata.downloads.client_mappings, undefined, 'Recheck the adapter if official mappings become available');
assert.deepEqual(JSON.parse(await readFile(`.research/metadata/${version}.json`, 'utf8')), metadata, 'Local parsed metadata differs from the checked official document');
assert.equal(metadata.downloads.client.sha1, 'c0b970952cdd279912da384cdbfc0c26e6c6090b');
const client = path.join(fixture.root, 'versions', version, `${version}.jar`), clientBytes = await readFile(client);
assert.equal(digest(clientBytes), metadata.downloads.client.sha1);
for (const filename of new Set(fixture.classpath.slice(1))) {
  const relative = filename.slice(path.join(fixture.root, 'libraries').length + 1).replaceAll('\\', '/');
  const artifact = metadata.libraries.flatMap(item => [item.downloads?.artifact, ...Object.values(item.downloads?.classifiers ?? {})]).find(item => item?.path === relative);
  assert(artifact, `Unidentified dependency ${relative}`); assert.equal(digest(await readFile(filename)), artifact.sha1, relative);
}
const files = unzipSync(clientBytes);
function classMembers(bytes) {
  const b = Buffer.from(bytes), constants = [], count = b.readUInt16BE(8); let cursor = 10;
  for (let i = 1; i < count; i++) {
    const tag = b[cursor++];
    if (tag === 1) { const size = b.readUInt16BE(cursor); cursor += 2; constants[i] = b.toString('utf8', cursor, cursor + size); cursor += size; }
    else if ([3, 4, 9, 10, 11, 12, 17, 18].includes(tag)) cursor += 4;
    else if ([7, 8, 16, 19, 20].includes(tag)) cursor += 2;
    else if ([5, 6].includes(tag)) { cursor += 8; i++; }
    else if (tag === 15) cursor += 3;
    else throw new Error(`Unknown constant-pool tag ${tag}`);
  }
  cursor += 6; const interfaces = b.readUInt16BE(cursor); cursor += 2 + interfaces * 2;
  const attributes = () => { const n = b.readUInt16BE(cursor); cursor += 2; for (let i = 0; i < n; i++) { cursor += 2; const size = b.readUInt32BE(cursor); cursor += 4 + size; } };
  const members = () => { const result = [], n = b.readUInt16BE(cursor); cursor += 2; for (let i = 0; i < n; i++) { const access = b.readUInt16BE(cursor), name = constants[b.readUInt16BE(cursor + 2)], descriptor = constants[b.readUInt16BE(cursor + 4)]; cursor += 6; result.push({ access, name, descriptor }); attributes(); } return result; };
  return { fields: members(), methods: members() };
}
const bindings = [
  ['cfi', 'methods', 'm', '()V', 'client tick; original game loop calls this during menus and play'],
  ['cfi', 'methods', 'a', '(Ljava/lang/String;Ljava/lang/String;Laxx;)V', 'creates and joins original integrated server dfx'],
  ['cfi', 'methods', 'y', '()Ldfx;', 'integrated-server getter returns ac'],
  ['cfi', 'methods', 'j', '()V', 'normal shutdown sets running flag false'],
  ['cfi', 'fields', 'i', 'Lcsy;', 'client player'],
  ['dgf', 'methods', 'init', '()V', 'Paulscode Library; invokes ALC10.alcOpenDevice/alcCreateContext and AL.createCapabilities'],
  ['dge', 'methods', 'play', '()V', 'Paulscode Channel; original AL10.alSourcePlay call'],
  ['dge', 'fields', 'a', 'Ljava/nio/IntBuffer;', 'original OpenAL source ID buffer'],
  ['bfw', 'methods', 'a', '(Lbkt;Laxs;Lej;II)Z', 'note-block event: Math.pow(2,(note-12)/12), original world sound dispatch at gain 3'],
  ['bfw', 'fields', 'c', 'Lbma;', 'note value state property'], ['bfw', 'fields', 'a', 'Lbly;', 'instrument state property'],
  ['bcj', 'methods', 'p', '()Lbkt;', 'default block-state getter'],
  ['bkr', 'methods', 'a', '(Lbmd;Ljava/lang/Comparable;)Ljava/lang/Object;', 'block-state property setter'],
  ['bmb', 'methods', 'a', '(Lbkt;)Lbmb;', 'instrument selected from actual support block'],
  ['axs', 'methods', 'a', '(Lej;Lbkt;I)Z', 'world block placement'], ['axs', 'fields', 'j', 'Ljava/util/List;', 'original world player list'],
  ['tc', 'methods', 'a', '(Lej;Lbcj;II)V', 'server-world queued block event'],
  ['net/minecraft/server/MinecraftServer', 'methods', 'a', '(Ljava/lang/Runnable;)Lcom/google/common/util/concurrent/ListenableFuture;', 'server-thread task submission'],
  ['net/minecraft/server/MinecraftServer', 'methods', 'a', '(I)Ltc;', 'dimension getter; dimension 0 is overworld'],
  ['aeo', 'methods', 'd', '(Z)V', 'sets NoGravity data property'], ['aeo', 'methods', 'b', '(DDDFF)V', 'sets current and previous position/yaw/pitch'],
  ['axx', 'methods', '<init>', '(JLaxp;ZZLaxz;)V', 'world settings constructor'], ['axx', 'methods', 'a', '()Laxx;', 'allows commands'],
  ['axp', 'fields', 'c', 'Laxp;', 'creative enum value'], ['axz', 'fields', 'c', 'Laxz;', 'flat world type'],
  ['bck', 'fields', 'aw', 'Lbcj;', 'note_block registry lookup'], ['bck', 'fields', 'a', 'Lbcj;', 'air registry lookup'], ['bck', 'fields', 'j', 'Lbcj;', 'dirt registry lookup'],
];
const instruments = ['harp', 'bass', 'basedrum', 'snare', 'hat', 'guitar', 'flute', 'bell', 'chime', 'xylophone'];
const bases = [['j', 'dirt'], ['n', 'oak_planks'], ['b', 'stone'], ['D', 'sand'], ['ap', 'glass'], ['aY', 'white_wool'], ['cU', 'clay'], ['bB', 'gold_block'], ['gp', 'packed_ice'], ['in', 'bone_block']];
for (const [name, block] of bases.slice(1)) bindings.push(['bck', 'fields', name, 'Lbcj;', `${block} registry lookup; original bmb instrument selection`]);
const evidenceDirectory = path.resolve('.research/legacy/1.13/world-adapter'); await mkdir(evidenceDirectory, { recursive: true });
await writeFile(path.join(evidenceDirectory, 'official-metadata.json'), metadataBytes);
const classEvidence = [];
for (const name of new Set([...bindings.map(item => item[0]), 'cfs', 'dgh', 'dgl'])) {
  const bytes = files[`${name}.class`]; assert(bytes, name); const members = classMembers(bytes);
  for (const [, kind, member, descriptor] of bindings.filter(item => item[0] === name)) assert(members[kind].some(item => item.name === member && item.descriptor === descriptor), `${name}.${member}${descriptor}`);
  const disassembly = spawnSync('javap', ['-p', '-c', '-s', '-classpath', client, name.replaceAll('/', '.')], { windowsHide: true, encoding: 'utf8' }); assert.equal(disassembly.status, 0, disassembly.stderr);
  const outputName = name.replaceAll('/', '_'); await writeFile(path.join(evidenceDirectory, outputName + '.javap.txt'), disassembly.stdout);
  await writeFile(path.join(evidenceDirectory, outputName + '.class'), bytes);
  classEvidence.push({ name, sha1: digest(bytes), disassemblySha256: digest(Buffer.from(disassembly.stdout), 'sha256') });
}
const nativeName = 'OpenAL.dll', nativeBytes = await readFile(path.join(fixture.nativeDir, nativeName));
const nativeLibrary = metadata.libraries.find(item => item.name === 'org.lwjgl:lwjgl-openal:3.1.6' && item.downloads.classifiers?.['natives-windows']); assert(nativeLibrary);
const nativeArtifact = nativeLibrary.downloads.classifiers['natives-windows'];
const nativeArchive = await readFile(path.join(fixture.root, 'libraries', nativeArtifact.path)); assert.equal(digest(nativeArchive), nativeArtifact.sha1);
assert(Object.entries(unzipSync(nativeArchive)).some(([name, bytes]) => path.basename(name) === nativeName && digest(bytes) === digest(nativeBytes)), 'Native DLL differs from the official referenced archive');
const adapterEvidence = { version, verifiedAt: new Date().toISOString(), manifestUrl, metadataUrl: release.url, metadataSha1: release.sha1, clientUrl: metadata.downloads.client.url, clientSha1: digest(clientBytes), mappings: { kind: 'manual-bytecode-bindings', officialClientMappingsAvailable: false, limitation: 'Descriptors and raw disassembly are checked; semantic names are manual research labels, not official mappings.' }, bindings: bindings.map(([owner, kind, member, descriptor, evidence]) => ({ owner, kind, member, descriptor, evidence })), classes: classEvidence, nativeArtifact, nativeDllSha256: digest(nativeBytes, 'sha256') };
await writeFile(path.join(evidenceDirectory, 'adapter-evidence.json'), JSON.stringify(adapterEvidence, null, 2));
if (process.argv.includes('--prepare-only')) { console.log(JSON.stringify({ prepared: true, evidenceDirectory, classCount: classEvidence.length })); process.exit(0); }

const master = process.argv.includes('--master') ? Number(process.argv[process.argv.indexOf('--master') + 1]) : 1; assert(master >= 0 && master <= 1);
const hrtf = process.argv.includes('--hrtf'), polyphony = process.argv.includes('--polyphony'), runId = String(Date.now());
const target = path.resolve('.local/legacy-world-comparison', version), run = path.join(target, `run-${runId}`), game = path.join(run, 'game'), output = path.join(run, 'capture');
await mkdir(game, { recursive: true }); await mkdir(output, { recursive: true });
const asmUrl = 'https://repo.maven.apache.org/maven2/org/ow2/asm/asm/9.7.1/asm-9.7.1.jar';
const asmSha256 = (await fetch(asmUrl + '.sha256').then(r => r.text())).trim(), asm = path.resolve('.research/tools/asm-9.7.1.jar'); await verifiedArtifact({ url: asmUrl, sha256: asmSha256 }, asm, 'sha256');
const config = { worldName: `nbsx-legacy-audio-verification-${runId}`, output: output.replaceAll('\\', '/'), hrtf: String(hrtf), minecraft: 'cfi', window: 'cfs', library: 'dgf', channel: 'dge', noteBlock: 'bfw', tick: 'm', noteEvent: 'a', sourceId: 'a', levelSettings: 'axx', gameType: 'axp', creative: 'c', worldType: 'axz', flat: 'c', allowCommands: 'a', createLevel: 'a', server: 'y', player: 'i', stop: 'j', noGravity: 'd', moveTo: 'b', execute: 'a', overworld: 'a', players: 'j', blocks: 'bck', noteBlockConstant: 'aw', air: 'a', 'base.0': 'j', defaultState: 'p', blockPos: 'ej', noteProperty: 'c', instrumentProperty: 'a', instrumentType: 'bmb', instrumentByState: 'a', setValue: 'a', setBlock: 'a', blockEvent: 'a', 'instrument.0': 'harp' };
for (let i = 0; i < instruments.length; i++) { config[`base.${i}`] = bases[i][0]; config[`instrument.${i}`] = instruments[i]; }
const cases = [[0, 0, 12, 0], [2, 0, 12, 0], [-2, 0, 12, 0], [0, 12, 12, 0], [0, -12, 12, 0], [0, 40, 12, 0], [0, 48, 12, 0], [0, 0, 0, 0], [0, 0, 24, 0]];
if (process.argv.includes('--all-instruments')) for (let i = 1; i < instruments.length; i++) for (const note of [0, 12, 24]) cases.push([0, 0, note, i]);
const grid = (count, mixed = false) => Array.from({ length: count }, (_, i) => [(i % 8) * 3 - 10, Math.floor(i / 8) * 3 - 10, [0, 12, 24][i % 3], mixed ? i % instruments.length : 0]);
const scenes = polyphony ? [{ name: 'harp-triad', notes: [[-3, 0, 0, 0], [0, 0, 12, 0], [3, 0, 24, 0]] }, { name: 'mixed-six', notes: grid(6, true) }, { name: 'all-ten-instruments', notes: grid(10, true) }, { name: 'twenty-four-mixed-notes', notes: grid(24, true) }] : cases.map((note, i) => ({ name: `single-${i}`, notes: [note] }));
config.caseLimit = String(scenes.length); for (const [i, scene] of scenes.entries()) { config[`scene.${i}`] = scene.notes.map(note => note.join(',')).join(';'); config[`sceneName.${i}`] = scene.name; }
await writeFile(path.join(output, 'cases.json'), JSON.stringify(scenes));
const configFile = path.join(run, 'agent.properties'); await writeFile(configFile, Object.entries(config).map(([k, v]) => `${k}=${v}`).join('\n'));
const classes = path.join(run, 'classes'); await mkdir(classes, { recursive: true });
const compile = spawnSync('javac', ['--release', '8', '-cp', [asm, ...fixture.classpath].join(path.delimiter), '-d', classes, 'scripts/java/LegacyWorldCaptureAgent.java'], { windowsHide: true, encoding: 'utf8' }); assert.equal(compile.status, 0, compile.stderr);
const manifest = path.join(run, 'MANIFEST.MF'); await writeFile(manifest, 'Manifest-Version: 1.0\nPremain-Class: studio.nbsx.research.LegacyWorldCaptureAgent\n\n');
const agent = path.join(run, 'legacy-world-capture-agent.jar'); const jar = spawnSync('jar', ['cfm', agent, manifest, '-C', classes, '.'], { windowsHide: true, encoding: 'utf8' }); assert.equal(jar.status, 0, jar.stderr);
for (const [source, name] of [[agent, 'legacy-world-capture-agent.jar'], ['scripts/java/LegacyWorldCaptureAgent.java', 'LegacyWorldCaptureAgent.java'], [configFile, 'agent.properties'], [path.join(evidenceDirectory, 'adapter-evidence.json'), 'adapter-evidence.json']]) await copyFile(source, path.join(output, name));
await writeFile(path.join(game, 'options.txt'), `renderDistance:2\nmaxFps:30\npauseOnLostFocus:false\ntutorialStep:none\nsoundCategory_master:${master}\nsoundCategory_records:1.0\nsoundCategory_music:0.0\nsoundCategory_weather:0.0\nsoundCategory_hostile:0.0\nsoundCategory_neutral:0.0\nsoundCategory_player:0.0\nsoundCategory_ambient:0.0\nsoundCategory_blocks:0.0\n`);
const args = ['-Xmx2G', `-Dorg.lwjgl.librarypath=${fixture.nativeDir}`, `-Djava.library.path=${fixture.nativeDir}`, `-javaagent:${agent}=${configFile}`, '-cp', [agent, asm, ...fixture.classpath].join(path.delimiter), 'net.minecraft.client.main.Main', '--version', version, '--username', 'NBSX_Legacy_Probe', '--uuid', '00000000000000000000000000000013', '--accessToken', '0', '--userType', 'legacy', '--gameDir', game, '--assetsDir', path.join(fixture.root, 'assets'), '--assetIndex', fixture.assetIndex.id, '--width', '640', '--height', '480'];
const provenance = { schema: 1, version, clientSha1: digest(clientBytes), metadataSha1: release.sha1, agentSha256: digest(await readFile(agent), 'sha256'), agentSourceSha256: digest(await readFile('scripts/java/LegacyWorldCaptureAgent.java'), 'sha256'), asmSha256, nativeDllSha256: digest(nativeBytes, 'sha256'), output, game, world: path.join(game, 'saves', config.worldName), hrtf, polyphony, master, mappingEvidence: path.join(evidenceDirectory, 'adapter-evidence.json'), recordingMethod: 'Actual original integrated world and note-block events; original Paulscode/LWJGL3 decoder and sources; original native OpenAL loopback; window hidden by research instrumentation.' };
await writeFile(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2)); await writeFile(path.join(target, 'latest.json'), JSON.stringify(provenance, null, 2));
const log = createWriteStream(path.join(output, 'client.log')), child = spawn('java', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: game });
const processFile = path.join(run, 'process.json'); await writeFile(processFile, JSON.stringify({ pid: child.pid, running: true, launchedAt: new Date().toISOString(), output, game }, null, 2)); console.log(JSON.stringify({ pid: child.pid, output, processFile }));
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log.write(chunk); for (const line of String(chunk).split(/\r?\n/)) if (line.includes('NBSX_LEGACY_CAPTURE')) console.log(line.slice(0, 350)); });
// Observation deadlines never terminate a live game or launch a second one.
const warning = setTimeout(() => console.error(JSON.stringify({ stillObserving: true, pid: child.pid, output, note: 'Three minutes elapsed; the live process is retained for diagnosis.' })), 180000);
const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }); clearTimeout(warning); log.end();
await writeFile(processFile, JSON.stringify({ pid: child.pid, running: false, exit, output, game, completedAt: new Date().toISOString() }, null, 2));
console.log(JSON.stringify({ exit, output, log: path.join(output, 'client.log') })); if (exit !== 0) process.exitCode = 1;
