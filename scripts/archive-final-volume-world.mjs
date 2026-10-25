import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { digest } from './research-utils.mjs';

const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
assert(argument('--result'), 'Pass the explicit completed six-report matrix result with --result.');
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), sha256: digest(await readFile(file), 'sha256') });
const currentGain = await reference('docs/evidence/java-1.21.8-1.21.9-final-gain-components.json');
const currentPitch = await reference('docs/evidence/java-1.21.8-1.21.9-pitch-order-components.json');
const gain = JSON.parse(await readFile(currentGain.path)), pitch = JSON.parse(await readFile(currentPitch.path));
const result = JSON.parse(await readFile(argument('--result'))); assert.equal(result.status, 'complete'); assert.equal(result.worldScenes, 46); assert.equal(result.cohorts.length, 6);
const world = JSON.parse(await readFile(result.cohorts[0].report));
assert.equal(gain.strictAllBitExact, true); assert.equal(gain.componentRows, 2624); assert.equal(gain.worldScenesAdded, 0);
assert.equal(pitch.strictBitExact, true); assert.equal(pitch.componentRows, 400); assert.equal(pitch.worldScenesAdded, 0);
for (const report of [gain, pitch]) {
  for (const [file, sha256] of Object.entries(report.productSources)) {
    assert.equal((await reference(file)).sha256, sha256, `Stale follow-up source: ${file}`);
    if (world.rendererSources[file]) assert.equal(world.rendererSources[file], sha256, `World/component source mismatch: ${file}`);
  }
}
// Validate the separate component results before the capture archiver writes
// the shared manifest; stale component evidence must not partially replace it.
const child = spawn(process.execPath, ['scripts/archive-volume-boundary-matrix.mjs', '--result', argument('--result')], { windowsHide: true, stdio: 'inherit' });
const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }); assert.equal(exit, 0);
const destination = 'docs/evidence/java-1.21.8-1.21.9-volume-world-matrix.json';
const matrix = JSON.parse(await readFile(destination));
const componentBaseline = matrix.components, signedZeroBaseline = matrix.signedZero;
delete matrix.signedZero;
matrix.components = currentGain;
matrix.pitchComponents = currentPitch;
matrix.datedComponentBaseline = { release: '0.1.12', components: componentBaseline, signedZero: signedZeroBaseline, componentGainBitExact: false, scope: 'Unchanged historic component evidence; 109 signed-zero differences and the old both-NaN comparison waiver belong to this baseline.' };
matrix.datedFirstStrictFollowup = {
  components: await reference('docs/evidence/java-1.21.8-1.21.9-strict-gain-components.json'),
  clampReview: await reference('docs/evidence/java-1.21.8-1.21.9-gain-clamp-review.json'),
  scope: 'The first successful strict component recheck is retained unchanged with its original source hashes. Final expanded-source checks are separately referenced above.',
};
matrix.componentGainBitExact = true;
matrix.componentResidualScope = 'Final gain follow-up: 2624/2624 raw-bit comparisons exact, with no signed-zero or NaN waiver. The dated baseline remains separate; synthetic domains do not add world coverage.';
matrix.pitchBitExact = true;
matrix.gainComponentRows = 2624;
matrix.pitchComponentRows = 400;
matrix.expandedComponentSources = gain.productSources;
matrix.captureArchiveHelper = matrix.archiveScript;
matrix.archiveScript = await reference('scripts/archive-final-volume-world.mjs');
matrix.scope = 'Six original Java 1.21.8/1.21.9 integrated-world recordings re-compared against final production sources. HRTF off only. Separate final gain and pitch component results do not increase the 46-world-scene count.';
await writeFile(destination, JSON.stringify(matrix, null, 2) + '\n');
console.log(JSON.stringify({ destination, worldScenes: matrix.totalWorldScenes, gainRows: matrix.gainComponentRows, pitchRows: matrix.pitchComponentRows, exact: true, baselinePreserved: true }));
