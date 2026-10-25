import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { digest, verifiedArtifact } from './research-utils.mjs';
import { historicalClassfile } from './historical-classfile.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';

export const lwjgl21710Version = '1.7.10';
const root = '.research/lwjgl21710-source';
const run = (program, args) => new Promise((resolve, reject) => { const child = spawn(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', error = ''; child.stdout.on('data', data => out += data); child.stderr.on('data', data => error += data); child.once('error', reject); child.once('exit', code => code ? reject(new Error(error)) : resolve(out)); });
export async function discoverLwjgl21710() {
  const catalog = JSON.parse(await readFile('src/data/java-releases.json')), release = catalog.versions.find(item => item.id === lwjgl21710Version);
  const metadataSha1 = /packages\/([a-f0-9]{40})\//.exec(release.metadataUrl)[1];
  await verifiedArtifact({ url: release.metadataUrl, sha1: metadataSha1 }, `${root}/official-metadata.json`);
  const metadata = JSON.parse(await readFile(`${root}/official-metadata.json`)); assert.deepEqual(metadata, JSON.parse(await readFile('.research/metadata/1.7.10.json'))); assert(!metadata.downloads.client_mappings);
  const client = '.research/clients/1.7.10.jar', clientBytes = await readFile(client); assert.equal(digest(clientBytes), 'e80d9b3bf5085002218d4be59e668bac718abbc6'); assert.equal(digest(clientBytes), metadata.downloads.client.sha1);
  const archives = [{ artifact: metadata.downloads.client, filename: client, files: unzipSync(clientBytes) }];
  const artifacts = metadata.libraries.flatMap(item => [item.downloads?.artifact, ...Object.values(item.downloads?.classifiers ?? {})]).filter(Boolean);
  for (const artifact of artifacts.filter(item => /(?:paulscode|lwjgl\/lwjgl\/lwjgl\/)/.test(item.path))) {
    const filename = path.join('.research/libraries', artifact.path); await verifiedArtifact(artifact, filename); archives.push({ artifact, filename, files: unzipSync(await readFile(filename)) });
  }
  const classes = new Map(); for (const archive of archives) for (const [filename, bytes] of Object.entries(archive.files)) if (filename.endsWith('.class')) { const item = historicalClassfile(bytes); classes.set(item.name, { ...item, bytes, archive }); }
  const find = (role, predicate) => { const matches = [...classes.values()].filter(predicate); assert.equal(matches.length, 1, `${role}: ${matches.map(item => item.name)}`); return matches[0].name; };
  const roles = {
    NoteBlock: find('NoteBlock', c => ['bassattack', 'bd', 'hat', 'snare', 'note.'].every(s => c.strings.includes(s))),
    TileEntityNote: find('TileEntityNote', c => c.strings.includes('note') && c.methods.some(m => /\(L[^;]+;III\)V/.test(m.descriptor)) && c.fields.some(f => f.descriptor === 'B')),
    SoundEngine: find('SoundEngine', c => c.strings.includes('Unable to play unknown soundEvent: {}')),
    SoundManager: find('SoundManager', c => c.strings.includes('sounds.json') && c.strings.includes('Invalid sounds.json')),
    Options: find('Options', c => c.strings.includes('soundCategory_')),
    PlayerList: find('PlayerList', c => c.strings.includes('multiplayer.player.joined')),
    Player: find('Player', c => c.strings.includes('SelectedItemSlot')),
    Entity: find('Entity', c => c.strings.includes('Motion') && c.strings.includes('UUIDMost')),
    Minecraft: find('Minecraft', c => c.strings.some(s => s.startsWith('Setting user:'))),
    IntegratedServer: find('IntegratedServer', c => c.parent === 'net/minecraft/server/MinecraftServer' && c.strings.some(s => s.includes('Starting integrated minecraft server'))),
    MinecraftServer: 'net/minecraft/server/MinecraftServer', ResourceIndex: 'bqo',
    Library: 'paulscode/sound/libraries/LibraryLWJGLOpenAL', Source: 'paulscode/sound/libraries/SourceLWJGLOpenAL', Channel: 'paulscode/sound/libraries/ChannelLWJGLOpenAL',
    CodecJOrbis: 'paulscode/sound/codecs/CodecJOrbis', SoundSystemConfig: 'paulscode/sound/SoundSystemConfig', SoundSystem: 'paulscode/sound/SoundSystem',
    BaseLibrary: 'paulscode/sound/Library', BaseSource: 'paulscode/sound/Source', LwjglAL: 'org/lwjgl/openal/AL', LwjglALC: 'org/lwjgl/openal/ALC10',
  };
  roles.BlockContainer = classes.get(roles.NoteBlock).parent; roles.Block = classes.get(roles.BlockContainer).parent; roles.TileEntity = classes.get(roles.TileEntityNote).parent;
  const play = classes.get(roles.TileEntityNote).methods.find(m => /^\(L[^;]+;III\)V$/.test(m.descriptor)); roles.World = /\(L([^;]+);/.exec(play.descriptor)[1];
  roles.ServerWorld = find('ServerWorld', c => c.parent === roles.World && c.strings.includes('TickNextTick list out of synch'));
  roles.ClientWorld = find('ClientWorld', c => c.parent === roles.World && c.strings.includes('MpServer'));
  roles.ServerPlayer = find('ServerPlayer', c => c.parent === roles.Player && c.refs.some(ref => ref.owner === roles.PlayerList));
  roles.ServerWorldListener = find('ServerWorldListener', c => c.refs.some(ref => ref.owner === roles.PlayerList && /DDDDI/.test(ref.descriptor)) && c.refs.some(ref => ref.descriptor === '(Ljava/lang/String;DDDFF)V'));
  const engine = classes.get(roles.SoundEngine);
  roles.SoundInstance = /\(L([^;]+);\)V/.exec(engine.methods.find(m => m.name === 'c' && /^\(L[^;]+;\)V$/.test(m.descriptor)).descriptor)[1];
  roles.SoundDefinition = /;L([^;]+);\)F/.exec(engine.methods.find(m => /^\(L[^;]+;L[^;]+;\)F$/.test(m.descriptor)).descriptor)[1];
  roles.Category = /\(L([^;]+);\)F/.exec(engine.methods.find(m => m.name === 'a' && m.descriptor.endsWith(';)F')).descriptor)[1];
  roles.MathHelper = find('MathHelper', c => c.methods.some(m => m.name === 'a' && m.descriptor === '(FFF)F') && c.methods.some(m => m.descriptor === '(DDD)D'));
  roles.ResourceLocation = /\(L([^;]+);\)/.exec(classes.get(roles.SoundManager).methods.find(m => m.descriptor.endsWith(')Lbto;')).descriptor)[1];
  roles.SoundEventAccessor = /\)L([^;]+);/.exec(classes.get(roles.SoundManager).methods.find(m => m.descriptor.endsWith(')Lbto;')).descriptor)[1];
  const settings = classes.get(roles.Minecraft).methods.find(m => /^\(Ljava\/lang\/String;Ljava\/lang\/String;L[^;]+;\)V$/.test(m.descriptor)); roles.LevelSettings = /;L([^;]+);\)/.exec(settings.descriptor)[1];
  const sounds = classes.get(roles.SoundManager).refs.find(r => r.owner === 'com/google/gson/GsonBuilder' && r.name === 'registerTypeAdapter'); assert(sounds);
  roles.SoundSerializer = find('SoundSerializer', c => c.strings.includes('Invalid volume') && c.strings.includes('Invalid pitch') && c.strings.includes('sounds'));
  const named = engine.refs.find(r => r.name === '<init>' && r.descriptor === '(Ljava/lang/String;DDDFF)V');
  const soundPacket = classes.get(roles.ServerWorldListener).refs.find(r => r.name === '<init>' && r.descriptor === '(Ljava/lang/String;DDDFF)V'); assert(soundPacket); roles.SoundPacket = soundPacket.owner;
  roles.ClientPacketHandler = find('ClientPacketHandler', c => c.methods.some(m => m.descriptor === `(L${roles.SoundPacket};)V`) && c.refs.some(r => r.owner === roles.ClientWorld));
  roles.ClientPlayer = /L([^;]+);/.exec(classes.get(roles.Minecraft).fields.find(f => f.name === 'h').descriptor)[1];
  roles.ServerPacketHandler = /L([^;]+);/.exec(classes.get(roles.ServerPlayer).fields.find(f => f.name === 'a').descriptor)[1];
  roles.TeleportPacket = find('TeleportPacket', c => c.parent === classes.get(roles.SoundPacket).parent && c.methods.some(m => m.name === '<init>' && m.descriptor === '(DDDFFZ)V'));
  roles.WorldListener = classes.get(roles.ServerWorldListener).interfaces[0];
  roles.ClientWorldListener = find('ClientWorldListener', c => c.interfaces.includes(roles.WorldListener) && c.name !== roles.ServerWorldListener);
  roles.Blocks = find('Blocks', c => c.fields.filter(f => f.descriptor === `L${roles.Block};` && (f.access & 8)).length > 100);
  roles.Material = classes.get(roles.TileEntityNote).refs.find(r => r.kind === 'field' && r.owner !== roles.TileEntityNote && r.descriptor === `L${r.owner};`).owner;
  roles.EngineLoader = engine.refs.find(r => r.name === '<init>' && r.descriptor === `(L${roles.SoundEngine};)V`).owner;
  roles.EngineSoundSystem = /L([^;]+);/.exec(engine.fields.find(f => f.name === 'e').descriptor)[1];
  roles.LwjglALCcontext = 'org/lwjgl/openal/ALCcontext';
  const event = classes.get(roles.ServerWorld).refs.filter(r => r.name === '<init>' && r.descriptor === `(IIIL${roles.Block};II)V`); assert.equal(event.length, 2);
  roles.BlockEventPacket = event.find(r => classes.get(r.owner).parent === classes.get(roles.SoundPacket).parent).owner;
  roles.BlockEvent = event.find(r => r.owner !== roles.BlockEventPacket).owner;
  return { version: lwjgl21710Version, metadata, metadataUrl: release.metadataUrl, metadataSha1, client, classes, roles, artifacts };
}
export async function auditLwjgl21710() {
  const found = await discoverLwjgl21710(), records = []; await mkdir(`${root}/classes`, { recursive: true });
  const names = new Set(Object.values(found.roles)); for (const item of found.classes.values()) if ([...names].some(name => item.name.startsWith(name + '$'))) names.add(item.name);
  for (const name of names) {
    const item = found.classes.get(name); assert(item, name); const basename = name.replaceAll('/', '_'), rawClass = `${root}/classes/${basename}.class`, rawSource = `${root}/source/${name}.java`, rawDisassembly = `${root}/${basename}.javap.txt`;
    await writeFile(rawClass, item.bytes); let source = await readFile(rawSource).catch(() => undefined);
    if (!source) { await run('java', ['-jar', '.research/tools/cfr-0.152.jar', rawClass, '--extraclasspath', item.archive.filename, '--outputdir', `${root}/source`, '--silent', 'true']); source = await readFile(rawSource); }
    let disassembly = await readFile(rawDisassembly).catch(() => undefined); if (!disassembly) { disassembly = Buffer.from(await run('javap', ['-p', '-s', '-c', '-classpath', item.archive.filename, name.replaceAll('/', '.')])); await writeFile(rawDisassembly, disassembly); }
    records.push({ originalName: name, roles: Object.entries(found.roles).filter(([, n]) => n === name).map(([r]) => r), artifact: item.archive.artifact, bytecodeSha1: digest(item.bytes), bytecodeSha256: digest(item.bytes, 'sha256'), methods: methodCodeHashes(item.bytes), fields: item.fields.map(({ access, name, descriptor }) => ({ access, name, descriptor })), rawClass, rawSource, sourceSha256: digest(source, 'sha256'), rawDisassembly, disassemblySha256: digest(disassembly, 'sha256') });
    if (records.length % 10 === 0) console.log(`${records.length}/${names.size} original audio/world classes extracted`);
  }
  const record = { schema: 1, version: found.version, officialSources: { metadataUrl: found.metadataUrl, metadataSha1: found.metadataSha1, clientSha1: found.metadata.downloads.client.sha1, clientUrl: found.metadata.downloads.client.url }, roles: found.roles, classes: records };
  await writeFile(`${root}/inventory.json`, JSON.stringify(record, null, 2) + '\n'); console.log(JSON.stringify({ roles: found.roles, classes: records.length })); return record;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await auditLwjgl21710();
