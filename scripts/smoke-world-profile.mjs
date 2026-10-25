import { _electron as electron } from 'playwright';
import { readFile, writeFile, mkdir, mkdtemp, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const packagedOption = option('--packaged');
if (process.argv.includes('--packaged')) assert(packagedOption && !packagedOption.startsWith('--'), '--packaged requires an unpacked executable path');
const packaged = packagedOption ? path.resolve(packagedOption) : undefined;
if (packaged) {
  assert(!/(?:portable|setup)\.exe$/i.test(packaged), 'Use an unpacked executable rather than a portable/setup launcher');
  assert((await stat(path.join(path.dirname(packaged), 'resources/app.asar'))).isFile(), 'Expected an unpacked Electron application');
}
const version = option('--version') ?? '1.20.5';
const embeddedEarlyVersions = ['1.0', '1.1', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.3.1', '1.3.2', '1.4.2', '1.4.4', '1.4.5', '1.4.6', '1.4.7', '1.5.1', '1.5.2'];
// Game controls and backend capabilities are distinct. In particular 1.12.2
// and 1.13 both reject vanilla HRTF in AudioEngine before starting a worker.
const expected = {
  ...Object.fromEntries(['1.0', '1.1', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.3.1', '1.3.2', '1.4.2', '1.4.4', '1.4.5', '1.4.6', '1.4.7'].map(version => [version, { cases: 0, maxVoices: 0, gameHrtfControl: false, backendHrtfSupported: false, defaultHrtf: 'device-default' }])),
  '1.5.1': { cases: 0, maxVoices: 0, gameHrtfControl: false, backendHrtfSupported: false, defaultHrtf: 'device-default' },
  '1.5.2': { cases: 0, maxVoices: 0, gameHrtfControl: false, backendHrtfSupported: false, defaultHrtf: 'device-default' },
  '1.6.1': { cases: 0, maxVoices: 0, gameHrtfControl: false, backendHrtfSupported: false, defaultHrtf: 'device-default' },
  '1.6.2': { cases: 0, maxVoices: 0, gameHrtfControl: false, backendHrtfSupported: false, defaultHrtf: 'device-default' },
  '1.6.4': { cases: 0, maxVoices: 0, gameHrtfControl: false, backendHrtfSupported: false, defaultHrtf: 'device-default' },
  '1.8.9': { cases: 0, maxVoices: 0, gameHrtfControl: false, backendHrtfSupported: false, defaultHrtf: 'device-default' },
  '1.9': { cases: 0, maxVoices: 0, gameHrtfControl: false, backendHrtfSupported: false, defaultHrtf: 'device-default' },
  '1.12.2': { cases: 0, maxVoices: 0, gameHrtfControl: false, backendHrtfSupported: false, defaultHrtf: 'device-default' },
  '1.13': { cases: 89, maxVoices: 24, gameHrtfControl: false, backendHrtfSupported: true, defaultHrtf: 'device-default' },
  '1.14': { cases: 127, maxVoices: 64, gameHrtfControl: false, backendHrtfSupported: true, defaultHrtf: 'device-default' },
  '1.14.3': { cases: 127, maxVoices: 64, gameHrtfControl: false, backendHrtfSupported: true, defaultHrtf: 'device-default' },
  '1.14.4': { cases: 127, maxVoices: 64, gameHrtfControl: false, backendHrtfSupported: true, defaultHrtf: 'device-default' },
  '1.16.5': { cases: 127, maxVoices: 64, gameHrtfControl: false, backendHrtfSupported: true, defaultHrtf: 'device-default' },
  '1.19': { cases: 127, maxVoices: 64, gameHrtfControl: true, backendHrtfSupported: true, defaultHrtf: 'device-default' },
  '1.19.2': { cases: 145, maxVoices: 64, gameHrtfControl: true, backendHrtfSupported: true, defaultHrtf: 'explicit-reset' },
  '1.20.2': { cases: 136, maxVoices: 64, gameHrtfControl: true, backendHrtfSupported: true, defaultHrtf: 'explicit-reset', limiter: true },
  '1.20.5': { cases: 136, maxVoices: 64, gameHrtfControl: true, backendHrtfSupported: true, defaultHrtf: 'explicit-reset', limiter: true },
  '1.21.5': { cases: 127, maxVoices: 64, gameHrtfControl: true, backendHrtfSupported: true, defaultHrtf: 'context-attributes', limiter: true },
  '1.21.8': { cases: 23, maxVoices: 64, gameHrtfControl: true, backendHrtfSupported: true, measuredHrtfOn: false, defaultHrtf: 'context-attributes', limiter: true },
  '1.21.9': { cases: 23, maxVoices: 64, gameHrtfControl: true, backendHrtfSupported: true, measuredHrtfOn: false, defaultHrtf: 'context-attributes', limiter: true },
  '26.3': { cases: 165, maxVoices: 64, gameHrtfControl: true, backendHrtfSupported: true, defaultHrtf: 'context-attributes', limiter: true },
}[version];
assert(expected, 'Pass a supported component/profile --version. See the expected matrix in this script.');
const fixtureRoot = path.resolve('.local/game-fixtures', version);
const gameFixture = JSON.parse(await readFile(path.join(fixtureRoot, 'fixture.json'), 'utf8'));
assert.equal(gameFixture.version, version);
const expectedSamples = Object.keys(gameFixture.sounds).length; assert(expectedSamples > 0);
const base = path.resolve('.local/world-profile-desktop'); await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, `run-${version}-`)), profile = path.join(root, 'profile');
const reportFile = path.join(root, 'report.json');
await build({ stdin: { contents: "export {createProject,newNote} from './src/core/project.ts'; export {saveNbsx} from './src/core/container.ts';", resolveDir: process.cwd(), sourcefile: 'profile-helper.ts' }, outfile: path.join(root, 'helper.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { createProject, newNote, saveNbsx } = await import(pathToFileURL(path.join(root, 'helper.mjs')).href);
const profileId = `java-${version}`, projectName = `${version} 声音配置检查`, defaultProjectName = `${version} 默认声音配置检查`;
const fixture = createProject(projectName); fixture.audio.profileId = profileId; fixture.audio.mode = 'vanilla'; fixture.audio.previewEngine = 'native'; fixture.audio.directional = true;
fixture.patterns[0].notes = [newNote(0, 66), { ...newNote(480, 69), pan: -1, height: 4 }, { ...newNote(960, 73), pan: 1, height: -4 }];
const input = path.join(root, `profile-${version}.nbsx`), defaultInput = path.join(root, `profile-${version}-default.nbsx`);
await writeFile(input, saveNbsx(fixture));
const defaultFixture = structuredClone(fixture); defaultFixture.name = defaultProjectName; defaultFixture.audio.directional = false;
await writeFile(defaultInput, saveNbsx(defaultFixture));
const env = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
const errors = [], report = { schema: 2, packaged: !!packaged, version, expectedScenes: expected.cases, maxMeasuredVoices: expected.maxVoices, expectedSamples,
  gameHrtfControl: expected.gameHrtfControl, backendHrtfSupported: expected.backendHrtfSupported,
  productionDefaultHrtfPolicy: expected.defaultHrtf, productionLimiterPolicy: expected.limiter ? 'explicit-true-and-applied' : 'original-attribute-unspecified',
  stages: [], rendererErrors: errors, status: 'starting', report: reportFile };
let app;
try {
  app = await electron.launch({ ...(packaged ? { executablePath: packaged } : {}), args: [...(packaged ? [] : ['.']), '--mute-audio', `--user-data-dir=${profile}`], env });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  report.application = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), isPackaged: app.isPackaged, version: app.getVersion(), appPath: app.getAppPath() }));
  assert.equal(report.application.userData, profile); assert.equal(report.application.isPackaged, !!packaged);
  // Observe the real main-process worker boundary without changing requests or
  // results. Menu playback continues through production AudioEngine.nativeRequest.
  await app.evaluate(({ utilityProcess }) => {
    const probe = globalThis.__nbsxNativeAudioSmoke = { phase: 'startup', requests: [], replies: [], workers: 0 };
    const originalFork = utilityProcess.fork;
    const observedFork = function (...args) {
      const worker = Reflect.apply(originalFork, this, args);
      if (/[\\/]audio-worker\.cjs$/.test(String(args[0]))) {
        const workerId = ++probe.workers, phase = probe.phase, originalPostMessage = worker.postMessage;
        const observedPostMessage = function (request, ...rest) {
          probe.requests.push({ workerId, phase, directional: request.directional, hrtf: request.hrtf ?? null,
            outputLimiterSpecified: request.outputLimiter !== undefined, outputLimiter: request.outputLimiter ?? null,
            javaDecoder: request.javaDecoder ?? null,
            sampleRate: request.sampleRate, nativeLibrary: request.nativeLibrary, events: request.events.length });
          return Reflect.apply(originalPostMessage, this, [request, ...rest]);
        };
        worker.postMessage = observedPostMessage;
        if (worker.postMessage !== observedPostMessage) throw new Error('Cannot observe the production audio worker postMessage');
        worker.on('message', message => probe.replies.push({ workerId, phase, error: message.error ?? null, hasResult: !!message.result,
          directional: message.result?.directional ?? null, outputLimiter: message.result?.outputLimiter ?? null,
          hrtfDefaultDevice: message.result?.hrtfDefaultDevice ?? null, hrtfGameDevice: message.result?.hrtfGameDevice ?? null, hrtfRequestedProfile: message.result?.hrtfRequestedProfile ?? null,
          hrtfProfile: message.result?.hrtfProfile ?? null, hrtfStatus: message.result?.hrtfStatus ?? null,
          backend: message.result?.backend ?? null, warnings: message.result?.warnings ?? [] }));
      }
      return worker;
    };
    utilityProcess.fork = observedFork;
    if (utilityProcess.fork !== observedFork) throw new Error('Cannot observe Electron utilityProcess.fork');
  });
  await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length > 0);
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, fixtureRoot);
  await page.evaluate(() => window.desktop.selectMinecraftRoot());
  // Refresh the renderer's resource list after normal directory authorization.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
  await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length > 0);
  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send('menu', name), name);
  const openProject = async (filename, name) => {
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, filename);
    await command('open'); await page.waitForFunction(name => document.title.startsWith(name), name);
    await page.waitForFunction(({ version, count }) => document.querySelector('.status-message').textContent.includes(version) && document.querySelector('.resource-card').textContent.includes(version) && document.querySelectorAll('.sample-dot.loaded').length === count, { version, count: expectedSamples });
  };
  const beginPhase = phase => app.evaluate((_electron, phase) => {
    if (typeof phase !== 'string') throw new Error('Worker observation phase must be a string');
    globalThis.__nbsxNativeAudioSmoke.phase = phase;
  }, phase);
  const phaseTraffic = phase => app.evaluate((_electron, phase) => ({ requests: globalThis.__nbsxNativeAudioSmoke.requests.filter(item => item.phase === phase), replies: globalThis.__nbsxNativeAudioSmoke.replies.filter(item => item.phase === phase) }), phase);
  const playAndCheck = async (phase, directionalOption, expectedPolicy) => {
    await beginPhase(phase); await command('play');
    await page.waitForFunction(() => document.querySelector('.play-button').classList.contains('is-playing'), null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('[data-testid=transport-position]').textContent !== '1.1.00');
    const statusMessage=await page.locator('.status-message').innerText(); assert(statusMessage.includes('原生试听'));
    await command('stop');
    const traffic = await phaseTraffic(phase), successes = traffic.replies.filter(reply => reply.hasResult && !reply.error);
    assert(successes.length > 0, 'Menu playback must complete a real production native-worker render');
    assert(traffic.replies.every(reply => !reply.error), 'Production worker must not fail during successful playback');
    const renders = [];
    for (const result of successes) {
      const request = traffic.requests.find(item => item.workerId === result.workerId); assert(request);
      if (embeddedEarlyVersions.includes(version) || ['1.6.1', '1.6.2', '1.6.4'].includes(version)) {
        assert.equal(request.javaDecoder?.kind, 'legacy-jorbis');
        const codecFiles = request.javaDecoder.classpath.slice(1);
        const expectedCodecFiles = embeddedEarlyVersions.includes(version) ? [gameFixture.classpath[0]]
          : gameFixture.classpath.filter(file => /[\\/](?:codecjorbis|soundsystem)-[^\\/]+\.jar$/.test(file));
        assert.deepEqual(codecFiles, expectedCodecFiles, 'Use only the checked client-embedded or official external codec container');
        assert.equal(codecFiles.length, embeddedEarlyVersions.includes(version) ? 1 : 2);
      }
      assert.equal(request.directional, directionalOption); assert.equal(request.hrtf, expectedPolicy);
      assert.equal(request.outputLimiterSpecified, !!expected.limiter);
      if (expected.limiter) { assert.equal(request.outputLimiter, true); assert.equal(result.outputLimiter, true); }
      if (!expected.backendHrtfSupported) {
        assert.equal(result.directional, false); assert.equal(result.hrtfDefaultDevice, null); assert.equal(result.hrtfGameDevice, null); assert.equal(result.hrtfStatus, null);
      } else {
        const actualGame = result.hrtfGameDevice; assert(actualGame, 'Game policies must observe the original regular-device initialization sequence');
        assert.equal(actualGame.control, expectedPolicy); assert.equal(actualGame.option, directionalOption);
        assert.equal(typeof actualGame.name, 'string'); assert(actualGame.name.length > 0);
        assert.equal(typeof actualGame.directional, 'boolean'); assert(Number.isFinite(actualGame.status)); assert(actualGame.sampleRate > 0);
        assert.equal(result.directional, actualGame.directional);
        if (expectedPolicy === 'device-default') {
          assert.deepEqual(result.hrtfDefaultDevice, actualGame);
          assert(statusMessage.includes(`沿用设备默认（${actualGame.directional?'开启':'关闭'}）`),'UI must show the observed default state');
          if (actualGame.directional) assert.equal(result.hrtfRequestedProfile, actualGame.profile);
        } else {
          assert.equal(result.hrtfDefaultDevice, null);
          assert(result.hrtfRequestedProfile, 'The production request must enumerate the original first profile');
          if (actualGame.directional !== directionalOption) {
            assert(result.warnings.some(text => text.includes('覆盖为') && text.includes(actualGame.directional ? '开启' : '关闭')), 'A global override of the game request must be disclosed');
            assert(statusMessage.includes(`设备设置覆盖为${actualGame.directional?'开启':'关闭'}`),'UI must show the effective override');
          }
        }
        if (actualGame.directional) {
          assert(actualGame.profile); assert.equal(result.hrtfProfile, actualGame.profile);
          if (result.hrtfProfile !== result.hrtfRequestedProfile) assert(result.warnings.some(text => text.includes(result.hrtfRequestedProfile) && text.includes(result.hrtfProfile)), 'A native profile fallback must be disclosed');
        }
      }
      renders.push({ request, result, optionDiffersFromActual: directionalOption !== result.directional,
        profileFallback: !!(result.directional && result.hrtfRequestedProfile && result.hrtfProfile !== result.hrtfRequestedProfile) });
    }
    report.stages.push({ phase, directionalOption, status: 'passed', statusMessage, renders });
  };
  await openProject(input, projectName);
  report.loadedSamples = await page.locator('.sample-dot.loaded').count(); assert.equal(report.loadedSamples, expectedSamples);
  if (!expected.gameHrtfControl) {
    const phase = 'vanilla-hrtf-rejection'; await beginPhase(phase); await command('play');
    await page.waitForFunction(() => document.querySelector('.status-message').textContent.includes('该版本未提供游戏内 HRTF 开关'));
    report.vanillaHrtfRejection = await page.locator('.status-message').innerText();
    assert(report.vanillaHrtfRejection.includes('请关闭方向音频，或切换完整试听模式'));
    assert.equal(await page.locator('.play-button.is-playing').count(), 0); assert.equal(await page.locator('[data-testid=transport-position]').innerText(), '1.1.00');
    const traffic = await phaseTraffic(phase); assert.equal(traffic.requests.length, 0, 'Game-control rejection must happen before a worker is started, including 1.12.2'); assert.equal(traffic.replies.length, 0);
    report.stages.push({ phase, status: 'passed', reason: 'game-control-unavailable', workerRequests: 0, backendHrtfSupported: expected.backendHrtfSupported });
    report.rejectionScreenshot = path.join(root, `profile-${version}-hrtf-rejected.png`); await page.screenshot({ path: report.rejectionScreenshot });
  } else await playAndCheck('vanilla-hrtf-enabled', true, version === '1.19' ? 'enable-only-reset' : expected.defaultHrtf);
  await openProject(defaultInput, defaultProjectName);
  await playAndCheck('vanilla-default', false, expected.defaultHrtf);
  await command('settings'); const dialog = page.getByRole('dialog', { name: '设置' }); await dialog.waitFor();
  assert.equal(await dialog.getByLabel('工程目标版本', { exact: true }).inputValue(), profileId);
  assert.equal(await dialog.getByLabel('项目试听引擎').inputValue(), 'native'); assert.equal(await dialog.getByLabel('试听模式').inputValue(), 'vanilla');
  assert.equal(await dialog.getByRole('checkbox', { name: '方向音频 / HRTF' }).isChecked(), false);
  const notice = await dialog.locator('.research-notice').innerText();
  if (expected.cases) {
    assert(notice.includes(`${expected.cases} 个游戏场景`)); assert(notice.includes(`${expected.maxVoices} 音合奏`)); assert(notice.includes('其他设置仍待验收'));
    assert(notice.includes(expected.measuredHrtfOn===false ? '仅 HRTF 关闭场景，开启待验收' : '受控后端 HRTF 关闭/开启'));
  } else {
    assert(notice.includes('核心参数已核对') && notice.includes('待游戏实测'));
    assert(!/已对照 \d+ 个游戏场景|\d+ 音合奏/.test(notice), 'Excluded normalized candidates must never appear as measured world scenes');
  }
  assert(!notice.includes('该版本未提供游戏内 HRTF 开关'), 'Backend research coverage must remain distinct from game controls');
  report.measurementNotice = notice; report.optionHints = await dialog.locator('.field-hint').allTextContents();
  if (!expected.gameHrtfControl) assert(report.optionHints.some(text => text.includes('该版本没有游戏内方向音频开关')));
  if (version === '1.19') assert(report.optionHints.some(text => text.includes('关闭此选项时仍沿用音频库默认设置')));
  report.screenshot = path.join(root, `profile-${version}-measurement.png`); await page.screenshot({ path: report.screenshot });
  assert.deepEqual(errors, []); report.nativeWorkerTraffic = await app.evaluate(() => globalThis.__nbsxNativeAudioSmoke);
  report.automaticResourceMatch = 'passed'; report.status = 'passed';
  await writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, packaged: !!packaged, applicationVersion: report.application.version, version,
    gameHrtfControl: expected.gameHrtfControl, backendHrtfSupported: expected.backendHrtfSupported, stages: report.stages,
    expectedScenes: expected.cases, rendererErrors: errors, report: reportFile }));
} catch (error) {
  report.status = 'failed'; report.error = error.stack ?? String(error);
  if (app) {
    report.nativeWorkerTraffic = await app.evaluate(() => globalThis.__nbsxNativeAudioSmoke).catch(() => null);
    const page = await app.firstWindow().catch(() => null); await page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
  }
  try { await writeFile(reportFile, JSON.stringify(report, null, 2)); }
  catch (reportError) { await writeFile(reportFile, JSON.stringify({ schema: 2, version, status: 'failed', error: report.error, reportError: String(reportError) }, null, 2)); }
  console.error(`Desktop profile check failed; report: ${reportFile}`); throw error;
} finally {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}); }
}
