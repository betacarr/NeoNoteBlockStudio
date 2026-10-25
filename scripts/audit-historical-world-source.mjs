import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';
import { historicalClassfile } from './historical-classfile.mjs';

export const historicalWorldPatchVersions = ['1.13.1', '1.13.2', '1.14.1', '1.14.2', '1.14.3'];
// Independently checked 1.14.3 adapter; semantic labels are manual.
export const earlyPatchConfig = {
  '1.14.3': { minecraft: 'cvo', library: 'ctj', channel: 'cti', noteBlock: 'bqg', window: 'cuh',
    openDevice: 'f', tick: 'e', channelPlay: 'c', noteEvent: 'a', sourceId: 'b', overlay: 'p', server: 'A', player: 'j', stop: 'k',
    levelSettings: 'bhq', gameType: 'bhj', creative: 'c', worldType: 'bht', flat: 'c', allowCommands: 'b', createLevel: 'a',
    noGravity: 'd', moveTo: 'b', execute: 'execute', overworld: 'a', dimensionType: 'byi', overworldDimension: 'a', players: 'A',
    blocks: 'bmr', noteBlockConstant: 'av', air: 'a', defaultState: 'o', blockPos: 'ev', noteProperty: 'c', setValue: 'a', getValue: 'c', setBlock: 'a', blockEvent: 'a',
    instrumentProperty: 'a', instrumentType: 'bwp', instrumentName: 'm', instrumentByState: 'a', options: 'w', soundSource: 'yo', sourceMaster: 'a', sourceRecords: 'c', sourceBlocks: 'e', optionVolume: 'a' },
};
const run = (program, args) => new Promise((resolve, reject) => {
  const child = spawn(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
  child.once('error', reject); child.once('exit', code => code ? reject(new Error(`${program}: ${stderr}`)) : resolve(stdout));
});
const slash = value => value.replaceAll('\\', '/');

export async function discoverHistoricalWorldRoles(version) {
  assert(historicalWorldPatchVersions.includes(version));
  const audio = JSON.parse(await readFile(`docs/evidence/java-${version}-audio-source.json`));
  const client = path.resolve(`.research/clients/${version}.jar`), bytes = await readFile(client); assert.equal(digest(bytes), audio.clientSha1);
  const archive = unzipSync(bytes, { filter: entry => entry.name.endsWith('.class') });
  const classes = new Map(Object.entries(archive).map(([filename, code]) => { const item = historicalClassfile(code); return [item.name, item]; }));
  const find = (role, predicate) => { const matches = [...classes.values()].filter(predicate); assert.equal(matches.length, 1, `${version} ${role}: ${matches.map(x => x.name)}`); return matches[0].name; };
  const roles = { ...audio.roles }, note = classes.get(roles.NoteBlock);
  const event = note.methods.filter(item => /^a\(L[^;]+;L[^;]+;L[^;]+;II\)Z$/.test(item.name + item.descriptor)); assert.equal(event.length, 1);
  [roles.BlockState, roles.World, roles.BlockPos] = [...event[0].descriptor.matchAll(/L([^;]+);/g)].map(item => item[1]);
  roles.Block = note.parent;
  roles.Minecraft = find('Minecraft', item => item.strings.some(text => text.startsWith('Setting user:')));
  roles.PlayerList = find('PlayerList', item => item.strings.includes('multiplayer.player.joined'));
  roles.ServerWorld = find('ServerWorld', item => item.parent === roles.World && item.strings.includes('menu.savingLevel'));
  roles.Entity = find('Entity', item => item.strings.includes('NoGravity'));
  roles.Player = find('Player', item => item.floats.includes(Math.fround(1.62)) && item.utf8.includes('com/mojang/authlib/GameProfile') && item.strings.includes('SelectedItemSlot'));
  roles.IntegratedServer = find('IntegratedServer', item => item.parent === 'net/minecraft/server/MinecraftServer' && item.strings.some(text => text.includes('Starting integrated minecraft server')));
  roles.MinecraftServer = 'net/minecraft/server/MinecraftServer';
  roles.Blocks = find('Blocks', item => item.strings.includes('note_block') && item.fields.filter(field => field.descriptor === `L${roles.Block};` && (field.access & 8)).length > 100);
  const creates = classes.get(roles.Minecraft).methods.filter(item => /^\(Ljava\/lang\/String;Ljava\/lang\/String;L[^;]+;\)V$/.test(item.descriptor)); assert.equal(creates.length, 1);
  roles.LevelSettings = /;L([^;]+);\)V$/.exec(creates[0].descriptor)[1];
  const constructors = classes.get(roles.LevelSettings).methods.filter(item => item.name === '<init>' && /^\(JL[^;]+;ZZL[^;]+;\)V$/.test(item.descriptor)); assert.equal(constructors.length, 1);
  [roles.GameType, roles.WorldType] = [...constructors[0].descriptor.matchAll(/L([^;]+);/g)].map(item => item[1]);
  roles.Window = find('Window', item => item.strings.includes('Pre startup') && item.strings.some(text => text.includes('GLFW error')));
  const engineSource = await readFile(`.research/historical-audio-patches/${version}/source/${roles.SoundEngine}.java`, 'utf8');
  if (!version.startsWith('1.13')) roles.Camera = /public void a\((\w+) \w+\) \{\s*if \(!this\.f \|\| !\w+\.h\(\)\)/.exec(engineSource)[1];
  roles.ClientWorld = find('ClientWorld', item => item.parent === roles.World && item.strings.includes('MpServer'));
  roles.BlockStateBase = classes.get(roles.BlockState).parent;
  if (roles.BlockStateBase === 'java/lang/Object') roles.BlockStateBase = classes.get(roles.BlockState).interfaces[0];
  roles.LivingEntity = classes.get(roles.Player).parent;
  roles.ServerExecutor = classes.get(roles.MinecraftServer).parent;
  if (roles.ServerExecutor === 'java/lang/Object') delete roles.ServerExecutor;
  if (roles.ServerExecutor) {
    let executor = classes.get(roles.ServerExecutor);
    while (!executor.methods.some(item => item.name === 'execute' && item.descriptor === '(Ljava/lang/Runnable;)V')) { assert(classes.has(executor.parent)); executor = classes.get(executor.parent); }
    roles.ServerExecutorImplementation = executor.name;
  }
  const playerListSend = classes.get(roles.PlayerList).methods.filter(item => new RegExp(`^\\(L${roles.Player};DDDDL[^;]+;L[^;]+;\\)V$`).test(item.descriptor)); assert.equal(playerListSend.length, 1);
  [roles.DimensionType, roles.Packet] = [...playerListSend[0].descriptor.matchAll(/L([^;]+);/g)].map(item => item[1]).slice(1);
  roles.ServerPlayer = find('ServerPlayer', item => item.parent === roles.Player && item.refs.some(ref => ref.owner === roles.PlayerList));
  let packetCaller = classes.get(roles.ServerWorld);
  if (version.startsWith('1.13')) {
    roles.ServerWorldListener = find('ServerWorldListener', item => item.refs.some(ref => ref.owner === roles.PlayerList && ref.descriptor === playerListSend[0].descriptor) && item.refs.some(ref => ref.name === '<init>' && /^\(L[^;]+;L[^;]+;DDDFF\)V$/.test(ref.descriptor)));
    packetCaller = classes.get(roles.ServerWorldListener);
  }
  const soundPacket = packetCaller.refs.filter(ref => ref.name === '<init>' && /^\(L[^;]+;L[^;]+;DDDFF\)V$/.test(ref.descriptor)); assert.equal(soundPacket.length, 1);
  roles.SoundPacket = soundPacket[0].owner;
  roles.SoundEvent = /\(L([^;]+);/.exec(soundPacket[0].descriptor)[1];
  const dimensionGetter = packetCaller.refs.filter(ref => ref.kind === 'method' && ref.descriptor === `()L${roles.DimensionType};`); assert.equal(dimensionGetter.length, 1);
  roles.WorldDimension = dimensionGetter[0].owner;
  roles.ClientPacketHandler = find('ClientPacketHandler', item => item.methods.some(method => method.descriptor === `(L${roles.SoundPacket};)V`) && item.refs.some(ref => ref.owner === roles.ClientWorld));
  const soundInstance = classes.get(roles.ClientWorld).refs.filter(ref => ref.name === '<init>' && ref.descriptor === `(L${roles.SoundEvent};L${roles.SoundSource};FFFFF)V`); assert.equal(soundInstance.length, 1);
  roles.SimpleSoundInstance = soundInstance[0].owner;
  roles.AbstractSoundInstance = classes.get(roles.SimpleSoundInstance).parent;
  const blockEvents = classes.get(roles.ServerWorld).refs.filter(ref => ref.name === '<init>' && ref.descriptor === `(L${roles.BlockPos};L${roles.Block};II)V`); assert.equal(blockEvents.length, 2);
  roles.BlockEvent = blockEvents.find(ref => !classes.get(ref.owner).interfaces.includes(roles.Packet)).owner;
  roles.BlockEventPacket = blockEvents.find(ref => classes.get(ref.owner).interfaces.includes(roles.Packet)).owner;
  if (roles.Camera) {
    roles.GameRenderer = find('GameRenderer', item => item.refs.some(ref => ref.owner === roles.Camera && ref.name === 'a' && ref.descriptor.endsWith('ZZF)V')));
    const eye = classes.get(roles.Player).methods.find(item => item.name === 'b' && /^\(L[^;]+;L[^;]+;\)F$/.test(item.descriptor)); assert(eye);
    [roles.Pose, roles.EntityDimensions] = [...eye.descriptor.matchAll(/L([^;]+);/g)].map(item => item[1]);
    roles.PositionVector = /\(\)L([^;]+);/.exec(classes.get(roles.Camera).methods.find(item => item.name === 'c').descriptor)[1];
  }
  return { version, client, clientSha1: digest(bytes), archive, classes, roles, createLevel: creates[0].name };
}

async function extract() {
  const records = [], jobs = [];
  for (const version of historicalWorldPatchVersions) {
    const discovered = await discoverHistoricalWorldRoles(version), { client, archive, roles } = discovered;
    const root = path.resolve(`.research/historical-world-patches/${version}`); await mkdir(path.join(root, 'classes'), { recursive: true });
    const record = { version, clientSha1: discovered.clientSha1, createLevel: discovered.createLevel, roles, classes: [] }; records.push(record);
    for (const name of [...new Set(Object.values(roles))]) {
      const code = archive[name + '.class']; assert(code, name); const parsed = discovered.classes.get(name);
      const rawClass = path.join(root, 'classes', name.replaceAll('/', '_') + '.class'); await writeFile(rawClass, code);
      const entry = { originalName: name, roles: Object.entries(roles).filter(([, value]) => value === name).map(([role]) => role), parent: parsed.parent, bytecodeSha1: digest(code), bytecodeSha256: digest(code, 'sha256'), methods: methodCodeHashes(code), fields: parsed.fields.map(({ access, name, descriptor }) => ({ access, name, descriptor })), rawClass: slash(path.relative(process.cwd(), rawClass)) }; record.classes.push(entry);
      jobs.push(async () => {
        const sourceFile = path.join(root, 'source', name + '.java'), javapFile = path.join(root, name.replaceAll('/', '_') + '.javap.txt');
        let source = await readFile(sourceFile, 'utf8').catch(() => undefined);
        if (source === undefined) { await run('java', ['-jar', '.research/tools/cfr-0.152.jar', rawClass, '--extraclasspath', client, '--outputdir', path.join(root, 'source'), '--silent', 'true']); source = await readFile(sourceFile, 'utf8'); }
        let disassembly = await readFile(javapFile, 'utf8').catch(() => undefined);
        if (disassembly === undefined) { disassembly = await run('javap', ['-p', '-s', '-c', '-classpath', client, name.replaceAll('/', '.')]); await writeFile(javapFile, disassembly); }
        entry.rawSource = slash(path.relative(process.cwd(), sourceFile)); entry.sourceSha256 = digest(Buffer.from(source), 'sha256');
        entry.rawDisassembly = slash(path.relative(process.cwd(), javapFile)); entry.disassemblySha256 = digest(Buffer.from(disassembly), 'sha256');
      });
    }
    console.log(`${version}: discovered ${Object.keys(roles).length} original roles; Minecraft=${roles.Minecraft}, world=${roles.World}/${roles.ServerWorld}, players=${roles.PlayerList}, player=${roles.Player}, camera=${roles.Camera ?? roles.SoundEngine}`);
  }
  let cursor = 0; await Promise.all(Array.from({ length: 2 }, async () => { while (cursor < jobs.length) await jobs[cursor++](); }));
  await writeFile('.research/historical-world-patches/inventory.json', JSON.stringify({ schema: 1, records }, null, 2) + '\n');
  console.log(JSON.stringify({ versions: records.length, classes: records.reduce((n, item) => n + item.classes.length, 0), output: '.research/historical-world-patches/inventory.json' }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await extract();
