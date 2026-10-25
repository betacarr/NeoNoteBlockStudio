import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {digest} from './research-utils.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';

export async function reviewedJava10Resources(){
  const file='docs/evidence/java-1.0-resource-selection.json',bytes=await readFile(file),r=JSON.parse(bytes);
  assert.equal(r.status,'passed');assert.equal(r.version,'1.0');assert.equal(r.worldScenesAdded,0);assert.equal(r.fullAudioProfilePromoted,false);
  const client=await readFile('.research/clients/1.0.jar');assert.equal(digest(client),'b679fea27f2284836202e9365e13a82552092e5d');assert.equal(r.officialSources.client.sha1,digest(client));
  const metaBytes=await readFile(r.metadata.path);assert.equal(digest(metaBytes),r.officialSources.metadataSha1);assert.equal(digest(metaBytes,'sha256'),r.metadata.sha256);
  const meta=JSON.parse(metaBytes);assert.deepEqual(meta.downloads.client,r.officialSources.client);assert.deepEqual(meta.assetIndex,r.officialSources.assetIndex);
  const allowed=l=>{let ok=!l.rules;for(const rule of l.rules??[])if(!rule.os||rule.os.name==='windows')ok=rule.action==='allow';return ok;};
  assert.deepEqual(r.classloadingDependencies,meta.libraries.filter(allowed).map(l=>l.downloads?.artifact).filter(Boolean));
  const indexBytes=await readFile(r.index.path);assert.equal(digest(indexBytes),meta.assetIndex.sha1);assert.equal(digest(indexBytes,'sha256'),r.index.sha256);const index=JSON.parse(indexBytes);assert.equal(index.map_to_resources,true);
  for(const[file,hash]of Object.entries(r.sources))assert.equal(digest(await readFile(file),'sha256'),hash,file);
  for(const ref of Object.values(r.raw))assert.equal(digest(await readFile(ref.path),'sha256'),ref.sha256,ref.path);
  const process=JSON.parse(await readFile(r.raw.process.path));assert.equal(process.exit,0);assert.equal(process.terminal,true);assert(process.pid>0);assert(process.args.includes('studio.nbsx.research.Legacy10Resources'));
  const cp=process.args[process.args.indexOf('-cp')+1].split(path.delimiter);assert(cp.includes(path.resolve('.research/clients/1.0.jar')));assert.equal(cp.filter(f=>/[/\\]clients[/\\].+\.jar$/.test(f)).length,1);
  for(const a of r.classloadingDependencies){const file=path.resolve('.research/libraries',a.path);assert(cp.includes(file));assert.equal(digest(await readFile(file)),a.sha1);}
  const zip=unzipSync(client),classes=new Map();assert.equal(r.classes.length,6);
  for(const c of r.classes){const original=zip[c.name+'.class'];assert.equal(digest(original,'sha256'),c.classSha256,c.name);assert.deepEqual(methodCodeHashes(original),c.methods);assert.equal(digest(await readFile(c.disassembly.path),'sha256'),c.disassembly.sha256);classes.set(c.name,c);}
  assert.equal(r.bindings.length,8);for(const b of r.bindings)assert.equal(classes.get(b.owner).methods[b.method],b.codeSha256);
  for(const f of r.fixtures){assert.deepEqual(index.objects[f.key],{hash:f.hash,size:f.size});const b=await readFile(f.file);assert.equal(digest(b),f.hash);assert.equal(b.length,f.size);}
  const rows=(await readFile(r.raw.output.path,'utf8')).trim().split(/\r?\n/).map(line=>line.split('\t'));assert.deepEqual(rows.shift(),['TREE','7']);
  const actual=rows.filter(row=>row[0]==='SAMPLE').map(([,event,name,url,hash,size])=>({event,name,url,sha1:hash,bytes:Number(size)}));assert.deepEqual(actual,r.actualSamples);assert.equal(actual.length,6);
  const expectedNames=['harp','bassattack','bd','snare','hat','pling'];assert.deepEqual(actual.map(s=>s.event),expectedNames.map(n=>'note.'+n));
  for(const s of actual){const a=index.objects['newsound/'+s.name];assert.equal(s.sha1,a.hash);assert.equal(s.bytes,a.size);assert(s.url.includes('/resources/newsound/'));}
  const dispatch=rows.filter(row=>row[0]==='DISPATCH').map(([,prefix,counts])=>({prefix,counts:counts.split(',').map(Number)}));assert.deepEqual(dispatch,r.dispatchCases);
  assert.deepEqual(dispatch.map(c=>[c.prefix,c.counts]),[['newsound',[1,0,0]],['sound',[1,0,0]],['NEWSOUND',[1,0,0]],['sound3',[0,0,0]],['streaming',[0,1,0]],['music',[0,0,1]],['newmusic',[0,0,1]],['unknown',[0,0,0]]]);
  return {version:r.version,clientSha1:digest(client),assetIndexSha1:meta.assetIndex.sha1,sourcePrefix:'newsound',events:{harp:'harp',bass:'bassattack',basedrum:'bd',snare:'snare',hat:'hat',pling:'pling'},sourceEvidence:{path:file,sha256:digest(bytes,'sha256')},samples:actual,worldScenesAdded:0,fullAudioProfilePromoted:false};
}
