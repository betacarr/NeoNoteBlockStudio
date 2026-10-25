import { _electron as electron } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const packaged = process.argv.includes('--packaged') ? path.resolve(process.argv[process.argv.indexOf('--packaged') + 1]) : undefined;
const root = path.resolve('.local/timing-desktop', `run-${Date.now()}`), profile = path.join(root,'profile');
await mkdir(root,{recursive:true});
await build({stdin:{contents:"export {createProject,newNote} from './src/core/project.ts'; export {saveNbsx,openNbsx} from './src/core/container.ts';",resolveDir:process.cwd(),sourcefile:'timing-helper.ts'},outfile:path.join(root,'helper.mjs'),bundle:true,platform:'node',format:'esm'});
const {createProject,newNote,saveNbsx,openNbsx} = await import(pathToFileURL(path.join(root,'helper.mjs')).href);
const project=createProject('变拍号检查'); project.ppq=480;
project.timeSignatures=[{tick:0,numerator:3,denominator:4},{tick:2880,numerator:7,denominator:8},{tick:6240,numerator:4,denominator:4}];
project.tempos=[{tick:0,bpm:120},{tick:2880,bpm:90},{tick:6240,bpm:150}];
project.patterns[0].length=8160; project.patterns[0].notes=[newNote(0,66),newNote(2880,69),newNote(6240,73)]; project.regions[0].length=8160;
const input=path.join(root,'mixed.nbsx'), saved=path.join(root,'saved.nbsx'); await writeFile(input,saveNbsx(project));
const env={...process.env,NBSX_TEST_USER_DATA:profile}; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
const app=await electron.launch({...(packaged?{executablePath:packaged}:{}),args:[...(packaged?[]:['.']),'--mute-audio',`--user-data-dir=${profile}`],env});
const errors=[], observations=[];
try {
  const page=await app.firstWindow(); page.on('pageerror',error=>errors.push(error.message));
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
  const version=JSON.parse(await readFile('package.json','utf8')).version;
  assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
  await page.waitForFunction(()=>document.querySelectorAll('.sample-dot.loaded').length>=16);
  const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('menu',name),name);
  await app.evaluate(({dialog},filename)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filename]});},input);
  await command('open'); await page.waitForFunction(()=>document.title.startsWith('变拍号检查'));
  const read=()=>page.evaluate(()=>({position:document.querySelector('[data-testid=transport-position]').textContent,signature:document.querySelector('[data-testid=transport-signature]').textContent,bpm:Number(document.querySelector('[aria-label="当前位置速度 BPM"]').value)}));
  observations.push(await read());
  for(const expected of [
    {position:'2.1.00',signature:'3/4',bpm:120},
    {position:'3.1.00',signature:'7/8',bpm:90},
    {position:'4.1.00',signature:'7/8',bpm:90},
    {position:'5.1.00',signature:'4/4',bpm:150},
  ]) {
    await command('next-bar'); await page.waitForFunction(position=>document.querySelector('[data-testid=transport-position]').textContent===position,expected.position);
    const actual=await read(); assert.deepEqual(actual,expected); observations.push(actual);
  }
  await command('previous-bar'); await page.waitForFunction(()=>document.querySelector('[data-testid=transport-position]').textContent==='4.1.00');
  assert.deepEqual(await read(),{position:'4.1.00',signature:'7/8',bpm:90});
  const ruler=await page.locator('.arrangement-ruler .bar').evaluateAll(elements=>elements.map(element=>({tick:Number(element.dataset.tick),bar:Number(element.dataset.bar)})));
  for(const [tick,bar] of [[0,1],[1440,2],[2880,3],[4560,4]]) assert(ruler.some(mark=>mark.tick===tick&&mark.bar===bar),`Missing ruler bar ${bar}`);
  await page.screenshot({path:path.join(root,'mixed-meter.png')});
  // Save before opening the read-only inspection modal: editor menu commands are
  // intentionally blocked while a dialog is active.
  await app.evaluate(({dialog},filename)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:filename});},saved);
  // Opening a saved NBSX retains its destination; use Save As for a separate verification file.
  await command('save-as'); await page.waitForFunction(()=>document.querySelector('.status-message').textContent.includes('已保存'));
  const restored=openNbsx(new Uint8Array(await readFile(saved)));
  assert.deepEqual(restored.tempos,project.tempos); assert.deepEqual(restored.timeSignatures,project.timeSignatures);
  assert.deepEqual(restored.patterns[0].notes,project.patterns[0].notes); assert.deepEqual(errors,[]);
  await command('timing'); await page.getByRole('dialog',{name:'速度与拍号'}).waitFor();
  assert.deepEqual(await page.locator('[data-testid=meter-event] .timing-position').allTextContents(),['1.1.00','3.1.00','5.1.00']);
  assert.deepEqual(await page.locator('[data-testid=tempo-event] input').evaluateAll(elements=>elements.map(element=>Number(element.value))),[120,90,150]);
  await page.screenshot({path:path.join(root,'timing-editor.png')});
  const report={schema:1,version,packaged:!!packaged,platform:process.platform,arch:process.arch,observations,ruler:'passed',timingEditor:'passed',saveTimingAndNotes:'passed',rendererErrors:errors,
    scope:'Actual Electron main-process menu commands, renderer DOM inspection and NBSX readback; no synthetic mouse/keyboard input. Does not cover every piano-roll interaction.',implementationSha256:{}};
  for(const file of ['src/core/meter.ts','src/core/time.ts','src/core/project.ts','src/ui/App.tsx','src/ui/Arrangement.tsx','src/ui/PianoRoll.tsx','src/ui/TimingEditor.tsx','scripts/smoke-timing-desktop.mjs']) report.implementationSha256[file]=createHash('sha256').update(await readFile(file)).digest('hex');
  await writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2));
  if(process.argv.includes('--write-evidence')) { await mkdir('docs/evidence',{recursive:true}); await writeFile('docs/evidence/editor-timing.json',JSON.stringify(report,null,2)); }
  console.log(JSON.stringify({...report,implementationSha256:undefined,screenshots:root}));
} catch(error) {
  const page=await app.firstWindow().catch(()=>null); await page?.screenshot({path:path.join(root,'failure.png')}).catch(()=>{}); throw error;
} finally {
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>{}); await app.close().catch(()=>{});
}
