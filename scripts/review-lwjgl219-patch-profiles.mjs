import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {patchVersions,verifiedLwjgl219PatchSource} from './review-lwjgl219-patches-complete.mjs';
import {verifiedLwjgl219PatchComponents} from './probe-lwjgl219-patches.mjs';

export const lwjgl219PatchVersions=[...patchVersions];

/** Read-only preparation of independently checked entries; never writes shared facts. */
export async function reviewedLwjgl219PatchProfile(version){
 assert(lwjgl219PatchVersions.includes(version),version);
 const review=await verifiedLwjgl219PatchComponents(version),f=review.facts;
 assert.equal(review.fullDispatchChainReviewed,true);assert.equal(review.numericComponentsExecuted,true);assert.equal(review.integratedWorldScenesAdded,0);assert.equal(review.scope.nativeContextOpened,false);
 assert.equal(f.soundEventArithmetic,'float-event-scalars');assert.equal(f.volumeRule,'category-before-clamp');assert.equal(f.masterVolumePlacement,'listener');
 const registeredScale=['1.9.1','1.9.2'].includes(version)?63.5:63;
 assert.deepEqual(f.pitchTransport,{kind:'unsigned-byte',scale:registeredScale,minimum:0,maximum:255,overflow:'wrap'});
 assert.deepEqual(f.namedPitchTransport,{kind:'unsigned-byte',scale:63,minimum:0,maximum:255,overflow:'wrap'});
 const registered=review.bindings.find(b=>b.label==='RegisteredSoundPacket-stored-scaled-pitch');assert(registered);assert.equal(registered.owner,review.roles.RegisteredSoundPacket);assert.notEqual(registered.owner,review.roles.NamedSoundPacket);assert(registered.semanticInstructionChecks.includes(`float ${registeredScale.toFixed(1)}f`));
 assert.equal(f.decoder,'legacy-jorbis');assert.equal(f.attenuationModel,'paulscode-linear');assert.equal(f.attenuationDistance,16);assert.equal(f.noteBlockVolume,3);assert.equal(f.category,'record');
 assert.equal(f.broadcastRange,48);assert.equal(f.broadcastOrigin,'server-player-entity-position');assert.equal(f.comparison,'strict-distance-squared-less-than-range-squared');assert.equal(f.sameDimensionRequired,true);
 assert.equal(f.listenerPositionModel,'interpolated-client-player-position-plus-original-player-eye-height-getter');assert.equal(f.standingEyeHeightJavaFloat,Math.fround(1.62));
 assert.equal(f.hrtfControl,false);assert.equal(f.hrtfControlMode,'device-default');assert.deepEqual(f.originalRequestedVoicePool,{normal:28,streaming:4,notePool:'normal',actualAllocatedCapacityMeasured:false});
 const source=JSON.parse(await readFile(review.sourceEvidence.path)),numeric=JSON.parse(await readFile(review.numericEvidence.path));assert.equal(source.version,version);assert.equal(numeric.version,version);assert.equal(source.officialSources.clientSha1,numeric.officialSources.clientSha1);assert.equal(source.scope.worldScenesAdded,0);assert.equal(numeric.integratedWorldScenesAdded,0);
 assert.equal(numeric.originalNoteToPacketToInstanceToEngine.find(row=>row.instrumentEventId===0&&row.note===12).originalEnginePitch,registeredScale===63.5?Math.fround(63/63.5):1);
 assert.equal(review.instruments.length,5);assert.deepEqual(source.materialFields.supports.map(row=>row.block),['dirt','stone','sand','glass','planks']);
 const materials=source.materialFields.supports.map(row=>{const instrument=review.instruments.find(item=>item.eventId===row.eventId);assert(instrument);assert.equal(instrument.event,row.event);return{instrument:instrument.instrument,eventId:row.eventId,material:row.block==='dirt'?'default/dirt':row.block==='planks'?'wood':row.block};});
 const common={id:'java-'+version,version,clientSha1:source.officialSources.clientSha1,sourceEvidence:review.sourceEvidence.path,sourceEvidenceSha256:review.sourceEvidence.sha256,numericEvidence:review.numericEvidence,classSha256:Object.fromEntries(source.classes.map(c=>[c.originalClass,c.classSha256]))};
 return{
  legacy:{...common,...f,blockVolume:f.noteBlockVolume,gainFormula:'clampFloat(float(float(instanceFloat*eventVolumeFloat)*categoryFloat),0,1)',pitchFormula:'clampFloat(float(instancePitchFloat*eventPitchFloat),.5,2)',notePitchArithmetic:'double-pow-then-float',noteSoundTableSize:5,sourceRangeScalar:'unclamped-float-instance-event-product',materials,contextEvidence:review.contextEvidence,evidence:'original-patch-registered-packet-float-category-before-clamp-codec-and-component-checked',gameRecording:'pending'},
  world:{...common,broadcastRange:f.broadcastRange,broadcastOrigin:f.broadcastOrigin,comparison:f.comparison,sameDimensionRequired:f.sameDimensionRequired,standingEyeHeight:f.standingEyeHeightJavaFloat,standingEyeHeightJavaFloat:f.standingEyeHeightJavaFloat,listenerPositionModel:f.listenerPositionModel,evidence:'original-patch-server-feet-delivery-and-client-position-plus-eye-getter-source-checked',gameRecording:'pending',listenerReferenceScope:'Standing editor reference uses this release original Java float eye-height getter. Server delivery uses same-dimension player feet/entity position with strict squared-distance filtering; the original client listener interpolates client player coordinates and adds its pose-dependent eye getter before float conversion. Actual world pose, native context equivalence and game recordings remain unverified; no world measurement is inherited.'},
 };
}

export async function reviewedLwjgl219PatchProfiles(){
 const entries=[];for(const version of lwjgl219PatchVersions)entries.push(await reviewedLwjgl219PatchProfile(version));return entries;
}

// Source-only consumers can validate identities without opening a Java process.
export {verifiedLwjgl219PatchSource};
