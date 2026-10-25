import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {writeFileSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pre13Versions} from './audit-pre13-audio.mjs';
import {reviewedPre13Source} from './review-pre13-audio-source.mjs';
import {reviewedPre13Components} from './review-pre13-components.mjs';

// Archival only: never calls a producer, compiler, Java, native API, or downloader.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(process.cwd(), file).replaceAll('\\', '/');
const inputHashes = new Map();
const read = async file => {
  const absolute = path.resolve(file), bytes = await readFile(absolute);
  const hash = sha(bytes);
  if (inputHashes.has(absolute)) assert.equal(hash, inputHashes.get(absolute), 'Changed input: ' + file);
  else inputHashes.set(absolute, hash);
  return bytes;
};
const ref = async file => ({path: relative(file), sha256: sha(await read(file))});
const json = async file => JSON.parse(await read(file));
const checkedRef = async r => {assert.equal((await ref(r.path)).sha256, r.sha256, r.path); return r;};
const processRoots = ['.local/pre13-audio-inventory', '.local/pre13-packet-inventory', '.local/pre13-audio-components', '.local/pre13-audio-executions'];
async function filesBelow(dir) {
  const result = [];
  for (const entry of (await readdir(dir, {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(file)); else result.push(file);
  }
  return result;
}

// Explicit seeds plus their static local imports; the independently changing
// candidate profile adapter is deliberately outside this archive's closure.
async function sourceClosure(seeds) {
  const result = {}, externalImports = new Set();
  async function visit(file) {
    file = relative(path.resolve(file));
    assert.notEqual(file, 'scripts/review-pre13-profiles.mjs');
    if (result[file]) return;
    const bytes = await read(file); result[file] = sha(bytes);
    if (!/\.(mjs|js)$/.test(file)) return;
    const text = bytes.toString();
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.')) await visit(path.resolve(path.dirname(file), specifier));
      else if (!specifier.startsWith('node:')) externalImports.add(specifier);
    }
  }
  for (const file of seeds) await visit(file);
  const packages = [];
  for (const specifier of [...externalImports].sort()) {
    const entry = fileURLToPath(import.meta.resolve(specifier));
    packages.push({specifier, resolvedEntry: await ref(entry)});
  }
  return {files: Object.fromEntries(Object.entries(result).sort()), externalImports: packages,
    scope: 'Current archive/reader/producer source and transitive static local imports; not a claim to recover an unsnapshotted script at a historical failed invocation.'};
}

async function priorProcess(file) {
  const p = await json(file);
  assert(p.terminal === true && Number.isInteger(p.code) && p.signal === null && p.pid > 0, 'Unfinished original process: ' + file);
  assert(Number.isFinite(Date.parse(p.startedAt)) && Date.parse(p.finishedAt) >= Date.parse(p.startedAt));
  return {record: await ref(file), ...p, stdout: await ref(p.stdoutFile), stderr: await ref(p.stderrFile)};
}

async function archive() {
  const processFiles = (await Promise.all(processRoots.map(filesBelow))).flat().filter(f => f.endsWith('.process.json')).sort();
  const processes = [];
  for (const file of processFiles) processes.push(await priorProcess(file));
  const executableName = p => path.basename(p.executable).replace(/\.exe$/i, '').toLowerCase();
  const byExecutable = Object.fromEntries(['javap','javac','java','node'].map(name => [name, processes.filter(p => executableName(p) === name).length]));
  assert.equal(byExecutable.javap, 182); assert.equal(byExecutable.javac, 8); assert.equal(byExecutable.java, 7);
  assert(processes.filter(p => ['javap','javac','java'].includes(executableName(p))).every(p => p.code === 0));
  const failures = processes.filter(p => p.code !== 0).map(p => ({...p,
    interpretation: p.record.path.includes('run-1792809123419') ? 'Initial metadata identity assertion rejected; no javap/Java child recorded in that attempt.' :
      p.record.path.includes('run-1792809292274') ? 'Initial client packet-handler role discovery rejected zero matches; no javap/Java child recorded in that attempt.' :
      p.record.path.includes('run-1792809828779') ? 'Original Java completed exit0. Parent Node checker rejected Java decimal text0.0 versus JS0; read-only recovery is separate.' : 'Retained nonzero process; inspect exact stderr.'}));
  const seeds = ['scripts/archive-pre13-audio.mjs', 'scripts/java/Pre13AudioProbe.java', 'scripts/recover-pre13-audio.mjs', 'scripts/review-pre13-components.mjs', 'scripts/verify-pre13-audio.mjs', 'scripts/audit-pre13-reader-gates.mjs'];
  const versions = [];
  for (const version of pre13Versions) {
    const sourceFile = `docs/evidence/java-${version}-pre13-audio-source.json`;
    const numericFile = `docs/evidence/java-${version}-pre13-numeric-components.json`;
    const source = await reviewedPre13Source(version, {read});
    const numeric = await reviewedPre13Components(version, {read});
    for (const report of [source, numeric]) {
      seeds.push(...Object.keys(report.sources)); await checkedRef(report.rawReport);
      await checkedRef(report.resourceEvidence);
    }
    await checkedRef(source.inventory); await checkedRef(source.packetInventory);
    const metadata = await json(source.official.metadataFile);
    assert.equal(createHash('sha1').update(await read(source.official.metadataFile)).digest('hex'), source.official.metadataSha1);
    const clientFile = `.research/clients/${version}.jar`;
    assert.equal(createHash('sha1').update(await read(clientFile)).digest('hex'), metadata.downloads.client.sha1);
    const classes = [];
    for (const c of source.classes) {
      assert.equal(sha(await read(c.classFile)), c.sha256);
      await checkedRef(c.process); await checkedRef(c.disassembly);
      classes.push({name:c.name,roles:c.roles,archive:c.archive,artifact:c.artifact,sha1:c.sha1,sha256:c.sha256,
        classFile:await ref(c.classFile),disassembly:c.disassembly,process:c.process});
      await read(c.archive);
    }
    for (const d of numeric.dependencies) await read(d.file);
    assert.equal(sha(await read(numeric.asm.file)), numeric.asm.sha256);
    for (const file of Object.keys(numeric.compiledClasses)) await read(file);
    for (const sample of numeric.samples) {await read(sample.file); await read(sample.originalSelectedFile);}
    for (const decoded of numeric.checks.decodes) await read(decoded.file);
    const processFor = r => processes.find(p => path.resolve(p.record.path) === path.resolve(r.path));
    const compile = processFor(numeric.processes.compile), java = processFor(numeric.processes.java);
    assert(compile && java); assert.equal(compile.code, 0); assert.equal(java.code, 0);
    versions.push({version,status:'passed-read-only-revalidation',official:source.official,
      metadataFile:await ref(source.official.metadataFile),client:await ref(clientFile),
      sourceEvidence:await ref(sourceFile),numericEvidence:await ref(numericFile),
      rawSource:source.rawReport,rawNumeric:numeric.rawReport,resourceEvidence:numeric.resourceEvidence,
      inventory:source.inventory,packetInventory:source.packetInventory,classes,bindings:source.bindings,
      sourceFacts:source.facts,componentChecks:numeric.checks,domainPartition:numeric.domainPartition,
      actualCompile:compile.record,actualJava:java.record,compilePid:compile.pid,javaPid:java.pid,
      classpath:numeric.classpath,dependencies:numeric.dependencies,compiledClasses:numeric.compiledClasses,
      sourceClosureAtSuccessfulReport:numeric.sources,recovery:numeric.recovery ?? null,
      worldScenesAdded:0});
    console.log(JSON.stringify({version,status:'passed',classes:classes.length,bindings:source.bindings.length,javaPid:java.pid,javaExit:java.code}));
  }
  const validationFile = 'docs/evidence/pre13-audio-reader-validation.json';
  const independentFile = 'docs/evidence/pre13-reader-independent-review.json';
  const validation = await json(validationFile), independent = await json(independentFile);
  assert.equal(validation.status, 'passed'); assert.equal(validation.positive, 7); assert.equal(validation.rejected, 127);
  await checkedRef(validation.rawReport); await checkedRef(independent.rawReport);
  assert.equal(independent.status, 'passed'); assert.equal(independent.baselines.length, 7);
  assert(independent.observations.every(o => o.accepted === false));
  for (const [file, hash] of Object.entries(validation.protectedInputs)) assert.equal(sha(await read(file)), hash, file);
  for (const [file, hash] of Object.entries(independent.inputEvidenceHashes)) assert.equal(sha(await read(file)), hash, file);
  for (const [file, hash] of Object.entries(independent.sources)) {assert.equal(sha(await read(file)), hash, file); seeds.push(file);}
  for (const o of independent.observations) for (const f of o.fixtures) await checkedRef(f.payload);
  const recovery = versions.find(v => v.version === '1.2.5').recovery;
  for (const key of ['failedProducer','originalProducerSnapshot','snapshotManifest','sameHelperCompile']) await checkedRef(recovery[key]);
  for (const [file, hash] of Object.entries(recovery.sameHelperClasses)) assert.equal(sha(await read(file)), hash);
  const failedReport = await json(path.join(path.dirname(recovery.originalProducerSnapshot.path),'report.json'));
  assert.equal(failedReport.status, 'failed');
  assert.deepEqual(failedReport, await json(recovery.failedProducer.path));
  const sourceClosureNow = await sourceClosure(seeds);
  const historicalReports = [];
  for (const dir of ['.local/pre13-audio-source','.local/pre13-audio-validation','.local/pre13-reader-independent']) {
    for (const file of await filesBelow(dir)) if (file.endsWith('.json')) historicalReports.push(await ref(file));
  }
  // Reader reports are historical observations too; they do not add original
  // executions. Protect every input that our injected read function observed.
  for (const [file, hash] of inputHashes) assert.equal(sha(await readFile(file)), hash, 'Archive changed input: ' + file);
  const totals = {versions:versions.length,originalClasses:versions.reduce((n,v)=>n+v.classes.length,0),
    originalCodeBindings:versions.reduce((n,v)=>n+v.bindings.length,0)};
  for (const key of ['boundaryCases','playedManagerCases','suppressedNotFinalGainComparisons','actualDownstreamClipCases','ordinaryMaterialNotes','originalBlockPacketNotes','clientDistanceGates','listenerFixtures','sourceAttenuationCases','options']) totals[key] = versions.reduce((n,v)=>n+v.componentChecks[key],0);
  totals.actualEmbeddedDecodes = versions.reduce((n,v)=>n+v.componentChecks.decodes.length,0);
  totals.worldScenesAdded = 0;
  return {schema:1,status:'passed',checkedAt:new Date().toISOString(),versions,totals,
    executionArchive:{scanRoots:processRoots,records:processes.length,byExecutable,allTerminal:true,
      allOriginalToolProcessesExitZero:true,processes,failures,
      missingHistoricalProducerSnapshots:'The two initial discovery failures retain exact argv/PID/terminal/logs, not a contemporaneous script snapshot. Current closure hashes are not substituted for those missing historical bytes.'},
    recovery125:{...independent.actualRecovery,canonicalRecovery:recovery,originalJavaRerun:false,
      explanation:'Original Java PID78128 exit0 retained. Parent Node PID21548 exit1 is preserved. Fresh javac PID75192 produced the same three helper hashes in a distinct directory; only the JS decimal text normalization and helper export changed. No new Java run or audio sample.'},
    readerValidation:{evidence:await ref(validationFile),rawReport:validation.rawReport,positive:7,rejected:127},
    independentReview:{evidence:await ref(independentFile),rawReport:independent.rawReport,positive:7,alignedDamageCasesRejected:independent.observations.length,process:independent.process},
    currentSourceClosure:sourceClosureNow,historicalReports,inputsUnchanged:true,
    protectedInputs:Object.fromEntries([...inputHashes].map(([f,h])=>[relative(f),h]).sort()),
    scope:{operation:'Read-only archival and revalidation of existing per-release original-class observations.',
      originalJavaRerun:false,javacRerun:false,javapRerun:false,resourceProbeRerun:false,
      nativeContextOpened:false,worldScenesAdded:0,standaloneServerAudited:false,
      productionEquivalenceAsserted:false,candidateAdapterIncluded:false},
    limitations:[
      'The reviewed audible note route is local/client block-event integer-note to raw double-pow-then-float; no named63 pitch packet is on that route. Other engines/releases are not inherited.',
      '48 is an original client audibility gate from the current view entity. No standalone-server delivery/dimension rule or server-feet/1.62 offset is inferred.',
      'The listener fixture executes original interpolation-to-float and horizontal-yaw orientation code. A live moving camera/world pose is unmeasured.',
      'Context builder data [4103,44100,4104,60,4105,0,0] has IntBuffer.position=7. This is not a real alcCreateContext attribute readback, actual sample rate, limiter, or HRTF state.',
      '28 normal/4 streaming are original requested configuration values. No original AL source allocation, actual capacity/cap, source gain/listener hardware measurement, or native world PCM is added.',
      '315 finite supplied scalar rows per release include 35 negative-volume diagnostics;165 suppressed rows have no submitted/final gain. These are not all constructed-project integration tests.',
      'Six original embedded JOrbis decodes per release consume existing frozen resource selections; pling is a resource, not a sixth material instrument. No frozen resource probe is rerun.',
      'This archive was prepared before independent candidate registration/production comparison and does not attest current runtime status or register an audio profile.'
    ]};
}

const root = path.resolve('.local/pre13-audio-family-archive', 'run-' + Date.now());
await mkdir(root, {recursive:true});
const processFile = path.join(root, 'node.process.json'), stdoutFile = path.join(root, 'node.stdout.log'), stderrFile = path.join(root, 'node.stderr.log');
const execution = {executable:process.execPath,args:process.argv.slice(1),cwd:process.cwd(),parentPid:process.ppid,pid:process.pid,startedAt:new Date().toISOString(),terminal:false,stdoutFile,stderrFile};
await writeFile(processFile, JSON.stringify(execution,null,2)+'\n');
// The exit event supplies this archive Node's actual terminal code. Its report
// is finalized synchronously there, rather than predicting success in advance.
let report;
for (const [stream,file] of [[process.stdout,stdoutFile],[process.stderr,stderrFile]]) {
  writeFileSync(file, '');
  const original = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {writeFileSync(file, chunk, {flag:'a'}); return original(chunk, ...rest);};
}
process.on('exit', code => {
  Object.assign(execution,{terminal:true,code,signal:null,finishedAt:new Date().toISOString()});
  writeFileSync(processFile, JSON.stringify(execution,null,2)+'\n');
  const actual = {record:{path:relative(processFile),sha256:sha(readFileSync(processFile))},...execution,
    stdout:{path:relative(stdoutFile),sha256:sha(readFileSync(stdoutFile))},stderr:{path:relative(stderrFile),sha256:sha(readFileSync(stderrFile))}};
  const body = {...(report ?? {schema:1,status:'failed',error:'Archive did not complete'}),archiveProcess:actual};
  if (code !== 0) body.status = 'failed';
  const raw = path.join(root,'report.json'), bytes = JSON.stringify(body,null,2)+'\n';
  writeFileSync(raw,bytes);
  if (code === 0 && body.status === 'passed' && process.argv.includes('--write-evidence')) {
    writeFileSync('docs/evidence/pre13-audio-family-audit.json',JSON.stringify({...body,rawReport:{path:relative(raw),sha256:sha(Buffer.from(bytes))}},null,2)+'\n');
  }
});
try {
  report = await archive();
  console.log(JSON.stringify({status:'passed',totals:report.totals,originalProcesses:report.executionArchive.byExecutable,retainedFailures:report.executionArchive.failures.length,inputsUnchanged:true,pid:process.pid,root,publicReport:process.argv.includes('--write-evidence')?'docs/evidence/pre13-audio-family-audit.json':null}));
} catch (error) {
  report = {schema:1,status:'failed',error:error.stack ?? String(error)};
  console.error(report.error); process.exitCode = 1;
}
