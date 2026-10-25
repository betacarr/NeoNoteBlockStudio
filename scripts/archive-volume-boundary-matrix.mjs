import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { digest } from './research-utils.mjs';

const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const resultFile = argument('--result');
assert(resultFile, 'Pass the explicit completed matrix-verification JSON with --result.');
const bytes = await readFile(resultFile), result = JSON.parse(bytes);
assert.equal(result.status, 'complete');
assert.equal(result.worldScenes, 46);
assert.equal(result.cohorts.length, 6);
const relative = file => path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/');
const reference = async file => ({ path: relative(file), sha256: digest(await readFile(file), 'sha256') });
const manifest = await reference(result.manifest);
assert.equal(manifest.sha256, result.manifestSha256);
assert.equal((await reference('scripts/verify-volume-boundary-matrix.mjs')).sha256, result.scriptSha256);

let rendererSources;
const cohorts = [];
for (const cohort of result.cohorts) {
  const reportReference = await reference(cohort.report);
  assert.equal(reportReference.sha256, cohort.sha256);
  const report = JSON.parse(await readFile(cohort.report));
  assert(report.exact && report.broadcast);
  assert.equal(report.version, cohort.version);
  assert.equal(report.observations.length, cohort.count);
  assert.equal(report.settings.hrtf, false);
  assert.equal(report.settings.masterGain, cohort.master);
  assert.equal(report.settings.recordCategoryVolume, cohort.records);
  if (rendererSources) assert.deepEqual(report.rendererSources, rendererSources);
  else rendererSources = report.rendererSources;
  const directory = cohort.directory;
  const provenance = await reference(path.join(directory, 'provenance.json'));
  assert.equal(provenance.sha256, cohort.provenanceSha256);
  const files = {};
  for (const name of ['cases.json', 'actual-options.properties', 'agent.properties', 'complete.txt', 'active-process.json', 'capture-volume-boundary-world.mjs', 'VolumeBoundaryWorldAgent.java', 'world-capture-agent.jar']) {
    files[name] = await reference(path.join(directory, name));
  }
  assert.equal(files['VolumeBoundaryWorldAgent.java'].sha256, cohort.agentSourceSha256);
  assert.equal(files['world-capture-agent.jar'].sha256, cohort.agentSha256);
  const scenes = [];
  for (const observation of report.observations) {
    assert(observation.exact);
    assert.equal(observation.changedSamples, 0);
    assert.equal(observation.maxPcmError, 0);
    assert.equal(observation.cameraSamples, 143);
    assert.equal(observation.cameraStable, 'true');
    assert.equal(observation.editorHrtfApplied, false);
    assert.equal(observation.hrtfStatus, 0);
    assert.equal(observation.outputLimiter, 1);
    assert.equal(observation.editorOutputLimiter, true);
    const pcm = await reference(path.join(directory, `case-${observation.case}.pcm`));
    assert.equal(pcm.sha256, observation.recordingSha256);
    assert.equal(pcm.sha256, observation.renderedSha256);
    scenes.push({
      case: observation.case,
      scene: observation.scene,
      voices: observation.voices.length,
      delivery: observation.delivery,
      pcm,
      properties: await reference(path.join(directory, `case-${observation.case}.properties`)),
      exact: true,
      maxPcmError: 0,
    });
  }
  const first = report.observations[0];
  cohorts.push({
    version: cohort.version,
    capture: cohort.capture,
    captureDirectory: relative(directory),
    label: cohort.label,
    scenes: cohort.count,
    master: cohort.master,
    records: cohort.records,
    polyphony: cohort.polyphony,
    hrtf: false,
    report: reportReference,
    provenance,
    files,
    originalContextAttributes: first.originalContextAttributes,
    captureContextAttributes: first.captureContextAttributes,
    actualContextAttributes: first.actualContextAttributes,
    originalOutputLimiter: first.outputLimiter,
    productOutputLimiter: first.editorOutputLimiter,
    cameraAtCapture: first.cameraAtCapture,
    listenerPosition: first.listenerPosition,
    listenerOrientation: first.listenerOrientation,
    cameraSamplesPerScene: 143,
    cameraStable: true,
    contextComparison: report.contextComparison,
    sceneFiles: scenes,
  });
}
for (const [file, sha256] of Object.entries(rendererSources)) {
  assert.equal((await reference(file)).sha256, sha256, `Frozen renderer source changed: ${file}`);
}
const sourceEvidence = await Promise.all(['1.21.8', '1.21.9'].map(version => reference(`docs/evidence/java-${version}-volume-boundary-source.json`)));
const components = await reference('docs/evidence/java-1.21.8-1.21.9-volume-components.json');
const signedZero = await reference('docs/evidence/java-1.21.8-1.21.9-signed-zero-components.json');
const residual = JSON.parse(await readFile(signedZero.path));
assert.equal(residual.strictGainBitExact, false);
assert.equal(residual.worldScenesAdded, 0);
assert.equal(residual.componentReport.path, components.path);
assert.equal(residual.componentReport.sha256, components.sha256);
assert.equal(residual.records.reduce((count, record) => count + record.signedZeroDifferenceCount, 0), 109);
const output = {
  schema: 1,
  scope: 'Six independent original integrated-world captures at the Java 1.21.8/1.21.9 volume-placement boundary, compared against frozen production broadcast and native render paths. HRTF off only.',
  totalWorldScenes: 46,
  reports: 6,
  exact: true,
  maxPcmError: 0,
  prechecksAddedToCount: 0,
  componentRowsAddedToWorldCount: 0,
  matrixManifest: manifest,
  verification: await reference(resultFile),
  sourceEvidence,
  components,
  signedZero,
  componentGainBitExact: false,
  componentResidualScope: 'Original Java clamp preserves negative zero in 109 component rows; production clamp canonicalizes it to positive zero. Numeric equality does not certify gain bit equality. No PCM tolerance was introduced.',
  contextReadbackScope: 'Original attributes 6546=0,6550=0,6554=1 were preserved; actual attributes and HRTF status/profile were recorded. ALC_ALL_ATTRIBUTES omits 6550 while HRTF is disabled. No enabled-HRTF/profile equivalence is claimed.',
  cameraScope: 'Original Camera and AL listener were recorded at scene start, each 1024-frame block, and end (143 samples per 3-second scene); sampled poses remained unchanged. Render requests use the observed absolute listener/source coordinates.',
  diagnosticNotAccepted: {
    path: '.local/world-volume-boundary/1.21.8/capture-1792788776642/comparison-baseline.json',
    scope: 'Earlier direct-mixer diagnostic without server delivery filtering: 8/9 exact, up48 scene differs by 8 LSB. Excluded from accepted scene count. The six formal reports all use --broadcast and are exact.',
    ...(await reference('.local/world-volume-boundary/1.21.8/capture-1792788776642/comparison-baseline.json')),
  },
  rendererSources,
  cohorts,
  archiveScript: await reference('scripts/archive-volume-boundary-matrix.mjs'),
  limitations: [
    'The 46 scenes cover two specified gain settings and five polyphony sizes per version, not every numeric setting or audio event type.',
    'Component probes allocate explicit synthetic original class state and invoke original methods; they do not simulate an entire running engine.',
    'Nonfinite synthetic raw-instance inputs are robustness probes, not note-block outputs or accepted category/master Options values.',
    'No HRTF-on, physical output-device acoustics, scheduling latency, or moving-listener scene was measured.',
  ],
};
const destination = 'docs/evidence/java-1.21.8-1.21.9-volume-world-matrix.json';
await writeFile(destination, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ destination, scenes: 46, reports: 6, exact: true, maxPcmError: 0 }));
