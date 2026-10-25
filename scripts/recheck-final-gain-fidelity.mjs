import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { digest } from './research-utils.mjs';

// Retain the first strict follow-up as a dated result, and reuse its immutable
// probe through an independent output path for final expanded-source checks.
const output = path.resolve('.local/final-gain-fidelity', `run-${Date.now()}`); await mkdir(output, { recursive: true });
const reference = async file => ({ path: path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/'), sha256: digest(await readFile(file), 'sha256') });
const priorFile = 'docs/evidence/java-1.21.8-1.21.9-strict-gain-components.json';
const prior = await reference(priorFile), priorReport = JSON.parse(await readFile(priorFile));
assert.equal(priorReport.strictAllBitExact, true);
const probe = priorReport.helpers.find(item => item.path === 'scripts/probe-strict-volume-boundary.mjs');
assert(probe); assert.deepEqual(await reference(probe.path), probe, 'The dated strict helper must remain unchanged.');
const sources = [...new Set([...Object.keys(priorReport.productSources), 'src/audio/parameters.ts', 'src/data/legacy-audio-facts.json'])];
const productSources = Object.fromEntries(await Promise.all(sources.map(async file => [file, (await reference(file)).sha256])));
const componentFile = path.join(output, 'component-base.json');
const child = spawn(process.execPath, [probe.path, '--write-evidence', '--evidence', componentFile], { windowsHide: true, stdio: 'inherit' });
const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
const component = JSON.parse(await readFile(componentFile));
for (const [file, sha256] of Object.entries(productSources)) assert.equal((await reference(file)).sha256, sha256, `Source changed during final component recheck: ${file}`);
assert.deepEqual(await reference(priorFile), prior, 'Dated strict result changed.');
for (const [file, sha256] of Object.entries(component.productSources)) assert.equal(productSources[file], sha256);
const report = {
  ...component,
  finalRecheckOutput: output,
  priorFollowup: prior,
  rawComponentReport: await reference(componentFile),
  expandedProvenanceScope: 'Final product volume/parameters and all imported audio fact tables are bound. The original strict gain probe is reused unchanged; pitch method/component evidence is separate.',
  productSources,
  driver: await reference('scripts/recheck-final-gain-fidelity.mjs'),
};
const destination = path.join(output, 'report.json'); await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--write-evidence')) await writeFile('docs/evidence/java-1.21.8-1.21.9-final-gain-components.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: destination, componentRows: report.componentRows, strictAllBitExact: report.strictAllBitExact, priorFollowupPreserved: true }));
assert.equal(exit, report.strictAllBitExact ? 0 : 1, 'Probe exit does not match strict bit result.');
if (!report.strictAllBitExact) process.exitCode = 1;
