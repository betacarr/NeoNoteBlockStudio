import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';
import { historicalClassfile } from './historical-classfile.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';
import { discoverLwjgl21710 } from './audit-lwjgl21710-source.mjs';

const file = 'docs/evidence/java-1.7.10-audio-world-source.json', numericFile = 'docs/evidence/java-1.7.10-numeric-components.json';
const hash = bytes => digest(bytes, 'sha256'), parse = async name => JSON.parse(await readFile(name));
export const lwjgl21710Facts = {
  decoder: 'legacy-jorbis', attenuationModel: 'paulscode-linear', attenuationDistance: 16, noteBlockVolume: 3, minPitch: .5, maxPitch: 2,
  volumeRule: 'category-before-clamp', masterVolumePlacement: 'listener', soundEventArithmetic: 'double-event-scalars',
  pitchTransport: { kind: 'unsigned-byte', scale: 63, minimum: 0, maximum: 255 },
  hrtfControl: false, hrtfControlMode: 'device-default', outputLimiter: 'device-default',
  originalHrtfSupported: false, originalOutputLimiterSupported: false, originalLoopbackSupported: true,
  broadcastRange: 48, broadcastOrigin: 'server-player-entity-position', comparison: 'strict-distance-squared-less-than-range-squared', sameDimensionRequired: true,
  sourceBlockOffset: [.5, .5, .5], standingEyeHeight: 1.62, standingEyeHeightJavaFloat: Math.fround(1.62),
  listenerPositionModel: 'interpolated-client-player-position-already-containing-legacy-y-offset',
  serverPlayerYOffset: 0, ordinaryClientPlayerYOffsetJavaFloat: Math.fround(1.62),
  teleportYConversion: 'server entity feet Y + widened float32(1.62), assigned directly to client entity Y',
  originalRequestedVoicePool: { normal: 28, streaming: 4, notePool: 'normal', actualAllocatedCapacityMeasured: false },
  materials: [{ block: 'dirt/default', instrument: 'harp', eventId: 0 }, { block: 'stone material', instrument: 'basedrum', eventId: 1 }, { block: 'sand material', instrument: 'snare', eventId: 2 }, { block: 'glass material', instrument: 'hat', eventId: 3 }, { block: 'wood material', instrument: 'bass', eventId: 4 }],
};
function section(text, owner, key) {
  const at = key.indexOf('('), member = key.slice(0, at), descriptor = key.slice(at), lines = text.split(/\r?\n/);
  const name = (member === '<init>' ? owner.split('/').at(-1) : member).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const begin = lines.findIndex((line, i) => line.trim() === `descriptor: ${descriptor}` && (member === '<clinit>' ? /static \{\};/.test(lines[i - 1]) : new RegExp(`\\b${name}\\(`).test(lines[i - 1]))); assert(begin >= 0, `${owner}.${key}`);
  let end = begin + 1; while (end < lines.length && !/^  (?:public|protected|private|static|synchronized)/.test(lines[end]) && lines[end] !== '}') end++;
  return lines.slice(begin - 1, end).join('\n');
}
async function bindingsFor(report) {
  const roles = report.roles, texts = {}, entries = {}; for (const entry of report.classes) { entries[entry.originalName] = entry; texts[entry.originalName] = await readFile(entry.rawDisassembly, 'utf8'); }
  const bindings = [], add = (label, role, selector, tokens = []) => {
    const entry = entries[roles[role]]; assert(entry, role); const matches = Object.keys(entry.methods).map(key => ({ key, text: section(texts[entry.originalName], entry.originalName, key) })).filter(item => selector(item.key, item.text)); assert.equal(matches.length, 1, `${label}: ${matches.map(x => x.key)}`);
    const { key, text } = matches[0]; for (const token of tokens) assert(text.includes(token), `${label}: ${token}`);
    const at = key.indexOf('('); bindings.push({ label, owner: entry.originalName, member: key.slice(0, at), descriptor: key.slice(at), codeSha256: entry.methods[key], semanticInstructionChecks: tokens }); return text;
  };
  const exact = (label, role, key, tokens) => add(label, role, candidate => candidate === key, tokens);
  exact('note-materials-and-queue', 'TileEntityNote', 'a(Lahb;III)V', ['Field awt.e:', 'Field awt.p:', 'Field awt.s:', 'Field awt.d:', 'ahb.c:(IIILaji;II)V']);
  exact('note-event-pow-float-volume', 'NoteBlock', 'a(Lahb;IIIII)Z', ['java/lang/Math.pow', 'd2f', 'float 3.0f', 'ahb.a:(DDDLjava/lang/String;FF)V']);
  exact('world-sound-dispatch', 'World', 'a(DDDLjava/lang/String;FF)V', ['ahh.a:(Ljava/lang/String;DDDFF)V']);
  exact('server-listener-sound-packet', 'ServerWorldListener', 'a(Ljava/lang/String;DDDFF)V', ['float 16.0f', 'fmul', 'class hc', 'oi.a:(DDDDILft;)V']);
  const delivery = exact('server-player-strict-range', 'PlayerList', 'a(Lyz;DDDDILft;)V', ['Field mw.s:D', 'Field mw.t:D', 'Field mw.u:D', 'Field mw.ap:I', 'dcmpg', 'ifge']); assert(/dcmpg\s*\n\s*\d+: ifge/.test(delivery));
  exact('server-note-block-event-queue', 'ServerWorld', 'c(IIILaji;II)V', ['class ags']);
  exact('server-block-identity-and-event', 'ServerWorld', 'a(Lags;)Z', ['if_acmpne', 'aji.a:(Lahb;IIIII)Z']);
  add('separate-radius64-event-notification', 'ServerWorld', (key, text) => text.includes('class gg'), ['double 64.0d']);
  exact('client-block-event-receiver', 'ClientPacketHandler', 'a(Lgg;)V', ['bjf.c:(IIILaji;II)V']);
  exact('client-world-local-block-event', 'World', 'c(IIILaji;II)V', ['aji.a:(Lahb;IIIII)Z']);
  const silent = exact('client-world-listener-no-unpacketized-note-sound', 'ClientWorldListener', 'a(Ljava/lang/String;DDDFF)V', ['return']); assert(!/invoke\w+/.test(silent));
  exact('client-sound-packet-receiver', 'ClientPacketHandler', 'a(Lhc;)V', ['hc.h:()F', 'bjf.a:(DDDLjava/lang/String;FFZ)V']);
  exact('client-world-actual-sound', 'ClientWorld', 'a(DDDLjava/lang/String;FFZ)V', ['class bso']);
  exact('packet-pitch-byte-constructor', 'SoundPacket', '<init>(Ljava/lang/String;DDDFF)V', ['float 63.0f', 'f2i', 'sipush        255', 'double 8.0d']);
  exact('packet-read-unsigned-pitch', 'SoundPacket', 'a(Let;)V', ['readUnsignedByte:()S']);
  exact('packet-write-pitch-byte', 'SoundPacket', 'b(Let;)V', ['writeByte:']);
  exact('packet-decoded-pitch', 'SoundPacket', 'h()F', ['float 63.0f', 'i2f', 'fdiv']);
  exact('original-codec-library-registration', 'SoundEngine', '<init>(Lbtp;Lbbj;)V', ['class paulscode/sound/libraries/LibraryLWJGLOpenAL', 'class paulscode/sound/codecs/CodecJOrbis', 'setCodec:']);
  exact('engine-double-volume-order', 'SoundEngine', 'a(Lbst;Lbti;Lw;)F', ['bst.e:()F', 'f2d', 'bti.c:()D', 'dmul', 'qh.a:(DDD)D', 'd2f']);
  exact('engine-double-pitch-order', 'SoundEngine', 'a(Lbst;Lbti;)F', ['bst.f:()F', 'bti.b:()D', 'dmul', 'qh.a:(DDD)D', 'd2f']);
  exact('engine-original-raw-range-and-source', 'SoundEngine', 'c(Lbst;)V', ['float 16.0f', 'newSource:', 'setPitch:', 'setVolume:']);
  exact('engine-category-master-update', 'SoundEngine', 'a(Lw;F)V', ['setMasterVolume:', 'a:(Lbst;Lbti;Lw;)F']);
  exact('engine-load-master-listener', 'EngineLoader', 'run()V', ['setMasterVolume:']);
  exact('engine-client-listener-no-second-eye-add', 'SoundEngine', 'a(Lyz;F)V', ['Field yz.p:D', 'Field yz.q:D', 'Field yz.r:D', 'Field yz.s:D', 'Field yz.t:D', 'Field yz.u:D', 'setListenerPosition:(FFF)V']);
  add('minecraft-listener-uses-client-player', 'Minecraft', (key, text) => text.includes('btp.a:(Lyz;F)V'), ['Field h:Lbjk;']);
  exact('server-player-zero-offset', 'ServerPlayer', '<init>(Lnet/minecraft/server/MinecraftServer;Lmt;Lcom/mojang/authlib/GameProfile;Lmx;)V', ['Field L:F', 'fconst_0']);
  exact('player-standing-offset-default', 'Player', '<init>(Lahb;Lcom/mojang/authlib/GameProfile;)V', ['float 1.62f', 'Field L:F']);
  exact('server-teleport-adds-eye-once', 'ServerPacketHandler', 'a(DDDFF)V', ['class fu', 'double 1.6200000047683716d', 'dadd']);
  exact('client-teleport-assigns-transported-position', 'ClientPacketHandler', 'a(Lfu;)V', ['yz.a:(DDDFF)V']);
  exact('entity-direct-interpolated-position-setter', 'Entity', 'a(DDDFF)V', ['Field q:D', 'Field t:D']);
  exact('entity-feet-position-setter-adds-offset', 'Entity', 'b(DDDFF)V', ['Field L:F', 'dadd']);
  exact('entity-box-subtracts-offset', 'Entity', 'b(DDD)V', ['Field L:F', 'dsub']);
  exact('library-original-context-start', 'Library', 'init()V', ['org/lwjgl/openal/AL.create:()V']);
  exact('lwjgl-default-context-settings', 'LwjglAL', 'create()V', ['ldc', '44100', 'bipush        60']);
  exact('lwjgl-context-create', 'LwjglAL', 'init(Ljava/lang/String;IIZZ)V', ['alcOpenDevice:', 'createAttributeList:', 'alcCreateContext:']);
  exact('lwjgl-context-attribute-array', 'LwjglALCcontext', 'createAttributeList(III)Ljava/nio/IntBuffer;', ['sipush        4103', 'sipush        4104', 'sipush        4105']);
  exact('library-source-pools', 'BaseLibrary', 'init()V', ['getNumberStreamingChannels:', 'getNumberNormalChannels:']);
  exact('library-voice-reuse-stealing', 'BaseLibrary', 'getNextChannel(Lpaulscode/sound/Source;)Lpaulscode/sound/Channel;', ['normalChannels:', 'streamingChannels:', 'Field paulscode/sound/Source.priority:Z']);
  exact('original-pool-defaults', 'SoundSystemConfig', '<clinit>()V', ['bipush        28', 'putstatic', 'iconst_4']);
  exact('original-codec-read-all', 'CodecJOrbis', 'readAll()Lpaulscode/sound/SoundBuffer;', []);
  exact('library-buffer-decode-and-upload', 'Library', 'loadSound(Lpaulscode/sound/FilenameURL;)Z', ['reverseByteOrder:', 'readAll:', 'alBufferData:']);
  exact('original-source-distance', 'Source', 'calculateDistance()V', ['fsub', 'f2d', 'java/lang/Math.sqrt']);
  exact('original-source-gain', 'Source', 'calculateGain()V', ['fdiv', 'fsub']);
  exact('original-source-gain-upload', 'Source', 'positionChanged()V', ['alSourcef:', 'Field gain:F', 'Field sourceVolume:F']);
  exact('original-source-play', 'Channel', 'play()V', ['alSourcePlay:']);
  exact('original-master-listener-gain', 'Library', 'setMasterVolume(F)V', ['alListenerf:']);
  add('original-resource-namespace-index', 'ResourceIndex', key => key.startsWith('<init>'), ['String /', 'java/lang/String.split:', 'String :']);
  exact('sound-definitions-namespaced-load', 'SoundManager', 'a(Lbqy;)V', ['String sounds.json', 'bqx."<init>":']);
  exact('sample-path-resource-resolution', 'SoundManager', 'a(Lbqx;Lbsp;)V', ['String sounds/', 'String .ogg']);
  return bindings;
}

async function resourceEvidence() {
  const fixture = await parse('.local/game-fixtures/1.7.10/fixture.json'), metadata = await parse('.research/metadata/1.7.10.json');
  const indexBytes = await readFile(path.join(fixture.root, 'assets/indexes', metadata.assetIndex.id + '.json')); assert.equal(digest(indexBytes), metadata.assetIndex.sha1); const index = JSON.parse(indexBytes);
  assert(index.objects['minecraft/sounds.json']); const definition = index.objects['minecraft/sounds.json'], defBytes = await readFile(path.join(fixture.root, 'assets/objects', definition.hash.slice(0, 2), definition.hash)); assert.equal(digest(defBytes), definition.hash); const events = JSON.parse(defBytes);
  const samples = []; for (const [id, resolved] of Object.entries(fixture.sounds)) { const object = index.objects[resolved.path]; assert(object); const bytes = await readFile(path.join(fixture.root, 'assets/objects', object.hash.slice(0, 2), object.hash)); assert.equal(digest(bytes), object.hash); assert.equal(events[resolved.event].category, 'record'); samples.push({ id, ...resolved, sha1: object.hash, bytes: bytes.length, originalCategory: events[resolved.event].category }); }
  assert.equal(samples.length, 6); return { layout: 'namespaced', index: metadata.assetIndex, definitions: { path: 'minecraft/sounds.json', sha1: definition.hash }, samples, actuallyMaterialSelected: ['harp', 'bass', 'basedrum', 'snare', 'hat'], extraResourceOnly: ['pling'] };
}
async function nativeEvidence(run = false) {
  const metadata = await parse('.research/metadata/1.7.10.json'), fixture = await parse('.local/game-fixtures/1.7.10/fixture.json'), artifact = metadata.libraries.find(item => item.name === 'org.lwjgl.lwjgl:lwjgl-platform:2.9.1').downloads.classifiers['natives-windows'];
  const archive = await readFile(path.join('.research/libraries', artifact.path)); assert.equal(digest(archive), artifact.sha1); const entries = unzipSync(archive), bytes = entries['OpenAL64.dll']; assert(bytes); assert.equal(hash(bytes), '9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bdbc5e'); assert.equal(hash(await readFile(path.join(fixture.nativeDir, 'OpenAL64.dll'))), hash(bytes));
  const jna = '.research/libraries/net/java/dev/jna/jna/4.4.0/jna-4.4.0.jar', source = 'scripts/java/Lwjgl2NativeProbe.java', destination = '.research/lwjgl21710-source/native-probe-classes', raw = '.research/lwjgl21710-source/native-capabilities.json';
  if (run) { await mkdir(destination, { recursive: true }); let result = spawnSync('javac', ['--release', '8', '-cp', jna, '-d', destination, source], { windowsHide: true, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); result = spawnSync('java', ['-cp', [destination, jna].join(path.delimiter), 'studio.nbsx.research.Lwjgl2NativeProbe', path.join(fixture.nativeDir, 'OpenAL64.dll')], { windowsHide: true, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); await writeFile(raw, result.stdout); }
  const rawBytes = await readFile(raw), capabilities = JSON.parse(rawBytes); assert.deepEqual({ backend: capabilities.backend, loopback: capabilities.loopback, hrtf: capabilities.hrtf, outputLimiter: capabilities.outputLimiter }, { backend: '1.1 ALSOFT 1.15.1', loopback: true, hrtf: false, outputLimiter: false });
  return { artifact, filename: 'OpenAL64.dll', sha256: hash(bytes), capabilities, probeSource: source, probeSourceSha256: hash(await readFile(source)), probeDependency: { path: jna, sha256: hash(await readFile(jna)), scope: 'Research probe only; not a 1.7.10 game dependency' }, rawEvidence: { path: raw, sha256: hash(rawBytes) }, measurement: 'No-sound original Windows x64 DLL loopback context capability probe; no world or native voice pool measured' };
}
async function numericEvidence() {
  const bytes = await readFile(numericFile), numeric = JSON.parse(bytes); assert.equal(numeric.version, '1.7.10'); assert.equal(numeric.clientSha1, 'e80d9b3bf5085002218d4be59e668bac718abbc6'); assert.equal(numeric.integratedWorldScenesAdded, 0);
  for (const [filename, expected] of Object.entries(numeric.sources)) assert.equal(hash(await readFile(filename)), expected);
  const raw = await readFile(numeric.rawOutputs.math); assert.equal(hash(raw), numeric.engineMath.outputSha256); assert.equal(raw.readUInt32LE(4), numeric.engineMath.cases); const inputs = await readFile('.local/lwjgl21710-methods/inputs.json'); assert.equal(hash(inputs), numeric.engineMath.inputsSha256);
  for (const [i, [rawVolume, pitch, category, eventVolume, eventPitch]] of JSON.parse(inputs).entries()) { assert.equal(raw.readFloatLE(8 + i * 8), Math.fround(Math.max(0, Math.min(1, rawVolume * eventVolume * category)))); assert.equal(raw.readFloatLE(12 + i * 8), Math.fround(Math.max(.5, Math.min(2, pitch * eventPitch)))); }
  const notes = await readFile(numeric.rawOutputs.notes); assert.equal(notes.readUInt32LE(4), 25); for (const [i, note] of numeric.originalNoteBlockToPacketToEngine.entries()) { assert.equal(notes.readFloatLE(8 + i * 16), note.originalEventPitch); assert.equal(notes.readFloatLE(12 + i * 16), note.transportedPitch); assert.equal(notes.readFloatLE(16 + i * 16), note.originalEnginePitch); assert.equal(notes.readFloatLE(20 + i * 16), 3); }
  const packet = await readFile(numeric.rawOutputs.packet); assert.equal(packet.readUInt32LE(4), numeric.originalPacketBoundaryCases.length); for (const [i, boundary] of numeric.originalPacketBoundaryCases.entries()) { assert.equal(packet.readFloatLE(8 + i * 8), boundary.transportedPitch); assert.equal(packet.readFloatLE(12 + i * 8), boundary.originalEnginePitch); }
  return { path: numericFile, sha256: hash(bytes), engineMathCases: numeric.engineMath.cases, originalNoteEvents: 25, packetBoundaryCases: numeric.originalPacketBoundaryCases.length, finitePrematureFloatCounterexample: numeric.finitePrematureFloatCounterexamples[0] };
}
export async function reviewLwjgl21710Source(filename = file) {
  const report = await parse(filename), discovered = await discoverLwjgl21710(); assert.equal(report.version, '1.7.10'); assert.equal(report.officialSources.clientSha1, discovered.metadata.downloads.client.sha1); assert.equal(report.officialSources.metadataSha1, discovered.metadataSha1); assert.deepEqual(report.roles, discovered.roles); assert.deepEqual(report.facts, lwjgl21710Facts); assert.equal(report.mappings.officialClientMappingsAvailable, false); assert.equal(report.integratedWorldScenesAdded, 0);
  for (const entry of report.classes) { const original = discovered.classes.get(entry.originalName); assert(original); assert.deepEqual(entry.artifact, original.archive.artifact); assert.equal(digest(original.bytes), entry.bytecodeSha1); assert.equal(hash(original.bytes), entry.bytecodeSha256); assert.deepEqual(methodCodeHashes(original.bytes), entry.methods); assert.deepEqual(historicalClassfile(original.bytes).fields.map(({ access, name, descriptor }) => ({ access, name, descriptor })), entry.fields); assert.equal(hash(await readFile(entry.rawClass)), entry.bytecodeSha256); assert.equal(hash(await readFile(entry.rawSource)), entry.sourceSha256); assert.equal(hash(await readFile(entry.rawDisassembly)), entry.disassemblySha256); }
  assert.deepEqual(report.bindings, await bindingsFor(report)); assert.deepEqual(report.resources, await resourceEvidence()); assert.deepEqual(report.native, await nativeEvidence()); assert.deepEqual(report.numericComponents, await numericEvidence()); return report;
}
async function writeReport() {
  const report = await parse('.research/lwjgl21710-source/inventory.json'); report.id = 'java-1.7.10'; report.mappings = { officialClientMappingsAvailable: false, kind: 'manual-original-client-and-official-dependency-role-audit' }; report.bindings = await bindingsFor(report); report.facts = lwjgl21710Facts; report.resources = await resourceEvidence(); report.native = await nativeEvidence(true); report.numericComponents = await numericEvidence(); report.integratedWorldScenesAdded = 0; report.gameRecording = 'pending'; report.limitations = ['No integrated-world PCM or allocated-pool measurement. No recorded coverage inherited from 1.12.2.', 'Only the original server note-block sound-packet path applies pitch byte63; direct client-local sound paths are not globally quantized.', 'Server entity Y and client listener Y use different legacy yOffset conventions; no second eye offset may be added.', '28 normal voices is the original requested upper bound. Native allocation may be lower, and exceeding the pool invokes original channel reuse/stealing.', 'Official Windows x64 OpenAL DLL is byte-identical to the checked 1.12.2 DLL. This is not a new native family; original game callers and LWJGL AL implementation differ.'];
  await writeFile(file, JSON.stringify(report, null, 2) + '\n'); const reviewed = await reviewLwjgl21710Source(); console.log(JSON.stringify({ path: file, classes: reviewed.classes.length, bindings: reviewed.bindings.length, facts: { soundEventArithmetic: reviewed.facts.soundEventArithmetic, pitchTransport: reviewed.facts.pitchTransport }, verified: true }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { if (process.argv.includes('--write')) await writeReport(); else { const result = await reviewLwjgl21710Source(); console.log(JSON.stringify({ version: result.version, classes: result.classes.length, bindings: result.bindings.length, verified: true })); } }
