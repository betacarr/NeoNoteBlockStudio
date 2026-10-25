import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';
import { historicalClassfile } from './historical-classfile.mjs';
import { historicalWorldPatchVersions, earlyPatchConfig, discoverHistoricalWorldRoles } from './audit-historical-world-source.mjs';

const parse = async filename => JSON.parse(await readFile(filename));
const sha256 = bytes => digest(bytes, 'sha256');
const sourceFile = version => `docs/evidence/java-${version}-world-source.json`;
const codeKey = method => method.name + method.descriptor;

export function historicalWorldFacts(version) {
  assert(historicalWorldPatchVersions.includes(version)); const camera = version.startsWith('1.14');
  return { noteBlockVolume: 3, baseBroadcastRadius: 16, broadcastRange: 48,
    broadcastOrigin: 'player-entity-position', comparison: 'strict-distance-squared-less-than-range-squared', sameDimensionRequired: true, excludedPlayerSkipped: true,
    dimensionComparison: 'dimension-type-object-identity', sourceBlockOffset: [.5, .5, .5],
    standingEyeHeight: 1.62, standingEyeHeightJavaFloat: Math.fround(1.62),
    blockEventNotificationRadius: 64, blockEventNotificationIsSoundDeliveryRule: false,
    packetCoordinateEncoding: 'truncate-java-int-double-times-8;decode-int-to-float-divide-8-then-double',
    listenerPositionModel: camera ? 'camera-position-converted-to-openal-float' : 'interpolated-entity-position-plus-current-eye-height-converted-to-openal-float',
    firstPersonForwardOffsetJavaFloat: camera ? -Math.fround(.05) : 0,
    eyeHeightSmoothing: camera ? { enabled: true, tickFactorJavaFloat: .5, arithmetic: 'float32(current + float32(float32(target - current) * 0.5))', frameInterpolation: 'float32(previous + float32(partialTick * float32(current - previous)))', target: 'entity-cached-eye-height', initialValue: 0 } : { enabled: false, target: 'current-player-eye-height-function' },
    standingFirstPersonPlayerRelativeToListener: { symbolicBeforeFinalOpenALFloatRounding: camera ? '+float32(0.05)*cameraForward - [0,smoothedEyeHeight,0]' : '[0,-float32(1.62),0]', cameraYaw0Pitch0Approximation: camera ? [0, -Math.fround(1.62), Math.fround(.05)] : [0, -Math.fround(1.62), 0], cameraYaw180Pitch0Approximation: camera ? [0, -Math.fround(1.62), -Math.fround(.05)] : [0, -Math.fround(1.62), 0], exactness: 'Only for stationary ordinary standing first person; actual orientation, smoothing and world-coordinate float rounding must be applied. These vectors are not exact recorded listener coordinates.' },
  };
}

function methodText(disassembly, owner, key) {
  const index = key.indexOf('('), name = key.slice(0, index), descriptor = key.slice(index), lines = disassembly.split(/\r?\n/);
  const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const at = lines.findIndex((line, i) => line.trim() === `descriptor: ${descriptor}` && (name === '<clinit>' ? /static \{\};/.test(lines[i - 1]) : new RegExp(`\\b${escaped(name === '<init>' ? owner.split('/').at(-1) : name)}\\(`).test(lines[i - 1])));
  assert(at >= 0, `Missing original disassembly ${owner}.${key}`); let end = at + 1;
  while (end < lines.length && !/^  (?:public|private|protected|static)/.test(lines[end]) && lines[end] !== '}') end++;
  return lines.slice(at - 1, end).join('\n');
}

async function bindReviewedMethods(record) {
  const roles = record.roles, texts = new Map(), classMap = new Map(record.classes.map(entry => [entry.originalName, entry])), bindings = [];
  for (const entry of record.classes) texts.set(entry.originalName, await readFile(entry.rawDisassembly, 'utf8'));
  const entryFor = role => { const result = classMap.get(roles[role]); assert(result, role); return result; };
  const add = (label, role, selector, tokens = []) => {
    const entry = entryFor(role), candidates = Object.keys(entry.methods).map(key => ({ key, text: methodText(texts.get(entry.originalName), entry.originalName, key) })).filter(item => selector(item.key, item.text));
    assert.equal(candidates.length, 1, `${record.version} ${label}: ${candidates.map(item => item.key)}`);
    const { key, text } = candidates[0]; for (const token of tokens) assert(text.includes(token), `${record.version} ${label} missing ${token}`);
    const at = key.indexOf('('), binding = { label, owner: entry.originalName, member: key.slice(0, at), descriptor: key.slice(at), codeSha256: entry.methods[key], semanticInstructionChecks: tokens };
    bindings.push(binding); return { binding, text };
  };
  const exact = (label, role, key, tokens) => add(label, role, candidate => candidate === key, tokens);
  const direct = `(L${roles.Player};DDDL${roles.SoundEvent};L${roles.SoundSource};FF)V`;
  const send = `(L${roles.Player};DDDDL${roles.DimensionType};L${roles.Packet};)V`;
  exact('note-block-event', 'NoteBlock', Object.keys(entryFor('NoteBlock').methods).find(key => /^a\(L[^;]+;L[^;]+;L[^;]+;II\)Z$/.test(key)), ['java/lang/Math.pow', 'float 3.0f', `${roles.SoundSource}.c:`]);
  const center = exact('source-block-center', 'World', `a(L${roles.Player};L${roles.BlockPos};L${roles.SoundEvent};L${roles.SoundSource};FF)V`, ['double 0.5d', direct]);
  assert.equal((center.text.match(/double 0\.5d/g) ?? []).length, 3);
  const radius = record.version.startsWith('1.13') ? exact('sound-range-and-packet', 'ServerWorldListener', `a(L${roles.Player};L${roles.SoundEvent};L${roles.SoundSource};DDDFF)V`, ['float 16.0f', 'fmul', `${roles.PlayerList}.a:${send}`, `class ${roles.SoundPacket}`]) : exact('sound-range-and-packet', 'ServerWorld', 'a' + direct, ['float 16.0f', 'fmul', `${roles.PlayerList}.a:${send}`, `class ${roles.SoundPacket}`]);
  const delivery = exact('player-entity-range-delivery', 'PlayerList', 'a' + send, ['dcmpg', 'ifge', 'if_acmp', 'dmul', 'dadd']);
  const positionFields = [...delivery.text.matchAll(new RegExp(`Field ${roles.ServerPlayer}\\.(\\w+):D`, 'g'))].map(item => `${roles.ServerPlayer}.${item[1]}:D`); assert.equal(new Set(positionFields).size, 3);
  assert.equal((delivery.text.match(/\bdmul\b/g) ?? []).length, 4); assert.equal((delivery.text.match(/\bdadd\b/g) ?? []).length, 2);
  for (const field of positionFields) assert(delivery.text.includes(`Field ${field}`));
  const dimensionField = new RegExp(`Field ${roles.ServerPlayer}\\.(\\w+):L${roles.DimensionType};`).exec(delivery.text); assert(dimensionField);
  exact('server-block-event-queue', 'ServerWorld', `a(L${roles.BlockPos};L${roles.Block};II)V`, [`class ${roles.BlockEvent}`]);
  add('distinct-block-event-notification', 'ServerWorld', (key, text) => text.includes(`class ${roles.BlockEventPacket}`), ['double 64.0d', `${roles.PlayerList}.a:${send}`]);
  exact('server-invokes-block-state-event', 'ServerWorld', `a(L${roles.BlockEvent};)Z`, [`${roles.BlockState}.a:`]);
  exact('client-receives-block-event', 'ClientPacketHandler', `a(L${roles.BlockEventPacket};)V`, [`${roles.ClientWorld}.a:`]);
  exact('client-receives-sound-packet', 'ClientPacketHandler', `a(L${roles.SoundPacket};)V`, [`${roles.SoundPacket}.d:()D`, `${roles.SoundPacket}.e:()D`, `${roles.SoundPacket}.f:()D`, `${roles.ClientWorld}.a:${direct}`]);
  const gate = exact('client-world-excludes-null-note-event', 'ClientWorld', 'a' + direct, ['if_acmpne']);
  assert(gate.text.includes(`Field ${roles.Minecraft}.`));
  exact('client-world-actual-local-sound', 'ClientWorld', `a(DDDL${roles.SoundEvent};L${roles.SoundSource};FFZ)V`, [`class ${roles.SimpleSoundInstance}`, 'd2f']);
  exact('sound-packet-construct-coordinates', 'SoundPacket', `<init>(L${roles.SoundEvent};L${roles.SoundSource};DDDFF)V`, ['double 8.0d', 'd2i']);
  for (const member of ['d', 'e', 'f']) exact(`sound-packet-${member}-coordinate`, 'SoundPacket', `${member}()D`, ['i2f', 'float 8.0f', 'fdiv', 'f2d']);
  exact('instrument-supporting-material', 'Instrument', `a(L${roles.BlockState};)L${roles.Instrument};`, []);
  exact('instrument-serialized-name', 'Instrument', 'm()Ljava/lang/String;', []);
  add('note-block-placement-selects-support', 'NoteBlock', (key, text) => key.startsWith('a(L') && key.endsWith(`)L${roles.BlockState};`) && !key.startsWith(`a(L${roles.BlockState};`) && text.includes(`${roles.Instrument}.a:`), [`${roles.Instrument}.a:`]);
  add('note-block-neighbor-updates-support', 'NoteBlock', (key, text) => key.startsWith(`a(L${roles.BlockState};L`) && key.endsWith(`)L${roles.BlockState};`) && text.includes(`${roles.Instrument}.a:`), [`${roles.Instrument}.a:`]);
  exact('note-block-queues-world-event', 'NoteBlock', `a(L${roles.World};L${roles.BlockPos};)V`, [`${roles.World}.a:(L${roles.BlockPos};L${roles.Block};II)V`]);
  exact('entity-move-current-and-previous-position', 'Entity', 'b(DDDFF)V', []);
  exact('entity-no-gravity', 'Entity', 'd(Z)V', []);
  if (record.version.startsWith('1.13')) {
    exact('world-listener-dispatch', 'World', 'a' + direct, ['invokeinterface']);
    add('minecraft-server-registers-world-listener', 'MinecraftServer', (key, text) => text.includes(`class ${roles.ServerWorldListener}`), [`class ${roles.ServerWorldListener}`]);
    add('integrated-server-loads-world', 'IntegratedServer', (key, text) => key.endsWith('()Z') && text.includes('Starting integrated minecraft server'), ['Starting integrated minecraft server']);
    exact('standing-player-eye-height', 'Player', 'bF()F', ['float 1.62f']);
    exact('listener-direct-entity-eye-interpolation', 'SoundEngine', `a(L${roles.Player};F)V`, [`${roles.Player}.bF:()F`, 'setListenerPosition:(FFF)V', 'd2f']);
    add('minecraft-updates-sound-listener', 'Minecraft', (key, text) => text.includes(`${roles.SoundManager}.a:(L${roles.Player};F)V`), [`${roles.SoundManager}.a:(L${roles.Player};F)V`]);
    exact('sound-manager-passes-player-pose', 'SoundManager', `a(L${roles.Player};F)V`, [`${roles.SoundEngine}.a:(L${roles.Player};F)V`]);
  } else {
    const eye = exact('standing-player-eye-height', 'Player', `b(L${roles.Pose};L${roles.EntityDimensions};)F`, ['float 1.62f']);
    exact('living-entity-dispatches-player-eye-height', 'LivingEntity', `a(L${roles.Pose};L${roles.EntityDimensions};)F`, [`b:(L${roles.Pose};L${roles.EntityDimensions};)F`]);
    exact('entity-cached-eye-height', 'Entity', Object.keys(entryFor('Entity').methods).find(key => /^b[M-N]\(\)F$/.test(key)), ['getfield']);
    add('entity-updates-cached-eye-height', 'Entity', (key, text) => !key.startsWith('<init>') && text.includes(`a:(L${roles.Pose};L${roles.EntityDimensions};)F`) && /putfield.*:F/.test(text), []);
    exact('camera-interpolates-position-and-shifts-first-person', 'Camera', Object.keys(entryFor('Camera').methods).find(key => key.startsWith('a(L') && key.endsWith('ZZF)V')), ['double -0.05000000074505806d', `${roles.MathHelper}.g:(FFF)F`, 'a:(DDD)V']);
    exact('camera-eye-height-smoothing', 'Camera', 'a()V', ['float 0.5f', 'fmul', 'fadd', 'fsub']);
    exact('camera-forward-axis-translation', 'Camera', 'a(DDD)V', ['dmul', 'dadd']);
    exact('camera-forward-vector-orientation', 'Camera', 'b()V', ['float 90.0f']);
    exact('camera-position-getter', 'Camera', `c()L${roles.PositionVector};`, []);
    exact('listener-uses-camera-position', 'SoundEngine', `a(L${roles.Camera};)V`, [`${roles.Camera}.c:()L${roles.PositionVector};`, 'invokedynamic', 'execute:']);
    add('listener-camera-update-callback', 'SoundEngine', (key, text) => text.includes(`${roles.Listener}.a:(L${roles.PositionVector};)V`), [`${roles.Listener}.a:(L${roles.PositionVector};)V`]);
    exact('native-listener-position-float', 'Listener', `a(L${roles.PositionVector};)V`, ['AL10.alListener3f', 'd2f']);
    exact('sound-manager-passes-camera', 'SoundManager', `a(L${roles.Camera};)V`, [`${roles.SoundEngine}.a:(L${roles.Camera};)V`]);
    add('minecraft-updates-sound-listener', 'Minecraft', (key, text) => text.includes(`${roles.SoundManager}.a:(L${roles.Camera};)V`), [`${roles.SoundManager}.a:(L${roles.Camera};)V`]);
    add('renderer-updates-camera-pose', 'GameRenderer', (key, text) => text.includes(`${roles.Camera}.a:(L`) && text.includes('ZZF)V'), [`${roles.Camera}.a:(L`]);
    add('renderer-ticks-camera-eye-height', 'GameRenderer', (key, text) => key !== '<init>()V' && text.includes(`${roles.Camera}.a:()V`), [`${roles.Camera}.a:()V`]);
    exact('server-thread-executor', 'ServerExecutorImplementation', 'execute(Ljava/lang/Runnable;)V', ['java/lang/Runnable.run:()V']);
  }
  return { bindings, entityPositionFields: [...new Set(positionFields)], dimensionField: `${roles.ServerPlayer}.${dimensionField[1]}:L${roles.DimensionType};`, texts, add, exact, entryFor };
}

async function adapterBindings(record, state) {
  if (record.version !== '1.14.3') return undefined;
  const c = earlyPatchConfig[record.version], { exact, entryFor } = state, r = record.roles;
  exact('adapter-client-frame', 'Minecraft', `${c.tick}(Z)V`, [`${r.SoundManager}.a:(L${r.Camera};)V`]);
  exact('adapter-create-world', 'Minecraft', `a(Ljava/lang/String;Ljava/lang/String;L${r.LevelSettings};)V`, [`class ${r.IntegratedServer}`]);
  exact('adapter-server-getter', 'Minecraft', `A()L${r.IntegratedServer};`, []);
  exact('adapter-stop-client', 'Minecraft', 'k()V', ['iconst_0', 'putfield']);
  exact('adapter-world-settings', 'LevelSettings', `<init>(JL${r.GameType};ZZL${r.WorldType};)V`, []);
  exact('adapter-allow-commands', 'LevelSettings', `b()L${r.LevelSettings};`, ['iconst_1', 'putfield']);
  exact('adapter-overworld-getter', 'MinecraftServer', `a(L${r.DimensionType};)L${r.ServerWorld};`, []);
  exact('adapter-world-players-getter', 'ServerWorld', 'A()Ljava/util/List;', []);
  exact('adapter-block-default-state', 'Block', `o()L${r.BlockState};`, []);
  const setter = Object.keys(entryFor('BlockStateBase').methods).find(key => /^a\(L[^;]+;Ljava\/lang\/Comparable;\)Ljava\/lang\/Object;$/.test(key)); assert(setter);
  exact('adapter-block-state-set-property', 'BlockStateBase', setter, []);
  const property = /\(L([^;]+);/.exec(setter)[1]; exact('adapter-block-state-get-property', 'BlockStateBase', `c(L${property};)Ljava/lang/Comparable;`, []);
  exact('adapter-set-world-block', 'World', `a(L${r.BlockPos};L${r.BlockState};I)Z`, []);
  exact('adapter-block-pos-constructor', 'BlockPos', '<init>(III)V', []);
  exact('adapter-original-device-open', 'Library', 'f()J', ['ALC10.alcOpenDevice']);
  exact('adapter-channel-play', 'Channel', 'c()V', ['AL10.alSourcePlay']);
  const fields = [
    ['Minecraft', c.overlay], ['Minecraft', c.player], ['Minecraft', c.options], ['Channel', c.sourceId],
    ['NoteBlock', c.noteProperty], ['NoteBlock', c.instrumentProperty], ['Blocks', c.air], ['Blocks', c.noteBlockConstant],
    ['GameType', c.creative], ['WorldType', c.flat], ['DimensionType', c.overworldDimension],
  ].map(([role, member]) => { const entry = entryFor(role), field = entry.fields.find(item => item.name === member); assert(field, `${role}.${member}`); return { owner: entry.originalName, member, descriptor: field.descriptor, access: field.access }; });
  return { config: c, fields };
}

async function inspect(version) {
  const inventory = await parse('.research/historical-world-patches/inventory.json'), record = inventory.records.find(item => item.version === version); assert(record);
  const state = await bindReviewedMethods(record), adapter = await adapterBindings(record, state);
  return { record, state, adapter };
}

export async function reviewHistoricalWorldSource(version, filename = sourceFile(version)) {
  assert(historicalWorldPatchVersions.includes(version)); const report = await parse(filename), previous = await parse(`docs/evidence/java-${version}-audio-source.json`);
  const metadataBytes = await readFile(`.research/historical-audio-patches/${version}/official-metadata.json`); assert.equal(digest(metadataBytes), report.officialSources.metadataSha1);
  const metadata = JSON.parse(metadataBytes); assert.equal(metadata.id, version); assert(!metadata.downloads.client_mappings); assert.deepEqual(metadata, await parse(`.research/metadata/${version}.json`));
  assert.deepEqual(report.officialSources, previous.officialSources); assert.equal(metadata.downloads.client.sha1, report.clientSha1);
  const client = await readFile(`.research/clients/${version}.jar`); assert.equal(digest(client), report.clientSha1); const archive = unzipSync(client);
  const discovery = await discoverHistoricalWorldRoles(version); assert.deepEqual(report.roles, discovery.roles);
  assert.deepEqual(report.facts, historicalWorldFacts(version)); assert.equal(report.integratedWorldScenesAdded, 0); assert.equal(report.mappings.officialClientMappingsAvailable, false);
  for (const entry of report.classes) {
    const bytes = archive[entry.originalName + '.class']; assert(bytes); assert.equal(digest(bytes), entry.bytecodeSha1); assert.equal(sha256(bytes), entry.bytecodeSha256); assert.deepEqual(methodCodeHashes(bytes), entry.methods);
    assert.deepEqual(historicalClassfile(bytes).fields.map(({ access, name, descriptor }) => ({ access, name, descriptor })), entry.fields);
    assert.equal(sha256(await readFile(entry.rawClass)), entry.bytecodeSha256); assert.equal(sha256(await readFile(entry.rawSource)), entry.sourceSha256); assert.equal(sha256(await readFile(entry.rawDisassembly)), entry.disassemblySha256);
  }
  const state = await bindReviewedMethods(report), adapter = await adapterBindings(report, state);
  assert.deepEqual(report.bindings, state.bindings); assert.deepEqual(report.entityPositionFields, state.entityPositionFields); assert.equal(report.dimensionField, state.dimensionField);
  assert.deepEqual(report.adapterConfig, adapter?.config ?? null); assert.deepEqual(report.adapterFields, adapter?.fields ?? []);
  return report;
}

async function writeReports() {
  // Publish 1.14.3 first so its independent capture adapter can proceed.
  for (const version of ['1.14.3', ...historicalWorldPatchVersions.filter(item => item !== '1.14.3')]) {
    const { record, state, adapter } = await inspect(version), previous = await parse(`docs/evidence/java-${version}-audio-source.json`);
    const report = { schema: 1, version, id: `java-${version}`, clientSha1: record.clientSha1, officialSources: previous.officialSources,
      mappings: { kind: 'manual-roles-over-original-classfiles', officialClientMappingsAvailable: false, limitation: 'Original version-specific class bytes, constant pools, descriptors, callers and instruction bodies are retained; no official or adjacent-release mappings are assumed.' },
      roles: record.roles, classes: record.classes, bindings: state.bindings, entityPositionFields: state.entityPositionFields, dimensionField: state.dimensionField,
      facts: historicalWorldFacts(version), adapterConfig: adapter?.config ?? null, adapterFields: adapter?.fields ?? [],
      integratedWorldScenesAdded: 0, gameRecording: 'pending', scope: 'Independent original world-delivery, material/event and listener/camera source audit. No world recording or acceptance inherited.',
      sourceChain: ['supporting-material -> original Instrument.byState -> NoteBlock instrument property', 'server queued block event -> matching original block state -> NoteBlock original note event', 'block center -> server sound packet range 16*raw volume -> same-dimension, non-excluded players with strict entity distance squared < range squared', 'sound packet -> original client packet handler -> matching client player world overload -> actual local sound instance -> original sound manager/engine', 'separate radius64 block-event notification -> client null-player note event is rejected by local-world identity gate, so it does not replace sound-packet radius48 delivery', version.startsWith('1.13') ? 'Minecraft -> sound manager -> sound engine interpolated player entity + current eye height -> original listener float coordinates' : 'GameRenderer -> Camera pose/eye smoothing/first-person -.05 forward shift -> Minecraft -> sound manager -> engine Camera.position -> original listener float coordinates'],
      limitations: ['Standing eye-height function is 1.62f, not a promise that the actual listener is entity+[0,1.62,0]. Camera smoothing, interpolation, first-person shift and final float rounding are explicit separate facts.', 'Other poses, third person and sleeping camera need their own position rules.', 'No default-device state, waveform or engine equivalence is inferred from this world source review.', 'Packet coordinate quantization is independently bound; raw block centers are exact eighths in the ordinary tested coordinate range.'],
    };
    await mkdir('docs/evidence', { recursive: true }); await writeFile(sourceFile(version), JSON.stringify(report, null, 2) + '\n');
    const verified = await reviewHistoricalWorldSource(version); console.log(JSON.stringify({ version, classes: verified.classes.length, bindings: verified.bindings.length, evidence: sourceFile(version), verified: true }));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) await writeReports(); else for (const version of historicalWorldPatchVersions) { const report = await reviewHistoricalWorldSource(version); console.log(JSON.stringify({ version, classes: report.classes.length, bindings: report.bindings.length, verified: true })); }
}
