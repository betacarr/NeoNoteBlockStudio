import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const argument=process.argv.indexOf('--profile');assert(argument>=0,'Pass the existing real-download QA profile explicitly.');
const profile=path.resolve(process.argv[argument+1]);
assert(profile.startsWith(path.resolve('.local/audio-model-official-ui')+path.sep),'Only a real-download QA profile may be used.');
const base=path.resolve('.local/audio-mega-real-ui');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'run-'));
const inputArgument=process.argv.indexOf('--input');
const input=path.resolve(inputArgument>=0?process.argv[inputArgument+1]:'.local/audio-assist-smoke/run-WdIdRs/original-120bpm-C-Am-G.wav');
const framesArgument=process.argv.indexOf('--frames');
const expectedFrames=framesArgument>=0?Number(process.argv[framesArgument+1]):12*44100;
const gpuRequested=process.argv.includes('--gpu'),lowRequested=process.argv.includes('--low-memory');
const threadArgument=process.argv.indexOf('--threads'),cpuThreads=threadArgument>=0?Number(process.argv[threadArgument+1]):0;
assert(Number.isSafeInteger(expectedFrames)&&expectedFrames>0);
const env={...process.env,NBSX_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.NBSX_DEV_URL;
const report={status:'running',root,profile,input,expectedFrames,realOfficialModel:true,realInference:false,inputKind:process.argv.includes('--real-music')?'natural-music':process.argv.includes('--recorded-mixture')?'recording-mixture':'synthetic',syntheticInput:!process.argv.includes('--real-music')&&!process.argv.includes('--recorded-mixture'),gpuRequested,cpuThreads,memoryRequested:lowRequested?'low':'balanced',rendererErrors:[],progress:[],cases:[]};let app,page;
const save=()=>writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
const check=(name,details={})=>{report.cases.push({name,...details});console.log(name);};
async function menu(group,item){await page.getByRole('menuitem',{name:group,exact:true}).click();await page.getByRole('menu',{name:group,exact:true}).getByRole('menuitem',{name:item}).click();}
try{
 app=await electron.launch({args:['.','--mute-audio','--user-data-dir='+profile],env,timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.rendererErrors.push(e.message));
 await page.waitForFunction(()=>document.querySelectorAll('.sample-dot.loaded').length>=16);await page.getByTestId('open-audio-assist').click();const dialog=page.getByRole('dialog',{name:'音频辅助扒谱',exact:true});await dialog.waitFor();
 report.model=await page.evaluate(()=>window.desktop.audioModelStatus());assert.equal(report.model.state,'ready');
 report.backend=await page.evaluate(()=>window.desktop.audioAssistStatus());assert(report.backend.canSeparate);assert(report.backend.modelReady);
 assert.equal(await dialog.getByRole('checkbox',{name:'尝试 GPU 加速',exact:true,includeHidden:true}).isChecked(),false);report.cpuDefaultVerified=true;
 if(gpuRequested||lowRequested||cpuThreads){await dialog.locator('.aa-compute summary').click();if(gpuRequested)await dialog.getByRole('checkbox',{name:'尝试 GPU 加速',exact:true}).check();if(lowRequested)await dialog.getByLabel('CPU 内存模式',{exact:true}).selectOption('low');if(cpuThreads)await dialog.getByLabel('CPU 线程数',{exact:true}).selectOption(String(cpuThreads));}
 await dialog.getByRole('button',{name:'六轨模型…',exact:true}).click();await dialog.getByRole('region',{name:'六轨模型下载',exact:true}).waitFor();await dialog.getByRole('button',{name:'收起模型下载提示',exact:true}).click();
 await dialog.getByRole('checkbox',{name:'启用六轨分离',exact:true}).check();assert(await dialog.getByRole('checkbox',{name:'启用六轨分离',exact:true}).isChecked());
 await page.evaluate(()=>{window.__megaProgress=[];window.desktop.onAudioAssistProgress(e=>window.__megaProgress.push(e));});
 await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},input);
 const started=Date.now();await dialog.getByRole('button',{name:'导入音频并分析',exact:true}).click();
 for(;;){await new Promise(resolve=>setTimeout(resolve,1000));report.progress=await page.evaluate(()=>window.__megaProgress);const busy=await dialog.getByRole('button',{name:'取消分析',exact:true}).count();const rows=await dialog.locator('.aa-stem').count();
   if(!busy){if(rows!==6)throw new Error(await dialog.locator('.aa-message').innerText());break;}
   if(Date.now()-started>15*60*1000)throw new Error('Real inference exceeded QA deadline');
   if(Math.floor((Date.now()-started)/1000)%10===0){console.log(JSON.stringify(report.progress.at(-1)));await save();}
 }
 await page.waitForFunction(()=>document.querySelector('.aa-transport button')&&!document.querySelector('.aa-transport button').disabled,null,{timeout:60000});
 report.elapsedSeconds=(Date.now()-started)/1000;report.realInference=report.progress.some(event=>event.phase==='separating');report.reusedRealModelResult=!report.realInference;
 report.roles=await dialog.locator('.aa-stem').evaluateAll(rows=>rows.map(e=>e.dataset.stemRole));assert.deepEqual(report.roles,['vocals','drums','bass','guitar','piano','other']);
 assert.match(await dialog.innerText(),/不是原生六轨/);await page.screenshot({path:path.join(root,'real-model-six-output-preview.png')});
 const cache=path.join(profile,'audio-assist');
 report.computeResult=await dialog.locator('.aa-compute-result').innerText();const actualDevice=report.computeResult.startsWith('本次计算：GPU')?'cuda':'cpu';report.actualDevice=actualDevice;report.realGpuInference=gpuRequested&&actualDevice==='cuda'&&report.realInference;
 const candidates=[];for(const item of await readdir(cache,{withFileTypes:true})){if(!item.isDirectory()||item.name.startsWith('pending-'))continue;const dir=path.join(cache,item.name);try{const metrics=JSON.parse(await readFile(path.join(dir,'model-metrics.json'),'utf8')),result=JSON.parse(await readFile(path.join(dir,'result.json'),'utf8'));if(metrics.model==='mvsep-mega-53-five-heads-residual'&&metrics.version.endsWith('five-residual-v5')&&metrics.device===actualDevice&&result.workspace.name===path.basename(input))candidates.push({metrics,result,dir,modified:(await stat(path.join(dir,'model-metrics.json'))).mtimeMs});}catch{}}candidates.sort((a,b)=>b.modified-a.modified);if(candidates[0]){report.metrics=candidates[0].metrics;report.resultDirectory=candidates[0].dir;report.result=candidates[0].result;}
 assert(report.metrics);assert.equal(report.metrics.frames,expectedFrames);assert.equal(report.result.workspace.stems.length,6);assert.equal(report.result.files.length,7);assert(report.metrics.reconstructionPeakError<1e-5);
 report.files=[];for(const file of report.result.files){const target=path.join(report.resultDirectory,file.file),data=await readFile(target);report.files.push({name:file.name,file:target,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
 assert(new Set(report.files.map(f=>f.sha256)).size>5);check('actual pinned checkpoint produced six aligned outputs and an explicit residual warning',{elapsedSeconds:report.elapsedSeconds,metrics:report.metrics});
 await dialog.getByRole('button',{name:'播放分轨试听',exact:true}).click();await new Promise(resolve=>setTimeout(resolve,600));await dialog.getByRole('button',{name:'暂停分轨试听',exact:true}).click();report.playPosition=await dialog.locator('.aa-transport output').innerText();assert(!report.playPosition.startsWith('0:00.00'));
 await dialog.getByRole('button',{name:'鼓静音',exact:true}).click();assert.equal(await dialog.getByRole('button',{name:'鼓静音',exact:true}).getAttribute('aria-pressed'),'true');await dialog.getByRole('button',{name:'鼓静音',exact:true}).click();
 await dialog.getByRole('button',{name:'人声独奏',exact:true}).click();assert.equal(await dialog.getByRole('button',{name:'人声独奏',exact:true}).getAttribute('aria-pressed'),'true');await dialog.getByRole('button',{name:'人声独奏',exact:true}).click();check('real preview transport, mute and solo remain functional');
 const exported=path.join(root,'real-model-vocals.wav');await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},exported);await dialog.getByRole('button',{name:'导出人声WAV',exact:true}).click();for(let i=0;i<100;i++){if(await stat(exported).then(s=>s.size>44).catch(()=>false))break;await new Promise(r=>setTimeout(r,50));}assert((await stat(exported)).size>44);check('real model single-stem WAV export writes a nonempty aligned audio file');
 await dialog.getByRole('button',{name:'应用到工程',exact:true}).click();await dialog.waitFor({state:'hidden'});
 report.project=path.join(root,'real-mega-six-output.nbsx');await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},report.project);await menu('文件','另存为…');
 for(let i=0;i<200;i++){if(await stat(report.project).then(s=>s.size>44).catch(()=>false))break;await new Promise(r=>setTimeout(r,50));}assert((await stat(report.project)).size>44);
 await page.waitForFunction(()=>document.querySelector('.file-hint')?.textContent==='工程已就绪');
 await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},report.project);await menu('文件','打开 / 导入…');await page.waitForFunction(()=>document.querySelector('.status-message')?.textContent.includes('已打开'));
 await page.getByTestId('open-audio-assist').click();await dialog.waitFor();assert.equal(await dialog.locator('.aa-stem').count(),6);await page.screenshot({path:path.join(root,'saved-model-workspace.png')});check('native project file reopen restores six real model outputs and sidecar assets');
 await page.waitForFunction(()=>document.querySelector('.aa-transport button')&&!document.querySelector('.aa-transport button').disabled);
 const previousWaves=await dialog.locator('.aa-wave path').evaluateAll(elements=>elements.map(e=>e.getAttribute('d')));
 const alternate=path.join(root,'cancel-input.wav'),alternateBytes=Buffer.from(await readFile(input));alternateBytes.writeFloatLE(.001,alternateBytes.length-4);await writeFile(alternate,alternateBytes);
 await page.evaluate(()=>{window.__megaProgress=[];});await app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},alternate);await dialog.getByRole('button',{name:'导入音频并分析',exact:true}).click();
 await page.waitForFunction(()=>window.__megaProgress.some(e=>e.phase==='separating'),null,{timeout:60000});const cancelStarted=Date.now();await dialog.getByRole('button',{name:'取消分析',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.aa-progress'),null,{timeout:30000});assert.equal(await dialog.locator('.aa-stem').count(),6);assert.deepEqual(await dialog.locator('.aa-wave path').evaluateAll(elements=>elements.map(e=>e.getAttribute('d'))),previousWaves);
 assert(!(await readdir(cache)).some(name=>name.startsWith('pending-')));report.cancelPassed=true;report.cancelSeconds=(Date.now()-cancelStarted)/1000;await page.screenshot({path:path.join(root,'cancel-preserves-real-result.png')});await dialog.getByRole('button',{name:'取消',exact:true}).click();check('cancelling during an actual model forward preserves the prior preview and removes its pending job',{cancelSeconds:report.cancelSeconds});
 assert.deepEqual(report.rendererErrors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack??String(error);process.exitCode=1;console.error(report.error);if(page){report.messages=await page.locator('.aa-message').allTextContents().catch(()=>[]);await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});}}
finally{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>{});await app.close().catch(()=>{});}report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({status:report.status,report:path.join(root,'report.json')}));}
