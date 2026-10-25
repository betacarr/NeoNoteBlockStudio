import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';

// A separate source-evidence generator. It never edits the shared product facts.
const version = '1.13', manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const manifest = await fetch(manifestUrl, { signal: AbortSignal.timeout(20000) }).then(r => { assert(r.ok); return r.json(); });
const release = manifest.versions.find(item => item.id === version); assert(release);
const metadataBytes = Buffer.from(await fetch(release.url, { signal: AbortSignal.timeout(20000) }).then(r => { assert(r.ok); return r.arrayBuffer(); }));
assert.equal(digest(metadataBytes), release.sha1);
const metadata = JSON.parse(metadataBytes); assert.equal(metadata.downloads.client_mappings, undefined);
const client = path.resolve('.local/game-fixtures/1.13/versions/1.13/1.13.jar'), clientBytes = await readFile(client);
assert.equal(digest(clientBytes), metadata.downloads.client.sha1); assert.equal(digest(clientBytes), 'c0b970952cdd279912da384cdbfc0c26e6c6090b');
const classes = unzipSync(clientBytes), sourceRoot = path.resolve('.research/legacy/1.13/world-delivery-source'); await mkdir(sourceRoot, { recursive: true });
const namedClasses = { NoteBlock: 'bfw', World: 'axs', ServerWorld: 'tc', ServerWorldEventHandler: 'td', PlayerList: 'vo', Player: 'aoc', Entity: 'aeo', SoundManager: 'dgh', IntegratedServer: 'dfx' };
const classEvidence = {};
for (const [label, name] of Object.entries(namedClasses)) {
  const bytes = classes[name + '.class']; assert(bytes, name);
  const result = spawnSync('javap', ['-p', '-c', '-s', '-classpath', client, name], { windowsHide: true, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  await writeFile(path.join(sourceRoot, name + '.class'), bytes); await writeFile(path.join(sourceRoot, name + '.javap.txt'), result.stdout);
  classEvidence[label] = { originalClass: name, classSha1: digest(bytes), javapSha256: digest(Buffer.from(result.stdout), 'sha256'), text: result.stdout };
}
function method(label, name, descriptor) {
  const lines = classEvidence[label].text.split(/\r?\n/);
  const at = lines.findIndex((line, i) => line.trim() === `descriptor: ${descriptor}` && new RegExp(`\\b${name}\\(`).test(lines[i - 1]));
  assert(at >= 0, `${label}.${name}${descriptor}`);
  let end = at + 1; while (end < lines.length && !/^  (?:public|protected|private|static)/.test(lines[end]) && lines[end] !== '}') end++;
  return { originalClass: classEvidence[label].originalClass, originalMethod: name, descriptor, bytecode: lines.slice(at - 1, end).join('\n').trimEnd() };
}
const noteEvent = method('NoteBlock', 'a', '(Lbkt;Laxs;Lej;II)Z');
const blockCenter = method('World', 'a', '(Laoc;Lej;Lwh;Lwj;FF)V');
const listeners = method('World', 'a', '(Laoc;DDDLwh;Lwj;FF)V');
const worldListener = method('ServerWorldEventHandler', 'a', '(Laoc;Lwh;Lwj;DDDFF)V');
const deliver = method('PlayerList', 'a', '(Laoc;DDDDILiv;)V');
const eye = method('Player', 'bF', '()F');
const listenerPose = method('SoundManager', 'a', '(Laoc;F)V');
const blockEvents = method('ServerWorld', 'am', '()V');
const registerWorldListener = method('IntegratedServer', 'a', '(Ljava/lang/String;Ljava/lang/String;JLaxz;Lcom/google/gson/JsonElement;)V');
assert(noteEvent.bytecode.includes('float 3.0f') && noteEvent.bytecode.includes('axs.a:(Laoc;Lej;Lwh;Lwj;FF)V'));
assert((blockCenter.bytecode.match(/double 0\.5d/g) ?? []).length === 3 && /Method (?:axs\.)?a:\(Laoc;DDDLwh;Lwj;FF\)V/.test(blockCenter.bytecode));
assert(listeners.bytecode.includes('axv.a:(Laoc;Lwh;Lwj;DDDFF)V'));
assert(worldListener.bytecode.includes('float 16.0f') && worldListener.bytecode.includes('fmul') && worldListener.bytecode.includes('vo.a:(Laoc;DDDDILiv;)V'));
assert(deliver.bytecode.includes('Field te.q:D') && deliver.bytecode.includes('Field te.r:D') && deliver.bytecode.includes('Field te.s:D') && deliver.bytecode.includes('Field te.ap:I'));
assert(/dcmpg\s*\n\s*107: ifge/.test(deliver.bytecode), 'Recheck the strict squared-distance branch');
assert(eye.bytecode.includes('float 1.62f') && listenerPose.bytecode.includes('aoc.bF:()F') && listenerPose.bytecode.includes('setListenerPosition:(FFF)V'));
assert(blockEvents.bytecode.includes('double 64.0d') && registerWorldListener.bytecode.includes('class td'));
const methods = { noteBlockEvent: noteEvent, sourceBlockCenter: blockCenter, worldSoundDispatch: listeners, soundRadiusAndPacket: worldListener, entityPositionDelivery: deliver, standingEyeHeight: eye, listenerPose, distinctBlockEventNotification: blockEvents, worldListenerRegistration: registerWorldListener };
const report = { schema: 1, id: 'java-1.13', version, checkedAt: new Date().toISOString(), officialSources: { manifestUrl, metadataUrl: release.url, metadataSha1: release.sha1, clientUrl: metadata.downloads.client.url, clientSha1: digest(clientBytes) },
  mappings: { officialClientMappingsAvailable: false, kind: 'manual-labels-over-original-bytecode', note: 'Semantic labels below are explicitly manual. Original class/method names and descriptors, class hashes, and raw javap instructions are retained.' },
  facts: { noteBlockVolume: 3, baseBroadcastRadius: 16, broadcastRange: Math.fround(16 * Math.fround(3)), broadcastOrigin: 'player-entity-position', comparison: 'strict-distance-squared-less-than-range-squared', sameDimensionRequired: true, excludedPlayerSkipped: true, entityPositionFields: ['te.q:D', 'te.r:D', 'te.s:D'], standingEyeHeight: 1.62, standingEyeHeightJavaFloat: Math.fround(1.62), sourceBlockOffset: [.5, .5, .5], blockEventNotificationRadius: 64, blockEventNotificationIsSoundDeliveryRule: false },
  interpretation: ['bfw original note-block event emits volume 3 through the world block-position overload.', 'axs adds 0.5 on each axis and dispatches to its original world event listeners; dfx registers td for each integrated-server world.', 'td computes float16*volume when volume>1, otherwise radius16, then asks vo to send the sound packet.', 'vo uses player entity q/r/s positions and the same dimension, skips the excluded player, and rejects squared distances >=radiusSquared.', 'aoc.bF returns 1.62f in the ordinary standing branch, with distinct sleeping/swimming/crouching branches; dgh adds this eye height to interpolated player Y before its original listener-position update.', 'tc separately fans out block-event notification packets within radius64; that is not the radius48 sound-packet delivery condition.'],
  classes: Object.fromEntries(Object.entries(classEvidence).map(([label, { text, ...entry }]) => [label, entry])), methods,
  corroboratingMeasurement: { evidence: 'docs/evidence/java-1.13-single-note-world.json', center: 'sourceY81.5, listenerY81.62f, player entity feetY80', beyondSoundDelivery: 'case6: note block at y129.5 center; note-block event observed but no source delivered to player feetY80' },
  scopeLimitations: ['Original Java1.13 released client c0b970952cdd279912da384cdbfc0c26e6c6090b', 'Source logic plus isolated integrated-world loopback observations; no official mappings exist for this client', 'Standing player pose only; the 1.62 eye-height fact must not be applied to other player poses'] };
const rawRoot = path.resolve('.research/legacy-world-delivery/1.13'); await mkdir(rawRoot, { recursive: true });
const rawBytes = Buffer.from(JSON.stringify(report, null, 2)); await writeFile(path.join(rawRoot, 'evidence.json'), rawBytes);
const publicReport = { ...report, methods: Object.fromEntries(Object.entries(methods).map(([label, { bytecode, ...entry }]) => [label, { ...entry, bytecodeSha256: digest(Buffer.from(bytecode), 'sha256') }])), rawEvidence: { path: '.research/legacy-world-delivery/1.13/evidence.json', sha256: digest(rawBytes, 'sha256'), status: 'local ignored research artifact; raw original disassembly is not redistributed' } };
await mkdir('docs/evidence', { recursive: true }); const output = path.resolve('docs/evidence/java-1.13-world-delivery-source.json');
await writeFile(output, JSON.stringify(publicReport, null, 2)); console.log(JSON.stringify({ output, rawOutput: path.join(rawRoot, 'evidence.json'), broadcastRange: report.facts.broadcastRange, classes: Object.keys(report.classes).length, methods: Object.keys(methods).length }));
