import {_electron as electron} from 'playwright';
import {mkdtemp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
const base=path.resolve('.local/arrangement-audio-ui');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'run-'));
const profile=path.resolve(process.env.NBSX_QA_PROFILE ?? '.local/audio-model-official-ui/run-G3nD63/profile');
const input=path.resolve(process.env.NBSX_QA_AUDIO ?? '.local/effect-eval/six-known-recordings-fast/six-reference-mixture.wav');
const bytes=await readFile(input),env={...process.env,NBSX_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.NBSX_DEV_URL;
const report={status:'running',root,input,profile,cases:[],errors:[]};let app,page;
const save=()=>writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
async function menu(group,item){await page.getByRole('menuitem',{name:group,exact:true}).click();await page.getByRole('menu',{name:group,exact:true}).getByText(item,{exact:true}).click();}
async function drop(selector,names,x=120){await page.locator(selector).first().evaluate((el,{data,names,x})=>{const d=new DataTransfer();for(const name of names)d.items.add(new File([new Uint8Array(data)],name,{type:'audio/wav'}));const b=el.getBoundingClientRect();el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d,clientX:b.left+x,clientY:b.top+12}));},{data:Array.from(bytes),names,x});}
const check=name=>{report.cases.push(name);console.log(name);};
try{
 app=await electron.launch({args:['.','--mute-audio','--user-data-dir='+profile],env,timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.waitForFunction(()=>document.querySelectorAll('.sample-dot.loaded').length>=16);await page.waitForTimeout(1000);if(await page.getByRole('dialog',{name:'发现恢复副本',exact:true}).count())await page.getByRole('button',{name:'稍后处理',exact:true}).click();await menu('文件','新建工程');
 await drop('.audio-drop-zone',['录音 空格 # &.wav']);await page.locator('[data-audio-clip-id]').first().waitFor();await page.waitForFunction(()=>document.querySelector('.audio-region path')?.getAttribute('d')?.length>100);check('empty project drop creates a managed audio track, named region and decoded waveform at drop position');
 const source=page.locator('[data-audio-clip-id]').first(),sourceId=await source.getAttribute('data-audio-clip-id'),trackId=await source.locator('..').getAttribute('data-track-id');
 report.sourceId=sourceId;report.sourceStart=Number(await source.getAttribute('data-start-tick'));
 await drop(`[data-track-id="${trackId}"].arrangement-lane`,['同轨另一片段.wav'],220);await page.waitForFunction(()=>document.querySelectorAll('.audio-region').length===2);check('dropping on an existing audio track adds another region without replacing the first');
 const rb=await page.locator('.arrangement-ruler').boundingBox(),cb=await source.boundingBox();await page.locator('.arrangement-ruler').click({position:{x:cb.x-rb.x+8,y:10}});await menu('视图','混音器');await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('[aria-label="总输出电平"]')?.getAttribute('aria-valuenow'))>.001);check('main audio output meter measures the imported region on the shared transport');const before=await page.locator('.arrangement-playhead').getAttribute('style');await page.waitForTimeout(1500);assert.notEqual(await page.locator('.arrangement-playhead').getAttribute('style'),before);await page.getByRole('button',{name:'暂停',exact:true}).click();await menu('视图','混音器');check('main project transport advances with audio regions');
 await source.click({button:'right',position:{x:8,y:8}});await page.getByRole('menuitem',{name:'处理 ▸',exact:true}).click();await page.getByRole('menuitem',{name:'大分轨拆分器…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'大分轨拆分器',exact:true});await dialog.waitFor();
 await page.evaluate(()=>{window.__arrangementProgress=[];window.desktop.onAudioAssistProgress(p=>window.__arrangementProgress.push(p));});
 const started=Date.now();
 await dialog.getByRole('button',{name:'应用',exact:true}).click();
 await dialog.waitFor({state:'hidden',timeout:240000});
 report.analysisSeconds=(Date.now()-started)/1000;report.progress=await page.evaluate(()=>window.__arrangementProgress);
 report.realInference=report.progress.some(p=>p.phase==='separating');
 if(!process.argv.includes('--allow-cache'))assert(report.realInference,'This QA requires actual inference, not only a result fixture/cache');
 if(report.realInference) assert(report.progress.some(p=>p.phase==='separating'&&p.message.includes('CPU')));
 await page.waitForFunction(()=>document.querySelectorAll('.audio-region').length===8);
 assert.equal(await source.getAttribute('data-muted'),'true');
 assert.equal(await page.locator(`[data-track-id="${trackId}"].arrangement-lane .audio-region[data-muted="false"]`).count(),1);
 assert.equal(await page.getByRole('button',{name:'折叠分轨组',exact:true}).count(),1);
 check('applying the real split result groups six tracks below the source and mutes only the selected region');
 await page.screenshot({path:path.join(root,'audio-stem-stack.png'),fullPage:true});
 await menu('编辑','撤销');assert.equal(await page.locator('.audio-region').count(),2);assert.equal(await source.getAttribute('data-muted'),'false');await menu('编辑','重做');assert.equal(await page.locator('.audio-region').count(),8);check('one undo/redo restores all stem tracks and original-region mute atomically');
 await page.getByRole('button',{name:'折叠分轨组',exact:true}).click();assert.equal(await page.locator('.audio-region').count(),2);await page.getByRole('button',{name:'展开分轨组',exact:true}).click();assert.equal(await page.locator('.audio-region').count(),8);check('stem stack collapse preserves child regions');
 report.project=path.join(root,'arrangement-audio.nbsx');await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},report.project);await menu('文件','另存为…');await page.waitForFunction(()=>document.querySelector('.file-hint')?.textContent==='工程已就绪');assert((await stat(report.project)).size>44);
 const manifest=JSON.parse(strFromU8(unzipSync(await readFile(report.project))['project.json']));report.manifest={tracks:manifest.tracks.length,clips:manifest.audioClips,tempos:manifest.tempos};assert.equal(manifest.audioClips.length,8);const children=manifest.audioClips.filter(c=>c.separation);assert.equal(children.length,6);assert(children.every(c=>c.start===report.sourceStart));assert.equal(manifest.tempos[0].bpm,120);check('saved manifest preserves exact stem positions, group ownership and original tempo');
 await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},report.project);await menu('文件','打开 / 导入…');await page.waitForFunction(()=>document.querySelector('.status-message')?.textContent.includes('已打开'));assert.equal(await page.locator('.audio-region').count(),8);await page.waitForFunction(()=>Array.from(document.querySelectorAll('.audio-region path')).every(p=>p.getAttribute('d')?.length>100));check('native project reopen restores audio sidecars and all waveforms');
 await source.click({button:'right',position:{x:8,y:8}});await page.getByRole('menuitem',{name:'和弦 ▸',exact:true}).click();await page.getByRole('menuitem',{name:'分析和弦',exact:true}).click();
 await page.getByText('和弦已保存到所选音频片段。',{exact:true}).waitFor({timeout:120000});
 await source.click({button:'right',position:{x:8,y:8}});await page.getByRole('menuitem',{name:'和弦 ▸',exact:true}).click();await page.getByRole('menuitem',{name:'将片段和弦应用到和弦轨',exact:true}).click();
 await page.getByRole('group',{name:'全局和弦轨'}).locator('.chord-track-group').first().waitFor();
 assert.equal(await page.locator('.audio-region').count(),8);
 check('chord analysis and promotion to the global track are independent of the saved split audio');
 assert.deepEqual(report.errors,[]);report.status='passed';await save();console.log(JSON.stringify({root,status:report.status,analysisSeconds:report.analysisSeconds}));
}catch(error){report.status='failed';report.error=String(error);await save();if(page)await page.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy();}).catch(()=>{});await app.close().catch(()=>{});}}
