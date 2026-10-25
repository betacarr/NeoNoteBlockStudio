import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {patchVersions} from './review-lwjgl212-source.mjs';
import {verifiedLwjgl212Components} from './probe-lwjgl212-methods.mjs';

export const lwjgl212Versions=[...patchVersions];

/** Read-only, per-release evidence gate. No facts file or product is written. */
export async function reviewedLwjgl212Profile(version){
 assert(lwjgl212Versions.includes(version));const review=await verifiedLwjgl212Components(version),f=review.facts;
 assert.equal(review.fullDispatchChainReviewed,true);assert.equal(review.numericComponentsExecuted,true);assert.equal(review.integratedWorldScenesAdded,0);assert.equal(review.scope.nativeContextOpened,false);
 assert.deepEqual(f.pitchTransport,{kind:'float32',wire:'writeFloat/readFloat',constructor:'stored-float-without-pitch-quantization'});assert.deepEqual(f.namedPitchTransport,f.pitchTransport);
 for(const role of ['RegisteredSoundPacket','NamedSoundPacket']){const ctor=review.bindings.find(b=>b.label===role+'-stored-float-pitch');assert(ctor);assert.equal(ctor.owner,review.roles[role]);assert(review.bindings.some(b=>b.label===role+'-wire-write'&&b.owner===ctor.owner));}
 assert.equal(f.soundEventArithmetic,'float-event-scalars');assert.equal(f.volumeRule,'category-before-clamp');assert.equal(f.masterVolumePlacement,'listener');assert.equal(f.noteBlockVolume,3);assert.equal(f.category,'record');assert.equal(f.decoder,'legacy-jorbis');assert.equal(f.attenuationModel,'paulscode-linear');assert.equal(f.attenuationDistance,16);
 assert.equal(f.broadcastRange,48);assert.equal(f.broadcastOrigin,'server-player-entity-position');assert.equal(f.comparison,'strict-distance-squared-less-than-range-squared');assert.equal(f.sameDimensionRequired,true);assert.equal(f.standingEyeHeightJavaFloat,Math.fround(1.62));assert.equal(f.listenerPositionModel,'interpolated-client-player-position-plus-original-player-eye-height-getter');
 assert.equal(f.hrtfControl,false);assert.equal(f.hrtfControlMode,'device-default');assert.deepEqual(f.originalRequestedVoicePool,{normal:28,streaming:4,notePool:'normal',actualAllocatedCapacityMeasured:false});
 const source=JSON.parse(await readFile(review.sourceEvidence.path)),numeric=JSON.parse(await readFile(review.numericEvidence.path));assert.equal(source.version,version);assert.equal(numeric.version,version);assert.equal(source.officialSources.clientSha1,numeric.officialSources.clientSha1);assert.equal(numeric.originalNoteToPacketToInstanceToEngine.find(n=>n.instrumentEventId===0&&n.note===12).originalWirePitch,1);
 assert.equal(review.instruments.length,10);assert.equal(f.nestedSoundEventArithmetic,'float-parent-child-multiply');assert.equal(f.nestedStreamRule,'child-or-parent');const materials=source.materialFields.supports.map(row=>{const instrument=review.instruments.find(i=>i.eventId===row.eventId);assert(instrument);assert.equal(instrument.event,row.event);return{instrument:instrument.instrument,eventId:row.eventId,material:row.block==='dirt'?'default/dirt':row.block==='planks'?'wood':row.block};});
 const common={id:'java-'+version,version,clientSha1:source.officialSources.clientSha1,sourceEvidence:review.sourceEvidence.path,sourceEvidenceSha256:review.sourceEvidence.sha256,numericEvidence:review.numericEvidence,classSha256:Object.fromEntries(source.classes.map(c=>[c.originalClass,c.classSha256]))};
 // Current product quantizes whenever pitchTransport exists. Direct float wire
 // is represented by omitting that executable rule, retaining its evidence as
 // detail. Never feed {kind:'float32'} to an unsigned-byte-only rule reader.
 const {pitchTransport,namedPitchTransport,...rules}=f;
 return{
  legacy:{...common,...rules,packetPitchEncoding:'float32',pitchTransportDetail:pitchTransport,namedPitchTransportDetail:namedPitchTransport,blockVolume:f.noteBlockVolume,gainFormula:'clampFloat(float(float(instanceFloat*eventVolumeFloat)*categoryFloat),0,1)',pitchFormula:'clampFloat(float(instancePitchFloat*eventPitchFloat),.5,2)',notePitchArithmetic:'double-pow-then-float',noteSoundTableSize:10,sourceRangeScalar:'unclamped-float-instance-event-product',materials,contextEvidence:review.contextEvidence,evidence:'original-release-float-wire-category-before-clamp-codec-and-component-checked',gameRecording:'pending'},
  world:{...common,broadcastRange:f.broadcastRange,broadcastOrigin:f.broadcastOrigin,comparison:f.comparison,sameDimensionRequired:f.sameDimensionRequired,standingEyeHeight:f.standingEyeHeightJavaFloat,standingEyeHeightJavaFloat:f.standingEyeHeightJavaFloat,listenerPositionModel:f.listenerPositionModel,evidence:'original-release-server-feet-delivery-and-client-position-plus-eye-getter-source-checked',gameRecording:'pending',listenerReferenceScope:'Standing editor reference uses this release original Java float eye-height getter. Same-dimension server delivery uses player feet/entity position and strict squared-distance filtering. Original client listener interpolates client player coordinates and adds its pose-dependent eye getter before float conversion. Actual world pose, native context equivalence, backend capability and game recordings remain unverified; no world measurement is inherited.'},
 };
}

export async function reviewedLwjgl212Profiles(){const entries=[];for(const version of lwjgl212Versions)entries.push(await reviewedLwjgl212Profile(version));return entries;}
