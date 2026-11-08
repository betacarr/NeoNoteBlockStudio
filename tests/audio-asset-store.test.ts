import { describe,it,expect } from 'vitest';
import { mkdtemp,writeFile,readFile,rename,open,mkdir,stat,symlink,rm,realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { AudioAssetStore } from '../electron/audio-asset-store';
import { createProject } from '../src/core/project';
import { saveNbsx,openNbsx } from '../src/core/container';
import type { AudioFileAsset } from '../src/core/types';

async function fixture() { const root=await mkdtemp(path.join(tmpdir(),'neonbs-assets-')); return {root,store:new AudioAssetStore()}; }
async function wav(filename:string,seconds=1) {
  const frames=44100*seconds,header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+frames*8,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(3,20);header.writeUInt16LE(2,22);header.writeUInt32LE(44100,24);header.writeUInt32LE(44100*8,28);header.writeUInt16LE(8,32);header.writeUInt16LE(32,34);header.write('data',36);header.writeUInt32LE(frames*8,40);
  const file=await open(filename,'w');try{await file.write(header);await file.truncate(44+frames*8);}finally{await file.close();}return{frames,sampleRate:44100,channels:2};
}
function project(descriptor:AudioFileAsset,seconds=1) {
  const p=createProject('Sidecar test');p.assets=[{id:'external-source',name:'song.wav',mime:'audio/wav',audioFile:descriptor}];
  p.audioWorkspace={id:'workspace',name:'Song',sourceAssetId:'external-source',duration:seconds,sampleRate:44100,frames:seconds*44100,stems:Array.from({length:6},(_,i)=>({id:'stem-'+i,role:'role-'+i,name:'Stem '+i,assetId:'external-source',gain:1,muted:false,solo:false})),bpm:120,firstBeat:0,beats:[0,.5],chords:[],model:{id:'synthetic-storage-fixture',version:'1'},loop:{enabled:false,start:0,end:seconds}};return p;
}
describe('project-adjacent audio asset store',()=>{
 it('streams range/HEAD through owner capability and revokes it',async()=>{
  const{root,store}=await fixture();try{
   const source=path.join(root,'source.wav'),meta=await wav(source),descriptor=await store.register(1,source,meta);
   await expect(store.inputPath(2,descriptor)).rejects.toThrow('获准');expect(await store.inputPath(1,descriptor)).toBe(await realpath(source));
   await expect(store.resolve(2,descriptor)).rejects.toThrow('获准');const url=await store.resolve(1,descriptor);
   const response=await store.response(new Request(url,{headers:{Range:'bytes=0-3'}}));expect(response?.status).toBe(206);expect(await response?.text()).toBe('RIFF');
   expect((await store.response(new Request(url,{method:'HEAD'})))?.headers.get('content-length')).toBe(String(descriptor.bytes));
   expect((await store.response(new Request(url,{headers:{Range:'bytes=9999999999-'}})))?.status).toBe(416);
   store.clearOwner(1);expect((await store.response(new Request(url)))?.status).toBe(404);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('saves beside project, moves the pair, reopens independently of cache, and refuses wrong relink',async()=>{
  const{root,store}=await fixture();try{
   const source=path.join(root,'source.wav'),meta=await wav(source),descriptor=await store.register(1,source,meta),bytes=saveNbsx(project(descriptor));
   const target=path.join(root,'song.nbsx');await store.prepareProjectSave(1,target,bytes);await writeFile(target,bytes);
   expect(openNbsx(bytes).assets[0].audioFile).toEqual(descriptor);const moved=path.join(root,'moved');await mkdir(moved);
   await rename(target,path.join(moved,'song.nbsx'));await rename(target+'.assets',path.join(moved,'song.nbsx.assets'));await rm(source);
   const fresh=new AudioAssetStore();await fresh.registerProject(2,path.join(moved,'song.nbsx'),bytes);const url=await fresh.resolve(2,descriptor),response=await fresh.response(new Request(url));expect(response?.status).toBe(200);await response?.arrayBuffer();
   const resource=path.join(moved,'song.nbsx.assets',descriptor.file);await rename(resource,resource+'.offline');await expect(fresh.resolve(2,descriptor)).rejects.toThrow('缺失');
   const wrong=path.join(root,'wrong.wav');await writeFile(wrong,Buffer.alloc(100));await expect(fresh.relink(2,descriptor,wrong)).rejects.toThrow();await expect(fresh.resolve(2,descriptor)).rejects.toThrow('缺失');
   await fresh.relink(2,descriptor,resource+'.offline');await fresh.resolve(2,descriptor);
   await fresh.prepareProjectSave(2,path.join(root,'save-as.nbsx'),bytes);expect((await stat(path.join(root,'save-as.nbsx.assets',descriptor.file))).size).toBe(descriptor.bytes);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('keeps an existing destination intact when its hash is wrong',async()=>{
  const{root,store}=await fixture();try{
   const source=path.join(root,'source.wav'),meta=await wav(source),descriptor=await store.register(1,source,meta),bytes=saveNbsx(project(descriptor)),target=path.join(root,'song.nbsx');
   const directory=path.join(target+'.assets','audio');await mkdir(directory,{recursive:true});const conflict=path.join(directory,descriptor.sha256+'.wav');await writeFile(conflict,'preserve this user file');
   await expect(store.prepareProjectSave(1,target,bytes)).rejects.toThrow('损坏');expect(await readFile(conflict,'utf8')).toBe('preserve this user file');
   await expect(store.resolve(1,{...descriptor,file:'../escape.wav'})).rejects.toThrow();
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('saves a complete five-minute six-row session beyond the former aggregate budget without truncation',async()=>{
  const{root,store}=await fixture();try{
   // Six distinct synthetic PCM files validate large-file storage, not model
   // separation. One sample differs; every complete timeline is five minutes.
   const descriptors:AudioFileAsset[]=[];
   for(let i=0;i<6;i++) {
    const source=path.join(root,`five-minute-${i}.wav`),meta=await wav(source,300),file=await open(source,'r+'),sample=Buffer.alloc(4);sample.writeFloatLE(i/10);await file.write(sample,0,4,44);await file.close();descriptors.push(await store.register(1,source,meta));
   }
   const descriptor=descriptors[0],p=project(descriptor,300);
   p.assets=descriptors.map((audioFile,i)=>({id:'source-'+i,name:`part-${i}.wav`,mime:'audio/wav',audioFile}));
   p.audioWorkspace!.sourceAssetId='source-0';p.audioWorkspace!.stems.forEach((s,i)=>s.assetId='source-'+i);const bytes=saveNbsx(p);
   expect(new Set(descriptors.map(d=>d.sha256)).size).toBe(6);expect(descriptors.reduce((sum,d)=>sum+d.bytes,0)).toBeGreaterThan(600*1024*1024);expect(bytes.length).toBeLessThan(10000);
   const target=path.join(root,'full-song.nbsx');await store.prepareProjectSave(1,target,bytes);await writeFile(target,bytes);
   const fresh=new AudioAssetStore();await fresh.registerProject(2,target,bytes);
   for(const part of descriptors){const url=await fresh.resolve(2,part),response=await fresh.response(new Request(url,{headers:{Range:'bytes=-8'}}));expect(response?.status).toBe(206);expect((await response?.arrayBuffer())?.byteLength).toBe(8);expect((await stat(path.join(target+'.assets',part.file))).size).toBe(105840044);}
   expect(openNbsx(bytes).audioWorkspace?.frames).toBe(13230000);
  }finally{await rm(root,{recursive:true,force:true});}
 },60000);
});
