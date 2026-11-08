import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const usage = 'Usage: node scripts/windows-release.mjs build | verify <NeoNBS.exe> [--audio-runtime DIR] [--glass-python EXE]';
const [mode, ...args] = process.argv.slice(2);
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Run this workflow in Windows with x64 Node.js.');
if (!['build', 'verify'].includes(mode) || (mode === 'build' && args.length) || (mode === 'verify' && !args.length)) throw new Error(usage);
const executable = mode === 'verify' ? path.resolve(args.shift()) : undefined;
const options = new Map();
while (args.length) {
  const [key, value] = args.splice(0, 2);
  if (!['--audio-runtime', '--glass-python'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw new Error(usage);
  options.set(key, path.resolve(value));
}

const git = args => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
if (git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('Use a clean, committed candidate checkout.');
const sourceCommit = git(['rev-parse', 'HEAD']);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const release = path.resolve('release', version);
const stamp = path.join(release, 'windows-candidate-build.json');
const unpacked = path.join(release, 'win-unpacked');
const appFiles = ['NeoNBS.exe', 'resources/app.asar'];
const sha256 = async file => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
};
const appHashes = dir => Promise.all(appFiles.map(async name => ({ name, sha256: await sha256(path.join(dir, name)) })));
const run = (program, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(program, args, { env, windowsHide: true, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(program)} ${args[0]} failed (${signal ?? code})`)));
});
const node = (script, args = [], env) => run(process.execPath, [path.join('scripts', script), ...args], env);

if (mode === 'build') {
  const env = { ...process.env };
  delete env.NEONBS_RELEASE_DIR; // The Windows workflow builds and audits the same default directory.
  const npm = (...args) => run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm.cmd', ...args], env);
  await node('check-publication.mjs', ['--ref', sourceCommit]);
  for (const args of [['ci'], ['test'], ['run', 'package:win']]) {
    console.log(`\n> npm ${args.join(' ')}`);
    await npm(...args);
  }
  if (git(['rev-parse', 'HEAD']) !== sourceCommit || git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('The candidate checkout changed while building.');
  const audit = JSON.parse(await readFile(path.join(release, 'release-audit.json'), 'utf8'));
  const assets = ['setup', 'portable'].map(kind => {
    const file = `NeoNBS-${version}-x64-${kind}.exe`;
    const record = audit.assets.find(asset => asset.name === file);
    if (audit.status !== 'passed' || audit.version !== version || !record) throw new Error(`Missing package audit for ${file}`);
    return record;
  });
  await writeFile(stamp, JSON.stringify({ version, sourceCommit, assets, app: await appHashes(unpacked) }, null, 2) + '\n');
  console.log(`\nBuilt ${assets.map(asset => asset.name).join(' and ')} from ${sourceCommit}.`);
  console.log(`Output: ${release}`);
} else {
  if (path.basename(executable).toLowerCase() !== 'neonbs.exe') throw new Error('Pass the installed NeoNBS.exe, not the installer or the portable launcher.');
  const built = JSON.parse(await readFile(stamp, 'utf8'));
  if (built.version !== version || built.sourceCommit !== sourceCommit) throw new Error('Rebuild the Windows candidate from this exact commit first.');
  for (const asset of built.assets) {
    if (await sha256(path.join(release, asset.name)) !== asset.sha256) throw new Error(`Candidate asset changed: ${asset.name}`);
  }
  for (const entry of await appHashes(path.dirname(executable))) {
    if (!built.app.some(item => item.name === entry.name && item.sha256 === entry.sha256)) throw new Error(`Installed ${entry.name} differs from this candidate build.`);
  }
  const base = path.resolve('.local/windows-release-verification');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-'));
  const reportPath = path.join(root, 'report.json');
  const report = { version, sourceCommit, app: built.app, assets: built.assets, status: 'running', checks: {},
    limitations: ['Portable launcher, Explorer association and drag-and-drop, actual Windows DPI, upgrade and uninstall require manual acceptance.'] };
  async function check(script, extra = [], env) {
    console.log(`\n> ${script}`);
    try {
      await node(script, ['--packaged', executable, ...extra], env);
      report.checks[script] = 'passed';
    } catch (error) {
      report.checks[script] = 'failed';
      throw error;
    }
  }
  try {
    for (const script of ['smoke-preview-desktop.mjs', 'smoke-diagnostics-desktop.mjs', 'smoke-file-lifecycle.mjs', 'smoke-midi-desktop.mjs', 'smoke-nbs-desktop.mjs']) await check(script);
    const python = options.get('--glass-python'), runtime = options.get('--audio-runtime');
    if (python) await check('smoke-liquid-glass.mjs', [], { ...process.env, NEONBS_QA_PYTHON: python });
    else report.checks['smoke-liquid-glass.mjs'] = 'not requested';
    if (runtime) await check('smoke-smart-tempo.mjs', ['--audio-runtime', runtime]);
    else report.checks['smoke-smart-tempo.mjs'] = 'not requested';
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    throw error;
  } finally {
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`\nAutomated checks: ${reportPath}`);
  }
}
