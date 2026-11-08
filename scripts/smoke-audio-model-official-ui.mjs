import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real production URLs, renderer, preload IPC and main-process downloader.
// No mocks, imported cache files or alternate URLs. The production downloader
// owns bounded retry/backoff and validator-checked resumable byte ranges.
const base = path.resolve('.local/audio-model-official-ui');
await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, 'run-')), profile = path.join(root, 'profile');
await mkdir(profile);
const env = { ...process.env, NBSX_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
const report = { status: 'running', root, profile, realOfficialDownload: true, startedAt: new Date().toISOString(), audit: [], rendererErrors: [], inferenceRun: false };
const save = () => writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
let app, page, phase = 'download';
const launch = async () => {
  app = await electron.launch({ args: ['.', '--mute-audio', '--user-data-dir=' + profile], env, timeout: 30000 });
  let stdout = '';
  app.process().stdout.on('data', chunk => {
    stdout += String(chunk); const lines = stdout.split(/\r?\n/); stdout = lines.pop();
    for (const line of lines) {
      const start = line.indexOf('audio-model-download '); if (start < 0) continue;
      try { const event = JSON.parse(line.slice(start + 'audio-model-download '.length)); report.audit.push({ phase, ...event }); console.log(JSON.stringify(event)); } catch { /* Other process output is not evidence. */ }
    }
  });
  page = await app.firstWindow(); page.setDefaultTimeout(30000);
  report.runtime = await app.evaluate(async ({ session }) => ({ versions: process.versions, chromiumProxyForGithub: await session.defaultSession.resolveProxy('https://github.com'),
    proxyEnvironment: ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NODE_USE_ENV_PROXY','NODE_EXTRA_CA_CERTS'].map(key=>({ key, present: !!process.env[key] })) }));
  page.on('pageerror', error => report.rendererErrors.push(error.message));
  await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length >= 16);
  await page.getByTestId('open-audio-assist').click();
};
try {
  await launch();
  report.initial = await page.evaluate(() => window.desktop.audioModelStatus());
  assert.equal(report.initial.state, 'missing'); assert.equal(report.initial.downloadedBytes, 0);
  await assert.rejects(stat(path.join(profile, 'audio-models', 'mvsep-mega-53')), { code: 'ENOENT' });
  await page.getByRole('button', { name: '六轨模型…', exact: true }).click();
  const card = page.getByRole('region', { name: '六轨模型下载', exact: true });
  await card.waitFor();
  assert.match(await card.innerText(), /1\.37\s*GB/);
  assert(await card.getByRole('button', { name: '确认下载模型', exact: true }).isEnabled());
  assert.equal(report.audit.filter(e => e.kind === 'response').length, 0);
  await page.screenshot({ path: path.join(root, 'before-confirmation.png') });
  console.log('Starting one authorized production model download through the actual confirmation button.');
  await card.getByRole('button', { name: '确认下载模型', exact: true }).click();
  const started = Date.now();
  do {
    await new Promise(resolve => setTimeout(resolve, 1000));
    report.download = await page.evaluate(() => window.desktop.audioModelStatus());
    if (Date.now() - started > 6 * 60 * 60 * 1000 + 60000) throw new Error('QA deadline exceeded');
    if (Math.floor((Date.now() - started) / 1000) % 10 === 0) { console.log(JSON.stringify(report.download)); await save(); }
  } while (report.download.state === 'downloading' || report.download.state === 'missing');
  report.elapsedSeconds = (Date.now() - started) / 1000;
  await page.screenshot({ path: path.join(root, 'download-result.png') });
  assert.equal(report.download.state, 'ready', report.download.message);
  assert.equal(report.audit.filter(e => e.kind === 'verified').length, 2);
  report.downloadPassed = true; await save();
  await app.close(); app = undefined;
  phase = 'restart'; await launch();
  report.restart = await page.evaluate(() => window.desktop.audioModelStatus());
  assert.equal(report.restart.state, 'ready');
  assert.equal(report.audit.filter(e => e.phase === 'restart' && e.kind === 'response').length, 0);
  report.restartCachePassed = true;
  assert.deepEqual(report.rendererErrors, []);
  report.status = 'download-and-restart-passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
  console.error(report.error);
} finally {
  if (app) await app.close().catch(() => {});
  report.finishedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ status: report.status, report: path.join(root, 'report.json') }));
}
