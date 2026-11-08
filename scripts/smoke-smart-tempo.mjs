import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const base = path.resolve('.local/smart-tempo-qa');
await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, 'run-'));
const profile = path.join(root, 'profile');
const argument = flag => {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  if (!process.argv[index + 1]) throw new Error(flag + ' requires a path.');
  return path.resolve(process.argv[index + 1]);
};
const executablePath = argument('--packaged'), runtime = argument('--audio-runtime');
if (executablePath && !runtime) throw new Error('Packaged Smart Tempo checks require --audio-runtime pointing to a provisioned component.');
if (runtime) {
  await mkdir(profile, { recursive: true });
  await symlink(runtime, path.join(profile, 'audio-runtime'), process.platform === 'win32' ? 'junction' : 'dir');
}

async function writePulseTrack(name, bpm, lead) {
  const rate = 44100, frames = 12 * rate, bytes = Buffer.alloc(44 + 2 * frames);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(2 * rate, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(2 * frames, 40);
  for (let beat = 0; beat < 24; beat++) {
    const start = Math.round((lead + beat * 60 / bpm) * rate);
    for (let i = 0; i < 1600 && start + i < frames; i++) {
      const time = i / rate;
      const sample = (Math.sin(time * 2 * Math.PI * 90) + .2 * Math.sin(time * 2 * Math.PI * 3050)) * Math.exp(-90 * time);
      bytes.writeInt16LE(Math.round(sample * (beat % 4 ? 10000 : 16000)), 44 + 2 * (start + i));
    }
  }
  const file = path.join(root, name + '.wav');
  await writeFile(file, bytes);
  return file;
}
const [first, second] = await Promise.all([writePulseTrack('节奏 96', 96, .23), writePulseTrack('节奏 137', 137, 0)]);
const env = { ...process.env, NBSX_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NBSX_DEV_URL;
const app = await electron.launch({ executablePath, args: [...(executablePath ? [] : ['.']), '--mute-audio', `--user-data-dir=${profile}`], env, timeout: 120000 });
try {
  const page = await app.firstWindow({ timeout: 60000 });
  // A cold translated renderer may still be starting after Electron exposes the window.
  page.setDefaultTimeout(executablePath ? 60000 : 12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(1050, 720); window.hide();
  });
  const projectName = page.getByRole('textbox', { name: '工程名称' });
  await projectName.waitFor();
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: /^新建工程/ }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="工程名称"]').value === '未命名工程');
  assert.equal(await page.locator('.lcd').getByRole('combobox').count(), 0);
  const bpm = page.getByRole('spinbutton', { name: '当前位置速度 BPM' });
  const drop = async (file, name) => {
    const lane = await page.locator('.arrangement-lane').first().boundingBox();
    const cdp = await page.context().newCDPSession(page);
    try {
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await cdp.send('Input.dispatchDragEvent', { type, x: lane.x + 6, y: lane.y + 10, data: { items: [], files: [file], dragOperationsMask: 1 } });
      }
    } finally { await cdp.detach(); }
    const clip = page.getByRole('button', { name: `音频片段 ${name}.wav`, exact: true });
    await clip.waitFor();
    return clip;
  };
  const imported = await drop(first, '节奏 96');
  const adopted = Number(await bpm.inputValue());
  assert(Math.abs(adopted - 96) < .6, `expected 96 BPM, got ${adopted}`);
  assert.equal(Number(await imported.getAttribute('data-offset-seconds')), 0);
  const lead = (3840 - Number(await imported.getAttribute('data-start-tick'))) * 60 / (960 * adopted);
  // The network may select a later downbeat than the first synthesized click.
  const beatsIntoClip = (lead - .23) / (60 / 96);
  assert(Math.abs(beatsIntoClip - Math.round(beatsIntoClip)) < .065);
  assert.match(await page.locator('.status-message').textContent(), /(首拍|小节重拍)对齐第 2 小节/);
  const overlap = await drop(second, '节奏 137');
  assert.equal(Number(await bpm.inputValue()), adopted);
  const bpmIn = (text) => Number(text.match(/([\d.]+) BPM/)?.[1]);
  const detected = bpmIn(await overlap.locator('.audio-region-title small').textContent());
  assert(Math.abs(detected - 137) < .6);
  assert.equal(bpmIn(await overlap.getAttribute('title')), detected);
  await overlap.locator('.audio-region-first-beat').waitFor({ state: 'attached' });
  await overlap.click({ button: 'right', position: { x: 15, y: 12 } });
  const menu = page.getByRole('menu', { name: /音频片段菜单 节奏 137/ });
  await menu.waitFor();
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  assert(await overlap.evaluate(node => document.activeElement === node));
  await page.keyboard.press('Shift+F10');
  await menu.getByRole('menuitem', { name: '智能速度', exact: true }).click();
  await menu.getByRole('menuitem', { name: '重新检测曲速与首拍', exact: true }).click();
  await page.waitForFunction(() => /检测到 [\d.]+ BPM/.test(document.querySelector('.status-message')?.textContent ?? ''));
  assert.equal(Number(await bpm.inputValue()), adopted);
  const checkedBpm = bpmIn(await overlap.getAttribute('title'));
  await overlap.click({ button: 'right', position: { x: 15, y: 12 } });
  await menu.getByRole('menuitem', { name: '智能速度', exact: true }).click();
  await menu.getByRole('menuitem', { name: '将检测曲速减半', exact: true }).click();
  assert(Math.abs(bpmIn(await overlap.getAttribute('title')) - checkedBpm / 2) < .011);
  assert.equal(Number(await bpm.inputValue()), adopted);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await overlap.evaluate(node => node.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: innerWidth - 2, clientY: innerHeight - 2, button: 2,
  })));
  await menu.getByRole('menuitem', { name: '智能速度', exact: true }).click();
  const bounds = await menu.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height,
    JSON.stringify({ bounds, viewport }));
  await page.screenshot({ path: path.join(root, 'context-menu.png') });
  await menu.getByRole('menuitem', { name: '应用曲速并对齐', exact: true }).click();
  if (Number(await bpm.inputValue()) === adopted) await page.getByRole('button', { name: '下一小节', exact: true }).click();
  assert(Math.abs(Number(await bpm.inputValue()) - 137) < .6);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(Number(await bpm.inputValue()), adopted);
  assert.deepEqual(errors, []);
  console.log(`Smart Tempo: adopted in empty project, protected overlapping audio, preserved pickup, context command and undo verified. ${root}`);
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close();
}
