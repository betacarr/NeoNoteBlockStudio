import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest, verifiedArtifact } from './research-utils.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';

export const historicalAudioPatchVersions = ['1.13.1', '1.13.2', '1.14.1', '1.14.2', '1.14.3'];
const clients = {
  '1.13.1': '8de235e5ec3a7fce168056ea395d21cbdec18d7c',
  '1.13.2': '30bfe37a8db404db11c7edf02cb5165817afb4d9',
  '1.14.1': '55ba86ddcbc3579397f41910463ffd4056e1e523',
  '1.14.2': 'ca6c5a139045967229975c0c0b7f93e78b4314c2',
  '1.14.3': 'af100b34ec7ef2b8b9cf7775b544d21d690dddec',
};
const componentFile = 'docs/evidence/historical-audio-patch-components.json';
const unix = value => value.replaceAll('\\', '/');
const officialArtifacts = metadata => metadata.libraries.flatMap(item => [item.downloads?.artifact, ...Object.values(item.downloads?.classifiers ?? {})]).filter(Boolean);
export function historicalAudioPatchFacts(version) {
  assert(historicalAudioPatchVersions.includes(version));
  const legacy = version.startsWith('1.13');
  return { decoder: legacy ? 'legacy-jorbis' : 'stb', attenuationModel: legacy ? 'paulscode-linear' : 'openal-linear',
    ...(legacy ? {} : { distanceModel: 'linear', referenceDistance: 0, rolloff: 1 }),
    attenuationDistance: 16, noteBlockVolume: 3, minPitch: .5, maxPitch: 2,
    hrtfControl: false, hrtfControlMode: 'device-default', outputLimiter: 'device-default',
    volumeRule: 'category-before-clamp', masterVolumePlacement: 'listener' };
}

async function metadataFor(version, download = false) {
  assert(historicalAudioPatchVersions.includes(version));
  const catalog = JSON.parse(await readFile('src/data/java-releases.json'));
  const release = catalog.versions.find(item => item.id === version); assert.equal(release.type, 'release');
  const sha1 = /\/packages\/([a-f0-9]{40})\//.exec(release.metadataUrl)[1];
  const file = `.research/historical-audio-patches/${version}/official-metadata.json`;
  if (download) await verifiedArtifact({ url: release.metadataUrl, sha1 }, file);
  const bytes = await readFile(file); assert.equal(digest(bytes), sha1);
  const metadata = JSON.parse(bytes); assert.equal(metadata.id, version); assert(!metadata.downloads.client_mappings);
  assert.equal(metadata.downloads.client.sha1, clients[version]); assert.equal(release.clientSha1, clients[version]);
  assert.deepEqual(JSON.parse(await readFile(`.research/metadata/${version}.json`)), metadata);
  return { metadata, metadataSha1: sha1, metadataUrl: release.metadataUrl };
}

function bindingsFor(record, component) {
  const roles = record.roles, legacy = record.version.startsWith('1.13'), bindings = [];
  const add = (role, selector, evidence) => {
    const entry = record.classes.find(item => item.name === (roles[role] ?? role)); assert(entry, `Missing ${role}`);
    const matches = Object.keys(entry.methods).filter(selector); assert.equal(matches.length, 1, `${record.version} ${role}: ${matches}`);
    const key = matches[0], at = key.indexOf('(');
    bindings.push({ role, owner: entry.name, member: key.slice(0, at), descriptor: key.slice(at), codeSha256: entry.methods[key], evidence });
  };
  const instance = component.originalEngineMath.soundInstance, category = component.originalEngineMath.category;
  add('Library', key => key === (legacy ? 'init()V' : 'a()V'), 'Original device/context initialization; alcCreateContext(device,null), no HRTF/reset or limiter attributes');
  add('SoundEngine', key => key === `e(L${instance};)F`, 'Float category multiplication before clamp to 0..1');
  add('SoundEngine', key => key === `d(L${instance};)F`, 'Original pitch clamp to .5..2');
  add('SoundEngine', key => key === `a(L${category};)F`, 'Master/null category returns 1; other categories use original Options');
  add('Options', key => key === `a(L${category};)F`, 'Effective category option lookup, default 1');
  add('SoundEngine', key => key === `c(L${instance};)V`, 'Original play: attenuation range uses raw volume and sample attenuation distance; delegates selected gain/pitch');
  add('SoundEngine', key => key === `a(L${category};F)V`, 'Master category updates listener gain; other categories update or stop source');
  add('NoteBlock', key => /^a\(L.*;II\)Z$/.test(key), 'Original note event; pow(2,(note-12)/12), record category, volume 3');
  add('Instrument', key => key.startsWith('a(L') && key.endsWith(`)L${roles.Instrument};`), 'Original supporting block/material instrument selection');
  add('Instrument', key => key === 'm()Ljava/lang/String;', 'Original serialized instrument name');
  add('MathHelper', key => key === 'a(FFF)F', 'Actual float clamp implementation');
  if (legacy) {
    add('Library', key => key === 'loadSound(Lpaulscode/sound/FilenameURL;)Z', 'Actual configured CodecJOrbis initialize/readAll/cleanup and buffer upload');
    add('Library', key => key === 'setMasterVolume(F)V', 'Master volume at OpenAL listener');
    add('Source', key => key === 'positionChanged()V', 'Original distance refresh and source gain calculation');
    add('Source', key => key === 'c()V', 'Original Java float differences and Euclidean distance calculation');
    add('Source', key => key === 'd()V', 'Original linear attenuation with range clamp');
  } else {
    add('Library', key => key === 'f()J', 'Original regular device opener');
    add('Channel', key => key === 'c(F)V', 'Per-source linear clamped distance, reference 0, rolloff 1, requested maximum distance');
    add('Channel', key => key === 'a(F)V', 'AL_PITCH');
    add('Channel', key => key === 'b(F)V', 'AL_GAIN');
    add('Listener', key => key === 'a(F)V', 'OpenAL listener AL_GAIN');
    add('Decoder', key => key === 'b()Ljava/nio/ByteBuffer;', 'Original STB pushdata read-all PCM16');
    add(roles.Decoder + '$a', key => key === 'a(F)V', 'Original float*32767.5-.5 then truncation and signed-short clamp');
    add('SoundEngine', key => key === `a(L${instance};)V`, 'Original stop: .1 removes active/expiry immediately; .2/.3 defer cleanup');
    add('SoundEngine', key => key === 'h()V', 'Original tick cleanup: .2 fixes category member removal to sound instance');
  }
  return bindings;
}

async function checkComponents(version, report, metadata) {
  const bytes = await readFile(componentFile); assert.equal(digest(bytes, 'sha256'), report.components.sha256);
  const all = JSON.parse(bytes); assert.equal(all.integratedWorldScenesAdded, 0);
  for (const [file, sha256] of Object.entries(all.sources)) assert.equal(digest(await readFile(file), 'sha256'), sha256, `Component source changed: ${file}; rerun original probes`);
  const result = all.records.find(item => item.version === version); assert(result); assert.equal(result.clientSha1, clients[version]);
  assert.equal(result.originalEngineMath.cases, 1005); assert.equal(result.originalEngineMath.exact, true);
  assert.equal(digest(await readFile(`.local/historical-audio-patch-methods/${version}/original-math.bin`), 'sha256'), result.originalEngineMath.pcmSha256);
  if (version.startsWith('1.13')) {
    assert.equal(result.originalSourceGain.cases, 2005); assert.equal(result.originalSourceGain.exact, true);
    assert.equal(digest(await readFile(`.local/historical-audio-patch-methods/${version}/original-source-gain.bin`), 'sha256'), result.originalSourceGain.outputSha256);
  } else {
    const fixed = version !== '1.14.1';
    assert.deepEqual(result.originalLifecycle.observations, [
      { phase: 'STOP', active: fixed ? 1 : 0, expiry: fixed ? 1 : 0, categoryMembers: 1, queuedCallbacks: 1 },
      { phase: 'FINISHED', active: 0, expiry: 0, categoryMembers: fixed ? 0 : 1, queuedCallbacks: 0 },
    ]);
  }
  const codecBytes = await readFile(`.local/historical-audio-patch-methods/${version}/original-codec.pcm`);
  assert.equal(codecBytes.readUInt32LE(4), result.originalCodec.samples.length);
  assert.equal(result.originalCodec.samples.length, version.startsWith('1.13') ? 11 : 16);
  const indexBytes = await readFile(`.local/game-fixtures/${version}/minecraft/assets/indexes/${metadata.assetIndex.id}.json`).catch(() => undefined);
  const fixture = JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`));
  const actualIndex = indexBytes ?? await readFile(path.join(fixture.root, 'assets/indexes', `${metadata.assetIndex.id}.json`));
  assert.equal(digest(actualIndex), metadata.assetIndex.sha1); const index = JSON.parse(actualIndex);
  let offset = 8;
  for (const sample of result.originalCodec.samples) {
    assert.equal(codecBytes.readUInt32LE(offset), sample.rate); assert.equal(codecBytes.readUInt32LE(offset + 4), sample.channels); assert.equal(codecBytes.readUInt32LE(offset + 8), sample.bytes); offset += 12;
    assert.equal(digest(codecBytes.subarray(offset, offset + sample.bytes), 'sha256'), sample.originalPcmSha256); offset += sample.bytes;
    assert.equal(sample.originalPcmSha256, sample.productionPcmSha256); assert.equal(sample.exact, true);
    const object = index.objects[fixture.sounds[sample.id].path]; assert.equal(object.hash, sample.sha1);
    assert.equal(digest(await readFile(path.join(fixture.root, 'assets/objects', sample.sha1.slice(0, 2), sample.sha1))), sample.sha1);
  }
  assert.equal(offset, codecBytes.length);
  const artifacts = officialArtifacts(metadata);
  for (const [filename, native] of Object.entries(result.nativeLibraries)) {
    const official = artifacts.find(item => item.path === native.artifact.path); assert.deepEqual(official, native.artifact);
    const archive = await readFile(path.join(fixture.root, 'libraries', official.path)); assert.equal(digest(archive), official.sha1);
    assert(Object.entries(unzipSync(archive)).some(([name, value]) => path.basename(name).toLowerCase() === filename.toLowerCase() && digest(value, 'sha256') === native.sha256));
    assert.equal(digest(await readFile(path.join(fixture.nativeDir, filename)), 'sha256'), native.sha256);
  }
  assert.deepEqual(result.nativeLibraries, report.nativeLibraries);
  return result;
}

/** Offline, strict cached validation for facts generators; never inherits world results. */
export async function reviewHistoricalAudioPatch(version, filename = `docs/evidence/java-${version}-audio-source.json`) {
  const report = JSON.parse(await readFile(filename)), { metadata, metadataSha1, metadataUrl } = await metadataFor(version);
  assert.equal(report.version, version); assert.equal(report.clientSha1, clients[version]);
  assert.equal(report.officialSources.metadataSha1, metadataSha1); assert.equal(report.officialSources.metadataUrl, metadataUrl);
  assert.equal(report.officialSources.clientUrl, metadata.downloads.client.url); assert.equal(report.officialSources.clientSha1, clients[version]);
  assert.equal(report.mappings.officialClientMappingsAvailable, false); assert.equal(report.integratedWorldScenesAdded, 0);
  assert.deepEqual(report.facts, historicalAudioPatchFacts(version));
  const client = await readFile(`.research/clients/${version}.jar`); assert.equal(digest(client), clients[version]);
  const archives = new Map([[clients[version], unzipSync(client)]]), artifacts = officialArtifacts(metadata), checked = new Map();
  for (const entry of report.classes) {
    let archive = archives.get(entry.artifact?.sha1 ?? clients[version]);
    if (entry.artifact) {
      assert.deepEqual(artifacts.find(item => item.path === entry.artifact.path), entry.artifact);
      if (!archive) { const bytes = await readFile(path.join('.local/game-fixtures', version, 'libraries', entry.artifact.path)); assert.equal(digest(bytes), entry.artifact.sha1); archive = unzipSync(bytes); archives.set(entry.artifact.sha1, archive); }
    }
    const bytes = archive[entry.originalName.replaceAll('.', '/') + '.class']; assert(bytes);
    assert.equal(digest(bytes), entry.bytecodeSha1); assert.equal(digest(bytes, 'sha256'), entry.bytecodeSha256);
    assert.deepEqual(methodCodeHashes(bytes), entry.methods); checked.set(entry.originalName, entry);
    if (entry.rawSource) assert.equal(digest(await readFile(entry.rawSource), 'sha256'), entry.rawSourceSha256);
    if (entry.rawDisassembly) assert.equal(digest(await readFile(entry.rawDisassembly), 'sha256'), entry.disassemblySha256);
  }
  for (const binding of report.bindings) assert.equal(checked.get(binding.owner)?.methods[binding.member + binding.descriptor], binding.codeSha256);
  const component = await checkComponents(version, report, metadata);
  const record = { version, roles: report.roles, classes: report.classes.map(item => ({ ...item, name: item.originalName })) };
  assert.deepEqual(report.bindings, bindingsFor(record, component));
  return report;
}

async function writeReports() {
  const inventory = JSON.parse(await readFile('.research/historical-audio-patches/inventory.json'));
  const componentBytes = await readFile(componentFile), components = JSON.parse(componentBytes);
  for (const version of historicalAudioPatchVersions) {
    const record = inventory.records.find(item => item.version === version), component = components.records.find(item => item.version === version);
    const { metadata, metadataSha1, metadataUrl } = await metadataFor(version, true);
    const client = await readFile(`.research/clients/${version}.jar`); assert.equal(digest(client), clients[version]); const archive = unzipSync(client);
    const classes = record.classes.map(item => ({ ...item, originalName: item.name, bytecodeSha256: digest(archive[item.name + '.class'], 'sha256'), rawSource: `.research/historical-audio-patches/${version}/source/${item.name}.java`, rawDisassembly: `.research/historical-audio-patches/${version}/${item.name}.javap.txt` }));
    if (version.startsWith('1.13')) {
      const artifacts = officialArtifacts(metadata);
      for (const [artifactName, names] of [['codecjorbis', ['paulscode.sound.codecs.CodecJOrbis']], ['soundsystem', ['paulscode.sound.Source', 'paulscode.sound.Library', 'paulscode.sound.SoundSystem', 'paulscode.sound.SoundSystemConfig']]]) {
        const artifact = artifacts.find(item => item.path.includes(`/${artifactName}/`)); assert(artifact);
        const bytes = await readFile(path.join('.local/game-fixtures', version, 'libraries', artifact.path)); assert.equal(digest(bytes), artifact.sha1); const entries = unzipSync(bytes);
        for (const originalName of names) { const code = entries[originalName.replaceAll('.', '/') + '.class']; assert(code); classes.push({ originalName, role: 'original-paulscode-dependency', artifact, bytecodeSha1: digest(code), bytecodeSha256: digest(code, 'sha256'), methods: methodCodeHashes(code) }); }
      }
    }
    const report = { schema: 1, version, clientSha1: clients[version], officialSources: { manifestUrl: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', metadataUrl, metadataSha1, clientUrl: metadata.downloads.client.url, clientSha1: clients[version], assetIndex: metadata.assetIndex },
      mappings: { kind: 'manual-original-bytecode-role-audit', officialClientMappingsAvailable: false, limitation: 'Manual semantic role names, bound to original class bytes and Code attributes; no unofficial or adjacent-release mapping is described as official.' },
      roles: record.roles, classes, bindings: bindingsFor(record, component), facts: historicalAudioPatchFacts(version),
      components: { path: componentFile, sha256: digest(componentBytes, 'sha256'), originalMathCases: 1005, originalSourceCases: component.originalSourceGain?.cases ?? 0, originalCodecSamples: component.originalCodec.samples.length, syntheticLifecycleProbe: Boolean(component.originalLifecycle) },
      nativeLibraries: component.nativeLibraries, integratedWorldScenesAdded: 0, gameRecording: 'pending',
      findings: { sourceGain: 'Java float category multiplication before clamp; master uses listener gain', pitch: 'instance pitch clamped .5..2; note event pow(2,(note-12)/12)', range: 'raw volume above 1 scales sample attenuation_distance; vanilla default 16 and note volume 3 yield max distance 48', context: 'original context receives null attributes; game exposes neither HRTF selection nor output limiter request',
        instruments: version.startsWith('1.13') ? '10 material-selected instruments; 11 canonical files decoded because pling exists as a resource but is not a supporting-block instrument' : '16 original material-selected instruments',
        lifecycle: version === '1.14.1' ? 'stop removes active/expiry immediately; finished cleanup passes channel handle instead of sound instance to category removal' : version.startsWith('1.14') ? 'stop retains bookkeeping until tick; finished cleanup removes actual sound instance from category multimap (fix introduced in 1.14.2)' : 'Full original Paulscode Library/Source/Channel path reviewed; original dependency codec/source invoked',
        nativeBoundary: version === '1.14.3' ? 'LWJGL 3.2.2 ships different OpenAL and STB binaries from 1.14.2; exact sample decoding is measured, full native mixer equivalence is not established' : 'Native archive and extracted DLL identities checked; dependency identity alone is not used as a behavior proof' },
      scopeLimitations: ['Selected audio core source review and isolated original-component checks; no integrated-world or native-mixer recording is inherited from any anchor version.', 'Broadcast/server/player/camera path has not been reviewed for these patch versions; no broadcast or standing-eye-height facts are supplied.', 'For STB versions CFR fails on the static-buffer lambda; original raw instructions and all class Code hashes are retained.', 'HRTF and limiter device-default are request policies, not claims that the actual backend state is disabled.', 'Synthetic lifecycle probe does not execute queued native callbacks or measure playback timing.'],
    };
    await mkdir('docs/evidence', { recursive: true }); const filename = `docs/evidence/java-${version}-audio-source.json`; await writeFile(filename, JSON.stringify(report, null, 2) + '\n');
    const verified = await reviewHistoricalAudioPatch(version, filename); console.log(JSON.stringify({ version, classes: verified.classes.length, bindings: verified.bindings.length, evidence: filename, integratedWorldScenesAdded: 0 }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) await writeReports();
  else for (const version of historicalAudioPatchVersions) { const report = await reviewHistoricalAudioPatch(version); console.log(JSON.stringify({ version, classes: report.classes.length, bindings: report.bindings.length, verified: true })); }
}
