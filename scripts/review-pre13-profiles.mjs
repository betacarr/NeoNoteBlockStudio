import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pre13Versions} from './audit-pre13-audio.mjs';
import {reviewedPre13Source} from './review-pre13-audio-source.mjs';
import {reviewedPre13Components} from './review-pre13-components.mjs';
import {reviewedJava10Resources} from './review-java10-resources.mjs';
import {reviewPre17Resources} from './review-pre17-resources.mjs';
export {pre13Versions};

/** Read-only candidates. Registration requires an independent product comparison. */
export async function reviewedPre13Profile(version,{read=readFile}={}){
  assert(pre13Versions.includes(version));
  const n=await reviewedPre13Components(version,{read}),s=await reviewedPre13Source(version,{read});
  const resources=version==='1.0'?await reviewedJava10Resources():await reviewPre17Resources(version),f=s.facts;
  assert.equal(n.clientSha1,resources.clientSha1);
  assert.equal(f.namedSoundPacketConstructorCount,0);
  assert.equal(f.pitchTransport,'none-on-reviewed-local-or-client-block-event-route');
  assert.equal(n.checks.normalNote1RawBits,'3f079c7d');
  assert.equal(n.checks.normalNote1Later63Bits,'3f061862');
  assert.equal(n.checks.quantizationInherited,false);
  assert.equal(f.audibleDistanceGate.origin,'current-client-view-entity-position');
  assert.equal(f.audibleDistanceGate.range,48);
  assert.equal(resources.sourcePrefix,'newsound');
  const common={id:'java-'+version,version,clientSha1:n.clientSha1,sourceEvidence:s.sourceEvidence.path,sourceEvidenceSha256:s.sourceEvidence.sha256,numericEvidence:n.numericEvidence,resourceEvidence:resources.sourceEvidence,classSha256:Object.fromEntries(s.classes.map(c=>[c.name,c.sha256]))};
  const materials=['default/dirt','stone','sand','glass','wood'].map((material,eventId)=>({material,eventId,event:'note.'+['harp','bd','snare','hat','bassattack'][eventId],instrument:['harp','basedrum','snare','hat','bass'][eventId]}));
  const audioDependencies=Object.fromEntries(['SoundSystem','BaseLibrary','CodecJOrbis','LwjglAL'].map(role=>[role,s.classes.find(c=>c.roles.includes(role)).artifact]));
  const legacy={...common,decoder:'legacy-jorbis',codecContainer:'original-client-embedded',categorySystem:false,eventModel:'direct-named-sound-pool-no-JSON-event-scalars',volumeRule:'clamp-before-global-setting',masterVolumePlacement:'source',globalSoundSettingPlacement:'source',sourceGain:'clampFloat(float(min(positiveRawVolumeFloat,1)*globalSoundSettingFloat),0,1)',gainFormula:'clampFloat(float(min(positiveRawVolumeFloat,1)*globalSoundSettingFloat),0,1)',gainProbeScope:'315 finite supplied manager inputs:150 played,165 suppressed (not final-gain comparisons),40 downstream original Library clips.280 rows use editor volume0..4/master0..2;35 negative-volume diagnostics are separate.90 stored-setting rows exceed the game slider but remain in the editor master domain. No constructed-project, AL-gain or world measurement.',listenerGain:f.listenerGain,blockVolume:3,noteBlockVolume:3,minPitch:.5,maxPitch:2,notePitchArithmetic:'double-pow-then-float',packetPitchEncoding:'integer-note-byte-no-float-pitch-transport',pitchTransportDetail:f.pitchTransport,pitchFormula:'clampFloat(float(pow(2,(note-12)/12)),.5,2)',localSoundPitch:'Raw original double-pow then float; original BaseSource clamps .5..2. No named pitch packet or63 quantization on the reviewed path.',noteTransportScope:f.localNoteRoute+'; '+f.networkClientRoute,noteEventReturn:'void',serverBroadcastScope:f.serverBroadcastScope,attenuationModel:'paulscode-linear',attenuationDistance:16,sourceRange:f.sourceRange,materials,noteSoundTableSize:5,hrtfControl:false,hrtfControlMode:'device-default',originalRequestedVoicePool:{...f.originalRequestedVoicePool,notePool:'normal'},audioDependencies,soundAssetLayout:'legacy-newsound',componentCounts:n.checks,evidence:'original-release-local-and-client-block-route-source-components-and-embedded-codec-checked',gameRecording:'pending'};
  // Absence is deliberate: the product treats any executable pitchTransport
  // object as byte quantization. The descriptive source string is not a rule.
  assert(!Object.hasOwn(legacy,'pitchTransport'));
  const world={...common,broadcastRange:48,broadcastOrigin:'current-client-view-entity-position',comparison:'strict-distance-squared-less-than-range-squared',distanceGateScope:'client-audibility-only-not-server-broadcast',clientRawNoteSoundCallback:'audible',listenerPositionModel:f.listenerPositionModel,listenerOrientationModel:f.listenerOrientationModel,standingEyeHeight:0,standingEyeHeightSource:'editor-stationary-client-reference-no-added-offset',listenerReferenceScope:'The stationary editor reference uses the same origin for the current client view entity distance gate and the interpolated listener, with no added foot/eye offset. The actual gate uses current entity doubles; the original listener interpolates entity doubles then rounds float. One original listener fixture and ten client48-block gates execute. Moving-current versus interpolated coordinates, full camera transforms and a running pose are unmeasured. This is a client audibility rule, not a claim about an unreviewed standalone server broadcast or dimension filter.',serverBroadcastScope:f.serverBroadcastScope,evidence:'original-release-client-raw-note-distance-and-listener-source-components-checked',gameRecording:'pending'};
  return{legacy,world,resources};
}
export async function reviewedPre13Profiles(options){const rows=[];for(const version of pre13Versions)rows.push(await reviewedPre13Profile(version,options));return rows;}
