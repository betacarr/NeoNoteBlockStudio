import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { digest } from './research-utils.mjs';
import { reviewedVolumeBoundarySource } from './audit-volume-boundary-source.mjs';

const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
assert(argument('--report') && argument('--diagnostic'), 'Pass explicit --report and --diagnostic JSON files.');
const relative = file => path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/');
const reference = async file => ({ path: relative(file), sha256: digest(await readFile(file), 'sha256') });
const reportReference = await reference(argument('--report')), diagnosticReference = await reference(argument('--diagnostic'));
const report = JSON.parse(await readFile(reportReference.path)), diagnostic = JSON.parse(await readFile(diagnosticReference.path));
assert.equal(report.strictAllBitExact, true);
assert.equal(report.strictNoteBlockAcceptedOptionsBitExact, true);
assert.equal(report.componentRows, 2624);
assert.equal(report.worldScenesAdded, 0);
assert.equal(diagnostic.strictAllBitExact, false);
assert.equal(diagnostic.strictNoteBlockAcceptedOptionsBitExact, true);
assert.equal(report.records.length, 2);
for (const item of [...report.helpers, ...diagnostic.helpers.filter(item => item.path.startsWith('.local/'))]) assert.deepEqual(await reference(item.path), item);
for (const [file, sha256] of Object.entries(report.productSources)) assert.equal((await reference(file)).sha256, sha256);
for (const item of [report.baseline, report.signedZeroBaseline, diagnostic.baseline, diagnostic.signedZeroBaseline]) assert.deepEqual(await reference(item.path), item);
const published = await reference('docs/evidence/java-1.21.8-1.21.9-strict-gain-components.json');
assert.equal(published.sha256, reportReference.sha256);
const versions = [];
for (const item of report.records) {
  const source = await reviewedVolumeBoundarySource(item.version);
  assert.equal(item.cases, 1312); assert.equal(item.strictBitExact, true); assert.equal(item.differences.length, 0);
  for (const file of item.rawFiles) assert.deepEqual(await reference(file.path), file);
  const previous = diagnostic.records.find(record => record.version === item.version);
  assert(previous && !previous.strictBitExact);
  for (const file of previous.rawFiles) assert.deepEqual(await reference(file.path), file);
  const binding = source.bindings.find(binding => binding.role === 'net.minecraft.util.Mth.clamp(FFF)F');
  assert.equal(binding.codeSha256, 'bcb2fca6a64bcce5b877df6c579faf75018f548a5800f32030e49a16a999d5f6');
  const mathClass = source.classes.find(record => record.name === 'net.minecraft.util.Mth');
  const samples = ['80000000', '00000000', 'bf800000', '00000001', '7fc00000', 'ffc00000', '7fc12345', 'ffc12345', '7f812345', 'ff812345'].map(input => {
    const row = item.observations.find(record => record.input.rawBits === input); assert(row);
    return { inputBits: input, observedInputBits: row.input.observedJavaRawBits, originalClampBits: row.original.directClampBits, originalMathMinBits: row.original.directMathMinBits };
  });
  versions.push({ version: item.version, originalClampClass: mathClass, originalClampMethod: binding,
    rawEvidence: source.rawEvidence, source: item.sourceEvidence, observedClampSamples: samples,
    cases: item.cases, domains: item.domains, strictAllBitExact: true,
    nativeAppliedRows: item.observations.filter(row => row.nativeApplied).length,
    failedDiagnosticDifferences: previous.differences.length,
    failedDiagnosticDomains: previous.domains,
  });
}
const runtime = JSON.parse(await readFile('.local/runtimes/temurin-21/runtime.json'));
const runtimeArchive = await reference('.local/runtimes/temurin-21/runtime.zip');
assert.equal(runtimeArchive.sha256, runtime.checksum);
const publicReview = {
  schema: 1,
  scope: 'Independent Java 1.21.8/1.21.9 original float-clamp and gain-fidelity follow-up. Original classes and OpenAL methods on explicitly constructed synthetic component state; no additional world coverage.',
  baselineRelease: '0.1.12', baseline: report.baseline, signedZeroBaseline: report.signedZeroBaseline,
  baselineCaveat: 'The earlier component helper treated both-NaN values as bit-equivalent. Its signed-zero list therefore did not enumerate NaN sign/payload differences. That dated baseline is unchanged; this follow-up compares every raw bit without a NaN waiver.',
  failedDiagnostic: diagnosticReference, passedRawReport: reportReference, passedReport: published,
  strictAllBitExact: true, componentRows: 2624, worldScenesAdded: 0,
  clampSemantics: {
    descriptor: '(FFF)F',
    originalControlFlow: 'If value < lower, return lower; otherwise return java.lang.Math.min(float value,float upper).',
    fixedUnitBounds: 'For fixed lower +0 and upper +1, comparison branches preserve input negative zero and input NaN sign/payload, matching the sampled original JVM behavior.',
    negativeZero: 'Compared equal to +0 at the lower check, then Math.min(-0,+1) returns -0.',
    nan: 'The original fcmpg does not take the lower branch for NaN. Original Math.min(value,+1) returned the input raw NaN bits in the sampled runtime, including signaling NaN. Subsequent SoundEngine float multiplication quieted signaling NaN while preserving the sampled sign/payload.',
    productionUnit: 'value < 0 ? 0 : value > 1 ? 1 : value',
  },
  runtime: { metadata: await reference('.local/runtimes/temurin-21/runtime.json'), archive: runtimeArchive, java: await reference(runtime.executable), version: runtime.version },
  productSources: report.productSources,
  versions,
  limitations: [
    'Only raw-volume3 with original-validator-accepted Options models the note-block component input domain. Finite arbitrary instances, nonfinite instances and injected invalid Options have separately reported synthetic domains.',
    'NaN payload preservation is an observation for this Java/V8 environment and tested bit patterns, not a claim of portable payload behavior for every JVM or arithmetic instruction.',
    'NaN, infinite or otherwise invalid AL gain values are not submitted to OpenAL. Those rows compare original function return bits; nativeApplied identifies the rows with actual source/listener readback.',
    'Unsafe construction deliberately bypasses full SoundEngine and Options lifecycle. Actual integrated-world PCM is verified separately from archived recordings after final source/facts freeze.',
  ],
  helper: await reference('scripts/archive-gain-fidelity.mjs'),
};
const destination = 'docs/evidence/java-1.21.8-1.21.9-gain-clamp-review.json';
await writeFile(destination, JSON.stringify(publicReview, null, 2) + '\n');
console.log(JSON.stringify({ destination, componentRows: publicReview.componentRows, strictAllBitExact: true, worldScenesAdded: 0 }));
