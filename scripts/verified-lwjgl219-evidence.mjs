import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';

/** Read-only strict consumer. Other releases expose only the separately reviewed narrow fields. */
export async function verifiedLwjgl219Evidence(version = '1.9') {
  const sourceFile = 'docs/evidence/java-1.9-audio-source.json', sourceBytes = await readFile(sourceFile), source = JSON.parse(sourceBytes), boundary = source.releaseBoundary.find(item => item.version === version); assert(boundary, version);
  for (const [file, sha256] of Object.entries(source.reviewSources)) assert.equal(digest(await readFile(file), 'sha256'), sha256, file);
  assert.equal(digest(await readFile(source.rawEvidence.path), 'sha256'), source.rawEvidence.sha256);
  const record = source.classes.find(item => item.version === version); assert(record);
  const metadataFile = `.research/lwjgl219-source/${version}/official-metadata.json`, metadataBytes = await readFile(metadataFile); assert.equal(digest(metadataBytes), record.officialSources.metadataSha1); const metadata = JSON.parse(metadataBytes);
  const archives = new Map(), classHashes = new Map();
  for (const c of record.classes) {
    const file = c.artifact.path ? path.join('.research/libraries', c.artifact.path) : `.research/clients/${version}.jar`;
    if (!archives.has(file)) { const bytes = await readFile(file); assert.equal(digest(bytes), c.artifact.sha1, file); archives.set(file, unzipSync(bytes)); }
    const bytes = archives.get(file)[`${c.originalName}.class`]; assert.equal(digest(bytes, 'sha256'), c.classSha256, c.originalName); classHashes.set(c.originalName, methodCodeHashes(bytes));
    assert.equal(digest(await readFile(c.rawDisassembly), 'sha256'), c.disassemblySha256);
  }
  const bindings = source.bindings.filter(item => item.version === version);
  for (const binding of bindings) assert.equal(classHashes.get(binding.owner)[binding.member + binding.descriptor], binding.codeSha256, binding.label);
  const facts = { soundEventArithmetic: 'float-event-scalars', volumeRule: 'category-before-clamp', gainFormula: 'clampFloat(float(float(instanceFloat*eventVolumeFloat)*categoryFloat),0,1)', pitchFormula: 'clampFloat(float(instancePitchFloat*eventPitchFloat),.5,2)', minPitch: .5, maxPitch: 2, notePitchArithmetic: 'double-pow-then-float',
    pitchTransport: boundary.packets.RegisteredSoundPacket.kind === 'float32' ? { kind: 'float' } : { kind: 'unsigned-byte', scale: boundary.packets.RegisteredSoundPacket.scale, minimum: 0, maximum: 255, overflow: 'wrap' },
    namedPitchTransport: boundary.packets.NamedSoundPacket.kind === 'float32' ? { kind: 'float' } : { kind: 'unsigned-byte', scale: boundary.packets.NamedSoundPacket.scale, minimum: 0, maximum: 255, overflow: 'wrap' }, noteSoundTableSize: boundary.noteSoundTableSize };
  let numeric;
  if (version === '1.9') {
    const numericFile = 'docs/evidence/java-1.9-numeric-components.json', numericBytes = await readFile(numericFile); numeric = JSON.parse(numericBytes); assert.equal(numeric.version, version); assert.equal(numeric.officialSources.clientSha1, metadata.downloads.client.sha1);
    for (const [file, sha256] of Object.entries(numeric.sources)) assert.equal(digest(await readFile(file), 'sha256'), sha256, file);
    for (const ref of Object.values(numeric.rawOutputs)) assert.equal(digest(await readFile(ref.path), 'sha256'), ref.sha256, ref.path);
    assert.equal(numeric.engineMath.cases, 1249); assert.equal(numeric.engineMath.strictRawFloatBits, true); assert.equal(numeric.packetBoundaries.actualOriginalConstructorAndNettyWireCases, 150); assert.equal(numeric.originalNoteToPacketToInstanceToEngine.length, 125); assert.deepEqual(numeric.originalMaterialSelection.map(item => item.eventId), [0, 1, 2, 3, 4]); assert.equal(numeric.integratedWorldScenesAdded, 0);
    for (const artifact of numeric.classpathArtifacts) assert.equal(digest(await readFile(path.join('.research/libraries', artifact.path))), artifact.sha1);
    Object.assign(facts, { decoder: 'legacy-jorbis', attenuationModel: 'paulscode-linear', attenuationDistance: 16, noteBlockVolume: 3, masterVolumePlacement: 'listener', sourceRangeScalar: 'unclamped-float-instance-event-product', broadcastRange: 48, broadcastOrigin: 'server-player-entity-position', comparison: 'strict-distance-squared-less-than-range-squared', sameDimensionRequired: true, listenerPositionModel: 'interpolated-client-player-position-plus-original-player-eye-height-getter', standingEyeHeightJavaFloat: Math.fround(1.62), originalRequestedVoicePool: { normal: 28, streaming: 4, notePool: 'normal', actualAllocatedCapacityMeasured: false },
      materials: ['harp', 'basedrum', 'snare', 'hat', 'bass'].map((instrument, eventId) => ({ instrument, eventId, material: ['default/dirt', 'stone', 'sand', 'glass', 'wood'][eventId] })) });
  }
  return { version, facts, verifiedFields: boundary.verifiedFields, fullCallChainReviewed: boundary.fullCallChainReviewed, independentlyUnreviewedFields: boundary.independentlyUnreviewedFields, bindings, sourceEvidence: { path: sourceFile, sha256: digest(sourceBytes, 'sha256') }, ...(numeric ? { numericEvidence: { path: 'docs/evidence/java-1.9-numeric-components.json', sha256: digest(await readFile('docs/evidence/java-1.9-numeric-components.json'), 'sha256') }, componentCounts: { engine: 1249, packetWire: 150, actualNotes: 125, materials: 5 } } : {}), scope: 'Independent source/component evidence only; zero world recordings. Non1.9 releases intentionally omit unreviewed full-chain facts.' };
}
