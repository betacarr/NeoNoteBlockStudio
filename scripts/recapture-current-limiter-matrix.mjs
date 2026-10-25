import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { digest } from './research-utils.mjs';

// Run each original-game capture and strict comparison sequentially. Every capture
// has its own identity. Capture failures stop; polyphony differences may await the
// continuous-context oracle while the remaining original recordings continue.
const version = '26.3';
const resumeAt = process.argv.indexOf('--resume');
const resumed = resumeAt < 0 ? undefined : JSON.parse(await readFile(path.resolve(process.argv[resumeAt + 1]), 'utf8'));
if (resumed) { assert.equal(resumed.version, version); assert.notEqual(resumed.status, 'running', 'Do not resume a coordinator that is still running'); }
const root = resumed?.root ?? path.resolve('.local/current-limiter-recapture', `batch-${Date.now()}`);
await mkdir(path.join(root, 'prior-evidence'), { recursive: true });
const jobs = resumed?.jobs ?? [
  { name: 'single-note-world', scenes: 66, args: [] },
  { name: 'hrtf-world', scenes: 66, args: ['--hrtf'] },
  { name: 'master-gain-world', scenes: 9, args: ['--master', '0.7', '--quick'] },
  { name: 'polyphony-world', scenes: 5, args: ['--polyphony'] },
  { name: 'polyphony-hrtf-world', scenes: 5, args: ['--polyphony', '--hrtf'] },
  { name: 'category-gain-world', scenes: 9, args: ['--master', '0.7', '--records', '0.2', '--quick'] },
  { name: 'polyphony-category-gain-world', scenes: 5, args: ['--master', '0.7', '--records', '0.2', '--polyphony'] },
].map(job => ({ ...job, evidenceName: `java-${version}-${job.name}`, status: 'queued' }));
assert.equal(jobs.reduce((count, job) => count + job.scenes, 0), 165);
const frozenSources = ['scripts/capture-current-world.mjs', 'scripts/java/CurrentWorldCaptureAgent.java', 'scripts/verify-game-world.mjs', 'electron/audio-worker.ts', 'src/audio/legacy.ts', 'src/audio/delivery.ts', 'src/audio/parameters.ts', 'src/audio/volume.ts', 'src/audio/context.ts', 'src/audio/profiles.ts', 'src/audio/engine.ts', 'src/core/reference.ts', 'src/core/transport.ts', 'src/core/recording.ts', 'src/data/audio-facts.json', 'src/data/early-audio-facts.json', 'src/data/legacy-audio-facts.json', 'src/data/world-audio-facts.json'];
const sourceHashes = resumed?.sourceHashes ?? Object.fromEntries(await Promise.all(frozenSources.map(async file => [file, digest(await readFile(file), 'sha256')])));
const manifest = resumed ?? { schema: 1, version, startedAt: new Date().toISOString(), root, processors: 4, expectedScenes: 165, requiredOriginalOutputLimiter: 1, sourceHashes, jobs };
manifest.status = 'running'; manifest.coordinatorProcessId = process.pid; manifest.resumedAt = resumed ? new Date().toISOString() : undefined;
const save = () => writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (!resumed) for (const job of jobs) await copyFile(`docs/evidence/${job.evidenceName}.json`, path.join(root, 'prior-evidence', job.evidenceName + '.json'));
await save(); console.log(JSON.stringify({ batch: root, jobs: jobs.length, expectedScenes: manifest.expectedScenes }));

async function assertFrozen() {
  // The parent may repair the research oracle without changing frozen product
  // audio. Record the current verifier hash for each comparison below.
  for (const [file, hash] of Object.entries(sourceHashes)) if (file !== 'scripts/verify-game-world.mjs') assert.equal(digest(await readFile(file), 'sha256'), hash, `Frozen source changed: ${file}`);
}
async function run(job, phase, args) {
  const logFile = path.join(root, job.name + '-' + phase + '-' + Date.now() + '.log');
  const log = createWriteStream(logFile); (job.logs ??= []).push({ phase, path: logFile });
  const child = spawn(process.execPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  job[phase + 'ProcessId'] = child.pid;
  let buffer = '';
  const line = text => {
    try {
      const item = JSON.parse(text);
      if (phase === 'capture' && item.output) { job.captureDirectory = item.output; job.gameProcessId = item.pid ?? job.gameProcessId; }
      if (item.pid || item.exact !== undefined || item.status === 'capture-complete-not-yet-compared') console.log(JSON.stringify({ job: job.name, phase, ...item }));
    } catch {}
    const progress = text.match(/captured-case (\d+)/);
    if (progress && (Number(progress[1]) % 10 === 0 || Number(progress[1]) === job.scenes - 1)) console.log(JSON.stringify({ job: job.name, captured: Number(progress[1]) + 1, expected: job.scenes, capture: job.captureDirectory }));
  };
  child.stdout.on('data', chunk => { log.write(chunk); buffer += String(chunk); let at; while ((at = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, at).trim()); buffer = buffer.slice(at + 1); } });
  child.stderr.on('data', chunk => { log.write(chunk); process.stderr.write(chunk); });
  const heartbeat = setInterval(() => console.log(JSON.stringify({ job: job.name, phase, stillObserving: true, processId: child.pid, gameProcessId: job.gameProcessId, capture: job.captureDirectory })), 60000);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    if (buffer.trim()) line(buffer.trim()); job[phase + 'ExitCode'] = code;
    return code;
  } finally { clearInterval(heartbeat); log.end(); await save(); }
}

try {
  for (const job of jobs) {
    if (job.status === 'passed') continue;
    await assertFrozen(); job.startedAt ??= new Date().toISOString();
    if (!job.captureDirectory) {
      job.status = 'capturing'; await save();
      const exit = await run(job, 'capture', ['scripts/capture-current-world.mjs', '--processors', '4', '--timeout', '1200', ...job.args]);
      assert.equal(exit, 0, `${job.name} capture failed; remaining jobs are not started`);
    }
    assert(job.captureDirectory, 'Capture launcher did not return a recording identity');
    const captureRoot = path.resolve('.local/game-world-comparison', version);
    assert(path.resolve(job.captureDirectory).startsWith(captureRoot + path.sep));
    const provenance = JSON.parse(await readFile(path.join(job.captureDirectory, 'provenance.json'), 'utf8'));
    assert.equal(provenance.version, version); assert.equal(provenance.status, 'capture-complete-not-yet-compared');
    job.agentSha256 = provenance.agentSha256; job.agentSourceSha256 = provenance.agentSourceSha256;
    assert.equal(provenance.agentSourceSha256, sourceHashes['scripts/java/CurrentWorldCaptureAgent.java']);
    assert.equal(JSON.parse(await readFile(path.join(job.captureDirectory, 'cases.json'), 'utf8')).length, job.scenes);
    for (let i = 0; i < job.scenes; i++) {
      const properties = await readFile(path.join(job.captureDirectory, `case-${i}.properties`), 'utf8');
      assert(/^outputLimiter=1\r?$/m.test(properties), `Scene${i}: original limiter was not enabled`);
      assert(/^originalContextAttributes=.*6554\\?=1/m.test(properties), `Scene${i}: original limiter context request missing`);
      assert(/^captureContextAttributes=.*6554\\?=1/m.test(properties), `Scene${i}: capture dropped the original limiter request`);
    }
    await assertFrozen(); job.status = 'comparing'; await save();
    job.verifierSha256 = digest(await readFile('scripts/verify-game-world.mjs'), 'sha256');
    const compareExit = await run(job, 'verify', ['scripts/verify-game-world.mjs', '--version', version, '--capture', path.basename(job.captureDirectory), '--broadcast', '--write-evidence', '--evidence-name', job.evidenceName]);
    if (compareExit !== 0) {
      assert(job.args.includes('--polyphony'), `${job.name} single-note comparison failed; remaining jobs are not started`);
      job.status = 'recorded-awaiting-continuous-comparison';
      job.pendingReason = 'Strict comparison failed; original recording retained. No tolerance or product change applied.';
      console.log(JSON.stringify({ job: job.name, capture: job.captureDirectory, comparisonDeferred: true })); await save(); continue;
    }
    const reportFile = path.join(job.captureDirectory, 'comparison-with-broadcast.json'), reportBytes = await readFile(reportFile), report = JSON.parse(reportBytes);
    assert.equal(report.observations.length, job.scenes); assert.equal(report.exact, true);
    for (const scene of report.observations) { assert.equal(scene.exact, true); assert.equal(scene.outputLimiter, 1); assert.equal(scene.editorOutputLimiter, true); }
    job.report = reportFile; job.reportSha256 = digest(reportBytes, 'sha256'); job.status = 'passed'; job.completedAt = new Date().toISOString(); await save();
  }
  await assertFrozen(); const complete = jobs.every(job => job.status === 'passed');
  manifest.status = complete ? 'complete' : 'recorded-awaiting-continuous-comparison'; manifest.completedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ batch: root, scenes: manifest.expectedScenes, exact: complete, reports: jobs.map(job => ({ evidence: job.evidenceName, capture: job.captureDirectory, scenes: job.scenes, status: job.status })) }));
} catch (error) {
  manifest.status = 'failed'; manifest.error = String(error.stack ?? error); manifest.failedAt = new Date().toISOString(); await save(); throw error;
}
