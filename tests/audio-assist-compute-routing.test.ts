import { describe,it,expect,vi,beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp,mkdir,writeFile,readFile,rm,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { IpcMain,IpcMainInvokeEvent } from 'electron';
const mocks=vi.hoisted(()=>({spawn:vi.fn<(exe:string,args:string[],options:unknown)=>any>()}));
vi.mock('node:child_process',()=>({spawn:mocks.spawn}));
import { registerAudioAssist } from '../electron/audio-assist';

function wav(){const bytes=Buffer.alloc(44+4410*8);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVE',8);bytes.write('fmt ',12);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(3,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(44100,24);bytes.writeUInt32LE(352800,28);bytes.writeUInt16LE(8,32);bytes.writeUInt16LE(32,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return bytes;}
async function setup(cuda:boolean,behavior:'success'|'gpu-failure'|'hold'='success',mps=false){
 const root=await mkdtemp(path.join(tmpdir(),'neonbs-compute-routing-'));
 for(const name of ['audio-runtime','audio-runtime-fast',...(cuda?['audio-runtime-cuda']:[])]){
  const directory=path.join(root,'.local',name,process.platform==='win32'?'Scripts':'bin');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,process.platform==='win32'?'python.exe':'python'),'controlled worker fixture');
 }
 await writeFile(path.join(root,'.local/audio-runtime-fast/neonbs-mega-ready.json'),'{}');
 if(mps)await writeFile(path.join(root,'.local/audio-runtime/neonbs-mps-ready.json'),'{}');
 if(cuda)await writeFile(path.join(root,'.local/audio-runtime-cuda/neonbs-cuda-ready.json'),'{}');
 await mkdir(path.join(root,'dist-electron'));await writeFile(path.join(root,'dist-electron/audio_mega.py'),'fixture');await writeFile(path.join(root,'dist-electron/audio-assist-worker.py'),'fixture');
 const handlers=new Map<string,Function>();const sender=Object.assign(new EventEmitter(),{id:1,isDestroyed:()=>false,send:vi.fn()});const event={sender} as unknown as IpcMainInvokeEvent;
 mocks.spawn.mockImplementation((_exe,args)=>{
  const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn(()=>{queueMicrotask(()=>child.emit('close',null));return true;})});
  if(behavior!=='hold')queueMicrotask(()=>void(async()=>{
   const output=args[args.indexOf('--output')+1],device=args.includes('--device')?args[args.indexOf('--device')+1]:'cpu';
   if(device!=='cpu'&&behavior==='gpu-failure'){
    await writeFile(path.join(output,'failed-gpu.tmp'),'owned failed attempt');child.stdout.emit('data',Buffer.from(JSON.stringify({phase:'gpu-fallback',progress:.05,message:'controlled GPU memory failure'})+'\n'));child.emit('close',76);return;
   }
   const bytes=wav();await writeFile(path.join(output,'original.wav'),bytes);
   const workspace={id:'fixture',name:'fixture',sourceAssetId:'original',duration:.1,sampleRate:44100,frames:4410,stems:[{id:'stem',role:'original',name:'原音频',assetId:'original',gain:1,muted:false,solo:false}],bpm:120,firstBeat:0,beats:[0],chords:[],model:{id:'routing-fixture',version:'1',device,memoryProfile:'balanced'},loop:{enabled:false,start:0,end:.1}};
   await writeFile(path.join(output,'result.json'),JSON.stringify({algorithm:'neonbs-audio-assist-2',workspace,files:[{id:'original',file:'original.wav',mime:'audio/wav',name:'source.wav'}]}));child.emit('close',0);
  })().catch(error=>child.emit('error',error)));
  return child;
 });
 const unregister=registerAudioAssist({handle:(key:string,fn:Function)=>handlers.set(key,fn),removeHandler:(key:string)=>handlers.delete(key)} as unknown as IpcMain,root,path.join(root,'profile'),()=>true,{modelStatus:async()=>({state:'ready'}),publishAsset:async(_owner,filename,meta)=>{const bytes=await readFile(filename),sha256=createHash('sha256').update(bytes).digest('hex');return{...meta,file:`audio/${sha256}.wav`,sha256,bytes:bytes.length};}});
 const start=(extra:object={})=>handlers.get('audio-assist:start')!(event,{id:'test',name:'source.wav',bytes:new Uint8Array(wav()),separation:true,...extra});
 return{root,sender,start,cancel:()=>handlers.get('audio-assist:cancel')!(event,'test'),status:()=>handlers.get('audio-assist:status')!(event),cleanup:async()=>{unregister();await rm(root,{recursive:true,force:true});}};
}
beforeEach(()=>{mocks.spawn.mockReset();});

describe('CPU-first compute routing with controlled worker fixtures',()=>{
 it('uses CPU by default even when the optional CUDA environment exists',async()=>{
  const api=await setup(true);try{const result=await api.start();expect(result.workspace.model.device).toBe('cpu');expect(mocks.spawn).toHaveBeenCalledTimes(1);expect(mocks.spawn.mock.calls[0][0]).toContain('audio-runtime-fast');expect(mocks.spawn.mock.calls[0][1]).toContain('cpu');expect((await api.status()).optionalCudaAvailable).toBe(true);}finally{await api.cleanup();}
 });
 it('keeps complete CPU behavior when optional CUDA packages are absent',async()=>{
  const api=await setup(false);try{expect((await api.status()).canSeparate).toBe(true);const result=await api.start({acceleration:'cuda'});expect(result.workspace.model.device).toBe('cpu');expect(result.workspace.model.fallbackNote).toContain('未安装');expect(mocks.spawn).toHaveBeenCalledTimes(1);expect(mocks.spawn.mock.calls[0][0]).not.toContain('audio-runtime-cuda');}finally{await api.cleanup();}
 });
 it('tries GPU once, recovers on CPU, cleans its failed attempt and keeps cache identity honest',async()=>{
  const api=await setup(true,'gpu-failure');try{const result=await api.start({acceleration:'cuda'});expect(mocks.spawn).toHaveBeenCalledTimes(2);expect(mocks.spawn.mock.calls[0][0]).toContain('audio-runtime-cuda');expect(mocks.spawn.mock.calls[1][0]).toContain('audio-runtime-fast');expect(result.workspace.model.device).toBe('cpu');expect(result.workspace.model.fallbackNote).toContain('已转回 CPU');expect((await readdir(path.join(api.root,'profile/audio-assist'))).some(name=>name.startsWith('pending-'))).toBe(false);const cached=await api.start();expect(mocks.spawn).toHaveBeenCalledTimes(2);expect(cached.workspace.model.fallbackNote).toBeUndefined();}finally{await api.cleanup();}
 });
 it('does not turn cancellation into a CPU retry',async()=>{
  const api=await setup(true,'hold');try{const result=api.start({acceleration:'cuda'});const rejected=expect(result).rejects.toThrow('取消');await vi.waitFor(()=>expect(mocks.spawn).toHaveBeenCalledTimes(1));expect(api.cancel()).toBe(true);await rejected;expect(mocks.spawn).toHaveBeenCalledTimes(1);expect((await readdir(path.join(api.root,'profile/audio-assist'))).some(name=>name.startsWith('pending-'))).toBe(false);}finally{await api.cleanup();}
 });
 it('rejects renderer-supplied executable values or unbounded CPU settings',async()=>{
  const api=await setup(true);try{for(const bad of [{acceleration:'C:/evil.exe'},{cpuThreads:-1},{cpuThreads:200},{cpuThreads:1.5},{memoryProfile:'unbounded'}])await expect(api.start(bad)).rejects.toThrow('计算设置');expect(mocks.spawn).not.toHaveBeenCalled();}finally{await api.cleanup();}
 });
});

 describe('Apple MPS optional compute',()=>{
 it.skipIf(process.platform!=='darwin')('uses the Mac base runtime, isolates the MPS cache and falls back on failure',async()=>{
  const api=await setup(false,'gpu-failure',true);try{expect((await api.status()).optionalMpsAvailable).toBe(true);const result=await api.start({acceleration:'mps'});expect(mocks.spawn).toHaveBeenCalledTimes(2);expect(mocks.spawn.mock.calls[0][1]).toContain('mps');expect(mocks.spawn.mock.calls[0][0]).toContain('audio-runtime/bin/python');expect(mocks.spawn.mock.calls[1][1]).toContain('cpu');expect(result.workspace.model.device).toBe('cpu');expect(result.workspace.model.fallbackNote).toContain('已转回 CPU');}finally{await api.cleanup();}
 });
 it.skipIf(process.platform!=='darwin')('returns verified MPS identity and reuses only its own cache',async()=>{
  const api=await setup(false,'success',true);try{const result=await api.start({acceleration:'mps'});expect(result.workspace.model.device).toBe('mps');await api.start({acceleration:'mps'});expect(mocks.spawn).toHaveBeenCalledTimes(1);await api.start();expect(mocks.spawn).toHaveBeenCalledTimes(2);}finally{await api.cleanup();}
 });
 it('falls back when MPS runtime is not prepared',async()=>{
 const api=await setup(false);try{const result=await api.start({acceleration:'mps'});expect(result.workspace.model.device).toBe('cpu');expect(result.workspace.model.fallbackNote).toContain('未安装');}finally{await api.cleanup();}
 });
 });

describe('independent audio task modes',()=>{
 it('routes explicit tasks independently and isolates their caches from legacy combined jobs',async()=>{
  const api=await setup(false);try{
   await api.start({mode:'split'});
   expect(mocks.spawn.mock.calls[0][1]).toContain('--mega-model');
   expect(mocks.spawn.mock.calls[0][1]).toContain('split');
   await api.start({mode:'split'});expect(mocks.spawn).toHaveBeenCalledTimes(1);
   await api.start({mode:'chords',separation:false});
   expect(mocks.spawn.mock.calls[1][1]).not.toContain('--mega-model');
   expect(mocks.spawn.mock.calls[1][1]).not.toContain('--research-model');
   expect(mocks.spawn.mock.calls[1][1]).toContain('chords');
   await api.start();expect(mocks.spawn).toHaveBeenCalledTimes(3);
   await api.start({mode:'chords',separation:false});expect(mocks.spawn).toHaveBeenCalledTimes(3);
  }finally{await api.cleanup();}
 });
 it('rejects unsupported and contradictory modes before starting a worker',async()=>{
  const api=await setup(false);try{
   for(const bad of [{mode:'other'},{mode:'chords'},{mode:'split',separation:false},{mode:'split',decodeOnly:true}]) await expect(api.start(bad)).rejects.toThrow('模式');
   expect(mocks.spawn).not.toHaveBeenCalled();
  }finally{await api.cleanup();}
 });
});
