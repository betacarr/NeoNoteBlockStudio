import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const base=path.resolve('.local/piano-mapping-range-ui'); await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'run-')),profile=path.join(root,'profile');await mkdir(profile);
const helper=path.join(root,'helper.mjs');
await build({stdin:{contents:"export{openNbsx,saveNbsx}from'./src/core/container.ts';export{createProject,newNote,uid}from'./src/core/project.ts';",resolveDir:process.cwd()},outfile:helper,bundle:true,platform:'node',format:'esm'});
const {createProject,newNote,uid,saveNbsx,openNbsx}=await import(pathToFileURL(helper).href);
const ordinary=createProject('普通轨音域边界 QA');ordinary.patterns[0].notes=[53,54,78,79].map(midi=>newNote(0,midi));
const shifted=structuredClone(ordinary);shifted.id=uid();shifted.name='乐器基准偏移 QA';shifted.instruments.find(i=>i.id===shifted.tracks[0].instrumentId).rootMidi=72;shifted.patterns[0].notes=[59,60,84,85].map(midi=>newNote(0,midi));
const kit=createProject('映射名称与输出音域 QA');kit.tracks[0].drumPresetId='kit';kit.patterns[0].notes=[36,38,42,46].map(midi=>newNote(0,midi));
const hit=midi=>({id:uid(),instrumentId:'snare',midi,offsetBeats:0,durationBeats:.25,velocity:1});
kit.drumPresets=[{id:'kit',name:'整体预设名称不是行名称',mappings:[
 {id:'kick',trigger:36,name:'我的重击层',notes:[hit(66)]},
 {id:'snare',trigger:38,name:'越界军鼓层',notes:[hit(53)]},
 {id:'hat',trigger:42,name:'混合层与一段很长的自定义映射名称用于检查省略和完整提示'.repeat(2),notes:[hit(66),hit(90)]},
 {id:'legacy',trigger:46,notes:[hit(66)]},
]}];
for(const [name,project]of [['ordinary',ordinary],['shifted',shifted],['kit',kit]])await writeFile(path.join(root,name+'.nbsx'),saveNbsx(project));
const env={...process.env,NBSX_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.NBSX_DEV_URL;
const report={status:'running',root,appearance:'classic',otherThemes:'Internal liquid-glass is disabled by the current build; it was not enabled for this test.',cases:[],rendererErrors:[]};let app,page;
const check=(name,details={})=>{report.cases.push({name,...details});console.log(name);};
const roll=()=>page.locator('.center-workspace').getByTestId('piano-roll');
async function menu(group,item){await page.getByRole('menuitem',{name:group,exact:true}).click();await page.getByRole('menu',{name:group,exact:true}).getByRole('menuitem',{name:item}).click();}
async function open(name){const file=path.join(root,name+'.nbsx');await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},file);await menu('文件','打开 / 导入…');await page.waitForFunction(title=>document.title.includes(title),name==='ordinary'?ordinary.name:name==='shifted'?shifted.name:kit.name);}
async function pixels(canvas,midis){return canvas.evaluate((element,midis)=>{const row=Number(element.dataset.rowHeight),sy=Number(element.dataset.scrollY),header=Number(element.dataset.keyboardWidth),dpr=element.width/element.getBoundingClientRect().width,ctx=element.getContext('2d');return midis.map(midi=>{const y=42+(127-midi+.5)*row-sy;if(y<42||y>=element.getBoundingClientRect().height-78)throw new Error('pitch not visible: '+midi);const rgba=[...ctx.getImageData(Math.floor((header+173)*dpr),Math.floor(y*dpr),1,1).data];return{midi,rgba,luminance:rgba[0]*.2126+rgba[1]*.7152+rgba[2]*.0722};});},midis);}
async function save(name){const file=path.join(root,name+'.nbsx');await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},file);await menu('文件','另存为…');await page.waitForFunction(()=>document.querySelector('.status-message')?.textContent.includes('已保存'));return openNbsx(new Uint8Array(await readFile(file)));}
try{
 app=await electron.launch({args:['.','--mute-audio','--user-data-dir='+profile],env,timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.rendererErrors.push(e.message));await page.waitForFunction(()=>document.querySelectorAll('.sample-dot.loaded').length>=16);
 await open('ordinary');await page.getByRole('button',{name:'显示全部音符',exact:true}).click();
 const ordinaryPixels=await pixels(roll().locator('canvas'),[53,54,78,79]);
 assert(ordinaryPixels[0].luminance<ordinaryPixels[1].luminance*.8);assert(ordinaryPixels[3].luminance<ordinaryPixels[2].luminance*.8);
 await page.screenshot({path:path.join(root,'ordinary-range-boundaries.png')});check('ordinary grid darkens both outside boundaries while keeping 54 and 78 normal',{pixels:ordinaryPixels});
 // A real pointer draw in an out-of-range row stays editable and saves that pitch.
 const canvas=roll().locator('canvas'),geometry=await canvas.evaluate(e=>({row:Number(e.dataset.rowHeight),sy:Number(e.dataset.scrollY),header:Number(e.dataset.keyboardWidth)}));
 await canvas.click({position:{x:geometry.header+173,y:42+(127-79+.5)*geometry.row-geometry.sy}});
 assert.equal(await page.getByRole('spinbutton',{name:'音符 MIDI 音高',exact:true}).inputValue(),'79');
 const edited=await save('outside-edited');assert.equal(edited.patterns[0].notes.filter(n=>n.midi===79).length,2);check('out-of-range grid remains editable and preserves MIDI 79');
 await open('shifted');await page.getByRole('button',{name:'显示全部音符',exact:true}).click();
 assert.equal(await roll().locator('canvas').getAttribute('data-range-min'),'60');assert.equal(await roll().locator('canvas').getAttribute('data-range-max'),'84');
 const shiftedPixels=await pixels(roll().locator('canvas'),[59,60,84,85]);assert(shiftedPixels[0].luminance<shiftedPixels[1].luminance*.8);assert(shiftedPixels[3].luminance<shiftedPixels[2].luminance*.8);check('guide follows the actual instrument root offset',{pixels:shiftedPixels});
 await open('kit');await page.getByRole('button',{name:'显示全部音符',exact:true}).click();
 const header=midi=>page.locator('[data-testid="drum-row-header"][data-midi="'+midi+'"]');
 assert.match(await header(36).innerText(),/我的重击层/);assert.match(await header(36).innerText(),/36/);assert.equal(await header(36).getAttribute('data-range'),'in');
 assert.equal(await header(38).getAttribute('data-range'),'out');assert.equal(await header(42).getAttribute('data-range'),'mixed');assert.match(await header(46).innerText(),/未命名映射/);assert.match(await header(37).innerText(),/未映射/);
 assert((await header(42).getAttribute('title')).includes(kit.drumPresets[0].mappings[2].name));
 const overflow=await header(42).locator('.drum-row-name').evaluate(e=>e.scrollWidth>e.clientWidth);assert(overflow);
 await page.screenshot({path:path.join(root,'custom-drum-mapping-names.png')});check('custom mapping names, pitch/trigger IDs, legacy/unmapped states and long-name tooltip',{overflow});
 await page.getByTestId('edit-drum-preset').click();const dialog=page.getByRole('dialog',{name:'鼓组映射预设',exact:true});await dialog.waitFor();
 await dialog.getByRole('textbox',{name:'映射名称',exact:true}).fill('已更新的自定义重击');
 const inner=dialog.getByTestId('drum-mapping-piano').locator('canvas');assert.equal(await inner.getAttribute('data-keyboard-width'),'58');assert.equal(await inner.getAttribute('data-range-min'),'54');
 await page.screenshot({path:path.join(root,'mapping-name-editor-and-real-pitches.png')});
 await dialog.getByRole('button',{name:/越界军鼓层/}).click();
 const innerPixels=await pixels(inner,[53,54]);assert(innerPixels[0].luminance<innerPixels[1].luminance*.8);
 await page.screenshot({path:path.join(root,'preset-real-output-outside.png')});check('preset internal roll shades actual sounding MIDI pitches',{pixels:innerPixels});
 await dialog.getByRole('button',{name:'应用修改',exact:true}).click();
 assert.match(await header(36).innerText(),/已更新的自定义重击/);
 const saved=await save('renamed-kit');assert.equal(saved.drumPresets[0].mappings[0].name,'已更新的自定义重击');check('mapping rename updates left rows immediately and persists through save');
 await page.getByRole('button',{name:'缩小钢琴卷帘纵向',exact:true}).click();await page.getByRole('button',{name:'放大钢琴卷帘纵向',exact:true}).click();assert.match(await header(36).innerText(),/已更新的自定义重击/);
 const mainCanvas=roll().locator('canvas');await mainCanvas.hover();await page.mouse.wheel(0,90);await page.mouse.wheel(0,-90);await page.waitForTimeout(100);assert.match(await header(36).innerText(),/已更新的自定义重击/);check('mapping rows remain synchronized after vertical zoom and scroll');
 const scrollbar=roll().getByRole('scrollbar',{name:'钢琴卷帘垂直滚动',exact:true});await scrollbar.press('Home');assert.equal(await header(127).count(),1);await scrollbar.press('End');assert.equal(await header(0).count(),1);await roll().getByRole('button',{name:/定位已映射/}).click();assert.match(await header(36).innerText(),/已更新的自定义重击/);check('extreme trigger rows 0 and 127 remain reachable without folding rows');
 await open('ordinary');assert.equal(await roll().getAttribute('data-row-mode'),'piano');assert.equal(await page.getByTestId('drum-row-header').count(),0);check('switching back to an ordinary track removes trigger headers and restores the pitch guide');
 assert.deepEqual(report.rendererErrors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack??String(error);process.exitCode=1;console.error(report.error);if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});}
finally{if(app)await app.close().catch(()=>{});report.finishedAt=new Date().toISOString();await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:path.join(root,'report.json')}));}
