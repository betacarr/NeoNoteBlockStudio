import { readFile, writeFile } from 'node:fs/promises';
import { digest } from './research-utils.mjs';
import { reviewedAudioSource } from './reviewed-audio-source.mjs';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { reviewHistoricalAudioPatch } from './review-historical-audio-patches.mjs';
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
const gain = JSON.parse(await readFile('.local/legacy-gain-comparison/1.13/result.json', 'utf8'));
const source = await readFile('.research/legacy/1.13/source/dgl.java', 'utf8'), manager = await readFile('.research/legacy/1.13/source/dgh.java', 'utf8');
if (!gain.exact || gain.cases < 2000 || !source.includes('1.0f - this.distanceFromListener / this.distOrRoll') || !manager.includes('CodecJOrbis.class')) throw new Error('Legacy source/runtime evidence is incomplete');
const library = await readFile('.research/legacy/1.13/source/dgf.java');
assert.equal(digest(library,'sha256'),'3b9c7f35f9fc7cfc2cf24fb426882848a92942c0a79f826e42f52090a3d70aab','Reviewed original 1.13 Library source changed');
assert(/alcCreateContext\([^\n]*\(IntBuffer\)null\)/.test(library.toString()) && !/HRTF|6546|6550|alcResetDeviceSOFT/.test(library.toString()));
const metadata=JSON.parse(await readFile('.research/metadata/1.13.json','utf8')),client=await readFile('.research/clients/1.13.jar');
assert.equal(digest(client),metadata.downloads.client.sha1);assert.equal(gain.clientSha1,metadata.downloads.client.sha1);
const originalLibrary=unzipSync(client,{filter:e=>e.name==='dgf.class'})['dgf.class'];
assert.equal(digest(originalLibrary),digest(await readFile('.research/legacy/1.13/classes/dgf.class')));
const profile = { id: 'java-1.13', clientSha1: gain.clientSha1, decoder: 'legacy-jorbis', attenuationModel: 'paulscode-linear', hrtfControl:false,hrtfControlMode:'device-default',
  evidence: 'original-codec-registration-and-source-arithmetic-checked', gainCases: gain.cases,
  contextEvidence:{kind:'manually-reviewed-original-library',originalClass:'dgf',sourceSha256:digest(library,'sha256'),finding:'Original init creates a context with null attributes; no game HRTF request or reset.'},
  classSha1: { Library:digest(originalLibrary),SourceLWJGL3: digest(await readFile('.research/legacy/1.13/classes/dgl.class')), SoundManager: digest(await readFile('.research/legacy/1.13/classes/dgh.class')) }, gameRecording: 'pending' };
const evidence='docs/evidence/java-1.12.2-world-source.json',audit=await reviewedAudioSource('1.12.2',evidence);
if(audit.facts.decoder!=='original-paulscode-codecjorbis'||audit.facts.attenuationModel!=='paulscode-linear'||audit.facts.masterVolumePlacement!=='listener'||audit.facts.volumeRule!=='category-before-clamp')throw new Error('Unexpected reviewed LWJGL2 audio path');
assert.equal(audit.facts.originalHrtfSupported,false);
const lwjgl2={id:'java-1.12.2',clientSha1:audit.officialSources.clientSha1,decoder:'legacy-jorbis',attenuationModel:'paulscode-linear',hrtfControl:false,hrtfControlMode:'device-default',evidence:'original-codec-registration-source-attenuation-volume-and-context-checked',sourceEvidence:evidence,classSha1:Object.fromEntries(Object.entries(audit.classes).map(([name,item])=>[name,item.classSha1])),gameRecording:'pending'};
const profiles=[lwjgl2,profile];
const legacy1710Evidence='docs/evidence/java-1.7.10-audio-world-source.json',legacy1710=await reviewLwjgl21710Source(legacy1710Evidence),legacy1710Facts=legacy1710.facts;
assert.equal(legacy1710Facts.decoder,'legacy-jorbis');assert.equal(legacy1710Facts.soundEventArithmetic,'double-event-scalars');
assert.deepEqual(legacy1710Facts.pitchTransport,{kind:'unsigned-byte',scale:63,minimum:0,maximum:255});
assert.equal(legacy1710Facts.originalRequestedVoicePool.normal,28);assert.equal(legacy1710Facts.hrtfControl,false);
profiles.push({id:'java-1.7.10',version:'1.7.10',...legacy1710Facts,blockVolume:legacy1710Facts.noteBlockVolume,clientSha1:legacy1710.officialSources.clientSha1,
  evidence:'original-game-packet-event-double-scalars-codec-coordinate-and-component-checked',sourceEvidence:legacy1710Evidence,
  classSha1:Object.fromEntries(legacy1710.classes.map(item=>[item.originalName??item.name,item.classSha1??item.bytecodeSha1])),gameRecording:'pending'});
const legacy18Evidence='docs/evidence/java-1.8-audio-source.json',legacy18=await reviewLwjgl218Source(legacy18Evidence),legacy18Facts=legacy18.facts;
assert.equal(legacy18Facts.decoder,'legacy-jorbis');assert.equal(legacy18Facts.soundEventArithmetic,'double-event-scalars');
assert.equal(legacy18Facts.categoryVolumeOrder,'float-after-double-instance-event-clamp');
assert.deepEqual(legacy18Facts.pitchTransport,{kind:'unsigned-byte',scale:63,minimum:0,maximum:255,overflow:'wrap'});
assert.equal(legacy18Facts.originalRequestedVoicePool.normal,28);assert.equal(legacy18Facts.masterVolumePlacement,'listener');
profiles.push({id:'java-1.8',version:'1.8',...legacy18Facts,blockVolume:legacy18Facts.noteBlockVolume,clientSha1:legacy18.officialSources.clientSha1,
  evidence:'original-packet-wire-category-after-double-clamp-codec-and-component-checked',sourceEvidence:legacy18Evidence,
  classSha1:Object.fromEntries(legacy18.classes.map(item=>[item.originalName,item.bytecodeSha1])),gameRecording:'pending'});
for(const version of lwjgl218PatchVersions){
  const sourceEvidence=`docs/evidence/java-${version}-audio-source.json`,review=await reviewLwjgl218Patch(version,sourceEvidence),f=review.facts;
  const metadata=JSON.parse(await readFile(`.research/metadata/${version}.json`,'utf8'));
  assert.equal(review.version,version);assert.equal(review.officialSources.clientSha1,metadata.downloads.client.sha1);
  assert.equal(digest(await readFile(`.research/clients/${version}.jar`)),review.officialSources.clientSha1);
  assert.equal(f.decoder,'legacy-jorbis');assert.equal(f.attenuationModel,'paulscode-linear');
  assert.equal(f.soundEventArithmetic,'double-event-scalars');assert.equal(f.volumeRule,'category-after-clamp');
  assert.equal(f.categoryVolumeOrder,'float-after-double-instance-event-clamp');assert.equal(f.masterVolumePlacement,'listener');
  assert.deepEqual(f.pitchTransport,{kind:'unsigned-byte',scale:63,minimum:0,maximum:255,overflow:'wrap'});
  assert.deepEqual(f.originalRequestedVoicePool,{normal:28,streaming:4,notePool:'normal',actualAllocatedCapacityMeasured:false});
  assert.equal(f.hrtfControl,false);assert.equal(f.nativeContextEvidence,'not-reviewed-or-normalized-by-this-audit');
  assert.equal(review.integratedWorldScenesAdded,0);assert.equal(f.gameRecording,'pending');
  profiles.push({id:`java-${version}`,version,...f,blockVolume:f.noteBlockVolume,clientSha1:review.officialSources.clientSha1,
    evidence:'original-patch-callers-packet-wire-category-after-double-clamp-codec-and-component-checked',sourceEvidence,
    classSha1:Object.fromEntries(review.classes.map(item=>[item.originalName,item.bytecodeSha1])),gameRecording:'pending'});
}
for(const version of ['1.13.1','1.13.2']){
  const sourceEvidence=`docs/evidence/java-${version}-audio-source.json`,review=await reviewHistoricalAudioPatch(version,sourceEvidence);
  assert.equal(review.facts.decoder,'legacy-jorbis'); assert.equal(review.facts.attenuationModel,'paulscode-linear');
  profiles.push({id:`java-${version}`,version,...review.facts,blockVolume:review.facts.noteBlockVolume,clientSha1:review.clientSha1,
    evidence:'selected-core-parameters-manually-source-and-original-component-checked',sourceEvidence,
    classSha1:Object.fromEntries(review.classes.map(item=>[item.originalName,item.bytecodeSha1])),gameRecording:'pending'});
}
profiles.push((await reviewedLwjgl219Profile()).legacy);
profiles.push(...(await reviewLwjgl217PatchProfiles()).legacyProfiles);
profiles.push(...(await reviewedLwjgl219PatchProfiles()).map(entry => entry.legacy));
profiles.push(...(await reviewedLwjgl2110Profiles()).map(entry => entry.legacy));
profiles.push(...(await reviewedLwjgl2111Profiles()).map(entry => entry.legacy));
profiles.push(...(await reviewedLwjgl212Profiles()).map(entry => entry.legacy));
profiles.push(...(await reviewLwjgl2172Profiles()).legacyProfiles);
profiles.push(...(await reviewedLwjgl215Profiles()).map(entry => entry.legacy));
profiles.push(...(await reviewedLwjgl216Profiles()).map(entry => entry.legacy));
profiles.push(...(await reviewedPre13Profiles()).map(entry => entry.legacy));
profiles.push(...(await reviewedLwjgl213Profiles()).map(entry => entry.legacy));
profiles.push(...(await reviewedLwjgl214Profiles()).map(entry => entry.legacy));
assert.equal(new Set(profiles.map(entry => entry.id)).size, profiles.length, 'Duplicate legacy audio profile');
await writeFile('src/data/legacy-audio-facts.json', JSON.stringify({ schema: 1, profiles }, null, 2));
console.log(JSON.stringify({ profiles: profiles.length, decoder: profile.decoder }));
