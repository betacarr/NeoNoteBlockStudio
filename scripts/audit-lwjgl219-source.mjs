import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest, verifiedArtifact } from './research-utils.mjs';
import { historicalClassfile } from './historical-classfile.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';

export const lwjgl219Root = '.research/lwjgl219-source';
export async function discoverLwjgl219(version = '1.9') {
  const release = JSON.parse(await readFile('src/data/java-releases.json')).versions.find(item => item.id === version); assert(release);
  const metadataSha1 = /packages\/([a-f0-9]{40})\//.exec(release.metadataUrl)[1], root = `${lwjgl219Root}/${version}`;
  await verifiedArtifact({ url: release.metadataUrl, sha1: metadataSha1 }, `${root}/official-metadata.json`);
  const metadata = JSON.parse(await readFile(`${root}/official-metadata.json`)); assert.equal(metadata.id, version); assert(!metadata.downloads.client_mappings);
  const client = `.research/clients/${version}.jar`; await verifiedArtifact(metadata.downloads.client, client);
  const archives = [{ filename: client, artifact: metadata.downloads.client, files: unzipSync(await readFile(client)) }];
  if (version === '1.9') for (const item of metadata.libraries.filter(item => /^com\.paulscode:/.test(item.name))) {
    const artifact = item.downloads.artifact, filename = path.join('.research/libraries', artifact.path); await verifiedArtifact(artifact, filename);
    archives.push({ filename, artifact, files: unzipSync(await readFile(filename)) });
  }
  const classes = new Map();
  for (const archive of archives) for (const [name, bytes] of Object.entries(archive.files)) if (name.endsWith('.class')) classes.set(name.slice(0, -6), { ...historicalClassfile(bytes), bytes, archive });
  const unique = (role, predicate) => { const candidates = [...classes.values()].filter(predicate); assert.equal(candidates.length, 1, `${version} ${role}: ${candidates.map(item => item.name)}`); return candidates[0].name; };
  const roles = {
    SoundEngine: unique('SoundEngine', item => item.strings.includes('Unable to play unknown soundEvent: {}')),
    Options: unique('Options', item => item.strings.includes('soundCategory_')),
    NoteBlock: unique('NoteBlock', item => item.refs.some(ref => ref.owner === 'java/lang/Math' && ref.name === 'pow') && item.methods.some(method => method.descriptor.endsWith(';II)Z'))),
    TileEntityNote: unique('TileEntityNote', item => item.strings.includes('note') && item.fields.some(field => field.descriptor === 'B')),
  };
  const engine = classes.get(roles.SoundEngine);
  roles.SoundInstance = unique('SoundInstance', item => (item.access & 0x200) && item.methods.filter(method => method.descriptor === '()F').length >= 5 && engine.refs.some(ref => ref.owner === item.name));
  roles.AbstractSound = unique('AbstractSound', item => item.interfaces.includes(roles.SoundInstance) && item.fields.filter(field => field.descriptor === 'F').length >= 4);
  roles.SoundDefinition = unique('SoundDefinition', item => classes.get(roles.AbstractSound).fields.some(field => field.descriptor === `L${item.name};`) && item.methods.some(method => method.name === '<init>' && method.descriptor.startsWith('(Ljava/lang/String;FFI')));
  roles.Category = unique('Category', item => item.parent === 'java/lang/Enum' && ['master', 'record', 'block'].every(value => item.strings.includes(value)));
  const packets = [...classes.values()].filter(item => item.fields.some(field => field.descriptor === `L${roles.Category};`) && item.methods.some(method => method.name === '<init>' && method.descriptor.includes('DDDFF')) && item.refs.some(ref => ref.name === 'writeFloat'));
  assert.equal(packets.length, 2, `${version} sound packets`);
  roles.NamedSoundPacket = packets.find(item => item.fields.some(field => field.descriptor === 'Ljava/lang/String;')).name;
  roles.RegisteredSoundPacket = packets.find(item => item.name !== roles.NamedSoundPacket).name;
  const registered = classes.get(roles.RegisteredSoundPacket);
  roles.SoundEvent = registered.fields.find(field => field.descriptor.startsWith('L') && field.descriptor !== `L${roles.Category};`).descriptor.slice(1, -1);
  roles.PacketBuffer = registered.refs.find(ref => ref.name === 'readFloat').owner;
  roles.PositionedSound = unique('PositionedSound', item => item.parent === roles.AbstractSound && item.methods.some(method => method.name === '<init>' && method.descriptor.includes('FFZIL')));
  roles.ResourceLocation = classes.get(roles.SoundDefinition).fields.find(field => field.descriptor.startsWith('L') && !field.descriptor.includes('$')).descriptor.slice(1, -1);
  roles.MathHelper = engine.refs.find(ref => ref.descriptor === '(FFF)F').owner;
  if (version === '1.9') Object.assign(roles, {
    SoundManager: 'byx', SoundSerializer: 'byh', SoundAccessor: 'byz', SoundAccessorInterface: 'bza', NestedSoundAccessor: 'byx$2', SoundDefinitionType: 'byf$a',
    World: 'aht', ServerWorld: 'lp', ServerWorldListener: 'lq', WorldListener: 'ahv', PlayerList: 'mm', Player: 'zj', ServerPlayer: 'lr',
    ClientWorld: 'bku', ClientPacketHandler: 'bks', Block: 'ajt', BlockState: 'arc', BlockPos: 'cj', Blocks: 'aju', Material: 'axe', SoundEvents: 'ng',
    Bootstrap: 'kn', EngineLoader: 'byv$1', EngineSoundSystem: 'byv$a',
    Library: 'paulscode/sound/libraries/LibraryLWJGLOpenAL', Source: 'paulscode/sound/libraries/SourceLWJGLOpenAL', Channel: 'paulscode/sound/libraries/ChannelLWJGLOpenAL', BaseLibrary: 'paulscode/sound/Library', SoundSystemConfig: 'paulscode/sound/SoundSystemConfig', CodecJOrbis: 'paulscode/sound/codecs/CodecJOrbis',
  });
  for (const name of Object.values(roles)) assert(classes.has(name), `${version} missing ${name}`);
  return { version, metadataUrl: release.metadataUrl, metadataSha1, metadata, client, classes, roles, root };
}

export async function auditLwjgl219(versions = ['1.9', '1.9.1', '1.9.2', '1.9.3', '1.9.4', '1.10', '1.10.1', '1.10.2', '1.11', '1.11.1', '1.11.2', '1.12', '1.12.1', '1.12.2']) {
  const records = [];
  for (const version of versions) {
    const found = await discoverLwjgl219(version), classes = [];
    await mkdir(`${found.root}/classes`, { recursive: true });
    const roles = version === '1.9' ? found.roles : Object.fromEntries(Object.entries(found.roles).filter(([role]) => ['NamedSoundPacket', 'RegisteredSoundPacket', 'SoundEngine', 'AbstractSound', 'SoundDefinition', 'TileEntityNote', 'NoteBlock'].includes(role)));
    for (const name of new Set(Object.values(roles))) {
      const item = found.classes.get(name), basename = name.replaceAll('/', '_'), rawClass = `${found.root}/classes/${basename}.class`, rawDisassembly = `${found.root}/${basename}.javap.txt`;
      await writeFile(rawClass, item.bytes);
      const run = spawnSync('javap', ['-p', '-s', '-c', '-classpath', item.archive.filename, name.replaceAll('/', '.')], { windowsHide: true, encoding: 'utf8', maxBuffer: 8e6 }); assert.equal(run.status, 0, run.stderr);
      await writeFile(rawDisassembly, run.stdout);
      classes.push({ originalName: name, roles: Object.entries(roles).filter(([, value]) => value === name).map(([role]) => role), artifact: item.archive.artifact, classSha1: digest(item.bytes), classSha256: digest(item.bytes, 'sha256'), methods: methodCodeHashes(item.bytes), fields: item.fields.map(({ name, descriptor, access }) => ({ name, descriptor, access })), rawClass, rawDisassembly, disassemblySha256: digest(Buffer.from(run.stdout), 'sha256') });
    }
    const record = { version, officialSources: { metadataUrl: found.metadataUrl, metadataSha1: found.metadataSha1, clientUrl: found.metadata.downloads.client.url, clientSha1: found.metadata.downloads.client.sha1 }, roles: found.roles, classes };
    await writeFile(`${found.root}/inventory.json`, JSON.stringify(record, null, 2)); records.push(record);
    console.log(JSON.stringify({ version, classes: classes.length, registered: found.roles.RegisteredSoundPacket, named: found.roles.NamedSoundPacket }));
  }
  const report = { schema: 1, mappings: { officialClientMappingsAvailable: false, kind: 'independent-original-class-and-call-chain-role-discovery' }, records };
  await writeFile(`${lwjgl219Root}/inventory.json`, JSON.stringify(report, null, 2)); return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await auditLwjgl219(process.argv.includes('--version') ? [process.argv[process.argv.indexOf('--version') + 1]] : undefined);
