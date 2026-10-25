import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from './research-utils.mjs';
import {lwjgl2172Versions,reviewLwjgl2172} from './review-lwjgl2172-source.mjs';

export async function reviewLwjgl2172Profile(version){
 assert(lwjgl2172Versions.includes(version));
 const sourceEvidence=`docs/evidence/java-${version}-audio-source.json`,review=await reviewLwjgl2172(version,sourceEvidence),f=review.facts;
 assert.equal(review.version,version);assert.equal(review.integratedWorldScenesAdded,0);
 assert.equal(f.decoder,'legacy-jorbis');assert.equal(f.soundEventArithmetic,'double-event-scalars');assert.equal(f.volumeRule,'category-before-clamp');assert.equal(f.masterVolumePlacement,'listener');
 assert.deepEqual(f.pitchTransport,{kind:'unsigned-byte',scale:63,minimum:0,maximum:255});assert.equal(f.pitchTransportDetail.overflow,'constructor-clamp');
 assert.equal(f.hrtfControl,false);assert.equal(f.hrtfControlMode,'device-default');assert.deepEqual(review.gameHrtfReferenceScan.references,[]);assert.equal(review.gameHrtfReferenceScan.gameControl,false);
 assert.equal(f.broadcastOrigin,'server-player-entity-position');assert.equal(f.broadcastRange,48);assert.equal(f.sameDimensionRequired,true);assert.equal(f.comparison,'strict-distance-squared-less-than-range-squared');
 assert.equal(f.listenerPositionModel,'interpolated-client-player-position-already-containing-legacy-y-offset');assert.equal(f.standingEyeHeight,1.62);assert.equal(f.standingEyeHeightJavaFloat,Math.fround(1.62));assert.equal(f.serverPlayerYOffset,0);assert.equal(f.ordinaryClientPlayerYOffsetJavaFloat,Math.fround(1.62));
 assert.equal(f.nativeContextEvidence,'not-reviewed-or-normalized-by-this-audit');assert.equal(f.gameRecording,'pending');
 const identity={id:`java-${version}`,version,clientSha1:review.officialSources.clientSha1,classSha1:Object.fromEntries(review.classes.map(c=>[c.originalName,c.bytecodeSha1])),sourceEvidence};
 const legacy={...identity,...f,blockVolume:f.noteBlockVolume,evidence:'original-patch-server-note-packet-field-clamp-double-event-category-codec-and-components-checked',gameRecording:'pending'};
 const world={...identity,broadcastRange:f.broadcastRange,broadcastOrigin:f.broadcastOrigin,comparison:f.comparison,sameDimensionRequired:f.sameDimensionRequired,
  standingEyeHeight:f.standingEyeHeight,standingEyeHeightJavaFloat:f.standingEyeHeightJavaFloat,listenerPositionModel:f.listenerPositionModel,
  serverPlayerYOffset:f.serverPlayerYOffset,ordinaryClientPlayerYOffsetJavaFloat:f.ordinaryClientPlayerYOffsetJavaFloat,teleportYConversion:f.teleportYConversion,
  nativeContextEvidence:f.nativeContextEvidence,gameRecording:'pending',evidence:'original-patch-server-feet-client-legacy-eye-offset-and-delivery-source-checked',
  listenerReferenceScope:'Nominal editor ear-centred standing reference is 1.62 blocks. Original ordinary client player Y already includes widened float32(1.62) relative to server feet; server player yOffset is zero and the listener only interpolates client player position, without another eye-height getter or addition. Float rounding, non-standing poses, complete editor-to-world pose conversion and original native-context/world PCM equivalence are not established.'};
 return{version,sourceEvidence,sourceEvidenceSha256:digest(await readFile(sourceEvidence),'sha256'),legacy,world};
}

export async function reviewLwjgl2172Profiles(){const reviews=[];for(const version of lwjgl2172Versions)reviews.push(await reviewLwjgl2172Profile(version));return{legacyProfiles:reviews.map(r=>r.legacy),worldProfiles:reviews.map(r=>r.world),sourceEvidence:reviews.map(({version,sourceEvidence,sourceEvidenceSha256})=>({version,path:sourceEvidence,sha256:sourceEvidenceSha256})),newWorldScenes:0};}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=await reviewLwjgl2172Profiles();console.log(JSON.stringify({legacyProfiles:r.legacyProfiles.length,worldProfiles:r.worldProfiles.length,ids:r.legacyProfiles.map(p=>p.id),newWorldScenes:0}));}
