import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {lwjgl215Versions,sha215} from './audit-lwjgl215-source.mjs';
import {verifiedLwjgl215Source} from './review-lwjgl215-source.mjs';
import {verifiedLwjgl215Components} from './probe-lwjgl215-methods.mjs';
export {lwjgl215Versions};

/** Read-only target-release resource gate. Does not initialize any game or AL context. */
export async function reviewedLwjgl215Resources(version,{evidenceFile=`docs/evidence/java-${version}-resource-selection.json`}={}){
 const c=await verifiedLwjgl215Components(version),s=await verifiedLwjgl215Source(version),bytes=await readFile(evidenceFile),r=JSON.parse(bytes);
 assert.deepEqual(r,{schema:1,version,status:'passed',layout:'legacy-sound3',acceptedPrefix:'sound3',ignoredPrefixes:['sound','newsound'],sourceEvidence:s.sourceEvidence,componentEvidence:c.componentEvidence,officialSources:s.officialSources,resources:c.checks.resources,decodes:c.checks.decodes,treeAccepted:7,dispatchControls:8,scope:c.scope});
 return{...r,resourceEvidence:{path:evidenceFile,sha256:sha215(bytes)}};
}

/** Registration candidates only: caller owns common facts and any product integration. */
export async function reviewedLwjgl215Profile(version){
 assert(lwjgl215Versions.includes(version));const s=await verifiedLwjgl215Source(version),c=await verifiedLwjgl215Components(version),r=await reviewedLwjgl215Resources(version),f=s.facts;
 assert.equal(c.checks.notes.clientRawCallbackSilent,true);assert.equal(c.checks.notes.notes,125);assert.equal(c.checks.boundary.inputs,200);assert.equal(c.checks.packet.inputs,44);
 const identity={id:'java-'+version,version,clientSha1:s.officialSources.client.sha1,sourceEvidence:s.sourceEvidence.path,sourceEvidenceSha256:s.sourceEvidence.sha256,numericEvidence:c.componentEvidence,resourceEvidence:r.resourceEvidence,classSha256:Object.fromEntries(s.classes.map(c=>[c.originalName,c.bytecodeSha256]))};
 const materials=['default/dirt','stone','sand','glass','wood'].map((material,eventId)=>({material,eventId,event:f.noteEvents[eventId],instrument:['harp','basedrum','snare','hat','bass'][eventId]}));
 return{
  legacy:{...identity,decoder:'legacy-jorbis',codecContainer:'original-client-embedded',categorySystem:false,volumeRule:'clamp-before-global-setting',masterVolumePlacement:'source',blockVolume:3,noteBlockVolume:3,globalSoundSettingPlacement:'source',sourceGain:'float(min(positiveRawVolume,1)*globalSoundSettingFloat)',gainFormula:'float(min(positiveRawVolumeFloat,1)*globalSoundSettingFloat)',gainProbeScope:'105 positive played / 95 suppressed original manager cases; global setting domain [0,1]. Sink captures submitted setVolume, not AL gain.',listenerGain:'original-library-default-not-driven-by-sound-setting',minPitch:.5,maxPitch:2,notePitchArithmetic:'double-pow-then-float',pitchTransport:f.pitchTransport,pitchTransportDetail:f.pitchTransportDetail,noteTransportScope:'Actual NoteBlock calls inherited World named dispatch; server listener constructs byte pitch packet. Original client World listener callback is no-op, so block-event branch does not add raw-pitch audio.',pitchFormula:'clampFloat(float(clampInt(truncateToInt32(float(rawPitchFloat*63)),0,255)/63),.5,2)',localSoundPitch:f.localSoundPitch,attenuationModel:'paulscode-linear',attenuationDistance:16,sourceRange:f.sourceRange,materials,noteSoundTableSize:5,hrtfControl:false,hrtfControlMode:'device-default',originalRequestedVoicePool:f.originalRequestedVoicePool,originalContextAttributes:c.checks.originalContextAttributes,audioDependencies:s.audioDependencies,soundAssetLayout:'legacy-sound3',evidence:'original-release-source-and-inert-components-and-codec-checked',gameRecording:'pending'},
  world:{...identity,broadcastRange:48,broadcastOrigin:'server-player-entity-position',comparison:'strict-distance-squared-less-than-range-squared',sameDimensionRequired:true,blockEventBroadcastRange:64,clientRawNoteSoundCallback:'no-op',listenerPositionModel:f.listenerPositionModel,standingEyeHeight:1.62,standingEyeHeightJavaFloat:f.ordinaryClientPlayerYOffsetJavaFloat,ordinaryClientPlayerYOffsetJavaFloat:f.ordinaryClientPlayerYOffsetJavaFloat,serverPlayerYOffset:0,serverTeleportSoundY:f.serverTeleportSoundY,listenerReferenceScope:'standingEyeHeight=1.62 is the nominal editor ear-to-server-feet delivery reference, not a measured world pose or an exact client coordinate transform. Original manager interpolates entity doubles then converts to float, without adding eye height. Original player constructor sets N=float1.62; server player clears N, and teleport handler transmits server y+widened float1.62 as client y. Selected methods are Code-bound; actual world standing pose is unmeasured. No modern Camera behavior inherited.',evidence:'original-release-server-named-and-block-event-delivery-and-listener-source-checked',gameRecording:'pending'},
 };
}
export async function reviewedLwjgl215Profiles(){const rows=[];for(const v of lwjgl215Versions)rows.push(await reviewedLwjgl215Profile(v));return rows;}
