import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { digest } from './research-utils.mjs';

// Reuse only recordings whose original hashes and archived agent identities
// match an accepted report, or an explicitly excluded 1.12.2 historical report
// in candidate-only mode. This does not create new game coverage.
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const version = option('--version');
const candidateOnly = version === '1.12.2';
assert(!candidateOnly || process.argv.includes('--candidate-only'), 'Java1.12.2 is excluded from acceptance: original context equivalence is unproved. Only --candidate-only diagnosis may replay its archived PCM.');
assert(!candidateOnly || (!process.argv.includes('--evidence-name') && !process.argv.includes('--write-evidence')), 'Excluded candidates cannot publish world acceptance evidence');
assert(['1.12.2', '1.13', '1.14', '1.14.3', '1.14.4', '1.16.5', '1.19', '1.19.2', '1.20.2', '1.20.5', '1.21.5', '1.21.8', '1.21.9', '26.3'].includes(version), 'Select a supported --version');
const legacy = version === '1.13';
const lwjgl2=version==='1.12.2',early=version==='1.14',earlyPatch=version==='1.14.3',mapped144=version==='1.14.4',volumeBoundary=['1.21.8','1.21.9'].includes(version),nested=legacy||lwjgl2;
const root = version==='1.21.5'?path.resolve('.local/world-hrtf1215'):path.resolve(mapped144?'.local/mapped144-world-comparison':earlyPatch?'.local/early-patch-world-comparison':volumeBoundary?'.local/world-volume-boundary':version==='1.19'?'.local/game-world-119':lwjgl2?'.local/lwjgl2-world-comparison':early?'.local/early-world-comparison':legacy ? '.local/legacy-world-comparison' : '.local/game-world-comparison', version);
const accepted = (await readdir('docs/evidence')).filter(name => name.startsWith(`java-${version}-`) && name.endsWith('-world.json')).sort();
assert(accepted.length, 'No accepted reports for this version');
const optionWorldRoot=['1.19.2','1.20.2','1.20.5'].includes(version)?path.resolve('.local/game-option-world',version):undefined;
const captures = [];
for(const source of [{root,nested,gameOption:false},...(optionWorldRoot?[{root:optionWorldRoot,nested:false,gameOption:true}]:[])]){
for (const entry of await readdir(source.root, { withFileTypes: true }).catch(error=>{if(error.code==='ENOENT'&&source.gameOption)return[];throw error;})) {
  if (!entry.isDirectory() || !(source.nested ? entry.name.startsWith('run-') : entry.name.startsWith('capture-'))) continue;
  const output = path.join(source.root, entry.name, ...(source.nested ? ['capture'] : []));
  try {
    await access(path.join(output, 'complete.txt'));
    const provenance = JSON.parse(await readFile(path.join(output, 'provenance.json'), 'utf8'));
    if (provenance.version !== version) continue;
    if(source.gameOption) assert.equal(provenance.agentSourceFile,'WorldGameOptionCapture.java');
    captures.push({ output, provenance, gameOption:source.gameOption });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
}
for (const name of accepted) {
  const report = JSON.parse(await readFile(path.join('docs/evidence', name), 'utf8'));
  assert(report.exact && report.observations.length, `Not an accepted exact report: ${name}`);
  const gameOption=report.settings.gameOption!==undefined;
  if(gameOption)assert(/^java-(1\.19\.2-game-forced-(on-option-off|off-option-on)|1\.20\.(2|5)-game-option-on-default)-world\.json$/.test(name),'Unexpected game-option cohort');
  let matched;
  for (const capture of captures) {
    if(capture.gameOption!==gameOption)continue;
    if (capture.provenance.clientSha1 !== report.clientSha1 || capture.provenance.agentSha256 !== report.agentSha256 || capture.provenance.agentSourceSha256 !== report.agentSourceSha256) continue;
    const cases = JSON.parse(await readFile(path.join(capture.output, 'cases.json'), 'utf8'));
    if (cases.length !== report.observations.length) continue;
    let matches = true;
    for (const observation of report.observations) if (digest(await readFile(path.join(capture.output, `case-${observation.case}.pcm`)), 'sha256') !== observation.recordingSha256) { matches = false; break; }
    if (matches) { matched = capture; break; }
  }
  assert(matched, `Original archived recording/agent not found for ${name}`);
  const evidenceName = name.slice(0, -5);
  const args = mapped144||earlyPatch||volumeBoundary?[mapped144?'scripts/verify-mapped144-world.mjs':earlyPatch?'scripts/verify-early-patch-world.mjs':'scripts/verify-volume-boundary-world.mjs','--version',version,'--capture',path.basename(matched.output),'--broadcast','--write-evidence','--evidence-name',evidenceName]:gameOption?['scripts/verify-game-option-world.mjs','--version',version,'--capture',path.basename(matched.output),'--broadcast','--write-evidence','--evidence-name',evidenceName]:lwjgl2?['scripts/verify-lwjgl2-world.mjs','--capture',matched.output,'--evidence-name',evidenceName]:early?['scripts/verify-early-world.mjs','--capture',path.basename(matched.output),'--broadcast','--write-evidence','--evidence-name',evidenceName]:legacy ? ['scripts/verify-legacy-world.mjs', '--capture', matched.output, '--evidence-name', evidenceName]
    : [version==='1.19'?'scripts/verify-world119.mjs':version==='1.21.5'?'scripts/verify-hrtf1215-world.mjs':'scripts/verify-game-world.mjs', '--version', version, '--capture', path.basename(matched.output), '--broadcast', '--write-evidence', '--evidence-name', evidenceName];
  if(candidateOnly){ args.splice(3); args.push('--candidate-only'); }
  if((early||earlyPatch||mapped144||version==='1.19')&&report.contextComparison?.startsWith('One continuous'))args.push('--continuous');
  const checked = spawnSync(process.execPath, args, { windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 2000000 });
  assert.equal(checked.status, 0, `${name}: ${checked.stdout}\n${checked.stderr}`);
  const diagnosticReport = candidateOnly ? JSON.parse(checked.stdout.trim().split(/\r?\n/).at(-1)).report : undefined;
  console.log(JSON.stringify({ version, evidence: name, cases: report.observations.length, exact: true, recordingReused: true, acceptance: candidateOnly ? 'excluded-normalized-candidate' : 'partially-measured', diagnosticReport }));
}
