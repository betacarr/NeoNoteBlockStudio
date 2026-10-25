import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { verifiedLwjgl219Evidence } from './verified-lwjgl219-evidence.mjs';
import { verifiedLwjgl219ContextControl } from './review-lwjgl219-context-control.mjs';

/** Only the independently reviewed full 1.9 chain is eligible for product facts. */
export async function reviewedLwjgl219Profile() {
  const review = await verifiedLwjgl219Evidence('1.9');
  const context = await verifiedLwjgl219ContextControl('1.9');
  assert.equal(review.fullCallChainReviewed, true);
  const f = review.facts;
  assert.equal(f.soundEventArithmetic, 'float-event-scalars');
  assert.equal(f.volumeRule, 'category-before-clamp');
  assert.equal(f.masterVolumePlacement, 'listener');
  assert.deepEqual(f.pitchTransport, { kind: 'unsigned-byte', scale: 63.5, minimum: 0, maximum: 255, overflow: 'wrap' });
  assert.equal(f.decoder, 'legacy-jorbis');
  assert.equal(f.attenuationModel, 'paulscode-linear');
  assert.equal(f.broadcastRange, 48);
  assert.equal(f.broadcastOrigin, 'server-player-entity-position');
  assert.equal(f.comparison, 'strict-distance-squared-less-than-range-squared');
  assert.equal(f.sameDimensionRequired, true);
  assert.equal(f.standingEyeHeightJavaFloat, Math.fround(1.62));
  assert.deepEqual(context.facts, { hrtfControl: false, hrtfControlMode: 'device-default' });
  assert.equal(context.scope.nativeContextCreated, false);
  const source = JSON.parse(await readFile(review.sourceEvidence.path, 'utf8'));
  const original = source.classes.find(item => item.version === '1.9');
  const numeric = JSON.parse(await readFile(review.numericEvidence.path, 'utf8'));
  assert.equal(original.officialSources.clientSha1, numeric.officialSources.clientSha1);
  assert.equal(source.integratedWorldScenesAdded, 0);
  assert.equal(numeric.integratedWorldScenesAdded, 0);
  const common = {
    id: 'java-1.9', version: '1.9', clientSha1: original.officialSources.clientSha1,
    sourceEvidence: review.sourceEvidence.path,
    sourceEvidenceSha256: review.sourceEvidence.sha256,
    numericEvidence: review.numericEvidence,
    classSha256: Object.fromEntries(original.classes.map(item => [item.originalName, item.classSha256])),
  };
  return {
    legacy: {
      ...common, ...f, ...context.facts, blockVolume: f.noteBlockVolume,
      contextEvidence: context.sourceEvidence,
      evidence: 'original-registered-packet-float-category-before-clamp-codec-and-component-checked',
      gameRecording: 'pending',
    },
    world: {
      ...common, broadcastRange: f.broadcastRange, broadcastOrigin: f.broadcastOrigin,
      comparison: f.comparison, sameDimensionRequired: f.sameDimensionRequired,
      standingEyeHeight: f.standingEyeHeightJavaFloat,
      standingEyeHeightJavaFloat: f.standingEyeHeightJavaFloat,
      listenerPositionModel: f.listenerPositionModel,
      evidence: 'original-server-delivery-and-client-position-plus-eye-getter-source-checked',
      listenerReferenceScope: 'Editor nominal standing reference uses the original Java float eye-height getter. Actual world pose, native context equivalence and game recordings remain unverified; no measurement is inherited from another release.',
    },
  };
}
