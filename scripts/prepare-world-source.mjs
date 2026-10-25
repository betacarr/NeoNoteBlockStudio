import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { digest,verifiedArtifact } from './research-utils.mjs';
import assert from 'node:assert/strict';
const version=process.argv[2];
if(!version||!/^[\w.-]+$/.test(version))throw new Error('Usage: prepare-world-source.mjs VERSION');
const metadata=JSON.parse(await readFile(`.research/metadata/${version}.json`,'utf8'));
assert.equal(metadata.type,'release'); assert(metadata.downloads.client_mappings||/^26\./.test(version),'Official mappings or a named released client required');
const target=path.resolve('.research/world-source',version),classes=path.join(target,'classes'),source=path.join(target,'source');await mkdir(classes,{recursive:true});
const client=path.resolve(`.research/clients/${version}.jar`),bytes=await readFile(client);assert.equal(digest(bytes),metadata.downloads.client.sha1);
const mapFile=metadata.downloads.client_mappings?path.join(target,'mappings.txt'):undefined;
if(mapFile)await verifiedArtifact(metadata.downloads.client_mappings,mapFile);
const mappings=mapFile?await readFile(mapFile,'utf8'):undefined;
const wanted=new Set(['net.minecraft.server.level.ServerLevel','net.minecraft.server.players.PlayerList','net.minecraft.sounds.SoundEvent','net.minecraft.client.gui.screens.worldselection.WorldOpenFlows']);
const entries=mappings?[...mappings.matchAll(/^(\S+) -> (\S+):$/gm)].filter(match=>wanted.has(match[1])).map(match=>({name:match[1],obfuscated:match[2]})):[...wanted].map(name=>({name,obfuscated:name}));
assert.equal(entries.length,wanted.size);
const cfr=path.resolve('.research/tools/cfr-0.152.jar');assert.equal(digest(await readFile(cfr),'md5'),'8a85ada8cec494121246805a5562b82b');
const files=unzipSync(bytes,{filter:entry=>entries.some(record=>entry.name===record.obfuscated.replaceAll('.','/')+'.class')});
for(const entry of entries){
 const filename=entry.obfuscated.replaceAll('.','/')+'.class',destination=path.join(classes,filename);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,files[filename]);
 const processResult=spawnSync('java',['-jar',cfr,destination,'--extraclasspath',client,...(mapFile?['--obfuscationpath',mapFile]:[]),'--outputdir',source,'--silent','true'],{windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:2e6});assert.equal(processResult.status,0,processResult.stderr);
 entry.bytecodeSha1=digest(files[filename]);entry.namedSourceSha256=digest(await readFile(path.join(source,filename.replace('.class','.java'))),'sha256');
 console.log(`${version}: ${entry.name}`);
}
await writeFile(path.join(target,'provenance.json'),JSON.stringify({version,clientSha1:digest(bytes),...(mapFile?{mappingsSha1:digest(await readFile(mapFile))}:{mapping:'original-named-client-no-mappings-artifact'}),tool:'CFR 0.152',classes:entries},null,2));
