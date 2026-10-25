import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { digest } from './research-utils.mjs';
import { unzipSync } from 'fflate';
import { reviewedAudioSource } from './reviewed-audio-source.mjs';
import { reviewHistoricalWorldSource } from './review-historical-world-source.mjs';
import { historicalWorldPatchVersions } from './audit-historical-world-source.mjs';
import { reviewedVolumeBoundarySource } from './audit-volume-boundary-source.mjs';
import { reviewLwjgl21710Source } from './review-lwjgl21710-source.mjs';
import { reviewLwjgl218Source } from './review-lwjgl218-source.mjs';
import { lwjgl218PatchVersions, reviewLwjgl218Patch } from './review-lwjgl218-patches.mjs';
import { reviewedLwjgl219Profile } from './review-lwjgl219-profile.mjs';
import { reviewLwjgl217PatchProfiles } from './review-lwjgl217-patch-profiles.mjs';
import { reviewedLwjgl219PatchProfiles } from './review-lwjgl219-patch-profiles.mjs';
import { reviewedLwjgl2110Profiles } from './review-lwjgl2110-profiles.mjs';
import { reviewedLwjgl2111Profiles } from './review-lwjgl2111-profiles.mjs';
import { reviewedLwjgl212Profiles } from './review-lwjgl212-profiles.mjs';
import { reviewLwjgl2172Profiles } from './review-lwjgl2172-profile.mjs';
import { reviewedLwjgl215Profiles } from './review-lwjgl215-profiles.mjs';
import { reviewedLwjgl216Profiles } from './review-lwjgl216-profiles.mjs';
import { reviewedPre13Profiles } from './review-pre13-profiles.mjs';
import { reviewedLwjgl213Profiles } from './review-lwjgl213-profiles.mjs';
import { reviewedLwjgl214Profiles } from './review-lwjgl214-profiles.mjs';
import { verifyMapped144World } from './audit-mapped144-world.mjs';
import assert from 'node:assert/strict';
const server = await readFile('.research/world-capture/source/aag.java', 'utf8'), players = await readFile('.research/world-capture/source/acu.java', 'utf8');
if (!server.includes('16.0f * f2') || !server.includes('new ClientboundSoundPacket') || !players.includes('d5 * d5') || !['getX()', 'getY()', 'getZ()'].every(s => players.includes(s))) throw new Error('Expected original world broadcast source evidence is missing');
const metadata = JSON.parse(await readFile('.research/metadata/1.16.5.json', 'utf8'));
const profile = { id: 'java-1.16.5', clientSha1: metadata.downloads.client.sha1, broadcastRange: 48, standingEyeHeight: 1.62,
  broadcastOrigin: 'player-entity-position', comparison: 'strict-distance-squared-less-than-range-squared',
  evidence: 'original-server-level-and-player-list-source-checked',
  classSha1: { ServerLevel: digest(await readFile('.research/world-capture/classes/aag.class')), PlayerList: digest(await readFile('.research/world-capture/classes/acu.class')) } };
const profiles=[profile];
const legacy=JSON.parse(await readFile('docs/evidence/java-1.13-world-delivery-source.json','utf8'));
const rawBytes=await readFile(legacy.rawEvidence.path),rawLegacy=JSON.parse(rawBytes);
if(digest(rawBytes,'sha256')!==legacy.rawEvidence.sha256||JSON.stringify(rawLegacy.facts)!==JSON.stringify(legacy.facts))throw new Error('Legacy raw evidence identity changed');
for(const [name,item] of Object.entries(legacy.methods))if(digest(Buffer.from(rawLegacy.methods[name].bytecode),'sha256')!==item.bytecodeSha256)throw new Error('Legacy reviewed method identity changed');
const legacyMetadata=JSON.parse(await readFile('.research/metadata/1.13.json','utf8')),legacyClient=await readFile('.research/clients/1.13.jar');
if(digest(legacyClient)!==legacyMetadata.downloads.client.sha1||legacy.officialSources.clientSha1!==legacyMetadata.downloads.client.sha1)throw new Error('Legacy world source differs from the original client');
const legacyClasses=unzipSync(legacyClient,{filter:entry=>Object.values(legacy.classes).some(item=>entry.name===item.originalClass+'.class')});
for(const item of Object.values(legacy.classes))if(digest(legacyClasses[item.originalClass+'.class'])!==item.classSha1)throw new Error('Legacy delivery class identity changed');
if(legacy.facts.broadcastRange!==48||legacy.facts.broadcastOrigin!=='player-entity-position'||legacy.facts.comparison!=='strict-distance-squared-less-than-range-squared'||legacy.facts.standingEyeHeight!==1.62||legacy.facts.blockEventNotificationIsSoundDeliveryRule!==false)throw new Error('Reviewed legacy sound delivery facts differ');
profiles.push({...profile,id:'java-1.13',clientSha1:legacy.officialSources.clientSha1,classSha1:Object.fromEntries(Object.entries(legacy.classes).map(([name,item])=>[name,item.classSha1])),methodBytecodeSha256:Object.fromEntries(Object.entries(legacy.methods).map(([name,item])=>[name,item.bytecodeSha256])),evidence:'original-bytecode-manually-labelled-and-source-checked',sourceEvidence:'docs/evidence/java-1.13-world-delivery-source.json'});
for(const [version,evidence] of [['1.12.2','docs/evidence/java-1.12.2-world-source.json'],['1.14','docs/evidence/java-1.14-audio-source.json']]){
  const audit=await reviewedAudioSource(version,evidence),f=audit.facts;
  if(f.broadcastRange!==48||f.standingEyeHeight!==1.62||f.broadcastOrigin!=='player-entity-position'||f.comparison!=='strict-distance-squared-less-than-range-squared')throw new Error('Unexpected reviewed legacy/early delivery rule');
  const classes=Array.isArray(audit.classes)?audit.classes:Object.values(audit.classes);
  profiles.push({...profile,id:`java-${version}`,clientSha1:audit.officialSources.clientSha1,classSha1:Object.fromEntries(classes.map(item=>[item.originalName??item.originalClass,item.bytecodeSha1??item.classSha1])),evidence:'original-bytecode-manually-labelled-and-source-checked',sourceEvidence:evidence});
}
for(const version of ['1.19','1.19.2','1.20.2','1.20.5','1.21.5','26.3']){
  const root=path.resolve('.research/world-source',version),record=JSON.parse(await readFile(path.join(root,'provenance.json'),'utf8'));
  const expected=JSON.parse(await readFile(`.research/metadata/${version}.json`,'utf8'));
  const named=record.mapping==='original-named-client-no-mappings-artifact';
  if(record.clientSha1!==expected.downloads.client.sha1||(expected.downloads.client_mappings?record.mappingsSha1!==expected.downloads.client_mappings.sha1:!named))throw new Error('World source provenance differs from official client');
  const texts={},hashes={},sourceHashes={};
  for(const role of ['ServerLevel','PlayerList','SoundEvent']){
    const entry=record.classes.find(item=>item.name.endsWith('.'+role));if(!entry)throw new Error(`Missing ${role}`);
    const filename=entry.obfuscated.replaceAll('.','/');
    const source=await readFile(path.join(root,'source',filename+'.java'),'utf8'),bytecode=await readFile(path.join(root,'classes',filename+'.class'));
    if(digest(bytecode)!==entry.bytecodeSha1||digest(Buffer.from(source),'sha256')!==entry.namedSourceSha256)throw new Error('World evidence changed since decompilation');
    texts[role]=source;hashes[role]=entry.bytecodeSha1;sourceHashes[role]=entry.namedSourceSha256;
  }
  if(!texts.ServerLevel.includes(named?'.getRange(volume)':'.getRange($$6)')||!texts.ServerLevel.includes('new ClientboundSoundPacket')||!texts.PlayerList.includes(named?'< range * range':'< $$4 * $$4')||!['getX()', 'getY()', 'getZ()'].every(text=>texts.PlayerList.includes(text))||!texts.SoundEvent.includes(named?'16.0f * volume : 16.0f':'16.0f * $$0 : 16.0f'))throw new Error('Reviewed world broadcast arithmetic is missing');
  profiles.push({...profile,id:`java-${version}`,clientSha1:record.clientSha1,classSha1:hashes,namedSourceSha256:sourceHashes});
}
for(const version of historicalWorldPatchVersions){
  const sourceEvidence=`docs/evidence/java-${version}-world-source.json`,audit=await reviewHistoricalWorldSource(version,sourceEvidence),f=audit.facts;
  assert.equal(f.broadcastRange,48);assert.equal(f.standingEyeHeight,1.62);assert.equal(f.broadcastOrigin,'player-entity-position');assert.equal(f.comparison,'strict-distance-squared-less-than-range-squared');assert.equal(f.blockEventNotificationIsSoundDeliveryRule,false);
  profiles.push({...profile,id:`java-${version}`,clientSha1:audit.clientSha1,classSha1:Object.fromEntries(audit.classes.map(item=>[item.originalName,item.bytecodeSha1])),
    evidence:'original-bytecode-world-delivery-and-separate-camera-source-checked',sourceEvidence,
    listenerPositionModel:f.listenerPositionModel,firstPersonForwardOffsetJavaFloat:f.firstPersonForwardOffsetJavaFloat,eyeHeightSmoothing:f.eyeHeightSmoothing,
    listenerReferenceScope:'Editor reference coordinates use nominal standing eye height; actual world comparisons retain the observed camera and player positions. Camera smoothing, orientation offsets and world-coordinate float rounding are separate unverified editor-pose scope.'});
}
for(const version of ['1.21.8','1.21.9']){
  const sourceEvidence=`docs/evidence/java-${version}-volume-boundary-source.json`,audit=await reviewedVolumeBoundarySource(version),f=audit.facts.worldDelivery;
  assert.equal(f.radius,48);assert.equal(f.standingEyeHeight,1.62);assert.equal(f.playerDistance,'strict squared entity-position distance < radius squared');
  const roles=['net.minecraft.server.level.ServerLevel','net.minecraft.server.players.PlayerList','net.minecraft.sounds.SoundEvent','net.minecraft.client.Camera','net.minecraft.world.entity.Entity'];
  const entries=roles.map(role=>{const entry=audit.classes.find(item=>item.name===role);assert(entry,`Missing ${role}`);return entry;});
  profiles.push({...profile,id:`java-${version}`,clientSha1:audit.officialSources.clientSha1,classSha1:Object.fromEntries(entries.map(item=>[item.name,item.classSha1])),
    evidence:'original-mapped-world-delivery-and-volume-boundary-source-checked',sourceEvidence});
}
const mapped144Evidence='docs/evidence/java-1.14.4-world-source.json',mapped144=await verifyMapped144World({output:'.local/world-facts-validation/1.14.4'}),mapped144Facts=mapped144.facts;
assert.equal(mapped144Facts.broadcastRange,48);assert.equal(mapped144Facts.broadcastOrigin,'player-entity-position');assert.equal(mapped144Facts.comparison,'strict-distance-squared-less-than-range-squared');
assert.equal(mapped144Facts.standingEyeHeight,1.62);assert.equal(mapped144Facts.firstPersonForwardOffsetJavaFloat,0);
assert.equal(digest(await readFile(mapped144.cameraEvidence.path),'sha256'),mapped144.cameraEvidence.sha256);
profiles.push({...profile,id:'java-1.14.4',clientSha1:mapped144.clientSha1,classSha1:Object.fromEntries(mapped144.classes.map(item=>[item.originalName,item.bytecodeSha1])),
  evidence:'official-mapped-world-delivery-and-camera-source-checked',sourceEvidence:mapped144Evidence,
  listenerPositionModel:mapped144Facts.listenerPositionModel,firstPersonForwardOffsetJavaFloat:0,
  listenerReferenceScope:'Nominal editor ear-centred reference; first-person camera forward offset removed in this original client. Actual world comparisons retain measured absolute camera and server entity positions.'});
const legacy1710Evidence='docs/evidence/java-1.7.10-audio-world-source.json',legacy1710=await reviewLwjgl21710Source(legacy1710Evidence),legacy1710Facts=legacy1710.facts;
assert.equal(legacy1710Facts.broadcastRange,48);assert.equal(legacy1710Facts.broadcastOrigin,'server-player-entity-position');assert.equal(legacy1710Facts.comparison,'strict-distance-squared-less-than-range-squared');
assert.equal(legacy1710Facts.standingEyeHeight,1.62);assert.equal(legacy1710Facts.sameDimensionRequired,true);
profiles.push({...profile,id:'java-1.7.10',clientSha1:legacy1710.officialSources.clientSha1,
  classSha1:Object.fromEntries(legacy1710.classes.map(item=>[item.originalName??item.name,item.classSha1??item.bytecodeSha1])),
  evidence:'original-legacy-server-feet-client-eye-packet-and-world-delivery-source-checked',sourceEvidence:legacy1710Evidence,
  listenerPositionModel:legacy1710Facts.listenerPositionModel,standingEyeHeightJavaFloat:legacy1710Facts.standingEyeHeightJavaFloat,
  listenerReferenceScope:'Nominal editor ear-centred reference; original client player position already contains legacy eye offset. Actual world comparisons require independently observed server entity and client listener coordinates.'});
const legacy18Evidence='docs/evidence/java-1.8-audio-source.json',legacy18=await reviewLwjgl218Source(legacy18Evidence),legacy18Facts=legacy18.facts;
assert.equal(legacy18Facts.broadcastRange,48);assert.equal(legacy18Facts.broadcastOrigin,'server-player-entity-position');
assert.equal(legacy18Facts.comparison,'strict-distance-squared-less-than-range-squared');assert.equal(legacy18Facts.sameDimensionRequired,true);
assert.equal(legacy18Facts.standingEyeHeightJavaFloat,Math.fround(1.62));
profiles.push({...profile,id:'java-1.8',clientSha1:legacy18.officialSources.clientSha1,
  classSha1:Object.fromEntries(legacy18.classes.map(item=>[item.originalName,item.bytecodeSha1])),
  evidence:'original-server-delivery-and-client-position-plus-eye-getter-source-checked',sourceEvidence:legacy18Evidence,
  listenerPositionModel:legacy18Facts.listenerPositionModel,standingEyeHeightJavaFloat:legacy18Facts.standingEyeHeightJavaFloat,
  listenerReferenceScope:'Nominal editor ear-centred reference only; original listener adds the player eye-height getter after interpolating client coordinates. No original-context world recording or complete editor-to-world pose equivalence is established.'});
for(const version of lwjgl218PatchVersions){
  const sourceEvidence=`docs/evidence/java-${version}-audio-source.json`,review=await reviewLwjgl218Patch(version,sourceEvidence),f=review.facts;
  const metadata=JSON.parse(await readFile(`.research/metadata/${version}.json`,'utf8'));
  assert.equal(review.version,version);assert.equal(review.officialSources.clientSha1,metadata.downloads.client.sha1);
  assert.equal(digest(await readFile(`.research/clients/${version}.jar`)),review.officialSources.clientSha1);
  assert.equal(f.broadcastRange,48);assert.equal(f.broadcastOrigin,'server-player-entity-position');
  assert.equal(f.comparison,'strict-distance-squared-less-than-range-squared');assert.equal(f.sameDimensionRequired,true);
  assert.equal(f.listenerPositionModel,'interpolated-client-player-position-plus-original-player-eye-height-getter');
  assert.equal(f.standingEyeHeightJavaFloat,Math.fround(1.62));
  assert.equal(f.nativeContextEvidence,'not-reviewed-or-normalized-by-this-audit');
  assert.equal(review.integratedWorldScenesAdded,0);assert.equal(f.gameRecording,'pending');
  profiles.push({id:`java-${version}`,version,clientSha1:review.officialSources.clientSha1,
    broadcastRange:f.broadcastRange,broadcastOrigin:f.broadcastOrigin,comparison:f.comparison,sameDimensionRequired:f.sameDimensionRequired,
    standingEyeHeight:f.standingEyeHeightJavaFloat,standingEyeHeightJavaFloat:f.standingEyeHeightJavaFloat,
    classSha1:Object.fromEntries(review.classes.map(item=>[item.originalName,item.bytecodeSha1])),
    evidence:'original-patch-server-feet-delivery-and-client-position-plus-eye-getter-source-checked',sourceEvidence,
    listenerPositionModel:f.listenerPositionModel,nativeContextEvidence:f.nativeContextEvidence,gameRecording:'pending',
    listenerReferenceScope:'Standing editor reference uses the reviewed Java float eye height. Original listener adds the player eye-height getter after interpolating client coordinates; server delivery uses player feet. No original-context world recording or complete editor-to-world pose equivalence is established.'});
}
profiles.push((await reviewedLwjgl219Profile()).world);
profiles.push(...(await reviewLwjgl217PatchProfiles()).worldProfiles);
profiles.push(...(await reviewedLwjgl219PatchProfiles()).map(entry => entry.world));
profiles.push(...(await reviewedLwjgl2110Profiles()).map(entry => entry.world));
profiles.push(...(await reviewedLwjgl2111Profiles()).map(entry => entry.world));
profiles.push(...(await reviewedLwjgl212Profiles()).map(entry => entry.world));
profiles.push(...(await reviewLwjgl2172Profiles()).worldProfiles);
profiles.push(...(await reviewedLwjgl215Profiles()).map(entry => entry.world));
profiles.push(...(await reviewedLwjgl216Profiles()).map(entry => entry.world));
profiles.push(...(await reviewedPre13Profiles()).map(entry => entry.world));
profiles.push(...(await reviewedLwjgl213Profiles()).map(entry => entry.world));
profiles.push(...(await reviewedLwjgl214Profiles()).map(entry => entry.world));
assert.equal(new Set(profiles.map(entry => entry.id)).size, profiles.length, 'Duplicate world audio profile');
await writeFile('src/data/world-audio-facts.json', JSON.stringify({ schema: 1, profiles }, null, 2));
console.log(JSON.stringify({ profiles: profiles.length, broadcastRange: 48 }));
