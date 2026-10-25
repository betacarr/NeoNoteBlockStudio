import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest, verifiedArtifact } from './research-utils.mjs';
import { lwjgl219Root } from './audit-lwjgl219-source.mjs';

const parse = async file => JSON.parse(await readFile(file));
export function originalSection(text, owner, key) {
  const at = key.indexOf('('), member = key.slice(0, at), descriptor = key.slice(at), lines = text.split(/\r?\n/);
  const escaped = (member === '<init>' ? owner.split('/').at(-1) : member).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const begin = lines.findIndex((line, index) => line.trim() === `descriptor: ${descriptor}` && (member === '<clinit>' ? /static \{\};/.test(lines[index - 1]) : new RegExp(`\\b${escaped}\\(`).test(lines[index - 1]))); assert(begin >= 0, owner + '.' + key);
  let end = begin + 1; while (end < lines.length && !/^  (?:public|private|protected|static|synchronized)/.test(lines[end]) && lines[end] !== '}') end++;
  return lines.slice(begin - 1, end).join('\n');
}
export async function reviewLwjgl219() {
  const versions = ['1.9', '1.9.1', '1.9.2', '1.9.3', '1.9.4', '1.10', '1.10.1', '1.10.2', '1.11', '1.11.1', '1.11.2', '1.12', '1.12.1', '1.12.2'];
  const records = [], bindings = [], texts = new Map();
  for (const version of versions) {
    const record = await parse(`${lwjgl219Root}/${version}/inventory.json`); assert.equal(record.version, version);
    const metadataFile = `${lwjgl219Root}/${version}/official-metadata.json`; assert.equal(digest(await readFile(metadataFile)), record.officialSources.metadataSha1);
    const metadata = await parse(metadataFile); assert.equal(metadata.downloads.client.sha1, record.officialSources.clientSha1);
    for (const c of record.classes) {
      assert.equal(digest(await readFile(c.rawClass), 'sha256'), c.classSha256);
      const raw = await readFile(c.rawDisassembly); assert.equal(digest(raw, 'sha256'), c.disassemblySha256); texts.set(`${version}:${c.originalName}`, raw.toString('utf8'));
      const archive = c.artifact.path ? path.join('.research/libraries', c.artifact.path) : `.research/clients/${version}.jar`;
      await verifiedArtifact(c.artifact, archive); const code = unzipSync(await readFile(archive), { filter: entry => entry.name === `${c.originalName}.class` })[`${c.originalName}.class`];
      assert.equal(digest(code, 'sha256'), c.classSha256);
    }
    records.push(record);
  }
  const add = (record, label, role, key, tokens = []) => {
    const owner = record.roles[role], c = record.classes.find(item => item.originalName === owner); assert(c, `${record.version} ${role}`); assert(c.methods[key], key);
    const text = originalSection(texts.get(`${record.version}:${owner}`), owner, key); for (const token of tokens) assert(text.includes(token), `${record.version} ${label}: ${token}`);
    const at = key.indexOf('('); bindings.push({ version: record.version, label, role, owner, member: key.slice(0, at), descriptor: key.slice(at), codeSha256: c.methods[key], semanticInstructionChecks: tokens }); return text;
  };
  const choose = (record, label, role, predicate, tokens = []) => {
    const owner = record.roles[role], c = record.classes.find(item => item.originalName === owner), candidates = Object.keys(c.methods).filter(key => predicate(key, originalSection(texts.get(`${record.version}:${owner}`), owner, key)));
    assert.equal(candidates.length, 1, `${record.version} ${label}: ${candidates}`); return { key: candidates[0], text: add(record, label, role, candidates[0], tokens) };
  };
  const boundary = [];
  for (const record of records) {
    const beforeFloatWire = /^1\.9(?:\.|$)/.test(record.version), earlyRegistered = ['1.9', '1.9.1', '1.9.2'].includes(record.version), packetFacts = {};
    for (const role of ['NamedSoundPacket', 'RegisteredSoundPacket']) {
      const ctor = choose(record, `${role}-constructor`, role, key => key.startsWith('<init>(') && key.includes('DDDFF')).text;
      const stores = [...ctor.matchAll(/putfield[^\n]+Field (\w+):([IF])/g)], pitchField = stores.at(-1)[1], pitchType = stores.at(-1)[2];
      const scale = beforeFloatWire ? role === 'RegisteredSoundPacket' && earlyRegistered ? 63.5 : 63 : undefined;
      if (beforeFloatWire) {
        assert.equal(pitchType, 'I'); assert(ctor.includes(`float ${scale.toFixed(1)}f`)); assert(ctor.includes('f2i'));
        assert.equal((ctor.match(new RegExp(`putfield[^\\n]+Field ${pitchField}:I`, 'g')) ?? []).length, 1);
        assert(ctor.lastIndexOf(`Field ${pitchField}:I`) < ctor.indexOf(`${record.roles.MathHelper}.a:(FFF)F`));
      } else { assert.equal(pitchType, 'F'); assert(!ctor.includes('f2i')); }
      add(record, `${role}-actual-read`, role, `a(L${record.roles.PacketBuffer};)V`, beforeFloatWire ? ['readUnsignedByte:()S', 'readFloat:()F'] : ['readFloat:()F']);
      const write = add(record, `${role}-actual-write`, role, `b(L${record.roles.PacketBuffer};)V`, beforeFloatWire ? ['writeByte:', 'writeFloat:'] : ['writeFloat:']);
      const getter = choose(record, `${role}-pitch-getter`, role, (key, text) => key.endsWith('()F') && text.includes(`Field ${pitchField}:${pitchType}`), beforeFloatWire ? ['i2f', 'fdiv'] : ['freturn']);
      if (!beforeFloatWire) assert.equal((write.match(/writeFloat:/g) ?? []).length, 2);
      packetFacts[role] = { originalClass: record.roles[role], pitchField, pitchFieldType: pitchType, kind: beforeFloatWire ? 'unsigned-byte-low8' : 'float32', ...(scale ? { scale, constructorClampDoesNotChangeStoredField: true } : {}), getter: getter.key };
    }
    const instance = record.roles.SoundInstance, engineGain = choose(record, 'float-instance-category-before-clamp', 'SoundEngine', (key, text) => key.endsWith(`(L${instance};)F`) && text.includes('fmul') && text.includes('(FFF)F'), ['fmul', 'fconst_0', 'fconst_1']).text;
    const enginePitch = choose(record, 'float-instance-pitch-clamp', 'SoundEngine', (key, text) => key.endsWith(`(L${instance};)F`) && text.includes('float 0.5f'), ['fconst_2', '(FFF)F']).text;
    assert(!engineGain.includes('dmul')); assert(!enginePitch.includes('dmul'));
    const volumeGetter = new RegExp(`${instance}\\.(\\w+):\\(\\)F`).exec(engineGain)[1], pitchGetter = new RegExp(`${instance}\\.(\\w+):\\(\\)F`).exec(enginePitch)[1];
    add(record, 'instance-event-float-volume-product', 'AbstractSound', `${volumeGetter}()F`, [`${record.roles.SoundDefinition}.`, '()F', 'fmul']);
    add(record, 'instance-event-float-pitch-product', 'AbstractSound', `${pitchGetter}()F`, [`${record.roles.SoundDefinition}.`, '()F', 'fmul']);
    choose(record, 'sound-event-float-definition', 'SoundDefinition', key => key.startsWith('<init>(Ljava/lang/String;FFI'), ['putfield']);
    const noteEvent = choose(record, 'original-note-pow-round-before-world-event', 'NoteBlock', (key, text) => key.endsWith('II)Z') && text.includes('java/lang/Math.pow:'), ['d2f', 'float 3.0f']).text;
    const noteTable = add(record, 'original-note-sound-table', 'NoteBlock', '<clinit>()V', [record.version.startsWith('1.12') ? 'bipush        10' : 'iconst_5']);
    const material = choose(record, 'original-support-material-trigger', 'TileEntityNote', (key, text) => key.endsWith(';)V') && text.includes('iconst_4') && text.includes(';II)V')).text;
    boundary.push({ version: record.version, officialSources: record.officialSources, packets: packetFacts, arithmetic: 'float32(instanceFloat * eventFloat), then float32(product * categoryFloat), then clampFloat(0,1); pitch float32(instancePitch * eventPitch), then clampFloat(.5,2)', notePitch: 'float32(pow(2,(note-12)/12)) before world dispatch', noteSoundTableSize: record.version.startsWith('1.12') ? 10 : 5,
      verifiedFields: ['named/registered packet constructor, wire read/write and pitch getter', 'instance/event float multiplication and engine gain/pitch clamp order', 'NoteBlock pow float rounding', 'note event table size and tile trigger Code'],
      fullCallChainReviewed: record.version === '1.9', independentlyUnreviewedFields: record.version === '1.9' ? ['native context/extension runtime and actual voice capacity'] : ['actual server registered dispatch and client instance route', 'master/listener/range', 'individual material/block identities', 'codec caller and source pool', 'native/context/runtime'],
      sourceBindings: bindings.filter(item => item.version === record.version).map(({ label, owner, member, descriptor, codeSha256 }) => ({ label, owner, member, descriptor, codeSha256 })) });
  }
  const record = records[0];
  add(record, 'original-codec-registration', 'SoundEngine', '<init>(Lbyx;Lbch;)V', ['class paulscode/sound/libraries/LibraryLWJGLOpenAL', 'class paulscode/sound/codecs/CodecJOrbis', 'SoundSystemConfig.setCodec:']);
  const nested = add(record, 'original-nested-event-direct-delegation', 'NestedSoundAccessor', 'a()Lbyf;', ['byz.a:()Lbyf;', 'areturn']); assert(!nested.includes('fmul')); assert(!nested.includes('class byf'));
  add(record, 'original-json-float-scalars', 'SoundSerializer', 'b(Lcom/google/gson/JsonObject;)Lbyf;', ['String volume', 'String pitch', '(Lcom/google/gson/JsonObject;Ljava/lang/String;F)F']);
  add(record, 'world-half-block-center', 'World', 'a(Lzj;Lcj;Lnf;Lnh;FF)V', ['double 0.5d', 'a:(Lzj;DDDLnf;Lnh;FF)V']);
  add(record, 'world-actual-listener-dispatch', 'World', 'a(Lzj;DDDLnf;Lnh;FF)V', ['ahv.a:(Lzj;Lnf;Lnh;DDDFF)V']);
  add(record, 'server-actual-registered-packet-radius', 'ServerWorldListener', 'a(Lzj;Lnf;Lnh;DDDFF)V', ['float 16.0f', 'fmul', 'class hz', 'mm.a:(Lzj;DDDDILff;)V']);
  add(record, 'server-strict-entity-distance', 'PlayerList', 'a(Lzj;DDDDILff;)V', ['Field lr.p:D', 'Field lr.q:D', 'Field lr.r:D', 'Field lr.am:I', 'dcmpg', 'ifge']);
  add(record, 'client-registered-packet-to-world', 'ClientPacketHandler', 'a(Lhz;)V', ['hz.g:()F', 'bku.a:(Lzj;DDDLnf;Lnh;FF)V']);
  add(record, 'client-named-packet-route', 'ClientPacketHandler', 'a(Lgi;)V', ['gi.g:()F', 'bye."<init>":(Lkk;Lnh;FFZILbyi$a;FFF)V']);
  add(record, 'client-original-instance-construction', 'ClientWorld', 'a(DDDLnf;Lnh;FFZ)V', ['class bye', 'bye."<init>":(Lnf;Lnh;FFFFF)V']);
  add(record, 'client-null-player-does-not-repeat-raw-note', 'ClientWorld', 'a(Lzj;DDDLnf;Lnh;FF)V', ['if_acmpne', 'a:(DDDLnf;Lnh;FFZ)V']);
  add(record, 'actual-positioned-volume-pitch-store', 'PositionedSound', '<init>(Lkk;Lnh;FFZILbyi$a;FFF)V', ['Field d:F', 'Field e:F']);
  add(record, 'category-master-null-unity', 'SoundEngine', 'a(Lnh;)F', ['Field nh.a:Lnh;', 'fconst_1', 'bch.a:(Lnh;)F']);
  add(record, 'category-option-float-getter', 'Options', 'a(Lnh;)F', ['java/lang/Float.floatValue:()F']);
  add(record, 'master-listener-owner', 'SoundEngine', 'a(Lnh;F)V', ['setMasterVolume:(F)V']);
  add(record, 'loader-initial-master-listener', 'EngineLoader', 'run()V', ['setMasterVolume:(F)V']);
  add(record, 'original-listener-interpolation-and-eye-height', 'SoundEngine', 'a(Lzj;F)V', ['Field zj.m:D', 'Field zj.n:D', 'Field zj.o:D', 'zj.bn:()F', 'dadd', 'd2f', 'setListenerPosition:(FFF)V']);
  add(record, 'original-standing-eye-height', 'Player', 'bn()F', ['float 1.62f']);
  add(record, 'original-note-record-category', 'Category', '<clinit>()V', ['String record', 'Field e:Lnh;']);
  add(record, 'original-five-event-identities', 'SoundEvents', '<clinit>()V', ['String block.note.harp', 'String block.note.basedrum', 'String block.note.snare', 'String block.note.hat', 'String block.note.bass']);
  add(record, 'original-support-block-registration', 'Blocks', '<clinit>()V', ['String dirt', 'String stone', 'String sand', 'String glass', 'String planks']);
  add(record, 'original-raw-instance-source-range', 'SoundEngine', 'c(Lbyi;)V', ['byi.g:()F', 'float 16.0f', 'fmul', 'newSource:']);
  add(record, 'original-library-default-create', 'Library', 'init()V', ['org/lwjgl/openal/AL.create:()V']);
  add(record, 'original-library-master-al-gain', 'Library', 'setMasterVolume(F)V', ['AL10.alListenerf:(IF)V']);
  add(record, 'original-jorbis-readall', 'CodecJOrbis', 'readAll()Lpaulscode/sound/SoundBuffer;'); assert(texts.get(`1.9:${record.roles.CodecJOrbis}`).includes('com/jcraft/jorbis/'));
  add(record, 'original-library-decode-upload', 'Library', 'loadSound(Lpaulscode/sound/FilenameURL;)Z', ['readAll:', 'alBufferData:']);
  add(record, 'original-source-java-distance', 'Source', 'calculateDistance()V', ['fsub', 'f2d', 'java/lang/Math.sqrt:(D)D', 'd2f']);
  add(record, 'original-source-java-linear-gain', 'Source', 'calculateGain()V', ['fdiv', 'fsub']);
  add(record, 'original-requested-source-pool', 'SoundSystemConfig', '<clinit>()V', ['bipush        28', 'iconst_4']);

  const metadata = await parse(`${lwjgl219Root}/1.9/official-metadata.json`), assetRoot = `${lwjgl219Root}/1.9/assets`; await mkdir(assetRoot, { recursive: true });
  await verifiedArtifact(metadata.assetIndex, `${assetRoot}/index.json`); const index = await parse(`${assetRoot}/index.json`), definition = index.objects['minecraft/sounds.json']; assert(definition);
  await verifiedArtifact({ url: `https://resources.download.minecraft.net/${definition.hash.slice(0, 2)}/${definition.hash}`, sha1: definition.hash }, `${assetRoot}/sounds.json`);
  const sounds = await parse(`${assetRoot}/sounds.json`), samples = [];
  for (const event of ['harp', 'basedrum', 'snare', 'hat', 'bass']) {
    const key = `block.note.${event}`, entry = sounds[key]; assert(entry); assert.equal(entry.sounds.length, 1); const sound = typeof entry.sounds[0] === 'string' ? { name: entry.sounds[0] } : entry.sounds[0];
    const assetKey = `minecraft/sounds/${sound.name}.ogg`, object = index.objects[assetKey]; assert(object, assetKey); const file = `${assetRoot}/${event}.ogg`;
    await verifiedArtifact({ url: `https://resources.download.minecraft.net/${object.hash.slice(0, 2)}/${object.hash}`, sha1: object.hash }, file);
    samples.push({ event: key, categoryFromOriginalNoteBlock: 'record', entry, sample: { key: assetKey, sha1: object.hash, bytes: (await readFile(file)).length }, scalarDefaults: { volume: sound.volume ?? 1, pitch: sound.pitch ?? 1 } });
  }
  const nativeItem = metadata.libraries.find(item => item.name.startsWith('org.lwjgl.lwjgl:lwjgl-platform:') && item.downloads?.classifiers?.['natives-windows'] && !item.rules?.some(rule => rule.action === 'allow' && rule.os?.name === 'osx'));
  assert(nativeItem); const nativeArtifact = nativeItem.downloads.classifiers['natives-windows'], nativeFile = path.join('.research/libraries', nativeArtifact.path); await verifiedArtifact(nativeArtifact, nativeFile);
  const nativeArchive = unzipSync(await readFile(nativeFile));
  const report = {
    schema: 1, version: '1.9', checkedAt: new Date().toISOString(), officialSources: record.officialSources,
    mappings: { officialClientMappingsAvailable: false, kind: 'independent-original-class-descriptor-and-Code-audit', limitation: 'Role labels are manual semantic descriptions, not adjacent-version mappings.' },
    findings: { registeredPitchTransport: '1.9..1.9.2 low8 unsigned byte /63.5; 1.9.3..1.9.4 low8 /63; 1.10..1.12.2 original float32', namedPitchTransport: '1.9..1.9.4 low8 unsigned byte /63; 1.10..1.12.2 original float32', instanceEventArithmetic: 'float32 instance/event products in AbstractSound; float32 category multiplication before clamp in SoundEngine', nestedReferencesIn19: 'Original byx$2 delegates directly to the referenced byz; unlike1.8 it does not multiply outer event-reference volume/pitch scalars', masterIn19: 'Original Options master is applied to Paulscode/OpenAL listener; category helper treats MASTER/null as unity for source gain', noteSoundTableCount: 'Five entries in1.9..1.11.2; ten first appear in release1.12; individual support identities outside1.9 are not certified by this narrow audit', decoderIn19: 'Official Paulscode CodecJOrbis registration and readAll/upload chain, not STB', deliveryIn19: 'Original note volume3 produces radius48 using player entity strict squared distance in same dimension; distinct from block notification radius', listenerIn19: 'Interpolated player double position plus original float eye-height getter, then final float listener coordinates; standing eye getter1.62f', voicePoolIn19: 'Paulscode requests28 normal+4 streaming; actual allocated capacity is unmeasured here' },
    roles: record.roles, bindings, releaseBoundary: boundary, resources: { assetIndex: metadata.assetIndex, soundsDefinitionSha1: definition.hash, samples },
    nativeIdentity: { artifact: nativeArtifact, openal64Sha256: digest(nativeArchive['OpenAL64.dll'], 'sha256'), lwjgl64Sha256: digest(nativeArchive['lwjgl64.dll'], 'sha256'), scope: 'Identity only; no native context or extension/runtime measurement in this source audit.' },
    classes: records.map(item => ({ version: item.version, officialSources: item.officialSources, classes: item.classes })),
    integratedWorldScenesAdded: 0, numericComponentsExecuted: false,
    limitations: ['Original classes and dependency bytes are checked against official metadata; raw javap remains ignored.', 'This is source evidence, not execution of the engine/world/codec/native mixer. Numeric components are a separate follow-up.', 'No game instance, new profile, facts generator or product source has been changed.'],
  };
  const raw = `${lwjgl219Root}/review.json`; await writeFile(raw, JSON.stringify(report, null, 2));
  const sourceFiles = ['scripts/audit-lwjgl219-source.mjs', 'scripts/review-lwjgl219-source.mjs', 'scripts/historical-classfile.mjs', 'scripts/audit-early-world.mjs', 'scripts/research-utils.mjs'];
  report.reviewSources = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, digest(await readFile(file), 'sha256')])));
  report.rawEvidence = { path: raw, sha256: digest(await readFile(raw), 'sha256') };
  await writeFile('docs/evidence/java-1.9-audio-source.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: 'docs/evidence/java-1.9-audio-source.json', releases: records.length, classes: records.reduce((sum, item) => sum + item.classes.length, 0), bindings: bindings.length, worldScenes: 0 }));
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await reviewLwjgl219();
