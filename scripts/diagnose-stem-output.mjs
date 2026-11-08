import {_electron as electron} from 'playwright';
import {build} from 'esbuild';
import {mkdir,mkdtemp,readFile,writeFile,unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const base=path.resolve('.local/stem-output-qa');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'run-')),profile=path.join(root,'profile');await mkdir(profile);
await build({stdin:{contents:"export {openNbsx,saveNbsx,bytesToBase64} from './src/core/container.ts';export {newTrack} from './src/core/project.ts';",resolveDir:process.cwd()},outfile:path.join(root,'helper.mjs'),bundle:true,platform:'node',format:'esm'});
const {openNbsx,saveNbsx,bytesToBase64,newTrack}=await import(pathToFileURL(path.join(root,'helper.mjs')));
const input=path.resolve('.local/audio-mega-real-ui/run-YJ8vYL/real-mega-six-output.nbsx');
const project=openNbsx(new Uint8Array(await readFile(input))),w=project.audioWorkspace;
const noteProject=structuredClone(project),caseName=process.argv.includes('--case')?process.argv[process.argv.indexOf('--case')+1]:'multi';
if(!w)throw Error('No genuine stem workspace');project.name='Real stem output QA';project.patterns=[];project.regions=[];project.tracks=[];project.audioClips=[];
for(const asset of project.assets){if(asset.audioFile){asset.data=bytesToBase64(await readFile(path.join(input+'.assets',asset.audioFile.file)));delete asset.audioFile;}}
for(const stem of w.stems){const t=newTrack(stem.name,project.tracks.length,'harp');t.kind='audio';project.tracks.push(t);project.audioClips.push({id:'clip-'+stem.id,assetId:stem.assetId,trackId:t.id,name:stem.name,start:0,offsetSeconds:0,durationSeconds:w.duration});}
delete project.audioWorkspace;
if(caseName==='single'||caseName==='standalone')project.audioClips=project.audioClips.slice(0,1);
if(caseName==='solo')project.tracks[0].solo=true;
if(caseName==='mute')for(const t of project.tracks)t.muted=true;
if(caseName==='group'){const group={...newTrack('Stem group',6,'harp'),kind:'audio',audioGroup:{collapsed:false,sourceClipId:project.audioClips[0].id},volume:.8};for(const t of project.tracks)t.parentTrackId=group.id;project.tracks.unshift(group);}
if(caseName==='loop')project.cycle={start:960,end:2880,enabled:true};
if(caseName==='notes'){project.audioClips=[];project.tracks=noteProject.tracks;project.patterns=noteProject.patterns;project.regions=noteProject.regions;}
const file=path.join(root,'real-stems.nbsx');await writeFile(file,saveNbsx(project));
if(process.argv.includes('--tiny-cycle')){project.cycle={start:3840,end:3841,enabled:true};await writeFile(file,saveNbsx(project));}
const env={...process.env,NBSX_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.NBSX_DEV_URL;let app;
const report={status:'running',root,input,caseName,files:[],errors:[]};
await writeFile('dist/assets/qa-audio-capture.js',`class Capture extends AudioWorkletProcessor{process(inputs){const a=inputs[0];if(a?.length)this.port.postMessage({frame:currentFrame,rate:sampleRate,left:Array.from(a[0]),right:Array.from(a[1]??a[0])});return true;}}registerProcessor('qa-audio-capture',Capture);`);
function instrument(){
 window.__audioQA={chunks:[],starts:[],nodes:[],recording:false,ready:[]};
 const Context=window.AudioContext;window.AudioContext=new Proxy(Context,{construct(target,args){const ctx=new target(...args);window.__audioQA.ready.push(ctx.audioWorklet.addModule('nbsx://app/assets/qa-audio-capture.js'));return ctx;}});
 const connect=AudioNode.prototype.connect, start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop;
 AudioBufferSourceNode.prototype.start=function(...args){const b=this.buffer;const event={when:args[0],offset:args[1]??0,duration:args[2],frames:b?.length,rate:b?.sampleRate,channels:b?.numberOfChannels,now:this.context.currentTime};this.__qaEvent=event;window.__audioQA.starts.push(event);return start.apply(this,args);};
 AudioBufferSourceNode.prototype.stop=function(...args){if(this.__qaEvent)this.__qaEvent.stopTime=args[0]??this.context.currentTime;return stop.apply(this,args);};
 AudioNode.prototype.connect=function(destination,...args){const result=connect.call(this,destination,...args);
  if(destination===this.context.destination&&!this.__qaAttached){this.__qaAttached=true;const context=this.context,rec=new AudioWorkletNode(context,'qa-audio-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});rec.port.onmessage=e=>{if(window.__audioQA.recording)window.__audioQA.chunks.push({at:e.data.frame/e.data.rate,...e.data});};connect.call(this,rec);connect.call(rec,destination);window.__audioQA.nodes.push(rec);}
  return result;};
}
try{app=await electron.launch({args:['.','--mute-audio',`--user-data-dir=${profile}`],env});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()));const page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));await page.addInitScript(instrument);await page.reload();await page.waitForSelector('.piano-viewport canvas');
await page.locator('input[type=file][accept=".nbsx,.nbs,.mid,.midi,.flp"]').setInputFiles(file);if(caseName!=='notes')await page.waitForFunction(count=>document.querySelectorAll('.audio-region svg[data-waveform-ready=true]').length===count,project.audioClips.length);else await page.waitForFunction(()=>document.querySelectorAll('.sample-dot.loaded').length>=16);
if(caseName==='reopen'){await page.locator('input[type=file][accept=".nbsx,.nbs,.mid,.midi,.flp"]').setInputFiles(file);await page.waitForTimeout(300);}
const beforeCycle=await page.getByTestId('arrangement-cycle-range').count();await page.locator('.arrangement-ruler').click({position:{x:120,y:4}});if(await page.getByTestId('arrangement-cycle-range').count()!==beforeCycle)throw Error('Ruler click created a cycle');await page.getByRole('button',{name:'停止并回到起点',exact:true}).click();
await page.evaluate(async()=>{await Promise.all(window.__audioQA.ready);window.__audioQA.recording=true;});
if(caseName==='standalone')await page.evaluate(async({data,gain})=>{const context=new AudioContext({sampleRate:48000});await Promise.all(window.__audioQA.ready);const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const buffer=await context.decodeAudioData(bytes.buffer);await context.resume();const source=context.createBufferSource(),g=context.createGain();source.buffer=buffer;g.gain.value=gain;source.connect(g);g.connect(context.destination);source.start(context.currentTime+.05);window.__qaStandalone={source,context};},{data:project.assets.find(a=>a.id===project.audioClips[0].assetId).data,gain:project.audio.masterGain});
else await page.locator('.play-button').click();
if(caseName==='seek'){await page.waitForTimeout(800);await page.locator('.arrangement-ruler').click({position:{x:136,y:18}});}await page.waitForTimeout(process.argv.includes('--tiny-cycle')?250:4500);report.statusMessage=await page.locator('.status-message').innerText();if(caseName==='standalone')await page.evaluate(()=>window.__qaStandalone.source.stop());else await page.locator('.play-button').click();
const capture=await page.evaluate(()=>{window.__audioQA.recording=false;return{chunks:window.__audioQA.chunks,starts:window.__audioQA.starts};});
await writeFile(path.join(root,'live-capture.json'),JSON.stringify(capture));report.starts=capture.starts;report.chunks=capture.chunks.length;
report.capture=path.join(root,'live-capture.json');report.status='captured';console.log(JSON.stringify({...report,starts:report.starts.slice(0,2),startCount:report.starts.length},null,2));
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1;}finally{await app?.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app?.close().catch(()=>{});await unlink('dist/assets/qa-audio-capture.js').catch(()=>{});await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));}
