import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const base=path.resolve('.local/audio-task-dialogs');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'run-'));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NBSX_DEV_URL;
const packaged = process.argv.indexOf('--packaged');
if (packaged >= 0 && !process.argv[packaged + 1]) throw new Error('--packaged requires the application executable.');
const executablePath = packaged >= 0 ? path.resolve(process.argv[packaged + 1]) : undefined;
const app=await electron.launch({
 ...(executablePath ? { executablePath } : {}),
 args:[...(executablePath ? [] : ['.']), '--mute-audio', `--user-data-dir=${path.join(root, 'profile')}`],
 env,
});
try{
 const runtime = await app.evaluate(({ app }) => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, packaged: app.isPackaged }));
 assert.equal(runtime.packaged, !!executablePath);
 const page=await app.firstWindow();await page.locator('.piano-viewport canvas').waitFor();const title=await page.title();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const captureWindow = async (filename) => {
   const png = await app.evaluate(async ({ BrowserWindow }) => {
     const image = await BrowserWindow.getAllWindows()[0].capturePage();
     return image.toPNG().toString('base64');
   });
   await writeFile(path.join(root, filename), Buffer.from(png, 'base64'));
 };
 await page.getByTestId('open-audio-split').click();const split=page.getByRole('dialog',{name:'大分轨拆分器',exact:true});await split.waitFor();
 assert.equal(await split.getByRole('group',{name:'要添加的分轨'}).getByRole('checkbox').count(),6);
 await split.getByLabel('分轨预置').selectOption('vocals');assert.equal(await split.getByRole('group',{name:'要添加的分轨'}).locator('input:checked').count(),1);
 await split.getByLabel('分轨预置').selectOption('all');assert.equal(await split.getByRole('group',{name:'要添加的分轨'}).locator('input:checked').count(),6);
 assert.equal(await split.getByLabel('分析BPM').count(),0);assert.equal(await split.getByRole('switch',{name:'单个鼓件'}).count(),1);
 await split.getByLabel('分轨预置').selectOption('vocalsInstrumental');
 assert(await split.getByLabel('子混音',{exact:true}).isChecked());
 await split.getByRole('button',{name:'选择子混音声部'}).click();
 assert.equal(await split.getByRole('group',{name:'子混音声部'}).getByRole('checkbox').count(),5);
 const normalStyle = await split.evaluate(dialog => {
   const style = getComputedStyle(dialog);
   return { radius: style.borderTopLeftRadius, shape: style.getPropertyValue('corner-top-left-shape'), background: style.backgroundColor, font: style.fontFamily };
 });
 assert(parseFloat(normalStyle.radius) >= 24, 'The splitter shell needs enough radius for a visible continuous corner.');
 assert.match(normalStyle.shape, /^(squircle|superellipse\(2\))$/);
 assert.equal(normalStyle.background, 'rgb(41, 41, 41)');
 await page.screenshot({path:`${root}/split.png`});
 const cancel = split.getByRole('button', { name: '取消', exact: true });
 const layouts = [];
 for (const zoom of [1.25, 1.5]) {
   await app.evaluate(({ BrowserWindow }, factor) => {
     const window = BrowserWindow.getAllWindows()[0];
     window.setContentSize(1050, 720);
     window.webContents.setZoomFactor(factor);
   }, zoom);
   await cancel.scrollIntoViewIfNeeded();
   const layout = await cancel.evaluate(button => {
     const dialog = button.closest('[role="dialog"]');
     const bounds = dialog.getBoundingClientRect();
     const footerButton = button.getBoundingClientRect();
     return {
       fitsViewport: bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1,
       fitsWidth: dialog.scrollWidth <= dialog.clientWidth + 1,
       cancelVisible: footerButton.top >= bounds.top && footerButton.bottom <= bounds.bottom,
     };
   });
   assert.deepEqual(layout, { fitsViewport: true, fitsWidth: true, cancelVisible: true });
   layouts.push({ zoom, ...layout });
 }
 await captureWindow('split-zoom-150.png');
 await page.emulateMedia({ forcedColors: 'active' });
 const contrast = await split.evaluate(dialog => ({
   preset: getComputedStyle(dialog.querySelector('.aa-preset select')).appearance,
   drumSwitch: getComputedStyle(dialog.querySelector('.aa-drum-pieces input')).appearance,
   thumb: getComputedStyle(dialog.querySelector('.aa-drum-pieces input'), '::before').display,
 }));
 assert.deepEqual(contrast, { preset: 'auto', drumSwitch: 'auto', thumb: 'none' });
 await split.evaluate(async dialog => {
   dialog.scrollTop = 0;
   await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
 });
 await captureWindow('split-forced-colors.png');
 await cancel.click();
 await page.emulateMedia({ forcedColors: 'none' });
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
 await page.getByTestId('open-audio-assist').click();const chords=page.getByRole('dialog',{name:'和弦与速度分析',exact:true});await chords.waitFor();assert.equal(await chords.getByLabel('分轨预置').count(),0);assert.equal(await chords.getByRole('button',{name:'模型资源…'}).count(),0);await page.screenshot({path:`${root}/chords.png`});await chords.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.title(),title);assert.deepEqual(errors,[]);
 await writeFile(`${root}/report.json`,JSON.stringify({status:'passed',runtime,normalStyle,layouts,contrast,checks:['independent entries','six stem choices, kit-piece option and submix presets','no chord controls in split','no model controls in chords','cancel preserves project'],errors,root},null,2));console.log(root);
}finally{await app.close();}
