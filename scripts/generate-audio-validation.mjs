import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { digest } from './research-utils.mjs';
import { reviewLwjgl2122ContextEvidence } from './review-lwjgl2122-context.mjs';

const versions = [
  { version: '1.13', single: 36, batches: 4, maxVoices: 24, master: 'master-07' },
  ...['1.14', '1.14.3', '1.14.4', '1.16.5', '1.19', '1.19.2', '1.20.2', '1.20.5', '1.21.5'].map(version => ({ version, single: 54, batches: 5, maxVoices: 64, master: 'master-gain' })),
  ...['1.21.8', '1.21.9'].map(version => ({ version, maxVoices: 64, volumeBoundary: true })),
  { version: '26.3', single: 66, batches: 5, maxVoices: 64, master: 'master-gain' },
];
// Exact PCM under a replaced context is diagnostic evidence, not proof that
// the original context was preserved. Keep the correction bound to its audit.
const contextAudit = await reviewLwjgl2122ContextEvidence();
const contextEvidence = 'docs/evidence/java-1.12.2-context-audit.json';
const excludedProfiles = [{ id: 'java-1.12.2', status: 'excluded-normalized-candidate',
  reason: contextAudit.classification, singleNoteCandidateCases: 45, simultaneousCandidateCases: 4,
  evidence: { path: contextEvidence, sha256: digest(await readFile(contextEvidence), 'sha256') },
  historicalReports: contextAudit.affectedReports.map(item => ({ path: item.originalPath, sha256: item.snapshotSha256, cases: item.scenes })),
}];
assert(!versions.some(item => excludedProfiles.some(excluded => excluded.id === `java-${item.version}`)), 'Excluded context candidates cannot become measured profiles');
// Registry status must not survive a change in the code/facts being certified.
const currentSources = Object.fromEntries(await Promise.all([
  'electron/audio-worker.ts', 'electron/vorbis.ts', 'electron/java-decoder.ts', 'electron/java/NbsxVorbisDecoder.java', 'src/core/project.ts', 'src/core/time.ts', 'src/audio/legacy.ts', 'src/audio/delivery.ts',
  'src/audio/parameters.ts', 'src/audio/volume.ts', 'src/audio/context.ts', 'src/audio/profiles.ts',
  'src/audio/engine.ts', 'src/core/reference.ts', 'src/core/transport.ts', 'src/core/recording.ts', 'src/data/audio-facts.json', 'src/data/early-audio-facts.json', 'src/data/legacy-audio-facts.json', 'src/data/world-audio-facts.json',
].map(async file => [file, digest(await readFile(file), 'sha256')])));
const profiles = [];
for (const settings of versions) {
  const { version, single, batches, maxVoices } = settings;
  const metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`, 'utf8'));
  const cohorts = settings.volumeBoundary ? [
    { name: 'volume-category05', cases: 9, hrtf: false, voices: 1, master: 1, category: .5 },
    { name: 'volume-category02-master07', cases: 9, hrtf: false, voices: 1, master: .7, category: .2 },
    { name: 'volume-category02-master07-polyphony', cases: 5, hrtf: false, voices: maxVoices, master: .7, category: .2 },
  ] : [
    { name: 'single-note', cases: single, hrtf: false, voices: 1, master: 1, category: 1 },
    { name: settings.master, cases: 9, hrtf: false, voices: 1, master: .7, category: 1 },
    { name: 'polyphony', cases: batches, hrtf: false, voices: maxVoices, master: 1, category: 1 },
    ...(!settings.noHrtf?[
      { name: 'hrtf', cases: single, hrtf: true, voices: 1, master: 1, category: 1 },
      { name: 'polyphony-hrtf', cases: batches, hrtf: true, voices: maxVoices, master: 1, category: 1 },
    ]:[]),
    ...(version === '26.3' ? [
      { name: 'category-gain', cases: 9, hrtf: false, voices: 1, master: .7, category: .2 },
      { name: 'polyphony-category-gain', cases: 5, hrtf: false, voices: maxVoices, master: .7, category: .2 },
    ] : []),
    ...(version === '1.19.2' ? [
      { name: 'game-forced-on-option-off', cases: 9, hrtf: true, gameOption: false, forced: 'on', voices: 1, master: 1, category: 1 },
      { name: 'game-forced-off-option-on', cases: 9, hrtf: false, gameOption: true, forced: 'off', voices: 1, master: 1, category: 1 },
    ] : []),
    ...(['1.20.2', '1.20.5'].includes(version) ? [
      { name: 'game-option-on-default', cases: 9, hrtf: false, gameOption: true, voices: 1, master: 1, category: 1 },
    ] : []),
  ];
  const reports = [];
  for (const cohort of cohorts) {
    const evidence = `docs/evidence/java-${version}-${cohort.name}-world.json`;
    const report = JSON.parse(await readFile(evidence, 'utf8'));
    assert.equal(report.version, version); assert.equal(report.clientSha1, metadata.downloads.client.sha1);
    assert(report.exact && report.observations.length === cohort.cases && report.observations.every(item => item.noteEvents > 0 && item.exact && item.maxPcmError === 0 && item.recordingSha256 === item.renderedSha256), `Incomplete ${evidence}`);
    assert.equal(report.settings.hrtf, cohort.hrtf);
    assert.equal(Math.fround(report.settings.masterGain), Math.fround(cohort.master));
    assert.equal(Math.fround(report.settings.recordCategoryVolume), Math.fround(cohort.category));
    assert.equal(report.settings.sampleRate, 48000); assert.equal(report.settings.channels, 2);
    assert.equal(Math.max(...report.observations.map(item => item.deliveredSources)), cohort.voices);
    assert(report.observations.every(item => item.editorHrtfApplied === cohort.hrtf && (settings.noHrtf?item.hrtfStatus==='unsupported'&&item.hrtfSupported===false:item.hrtfStatus === (cohort.hrtf ? 1 : 0))), `Missing original/editor HRTF state in ${evidence}`);
    if(settings.noHrtf){assert.equal(report.settings.originalHrtfSupported,false);assert.equal(report.settings.productBroadcastIntegrated,true);}
    if(['1.14.3','1.14.4'].includes(version)){
      assert(report.broadcast && report.settings.preflight===false);
      assert.equal(report.settings.hrtfComparison,'controlled-loopback-backend'); assert.equal(report.settings.gameHrtfControl,false);
      assert(report.contextComparison?.startsWith('One continuous production-renderer context'));
      const verifier=version==='1.14.4'?'scripts/verify-mapped144-world.mjs':'scripts/verify-early-patch-world.mjs';
      assert.equal(report.rendererSources[verifier],digest(await readFile(verifier),'sha256'));
      assert(report.observations.every(item=>item.listenerObservation?.kind==='capture-start-al-observation'&&item.listenerObservation.poseRecordedPerBlock&&item.listenerStableAcrossBlocks&&item.listenerStabilityChecks===142&&item.originalContextAttributes==='{}'&&item.outputLimiter===0&&item.editorOutputLimiter===false&&item.actualMonoSources===255&&item.editorHrtfPolicy==='controlled-loopback-backend'&&item.originalGameHrtfControl===false&&item.captureContextAttributes.includes(`6546=${cohort.hrtf?1:0}`)&&(!cohort.hrtf||typeof item.selectedHrtfProfile==='string'&&item.selectedHrtfProfile.length>0&&item.selectedHrtfProfile===item.editorHrtfProfile)),`Missing original early-patch context/pose in ${evidence}`);
    }
    if(settings.volumeBoundary){
      assert(report.broadcast && report.contextComparison?.startsWith('One continuous editor context'));
      for(const file of ['scripts/verify-volume-boundary-world.mjs','scripts/capture-volume-boundary-world.mjs','scripts/java/VolumeBoundaryWorldAgent.java','electron/vorbis.ts','electron/java/NbsxVorbisDecoder.java']) assert.equal(report.rendererSources[file],digest(await readFile(file),'sha256'));
      for(const item of report.observations){
        assert.equal(item.originalMasterOption,cohort.master); assert.equal(item.originalRecordsOption,cohort.category);
        assert.equal(item.originalDirectionalOption,'false'); assert.equal(item.cameraStable,'true'); assert.equal(item.cameraSamples,143);
        assert.equal(item.originalContextAttributes,'{6546=0, 6550=0, 6554=1}');
        assert(item.captureContextAttributes.includes('6546=0')&&item.captureContextAttributes.includes('6550=0')&&item.captureContextAttributes.includes('6554=1'));
        assert.equal(item.outputLimiter,1); assert.equal(item.editorOutputLimiter,true); assert.equal(item.editorHrtfPolicy,'context-attributes');
        assert.equal(item.editorGameDevice?.directional,false); assert.equal(item.editorGameDevice?.control,'context-attributes');
        assert.deepEqual(item.editorGameDevice?.contextAttributes,[6546,0,6550,0,6554,1]);
        assert.equal(item.listenerGain,version==='1.21.8'?Math.fround(cohort.master):1);
        const gain=version==='1.21.8'?Math.min(1,Math.fround(3*Math.fround(cohort.category))):Math.fround(Math.fround(cohort.category)*Math.fround(cohort.master));
        assert(item.voices.every(voice=>voice.gain===gain),`Original source gain ownership differs in ${evidence}`);
      }
    }
    if(['1.20.2','1.20.5','1.21.5','26.3'].includes(version)){
      assert(report.contextComparison?.startsWith('One continuous editor context'),'Limiter cohorts must preserve original mixer history');
      assert(report.observations.every(item=>item.outputLimiter===1&&item.editorOutputLimiter===true&&item.originalContextAttributes?.includes('6554=1')&&item.captureContextAttributes?.includes('6554=1')),`Missing original/applied limiter evidence in ${evidence}`);
    }
    if(['1.19.2','26.3'].includes(version)&&cohort.gameOption===undefined) assert(report.observations.every(item=>item.editorHrtfPolicy===(version==='1.19.2'?'explicit-reset':'context-attributes')&&item.editorGameDevice?.control===item.editorHrtfPolicy&&item.editorGameDevice?.option===cohort.hrtf&&item.editorGameDevice?.directional===cohort.hrtf&&typeof item.editorHrtfRequestedProfile==='string'),`Missing production original-game request/actual device in ${evidence}`);
    if(['1.20.2','1.20.5'].includes(version)&&cohort.gameOption===undefined) assert(report.settings.hrtfComparison==='controlled-loopback-backend'&&report.observations.every(item=>item.editorHrtfPolicy==='first-profile'&&item.editorGameHrtfPolicy==='explicit-reset'&&item.captureContextAttributes?.includes(`6546=${cohort.hrtf?1:0}`)&&typeof item.editorHrtfRequestedProfile==='string'),`Controlled mixer evidence must not impersonate the actual regular-device game option in ${evidence}`);
    if(cohort.gameOption!==undefined){
      assert(report.broadcast); assert.equal(report.settings.gameOption,cohort.gameOption); assert.equal(report.settings.forced,cohort.forced);
      const config=`[general]\nfrequency = 48000\nhrtf = ${cohort.forced==='on'?'true':cohort.forced==='off'?'false':'auto'}\nstereo-mode = speakers\n`;
      assert.deepEqual(report.settings.backendConfiguration,{file:'alsoft.ini',sha256:digest(Buffer.from(config),'sha256')});
      assert.equal(report.rendererSources['scripts/verify-game-option-world.mjs'],digest(await readFile('scripts/verify-game-option-world.mjs'),'sha256'));
      for(const item of report.observations){
        assert.equal(item.maxPcmError,0); assert.equal(item.recordingSha256,item.renderedSha256);
        assert.equal(item.originalGameOption,String(cohort.gameOption)); assert.equal(item.originalResetCalls,1);
        assert.equal(item.originalResetAttributes,`{6546=${cohort.gameOption?1:0}, 6550=0}`);
        assert(item.listenerStableAcrossBlocks&&item.listenerStabilityChecks===142);
        assert.equal(item.editorHrtfPolicy,'explicit-reset'); const device=item.editorGameDevice; assert(device);
        assert.equal(device.control,'explicit-reset'); assert.equal(device.option,cohort.gameOption); assert.equal(device.directional,cohort.hrtf);
        assert(device.name&&device.sampleRate===48000&&device.requestedProfile); assert.equal(device.resetSucceeded,true);
        assert.deepEqual(device.resetAttributes,[6546,cohort.gameOption?1:0,6550,0,0]);
        if(cohort.forced){
          const original=item.originalRegularDevice; assert(original);
          assert.equal(original.deviceKind,'original-regular-device-no-audio-played'); assert.equal(original.sourcesPlayed,'0');
          assert.equal(original.requestedHrtfProfileIndex,'0'); assert.equal(original.originalResetAttributes,item.originalResetAttributes);
          assert.equal(original.originalContextAttributes,'{}'); assert.equal(original.gameHrtfRequested,String(cohort.gameOption));
          assert.equal(Number(original.hrtfEnabled),cohort.hrtf?1:0); assert.equal(Number(original.hrtfStatus),cohort.hrtf?3:2);
          assert.equal(device.status,Number(original.hrtfStatus)); assert.equal(device.name,original.actualDeviceName);
          assert.equal(device.profile??null,original.selectedHrtfProfile??null); assert.equal(device.sampleRate,Number(original.contextSampleRate));
          assert.deepEqual(device.contextAttributes,[]); assert.equal(item.originalContextAttributes,'{}');
          assert.equal(item.contextHrtfAdaptation,'observed-regular-effective-state-replayed-at-loopback-context');
          assert(item.captureContextAttributes.includes(`6546=${cohort.hrtf?1:0}`));
        }else{
          assert.equal(device.status,0); assert.deepEqual(device.contextAttributes,[6554,1]);
          assert.equal(item.originalContextAttributes,'{6554=1}'); assert.equal(item.contextHrtfAdaptation,'none');
          assert(!item.captureContextAttributes.includes('6546=')&&!item.captureContextAttributes.includes('6550='));
        }
        if(cohort.hrtf) assert.equal(item.editorHrtfProfile,item.selectedHrtfProfile);
      }
    }
    if(version==='1.21.5'){
      assert(report.broadcast,'The context-boundary cohort must use the production broadcast policy');
      assert(report.observations.every(item=>item.editorHrtfPolicy==='context-attributes'&&item.editorGameDevice?.control==='context-attributes'&&item.editorGameDevice?.directional===cohort.hrtf&&item.hrtfProfileCount>0&&item.editorHrtfRequestedProfile===item.hrtfProfileZero&&item.originalDirectionalOption===String(cohort.hrtf)&&item.originalContextAttributes.includes(`6546=${cohort.hrtf?1:0}`)&&item.originalContextAttributes.includes('6550=0')&&(!cohort.hrtf||item.editorHrtfProfile===item.hrtfProfile)),`Missing original/production HRTF context/profile in ${evidence}`);
    }
    if(version==='1.19'){
      assert(report.broadcast,'The enable-only cohort must use the production broadcast policy');
      assert(report.observations.every(item=>item.originalGameOption===String(cohort.hrtf)&&item.originalResetCalls===(cohort.hrtf?1:0)&&item.originalContextAttributes==='{}'&&item.listenerStableAcrossBlocks&&item.listenerStabilityChecks>0),`Missing original enable-only option/pose observations in ${evidence}`);
      assert(report.observations.every(item=>cohort.hrtf
        ?item.editorHrtfPolicy==='enable-only-reset'&&item.originalResetAttributes==='{6546=1, 6550=0}'&&item.contextHrtfAdaptation==='original-reset-request-replayed-at-loopback-context-creation'&&item.captureContextAttributes.includes('6546=1')&&item.captureContextAttributes.includes('6550=0')&&item.editorHrtfProfile===item.selectedHrtfProfile
        :item.editorHrtfPolicy==='device-default'&&item.originalResetAttributes==='not-called'&&!item.captureContextAttributes.includes('6546=')&&item.editorDefaultDevice?.directional===false),`Missing default/reset distinction in ${evidence}`);
    }
    for (const [file, sha256] of Object.entries(currentSources)) assert.equal(report.rendererSources[file], sha256, `Stale renderer/facts in ${evidence}: ${file}`);
    reports.push({ report, evidence, cohort });
  }
  profiles.push({ id: `java-${version}`, clientSha1: metadata.downloads.client.sha1,
    singleNoteWorldCases: reports.filter(item => item.cohort.voices === 1).reduce((sum, item) => sum + item.report.observations.length, 0),
    simultaneousWorldCases: reports.filter(item => item.cohort.voices > 1).reduce((sum, item) => sum + item.report.observations.length, 0),
    maxSimultaneousVoices: maxVoices, hrtf: settings.noHrtf||settings.volumeBoundary?[false]:[false, true], hrtfUnsupported:!!settings.noHrtf, status: 'partially-measured',
    scope: `Windows x64, actual integrated world, ${settings.volumeBoundary?'selected gain-boundary scenes at category .5/master 1 and category .2/master .7':'canonical instruments'}, single notes and simultaneous batches up to ${maxVoices} voices, ${settings.noHrtf?'HRTF off; original backend has no HRTF extension':settings.volumeBoundary?'HRTF off only; HRTF-on not measured':'controlled backend HRTF off/on'}; excludes onset scheduling, complete editor-to-world camera projection and hardware output`,
    evidence: reports.map(item => item.evidence) });
}
await writeFile('src/data/audio-validation.json', JSON.stringify({ schema: 2, profiles, excludedProfiles }, null, 2));
console.log(JSON.stringify({ profiles: profiles.length,
  singleNoteWorldCases: profiles.reduce((sum, profile) => sum + profile.singleNoteWorldCases, 0),
  simultaneousWorldCases: profiles.reduce((sum, profile) => sum + profile.simultaneousWorldCases, 0) }));
