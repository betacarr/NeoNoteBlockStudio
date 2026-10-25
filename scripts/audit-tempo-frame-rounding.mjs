import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Pure arithmetic comparison: actual TempoMap versus exact rational interval
// integration. No epsilon, audio tolerance, game or UI claim.
const root = path.resolve('.local/tempo-frame-rounding', `run-${Date.now()}`); await mkdir(root, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), rate = 48000;
const helper = path.join(root, 'actual-time.mjs');
await build({ stdin: { contents: "export {tickToSeconds} from './src/core/time';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: helper });
const { tickToSeconds } = await import(pathToFileURL(helper).href);
const gcd = (a, b) => b ? gcd(b, a % b) : a;
function rationalSum(terms) { return terms.reduce(([n, d], [a, b]) => { const nextN = n * b + a * d, nextD = d * b, common = gcd(nextN, nextD); return [nextN / common, nextD / common]; }, [0n, 1n]); }
const rounded = ([n, d]) => Number((2n * n + d) / (2n * d));
function measure(ppq, tempos, tick) {
  const intervals = tempos.flatMap((tempo, index) => { const length = Math.max(0, Math.min(tick, tempos[index + 1]?.tick ?? tick) - tempo.tick); return length ? [{ ticks: length, bpm: tempo.bpm }] : []; });
  const rational = rationalSum(intervals.map(({ ticks, bpm }) => [BigInt(ticks) * BigInt(rate) * 60n, BigInt(ppq * bpm)]));
  const expected = rounded(rational), old = Math.round(tickToSeconds(tick, { ppq, tempos }) * rate);
  const groupedSeconds = Math.round(intervals.reduce((sum, { ticks, bpm }) => sum + ticks * 60 / (ppq * bpm), 0) * rate);
  const directFrames = Math.round(intervals.reduce((sum, { ticks, bpm }) => sum + ticks * rate * 60 / (ppq * bpm), 0));
  const separatelyRoundedSegments = intervals.reduce((sum, { ticks, bpm }) => sum + Math.round(ticks * rate * 60 / (ppq * bpm)), 0);
  return { ppq, tempos, tick, exactFrame: `${rational[0]}/${rational[1]}`, expected, old, groupedSeconds, directFrames, separatelyRoundedSegments };
}
function suite(name) { return { name, cases: 0, errors: { old: 0, groupedSeconds: 0, directFrames: 0, separatelyRoundedSegments: 0 }, maxFrameError: { old: 0, groupedSeconds: 0, directFrames: 0, separatelyRoundedSegments: 0 }, examples: { old: [], groupedSeconds: [], directFrames: [], separatelyRoundedSegments: [] }, oldErrorsResolvedByGrouping: 0, groupingIntroducesErrors: 0 }; }
function record(suite, value) {
  suite.cases++;
  for (const key of Object.keys(suite.errors)) if (value[key] !== value.expected) { suite.errors[key]++; suite.maxFrameError[key] = Math.max(suite.maxFrameError[key], Math.abs(value[key] - value.expected)); if (suite.examples[key].length < 12) suite.examples[key].push(value); }
  if (value.old !== value.expected && value.groupedSeconds === value.expected) suite.oldErrorsResolvedByGrouping++;
  if (value.old === value.expected && value.groupedSeconds !== value.expected) suite.groupingIntroducesErrors++;
}
const single = suite('single tempo: reproduce original 330 counterexamples');
for (const ppq of [96, 120, 240, 480, 960, 1000, 15360]) for (let bpm = 40; bpm <= 300; bpm++) for (let tick = 1; tick <= 512; tick++) record(single, measure(ppq, [{ tick: 0, bpm }], tick));
assert.equal(single.errors.old, 330);
const prefix = suite('two-tempo prefix integration');
for (const ppq of [480, 960]) for (const first of [64, 96, 120, 128, 137, 160, 176]) for (const boundary of [123, 240, 480, 960]) for (const second of [64, 96, 120, 128, 137, 160, 176]) for (let delta = 1; delta <= 512; delta++) record(prefix, measure(ppq, [{ tick: 0, bpm: first }, { tick: boundary, bpm: second }], boundary + delta));
const multi = suite('deterministic many-tempo prefixes');
let seed = 137;
const random = maximum => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
for (let test = 0; test < 10000; test++) {
  const ppq = [96, 480, 960, 1000][random(4)], tempos = [{ tick: 0, bpm: 40 + random(261) }];
  for (let index = 0, count = 2 + random(15); index < count; index++) tempos.push({ tick: tempos.at(-1).tick + 1 + random(1920), bpm: 40 + random(261) });
  record(multi, measure(ppq, tempos, tempos.at(-1).tick + 1 + random(960)));
}
const repeated = suite('adversarial exact-half prefix with repeated identical tempo messages');
for (const count of [11, 33, 55, 77, 99, 121]) record(repeated, measure(960, Array.from({ length: count }, (_, tick) => ({ tick, bpm: 176 })), count));
const report = { schema: 1, checkedAt: new Date().toISOString(), sampleRate: rate,
  scope: 'Pure actual-source time conversion and exact BigInt rational frame oracle for explicitly listed integer BPM/tick fixtures; no native/hardware/game music timing acceptance.',
  sources: { 'scripts/audit-tempo-frame-rounding.mjs': hash(await readFile('scripts/audit-tempo-frame-rounding.mjs')), 'src/core/time.ts': hash(await readFile('src/core/time.ts')) },
  algorithms: { old: 'actual TempoMap seconds(tick) * rate, rounded once', groupedSeconds: 'sum(delta * 60 / (ppq*bpm)) * rate, rounded once', directFrames: 'sum(delta * rate * 60 / (ppq*bpm)), rounded once', separatelyRoundedSegments: 'sum(round(delta * rate * 60 / (ppq*bpm)))', oracle: 'sum exact BigInt fractions, then a single positive half-up rounding' },
  suites: [single, prefix, multi, repeated],
  recommendation: 'An explicit integer event frame avoids a second seconds-to-frame conversion in the worker. Regrouping operations alone is not a general prefix/tie proof; preserve fractional-frame prefix information and round once. Do not round each tempo segment independently or add an acoustic tolerance/epsilon.',
  limitations: ['Integer BPM fixtures only; MIDI microseconds-per-quarter / arbitrary decimal BPM representation needs its own explicit contract.', 'No product or existing accepted report is modified.'] };
await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ root, report: path.join(root, 'report.json'), sha256: hash(await readFile(path.join(root, 'report.json'))), suites: report.suites.map(({ examples, ...suite }) => ({ ...suite, prefixDirectFrameExample: examples.directFrames[0], groupedExample: examples.groupedSeconds[0] })) }, null, 2));
