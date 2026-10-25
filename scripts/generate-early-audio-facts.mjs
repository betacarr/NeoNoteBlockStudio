import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { reviewedAudioSource } from './reviewed-audio-source.mjs';
import { reviewHistoricalAudioPatch } from './review-historical-audio-patches.mjs';

const sourceEvidence='docs/evidence/java-1.14-audio-source.json',audit=await reviewedAudioSource('1.14',sourceEvidence),f=audit.facts;
assert.deepEqual(f,{decoder:'stb',attenuationModel:'openal-linear',distanceModel:'linear',referenceDistance:0,rolloff:1,attenuationDistance:16,noteBlockVolume:3,minPitch:.5,maxPitch:2,hrtfControl:false,outputLimiter:'device-default',volumeRule:'category-before-clamp',masterVolumePlacement:'listener',broadcastRange:48,broadcastOrigin:'player-entity-position',comparison:'strict-distance-squared-less-than-range-squared',standingEyeHeight:1.62});
const profile={id:'java-1.14',version:'1.14',...f,hrtfControlMode:'device-default',blockVolume:f.noteBlockVolume,clientSha1:audit.officialSources.clientSha1,evidence:'selected-core-parameters-manually-source-checked',sourceEvidence,classSha1:Object.fromEntries(audit.classes.map(item=>[item.originalName,item.bytecodeSha1])),gameRecording:'pending'};
const profiles=[profile];
for(const version of ['1.14.1','1.14.2','1.14.3']){
  const sourceEvidence=`docs/evidence/java-${version}-audio-source.json`,review=await reviewHistoricalAudioPatch(version,sourceEvidence);
  assert.equal(review.facts.decoder,'stb'); assert.equal(review.facts.attenuationModel,'openal-linear');
  profiles.push({id:`java-${version}`,version,...review.facts,blockVolume:review.facts.noteBlockVolume,clientSha1:review.clientSha1,
    evidence:'selected-core-parameters-manually-source-and-original-component-checked',sourceEvidence,
    classSha1:Object.fromEntries(review.classes.map(item=>[item.originalName,item.bytecodeSha1])),gameRecording:'pending'});
}
await writeFile('src/data/early-audio-facts.json',JSON.stringify({schema:1,profiles},null,2));
console.log(JSON.stringify({profiles:profiles.length,decoder:profile.decoder}));
