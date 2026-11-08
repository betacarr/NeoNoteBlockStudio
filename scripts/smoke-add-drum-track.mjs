import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { mkdir,mkdtemp,readFile,writeFile,stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Start with the real built-in song and then a real blank New Project. No
// injected project, preset, track or note is used to reach the drum workflow.
const base=path.resolve('.local/add-drum-track-smoke');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'run-')),profile=path.join(root,'profile');await mkdir(profile);
const helper=path.join(root,'helper.mjs');
await build({stdin:{contents:"export{openNbsx}from'./src/core/container.ts';export{flattenNotes,renderNoteEvents}from'./src/core/project.ts';export{wavFromChannels}from'./src/audio/engine.ts';",resolveDir:process.cwd()},outfile:helper,bundle:true,platform:'node',format:'esm'});
const{openNbsx,flattenNotes,renderNoteEvents,wavFromChannels}=await import(pathToFileURL(helper).href);
const report={status:'running',root,profile,cases:[],rendererErrors:[],limitations:['Isolated development desktop app/profile; no user project or existing window touched.','Audio is actual Web Audio PCM output before hardware, not subjective listening.','Save/open dialogs use isolated test file paths; all musical edits use normal UI.']};
const env={...process.env,NBSX_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.NBSX_DEV_URL;
let desktop,page;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(name,details={})=>{report.cases.push({name,status:'passed',...details});console.log(name);};
async function menu(group,item){await page.getByRole('menuitem',{name:group,exact:true}).click();await page.getByRole('menu',{name:group,exact:true}).getByRole('menuitem',{name:item}).click();}
async function save(name){const file=path.join(root,name);await desktop.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},file);await menu('文件','另存为…');for(let i=0;i<200;i++){if(await stat(file).then(s=>s.size>44).catch(()=>false))break;await sleep(50);}await page.waitForFunction(()=>document.querySelector('.status-message')?.textContent.includes('已保存'));return{file,project:openNbsx(new Uint8Array(await readFile(file)))};}
async function open(file,name){await desktop.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},file);await menu('文件','打开 / 导入…');await page.waitForFunction(name=>document.title.includes(name),name);}
const manager=()=>page.getByRole('dialog',{name:'鼓组映射预设',exact:true});
async function setNumber(name,value){const field=page.getByRole('spinbutton',{name,exact:true});await field.fill(String(value));await field.press('Tab');}
async function audio(name){
  // Warm the real output node, stop, then follow its replacement for the take.
  await page.getByRole('button',{name:'播放',exact:true}).first().click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor();await page.waitForFunction(()=>!!window.__drumMaster);await menu('播放','停止并回到起点');
  await page.evaluate(()=>{const master=window.__drumMaster,context=master.context,node=context.createScriptProcessor(4096,2,2),silent=context.createGain();silent.gain.value=0;const chunks=[[],[]];node.onaudioprocess=e=>{for(let ch=0;ch<2;ch++)chunks[ch].push(e.inputBuffer.getChannelData(ch).slice());};Reflect.apply(window.__drumNativeConnect,master,[node]);Reflect.apply(window.__drumNativeConnect,node,[silent]);Reflect.apply(window.__drumNativeConnect,silent,[context.destination]);window.__drumCapture={master,context,node,silent,chunks};window.__drumOnMaster=next=>{if(next!==window.__drumCapture.master&&next.context===context){try{window.__drumCapture.master.disconnect(node);}catch{}Reflect.apply(window.__drumNativeConnect,next,[node]);window.__drumCapture.master=next;}};});
  await page.getByRole('button',{name:'播放',exact:true}).first().click();await sleep(1300);
  const captured=await page.evaluate(()=>{window.__drumOnMaster=undefined;const{master,context,node,silent,chunks}=window.__drumCapture;master.disconnect(node);node.disconnect();silent.disconnect();node.onaudioprocess=null;return{sampleRate:context.sampleRate,channels:chunks.map(parts=>{const data=new Float32Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){data.set(p,at);at+=p.length;}let text='';const bytes=new Uint8Array(data.buffer);for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);})};});
  const channels=captured.channels.map(encoded=>{const b=Buffer.from(encoded,'base64');return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));});const stats=channels.map(data=>{let energy=0,peak=0;for(const v of data){energy+=v*v;peak=Math.max(peak,Math.abs(v));}return{frames:data.length,rms:Math.sqrt(energy/data.length),peak};});assert(stats.some(ch=>ch.frames>0&&ch.rms>1e-5));await writeFile(path.join(root,name+'.wav'),wavFromChannels(channels,captured.sampleRate));await menu('播放','停止并回到起点');return stats;
}
async function scenario(name,trackCount,noteCount,useTrackMenu){
  const original=await save(name+'-before.nbsx');assert.equal(original.project.tracks.length,trackCount);assert.equal(flattenNotes(original.project).length,noteCount);
  if(useTrackMenu)await menu('轨道','添加鼓组轨道');else await page.getByRole('button',{name:'添加鼓组轨道',exact:true}).click();
  await manager().waitFor();await manager().getByTestId('drum-mapping-piano').locator('canvas').waitFor();
  for(const trigger of [36,38,42])assert.equal(await manager().getByRole('button',{name:new RegExp('MIDI '+trigger+'\\b')}).count(),1);
  await page.screenshot({path:path.join(root,name+'-manager.png')});
  await manager().getByRole('button',{name:useTrackMenu?'应用修改':'取消',exact:true}).click();await manager().waitFor({state:'hidden'});
  const added=await save(name+'-added.nbsx');assert.equal(added.project.tracks.length,trackCount+1);assert.equal(flattenNotes(added.project).length,noteCount);
  const track=added.project.tracks.find(track=>!original.project.tracks.some(before=>before.id===track.id));assert(track?.drumPresetId);const preset=added.project.drumPresets.find(p=>p.id===track.drumPresetId);assert.deepEqual(preset.mappings.map(m=>m.trigger).sort((a,b)=>a-b),[36,38,42]);
  const region=added.project.regions.find(r=>r.trackId===track.id);assert(region);assert.equal(added.project.patterns.find(p=>p.id===region.patternId).notes.length,0);
  assert.deepEqual(added.project.tracks.filter(t=>t.id!==track.id),original.project.tracks);for(const pattern of original.project.patterns)assert.deepEqual(added.project.patterns.find(p=>p.id===pattern.id),pattern);
  const canvas=page.locator('.center-workspace').getByTestId('piano-roll').locator('canvas');const box=await canvas.boundingBox();assert(box);
  const rowHeight=Number(await canvas.getAttribute('data-row-height')),scrollY=Number(await canvas.getAttribute('data-scroll-y'));
  const triggerY=42+(127-36)*rowHeight-scrollY+rowHeight/2;
  assert(triggerY>42&&triggerY<box.height-78,'New empty drum piano should show trigger 36 without manual scrolling');
  await canvas.click({position:{x:85,y:triggerY}});
  await setNumber('音符 MIDI 音高',36);await setNumber('音符开始拍',0);
  const edited=await save(name+'-played.nbsx');const source=edited.project.patterns.find(p=>p.id===region.patternId).notes;assert.equal(source.length,1);assert.equal(source[0].midi,36);assert.equal(flattenNotes(edited.project).length,noteCount+1);assert(renderNoteEvents(edited.project).notes.some(n=>n.trackId===track.id&&n.effectiveInstrument==='basedrum'));
  const stats=await audio(name+'-playback');
  await open(original.file,original.project.name);assert.equal(await page.locator('[data-testid=region]').count(),original.project.regions.length);
  await open(edited.file,edited.project.name);const reopened=await save(name+'-reopened.nbsx');assert.deepEqual(reopened.project.tracks,edited.project.tracks);assert.deepEqual(reopened.project.drumPresets,edited.project.drumPresets);assert.deepEqual(reopened.project.patterns,edited.project.patterns);
  await page.locator(`[data-testid="region"][data-region-id="${region.id}"]`).click();
  await page.screenshot({path:path.join(root,name+'-source-piano.png')});
  check(name+' normal UI add/manage/source-piano/play/save/reopen',{entry:useTrackMenu?'轨道菜单':'主界面按钮',originalTracks:trackCount,finalTracks:trackCount+1,originalNotes:noteCount,sourceNotes:noteCount+1,stats,file:edited.file});
}
try{
  desktop=await electron.launch({args:['.','--mute-audio',`--user-data-dir=${profile}`],env,timeout:30000});page=await desktop.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>report.rendererErrors.push(error.message));assert.equal(await desktop.evaluate(({app})=>app.getPath('userData')),profile);
  await page.addInitScript(()=>{const connect=AudioNode.prototype.connect;window.__drumNativeConnect=connect;AudioNode.prototype.connect=function(...args){const result=Reflect.apply(connect,this,args);if(args[0] instanceof AudioDestinationNode){window.__drumMaster=this;window.__drumOnMaster?.(this);}return result;};});await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.sample-dot.loaded').length>=16);assert.equal(await page.title(),'欢乐颂 · 示例 — NeoNBS');report.loadedScripts=await page.evaluate(()=>[...document.scripts].map(s=>s.src).filter(Boolean));
  await scenario('default-song',3,50,false);
  await menu('文件','新建工程');await page.waitForFunction(()=>document.querySelectorAll('[data-testid=region]').length===1);await scenario('blank-project',1,0,true);
  assert.deepEqual(report.rendererErrors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack??String(error);if(page){report.title=await page.title().catch(()=>undefined);report.dialogs=await page.getByRole('dialog').allTextContents().catch(()=>[]);await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});}console.error(report.error);process.exitCode=1;}
finally{if(desktop){await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await desktop.close().catch(()=>{});}report.finishedAt=new Date().toISOString();await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:path.join(root,'report.json')}));}
