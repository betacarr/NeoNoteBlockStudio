import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { parseMidi } from 'midi-file';
import { fromArrayBuffer } from '@nbsjs/core';

const base=path.resolve('.local/drum-mapping-smoke'); await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'run-')),profile=path.join(root,'profile');await mkdir(profile);
const helper=path.join(root,'helper.mjs');
await build({stdin:{contents:"export {createProject,newTrack,newNote,uid,flattenNotes,renderNoteEvents}from'./src/core/project.ts';export{saveNbsx,openNbsx}from'./src/core/container.ts';export{wavFromChannels}from'./src/audio/engine.ts';",resolveDir:process.cwd()},outfile:helper,bundle:true,platform:'node',format:'esm'});
const {createProject,newTrack,newNote,uid,flattenNotes,renderNoteEvents,saveNbsx,openNbsx,wavFromChannels}=await import(pathToFileURL(helper).href);
const fixture=createProject('Drum mapping acceptance');fixture.ppq=960;
const hit=(instrumentId,midi,offsetBeats=0,velocity=.8)=>({id:uid(),instrumentId,midi,offsetBeats,durationBeats:.25,velocity});
const preset={id:uid(),name:'Shared test kit',mappings:[{id:uid(),trigger:36,notes:[hit('basedrum',66),hit('snare',67),hit('hat',66,0,.4),hit('bell',66,.03125,.3)]},{id:uid(),trigger:38,notes:[hit('bell',66,.125,.7)]}]};
fixture.drumPresets=[preset];fixture.tracks[0].drumPresetId=preset.id;fixture.patterns[0].notes=[{...newNote(0,36,480),velocity:.8},{...newNote(480,38,480),velocity:.6}];
const other=newTrack('Shared second track',1,'harp');other.drumPresetId=preset.id;fixture.tracks.push(other);
const pattern={id:uid(),name:'Second trigger',length:3840,notes:[newNote(960,36,480)]};fixture.patterns.push(pattern);fixture.regions.push({id:uid(),trackId:other.id,patternId:pattern.id,start:0,length:3840,offset:0,loop:false});
const fixtureFile=path.join(root,'fixture.nbsx');await writeFile(fixtureFile,saveNbsx(fixture));
const env={...process.env,NBSX_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.NBSX_DEV_URL;
const report={status:'running',root,profile,cases:[],rendererErrors:[],limitations:['Development desktop build, isolated fixture/profile. File dialog paths controlled by test. Audio measures Web Audio PCM before hardware; no subjective listening.']};
const check=(name,details={})=>{report.cases.push({name,status:'passed',...details});console.log(name);};
let desktop,page;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const command=name=>desktop.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('menu',name),name);
async function launch(){desktop=await electron.launch({args:['.','--mute-audio',`--user-data-dir=${profile}`],env,timeout:30000});page=await desktop.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>report.rendererErrors.push(error.message));assert.equal(await desktop.evaluate(({app})=>app.getPath('userData')),profile);}
async function close(){if(desktop){await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>{});await desktop.close().catch(()=>{});desktop=undefined;}}
async function open(file){await desktop.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},file);await command('open');await page.waitForFunction(()=>document.title.includes('Drum mapping acceptance'));}
async function save(name){const file=path.join(root,name);await desktop.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},file);await command('save-as');for(let i=0;i<200;i++){if(await stat(file).then(s=>s.size>44).catch(()=>false))break;await sleep(50);}await page.waitForFunction(()=>document.querySelector('.status-message')?.textContent.includes('已保存'));return{file,project:openNbsx(new Uint8Array(await readFile(file)))};}
const dialog=()=>page.getByRole('dialog',{name:'鼓组映射预设',exact:true});
async function manager(){await page.getByTestId('edit-drum-preset').click();await dialog().waitFor();}
async function number(name,value){const field=dialog().getByRole('spinbutton',{name,exact:true});await field.fill(String(value));await field.press('Tab');}
async function chooseFirstHit(){await dialog().getByRole('region',{name:'子音符明细'}).count();await dialog().locator('.drum-overlap-list button').first().click();}
async function capture(name,action){
  await page.evaluate(()=>{const master=window.__drumMaster;if(!master)throw Error('No output graph');const context=master.context,node=context.createScriptProcessor(4096,2,2),silent=context.createGain();silent.gain.value=0;const chunks=[[],[]];node.onaudioprocess=e=>{for(let ch=0;ch<2;ch++)chunks[ch].push(e.inputBuffer.getChannelData(ch).slice());};Reflect.apply(window.__drumNativeConnect,master,[node]);Reflect.apply(window.__drumNativeConnect,node,[silent]);Reflect.apply(window.__drumNativeConnect,silent,[context.destination]);window.__drumCapture={master,context,node,silent,chunks};window.__drumOnMaster=next=>{if(next!==window.__drumCapture.master&&next.context===context){try{window.__drumCapture.master.disconnect(node);}catch{}Reflect.apply(window.__drumNativeConnect,next,[node]);window.__drumCapture.master=next;}};});
  await action();await sleep(1100);
  const captured=await page.evaluate(()=>{window.__drumOnMaster=undefined;const{master,context,node,silent,chunks}=window.__drumCapture;master.disconnect(node);node.disconnect();silent.disconnect();node.onaudioprocess=null;return{sampleRate:context.sampleRate,channels:chunks.map(parts=>{const samples=new Float32Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){samples.set(p,at);at+=p.length;}let text='';const bytes=new Uint8Array(samples.buffer);for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);})};});
  const channels=captured.channels.map(encoded=>{const b=Buffer.from(encoded,'base64');return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));});
  const stats=channels.map(samples=>{let energy=0,peak=0;for(const v of samples){energy+=v*v;peak=Math.max(peak,Math.abs(v));}return{frames:samples.length,rms:Math.sqrt(energy/samples.length),peak};});assert(stats.some(ch=>ch.frames>0&&ch.rms>1e-5));await writeFile(path.join(root,name+'.wav'),wavFromChannels(channels,captured.sampleRate));check(name,{stats});
}
async function exportFile(format){const file=path.join(root,'mapped.'+format);await page.getByRole('button',{name:'导出',exact:true}).click();const modal=page.getByRole('dialog',{name:'导出',exact:true});await modal.getByRole('button',{name:new RegExp('^'+format.toUpperCase())}).click();if(format==='wav')await modal.getByRole('checkbox',{name:'使用已加载版本的原生 OpenAL 离线混音'}).uncheck();await desktop.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},file);await modal.getByRole('button',{name:'导出文件…',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.status-message')?.textContent.includes('已导出'),undefined,{timeout:60000});if(await modal.count())await page.keyboard.press('Escape');return file;}
try{
  await launch();
  await page.addInitScript(()=>{const connect=AudioNode.prototype.connect;window.__drumNativeConnect=connect;AudioNode.prototype.connect=function(...args){const result=Reflect.apply(connect,this,args);if(args[0] instanceof AudioDestinationNode){window.__drumMaster=this;window.__drumOnMaster?.(this);}return result;};});await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.sample-dot.loaded').length>=16);await open(fixtureFile);
  report.loadedScripts=await page.evaluate(()=>[...document.scripts].map(script=>script.src).filter(Boolean));
  await manager();await chooseFirstHit();await number('子音符力度倍率',.65);await number('子音符延迟拍数',.03125);
  await dialog().getByRole('button',{name:'撤销',exact:true}).click();await chooseFirstHit();assert.equal(await dialog().getByRole('spinbutton',{name:'子音符延迟拍数',exact:true}).inputValue(),'0');await dialog().getByRole('button',{name:'重做',exact:true}).click();
  await dialog().getByRole('button',{name:/MIDI 38/}).click();await dialog().getByRole('button',{name:/MIDI 36/}).click();await chooseFirstHit();assert.equal(Number(await dialog().getByRole('spinbutton',{name:'子音符力度倍率'}).inputValue()),.65);
  const beforeDraw=await dialog().locator('.drum-overlap-list button').count();
  const canvas=dialog().getByTestId('drum-mapping-piano').locator('canvas');const box=await canvas.boundingBox();assert(box);
  await canvas.click({position:{x:box.width*.75,y:Math.min(box.height-90,100)}});
  assert.equal(await dialog().locator('.drum-overlap-list button').count(),beforeDraw+1,'Drawing on actual PianoRoll must create a child note');
  await number('子音符实际 MIDI',66);await number('子音符延迟拍数',.0625);
  await page.screenshot({path:path.join(root,'editing.png')});await dialog().getByRole('button',{name:'取消',exact:true}).click();
  const canceled=await save('canceled.nbsx');assert.deepEqual(canceled.project.drumPresets,fixture.drumPresets);check('draft undo/redo, trigger navigation preservation and cancel leave project untouched');
  // Warm the real output graph, then tap the manager audition output.
  await command('play');await page.getByRole('button',{name:'暂停',exact:true}).waitFor();await page.waitForFunction(()=>!!window.__drumMaster);await command('stop');
  await manager();await chooseFirstHit();await number('子音符力度倍率',.65);await number('子音符延迟拍数',.03125);await capture('preset-audition',()=>dialog().getByRole('button',{name:'试听触发',exact:true}).click());
  await dialog().getByRole('button',{name:'应用修改',exact:true}).click();await dialog().waitFor({state:'hidden'});
  const applied=await save('applied.nbsx');assert.equal(flattenNotes(applied.project).length,3);assert.equal(applied.project.drumPresets[0].mappings[0].notes[0].velocity,.65);assert.equal(applied.project.tracks[1].drumPresetId,preset.id);check('apply edits shared preset while retaining three single source triggers');
  await command('undo');const undone=await save('undone.nbsx');assert.deepEqual(undone.project.drumPresets,fixture.drumPresets);await command('redo');const redone=await save('redone.nbsx');assert.deepEqual(redone.project.drumPresets,applied.project.drumPresets);check('main project undo and redo restore embedded mappings');
  await capture('main-project-playback',()=>command('play'));await command('stop');
  const mid=await exportFile('mid'),nbsFile=await exportFile('nbs'),wavFile=await exportFile('wav');
  const expected=renderNoteEvents(redone.project).notes,order=(a,b)=>a[0]-b[0]||a[1]-b[1];
  const midi=parseMidi(new Uint8Array(await readFile(mid)));const actual=midi.tracks.flatMap(events=>{let tick=0;return events.flatMap(e=>{tick+=e.deltaTime;return e.type==='noteOn'&&e.velocity>0?[[tick,e.noteNumber]]:[];});}).sort(order);assert.deepEqual(actual,expected.map(n=>[Math.round(n.absoluteTick),n.midi]).sort(order));
  const nbs=fromArrayBuffer(Uint8Array.from(await readFile(nbsFile)).buffer),events=nbs.layers.all.flatMap(layer=>Object.entries(layer.notes.all).map(([tick,n])=>[Number(tick),n.key+21])).sort(order);assert.deepEqual(events,expected.map(n=>[Math.floor(n.absoluteTick/redone.project.ppq*60/120*nbs.getTempo()+1e-8),n.midi]).sort(order));
  const wave=await readFile(wavFile);assert.equal(wave.toString('ascii',0,4),'RIFF');let peak=0;for(let i=44;i+1<wave.length;i+=2)peak=Math.max(peak,Math.abs(wave.readInt16LE(i)));assert(peak>10);check('MIDI and quantized NBS parse mapped output; WAV contains nonzero PCM',{actualNotes:actual.length,nbsNotes:events.length,wavBytes:wave.length});
  await manager();await dialog().getByRole('button',{name:'复制为独立预设',exact:true}).click();await dialog().getByRole('textbox',{name:'鼓组预设名称'}).fill('Independent test kit');await dialog().getByRole('button',{name:'应用修改',exact:true}).click();const copied=await save('independent.nbsx');assert.notEqual(copied.project.tracks[0].drumPresetId,preset.id);assert.equal(copied.project.tracks[1].drumPresetId,preset.id);assert.equal(copied.project.drumPresets.length,2);check('independent copy keeps second track bound to original shared preset');
  await open(copied.file);const reopened=await save('reopened.nbsx');assert.deepEqual(reopened.project.drumPresets,copied.project.drumPresets);assert.equal(flattenNotes(reopened.project).length,3);check('saved project reopens embedded presets without external files');
  await close();await writeFile(path.join(profile,'recovery.nbsx'),saveNbsx(reopened.project));await launch();await page.getByRole('dialog',{name:'发现恢复副本'}).waitFor();await page.getByRole('button',{name:'载入恢复副本',exact:true}).click();const recovered=await save('recovered.nbsx');assert.deepEqual(recovered.project.drumPresets,copied.project.drumPresets);assert.equal(recovered.project.id,copied.project.id);check('recovery preserves embedded mappings and single triggers');
  await manager();await page.screenshot({path:path.join(root,'final-editor.png')});assert.deepEqual(report.rendererErrors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack??String(error);if(page){report.title=await page.title().catch(()=>undefined);report.dialogs=await page.getByRole('dialog').allTextContents().catch(()=>[]);await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});}console.error(report.error);process.exitCode=1;}
finally{await close();report.finishedAt=new Date().toISOString();await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:path.join(root,'report.json')}));}
