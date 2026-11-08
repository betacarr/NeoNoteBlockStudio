import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Isolated user profile, generated fixtures, real UI and host file dialogs.
// No user project, model download, native window, or installed setting is used.
const base = path.resolve('.local/logic-workflows'); await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, 'run-')), profile = path.join(root, 'profile'); await mkdir(profile);
const helper = path.join(root, 'helper.mjs');
await build({ stdin: { contents: "export {createProject,newTrack,newNote} from './src/core/project.ts';export {saveNbsx,openNbsx} from './src/core/container.ts';export {exportMidi} from './src/core/midi.ts';", resolveDir: process.cwd(), sourcefile: 'logic-helper.ts' }, outfile: helper, bundle: true, platform: 'node', format: 'esm' });
const { createProject, newTrack, newNote, saveNbsx, openNbsx, exportMidi } = await import(pathToFileURL(helper).href);
const source = createProject('Logic QA source');
source.patterns[0].length = 7680; source.regions[0].length = 7680;
source.patterns[0].notes = [{ ...newNote(0, 66, 960), instrumentId: 'bass' }, newNote(1920, 70, 960), newNote(3840, 67, 960)];
source.tracks.push(newTrack('Other harp', 1, 'harp'));
const sourceFile = path.join(root, 'source.nbsx'); await writeFile(sourceFile, saveNbsx(source));
const wav = new Uint8Array(44 + 44100 * 2), v = new DataView(wav.buffer);
const ascii = (at, text) => [...text].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
ascii(0, 'RIFF'); v.setUint32(4, wav.length - 8, true); ascii(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); ascii(36, 'data'); v.setUint32(40, wav.length - 44, true);
for (let frame = 0; frame < 44100; frame++) v.setInt16(44 + frame * 2, Math.sin(frame / 44100 * 440 * Math.PI * 2) * 3000, true);
const sampleFile = path.join(root, 'independent-sample.wav'); await writeFile(sampleFile, wav);
const env = { ...process.env, NBSX_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
let desktop;
const report = { status: 'running', root, profile, startedAt: new Date().toISOString(), cases: [], errors: [] };
const passed = (name, evidence) => { report.cases.push({ name, status: 'passed', ...evidence }); console.log(`PASS ${name}`); };
try {
  desktop = await electron.launch({ args: ['.', '--mute-audio', `--user-data-dir=${profile}`], env });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.hide()));
  const page = await desktop.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForFunction(() => document.querySelectorAll('.sample-dot.loaded').length >= 16);
  await page.locator('input[type=file][accept=".nbsx,.nbs,.mid,.midi,.flp"]').setInputFiles({ name: 'source.nbsx', mimeType: 'application/octet-stream', buffer: Buffer.from(saveNbsx(source)) });
  await page.waitForFunction(() => document.title.includes('Logic QA source'));
  assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
  report.renderer = await page.locator('script[type=module]').getAttribute('src');
  const name = page.getByRole('textbox', { name: '工程名称', exact: true });
  const undo = () => page.getByRole('button', { name: '撤销', exact: true }).click();
  const redo = () => page.getByRole('button', { name: '重做', exact: true }).click();
  const status = () => page.locator('.status-message').innerText();
  const documentKey = () => page.locator('.studio').getAttribute('data-document-key');
  async function chooseFile(filename) { await desktop.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, filename); }
  async function reset() {
    const before = await documentKey(); await chooseFile(sourceFile);
    await page.getByRole('button', { name: '打开 / 导入 MIDI、NBS 或 FLP', exact: true }).click();
    await page.waitForFunction(before => document.querySelector('[role=dialog][aria-label="未保存的修改"]') || document.querySelector('.studio')?.dataset.documentKey !== before, before);
    if (await page.getByRole('dialog', { name: '未保存的修改' }).count()) await page.getByRole('button', { name: '不保存', exact: true }).click();
    await page.waitForFunction(before => document.querySelector('.studio')?.dataset.documentKey !== before, before);
  }
  async function saveAs(filename) {
    await desktop.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, filename);
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: '另存为…', exact: false }).click();
    await page.waitForFunction(() => !document.title.startsWith('●') && document.querySelector('.status-message').textContent.includes('已保存'));
    return openNbsx(new Uint8Array(await readFile(filename)));
  }
  async function drop(files, selector = '.arrangement', x = 600, y = 300) {
    const transfer = await page.evaluateHandle(files => { const transfer = new DataTransfer(); for (const file of files) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.mime })); return transfer; }, files);
    await page.locator(selector).dispatchEvent('drop', { dataTransfer: transfer, clientX: x, clientY: y });
    await transfer.dispose();
  }
  async function newProject() { const before = await documentKey(); await page.getByRole('menuitem', { name: '文件', exact: true }).click(); await page.getByRole('menuitem', { name: '新建工程' }).click(); return before; }
  async function logicPreset() {
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '操作与快捷键', exact: true }).click();
    await page.getByLabel('快捷键基础预设').selectOption('logic');
    await page.getByRole('button', { name: '应用快捷键', exact: true }).click();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
  async function notePoint(midi = 66, beat = 0) {
    await page.getByRole('button', { name: '显示全部音符', exact: true }).click();
    return page.locator('.piano-viewport canvas').evaluate((canvas, { midi, beat }) => ({ x: +canvas.dataset.keyboardWidth + beat * +canvas.dataset.zoom - +canvas.dataset.scrollX + 6, y: 42 + (127 - midi) * +canvas.dataset.rowHeight - +canvas.dataset.scrollY + +canvas.dataset.rowHeight / 2 }), { midi, beat });
  }

  // Transactional inputs, including native Save while a draft is still focused.
  const bpm = page.getByRole('spinbutton', { name: '当前位置速度 BPM' });
  await bpm.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('135'); await bpm.press('Enter'); await undo(); assert.equal(await bpm.inputValue(), '120'); await redo(); assert.equal(await bpm.inputValue(), '135');
  await name.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('OneNameTransaction'); await name.press('Enter'); await undo(); assert.equal(await name.inputValue(), source.name); await redo(); assert.equal(await name.inputValue(), 'OneNameTransaction');
  passed('BPM and names each undo as one edit', { undoBpm: 120, redoBpm: 135 });
  const master = page.getByRole('slider', { name: '总音量', exact: true }), masterBox = await master.boundingBox(), masterBefore = await master.inputValue();
  await page.mouse.move(masterBox.x + masterBox.width * .35, masterBox.y + masterBox.height / 2); await page.mouse.down(); await page.mouse.move(masterBox.x + masterBox.width * .8, masterBox.y + masterBox.height / 2, { steps: 12 }); await page.mouse.up();
  assert.notEqual(await master.inputValue(), masterBefore); await undo(); assert.equal(await master.inputValue(), masterBefore);
  passed('Top master fader drag is one undo transaction');

  await page.getByRole('button', { name: '编辑速度与拍号', exact: true }).click();
  assert(await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')));
  for (let i = 0; i < 8; i++) { await page.keyboard.press(i % 2 ? 'Tab' : 'Shift+Tab'); assert(await page.evaluate(() => !!document.activeElement.closest('[role=dialog]'))); }
  assert(await page.locator('.control-bar').evaluate(element => element.inert));
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '编辑速度与拍号');
  passed('Modal focus, inert background, Tab and restoration');

  const recovery = { ...structuredClone(source), name: 'OneNameTransaction' }, recoveryBytes = saveNbsx(recovery);
  await page.evaluate(bytes => window.desktop.autosave(new Uint8Array(bytes)), [...recoveryBytes]);
  const recoveryPath = path.join(profile, 'recovery.nbsx'), beforeRecovery = await readFile(recoveryPath);
  await drop([{ name: 'invalid.mid', mime: 'audio/midi', bytes: [...new TextEncoder().encode('bad midi')] }]);
  await page.waitForFunction(() => document.querySelector('.status-message').textContent.includes('不是有效的标准 MIDI'));
  assert.deepEqual(await readFile(recoveryPath), beforeRecovery); assert.equal(await page.getByRole('dialog').count(), 0);
  passed('Invalid import preserves current project and exact recovery bytes');
  await newProject(); await page.getByRole('dialog', { name: '未保存的修改' }).waitFor(); await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(await name.inputValue(), 'OneNameTransaction');
  await newProject(); await desktop.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await page.getByRole('button', { name: '保存并继续', exact: true }).click(); await page.getByRole('dialog', { name: '未保存的修改' }).getByText('已取消保存', { exact: false }).waitFor(); assert.equal(await name.inputValue(), 'OneNameTransaction'); assert.deepEqual(await readFile(recoveryPath), beforeRecovery);
  await desktop.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, path.join(sampleFile, 'cannot-write.nbsx'));
  await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  await page.waitForFunction(() => { const text = document.querySelector('[role=dialog][aria-label="未保存的修改"] [role=status]')?.textContent; return text && text !== '正在保存…' && !text.includes('已取消保存'); });
  assert.equal(await name.inputValue(), 'OneNameTransaction'); assert.deepEqual(await readFile(recoveryPath), beforeRecovery);
  const savedBeforeNew = path.join(root, 'saved-before-new.nbsx'); await desktop.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, savedBeforeNew);
  await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="工程名称"]').value === '未命名工程');
  const checkpoint = openNbsx(new Uint8Array(await readFile(savedBeforeNew))); assert.equal(checkpoint.name, 'OneNameTransaction'); assert.equal(checkpoint.tempos[0].bpm, 135);
  passed('Unsaved Cancel and canceled save preserve current document; Save and continue stores the complete old document before switching');

  const midi = exportMidi(source).bytes;
  const beforeMidi = await documentKey(); await drop([{ name: 'valid.mid', mime: 'audio/midi', bytes: [...midi] }]); await page.waitForFunction(before => document.querySelector('.studio').dataset.documentKey !== before, beforeMidi);
  assert.match(await status(), /已打开 valid.mid/);
  const afterMidi = await documentKey(); await drop([{ name: 'valid.mid', mime: 'audio/midi', bytes: [...midi] }, { name: 'sound.wav', mime: 'audio/wav', bytes: [...wav] }]); assert.equal(await documentKey(), afterMidi); assert.match(await status(), /分别拖入/);
  passed('MIDI drop routes by format; mixed drops reject atomically');
  await reset(); await logicPreset();

  const point = await notePoint(); const canvas = page.locator('.piano-viewport canvas');
  await canvas.click({ button: 'right', position: point }); await page.getByRole('menu', { name: '音符编辑菜单' }).waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('spinbutton', { name: '音符 MIDI 音高' }).inputValue(), '66');
  const bounds = await canvas.boundingBox(); await page.keyboard.down('Alt'); await page.mouse.move(bounds.x + point.x, bounds.y + point.y); await page.mouse.down(); await page.mouse.move(bounds.x + point.x + 65, bounds.y + point.y, { steps: 8 });
  assert(+await canvas.getAttribute('data-copy-preview-count') > 0); await page.mouse.up(); await page.keyboard.up('Alt');
  let check = await saveAs(path.join(root, 'note-copy.nbsx')); assert.equal(check.patterns[0].notes.length, 4); assert(check.patterns[0].notes.some(note => note.id === source.patterns[0].notes[0].id && note.tick === 0));
  await undo(); check = await saveAs(path.join(root, 'note-copy-undo.nbsx')); assert.equal(check.patterns[0].notes.length, 3);
  const region = page.getByTestId('region').first(), regionBox = await region.boundingBox();
  await page.keyboard.down('Alt'); await page.mouse.move(regionBox.x + 20, regionBox.y + 20); await page.mouse.down(); await page.mouse.move(regionBox.x + 88, regionBox.y + 20, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Alt');
  assert.equal(await page.getByTestId('region').count(), 2); await undo(); assert.equal(await page.getByTestId('region').count(), 1);
  passed('Logic right-click menu and atomic Alt note/region copies preserve originals');

  await reset();
  await page.getByRole('button', { name: '替换轨道默认音色采样…', exact: true }).click();
  const replacement = page.getByRole('dialog', { name: '替换采样' }); assert.match(await replacement.innerText(), /轨道.*默认音色/); assert.match(await replacement.innerText(), /竖琴/);
  await chooseFile(sampleFile); await replacement.getByRole('button', { name: '仅替换此目标（独立音色）…', exact: true }).click(); await replacement.waitFor({ state: 'hidden' });
  check = await saveAs(path.join(root, 'local-sample.nbsx')); assert.notEqual(check.tracks[0].instrumentId, 'harp'); assert.equal(check.tracks[1].instrumentId, 'harp'); assert.equal(check.patterns[0].notes[0].instrumentId, 'bass'); assert(!check.instruments.find(instrument => instrument.id === 'harp').assetId);
  await reset(); const selectedPoint = await notePoint(); await canvas.click({ position: selectedPoint }); await page.getByRole('button', { name: '替换所选音符的采样…', exact: true }).click(); assert.match(await replacement.innerText(), /贝斯/);
  await chooseFile(sampleFile); await replacement.getByRole('button', { name: '仅替换此目标（独立音色）…', exact: true }).click(); await replacement.waitFor({ state: 'hidden' });
  check = await saveAs(path.join(root, 'local-note-sample.nbsx')); assert.equal(check.tracks[0].instrumentId, 'harp'); assert.notEqual(check.patterns[0].notes[0].instrumentId, 'bass'); assert(!check.instruments.find(instrument => instrument.id === 'bass').assetId);
  passed('Track and selected-note sample targets are independent and preserve global definitions');

  await reset(); const lane = await page.locator('.arrangement-scroll').boundingBox();
  await drop([{ name: 'test.wav', mime: 'audio/wav', bytes: [...wav] }], '.arrangement', lane.x + 34, lane.y + 180);
  await page.waitForFunction(() => document.querySelectorAll('[data-audio-clip-id]').length === 1);
  await page.getByTestId('region').first().click({ position: { x: 20, y: 20 } });
  const audio = page.locator('[data-audio-clip-id]'); await audio.first().click({ position: { x: 20, y: 15 } });
  assert.equal(await page.locator('.region.selected').count(), 0); await page.keyboard.press('Delete'); assert.equal(await audio.count(), 0); assert.equal(await page.getByTestId('region').count(), 1);
  await undo(); assert.equal(await audio.count(), 1); assert.equal(await page.locator('.audio-region.selected').count(), 1);
  await audio.first().click({ position: { x: 20, y: 15 } }); await page.keyboard.press('Control+C'); await page.locator('.arrangement-ruler').click({ position: { x: 200, y: 20 } }); await page.keyboard.press('Control+V'); assert.equal(await audio.count(), 2);
  await page.keyboard.press('Control+X'); assert.equal(await audio.count(), 1); await page.keyboard.press('Control+V'); assert.equal(await audio.count(), 2); await undo(); assert.equal(await audio.count(), 1); await redo(); assert.equal(await audio.count(), 2);
  passed('Audio selection/Delete/copy/cut/paste/Undo/Redo use the actual audio target');

  const ruler = await page.locator('.arrangement-ruler').boundingBox();
  await page.mouse.move(ruler.x + 34, ruler.y + 5); await page.mouse.down(); await page.mouse.move(ruler.x + 136, ruler.y + 5, { steps: 8 }); await page.mouse.up();
  check = await saveAs(path.join(root, 'cycle-audio.nbsx')); assert.deepEqual(check.cycle, { start: 960, end: 3840, enabled: true });
  assert((await stat(path.join(root, 'cycle-audio.nbsx.assets', check.assets.find(asset => asset.audioFile).audioFile.file))).isFile());
  await page.getByRole('button', { name: '播放', exact: true }).click(); await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await page.locator('.arrangement-ruler').click({ position: { x: 75, y: 20 } }); assert.equal(await page.getByRole('button', { name: '暂停', exact: true }).count(), 1);
  await page.getByRole('button', { name: '混音器', exact: true }).click();
  await page.waitForFunction(() => { const meter = [...document.querySelectorAll('[role=meter]')].find(meter => meter.getAttribute('aria-label') === 'test.wav 电平'); return meter && +meter.getAttribute('aria-valuenow') > .001; });
  const observed = await page.evaluate(() => new Promise(resolve => { const values = []; const timer = setInterval(() => { values.push(document.querySelector('[data-testid=transport-position]').textContent); if (values.length === 25) { clearInterval(timer); resolve(values); } }, 100); }));
  assert(observed.every(position => /^1\.[234]\./.test(position)), JSON.stringify(observed));
  await page.getByRole('button', { name: '停止并回到起点', exact: true }).click(); assert.equal(await page.getByTestId('transport-position').innerText(), '1.1.00'); assert.equal(await page.getByRole('button', { name: '播放', exact: true }).count(), 1);
  await page.locator('.arrangement-ruler').click({ position: { x: 100, y: 20 } }); assert.equal(await page.getByRole('button', { name: '播放', exact: true }).count(), 1);
  await page.screenshot({ path: path.join(root, 'audio-cycle.png') });
  passed('Local cycle persists with audio assets; seek keeps playback state, Stop returns to project start', { range: check.cycle, observedPositions: observed });
  const reopenedKey = await documentKey();
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'qa-native-drop'; input.hidden = true; document.body.append(input); });
  await page.locator('#qa-native-drop').setInputFiles(path.join(root, 'cycle-audio.nbsx'));
  const nativeTransfer = await page.evaluateHandle(() => { const transfer = new DataTransfer(); transfer.items.add(document.querySelector('#qa-native-drop').files[0]); return transfer; });
  await page.locator('.arrangement').dispatchEvent('drop', { dataTransfer: nativeTransfer, clientX: ruler.x + 20, clientY: ruler.y + 80 }); await nativeTransfer.dispose();
  await page.waitForFunction(before => document.querySelector('.studio').dataset.documentKey !== before, reopenedKey);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-audio-clip-id] svg path')].every(path => path.getAttribute('d').length > 30));
  assert.equal(await audio.count(), 2); assert(await page.getByRole('button', { name: '局部循环', exact: true }).evaluate(button => button.classList.contains('selected-text')));
  passed('Physical NBSX drop reopens saved cycle and managed audio sidecars');
  await page.screenshot({ path: path.join(root, 'audio-cycle-reopened.png') });
  await page.getByTestId('region').first().click({ position: { x: 20, y: 20 } });
  await page.getByRole('button', { name: '按所选片段设置循环', exact: true }).click();
  const selectedCycle = await saveAs(path.join(root, 'selected-cycle.nbsx')); assert.deepEqual(selectedCycle.cycle, { start: 0, end: 7680, enabled: true });
  await undo(); assert.match(await page.getByTestId('arrangement-cycle-range').getAttribute('aria-label'), /1.2.00/);
  passed('Set cycle from selected region and undo restores previous locators');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1050, 720));
  assert(await page.getByRole('slider', { name: '总音量', exact: true }).isVisible());
  const overflow = await page.evaluate(() => [...document.querySelectorAll('button')].filter(button => button.offsetParent && button.getBoundingClientRect().right > innerWidth + 1).map(button => button.getAttribute('aria-label') || button.textContent));
  assert.deepEqual(overflow, []); await page.screenshot({ path: path.join(root, 'minimum-window.png') });
  passed('Minimum window keeps master fader and action buttons reachable');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.stack ?? String(error); throw error; }
finally {
  if (desktop) { await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await desktop.close().catch(() => {}); }
  report.finishedAt = new Date().toISOString(); await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, report: path.join(root, 'report.json'), error: report.error }));
}
