import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';

/** Recheck a manually reviewed role map against original client/dependency bytes. */
export async function reviewedAudioSource(version,filename){
  const report=JSON.parse(await readFile(filename,'utf8')),metadata=JSON.parse(await readFile(`.research/metadata/${version}.json`,'utf8'));
  assert.equal(report.version,version);assert.equal(report.officialSources.clientSha1,metadata.downloads.client.sha1);
  const client=await readFile(`.research/clients/${version}.jar`);assert.equal(digest(client),metadata.downloads.client.sha1);
  const artifacts=metadata.libraries.flatMap(l=>[l.downloads?.artifact,...Object.values(l.downloads?.classifiers??{})]).filter(Boolean),archives=new Map([[metadata.downloads.client.sha1,unzipSync(client)]]),classes=new Map();
  const entries=Array.isArray(report.classes)?report.classes:Object.values(report.classes);
  for(const entry of entries){
    const artifact=entry.artifact??metadata.downloads.client;
    if(artifact.path){
      const official=artifacts.find(a=>a.path===artifact.path);assert.equal(official?.sha1,artifact.sha1);
      if(!archives.has(artifact.sha1)){
        const bytes=await readFile(path.join('.local/game-fixtures',version,'libraries',artifact.path));assert.equal(digest(bytes),artifact.sha1);archives.set(artifact.sha1,unzipSync(bytes));
      }
    }else assert.equal(artifact.sha1,metadata.downloads.client.sha1);
    const name=(entry.originalName??entry.originalClass).replaceAll('.','/'),bytes=archives.get(artifact.sha1)[name+'.class'];assert(bytes,`Missing original ${name}`);
    assert.equal(digest(bytes),entry.bytecodeSha1??entry.classSha1);classes.set(name,bytes);
    if(entry.rawDisassembly)assert.equal(digest(await readFile(entry.rawDisassembly),'sha256'),entry.disassemblySha256);
  }
  if(report.rawEvidence){
    const rawBytes=await readFile(report.rawEvidence.path);assert.equal(digest(rawBytes,'sha256'),report.rawEvidence.sha256);
    const raw=JSON.parse(rawBytes);assert.deepEqual(raw.facts,report.facts);
    for(const [key,method] of Object.entries(report.methods??{}))assert.equal(digest(Buffer.from(raw.methods[key].bytecode),'sha256'),method.bytecodeSha256);
  }
  for(const binding of report.bindings??[])assert.equal(methodCodeHashes(classes.get(binding.owner.replaceAll('.','/')))[binding.member+binding.descriptor],binding.codeSha256);
  return report;
}
