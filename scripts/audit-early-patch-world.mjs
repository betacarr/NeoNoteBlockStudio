import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {digest} from './research-utils.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';

// Filled from the independently reviewed original-client report, never adjacent mappings.
export const earlyPatchConfig={};
export async function auditEarlyPatchWorld({output}){
 const version='1.14.3',files=[`docs/evidence/java-${version}-audio-source.json`,`docs/evidence/java-${version}-world-source.json`];
 const metadata=JSON.parse(await readFile(`.research/metadata/${version}.json`,'utf8'));assert.equal(metadata.id,version);assert.equal(metadata.downloads.client_mappings,undefined);
 const client=await readFile(`.research/clients/${version}.jar`);assert.equal(digest(client),metadata.downloads.client.sha1);assert.equal(digest(client),'af100b34ec7ef2b8b9cf7775b544d21d690dddec');
 const archive=unzipSync(client,{filter:entry=>entry.name.endsWith('.class')}),classes=new Map(),bindings=[],sourceReports=[];let world;
 for(const filename of files){
  const bytes=await readFile(filename),report=JSON.parse(bytes);assert.equal(report.version,version);assert.equal(report.clientSha1,digest(client));
  sourceReports.push({path:filename,sha256:digest(bytes,'sha256')});if(filename.includes('-world-source.'))world=report;
  for(const entry of report.classes){const name=entry.originalName??entry.name,code=archive[name+'.class'];assert(code,`Missing original class ${name}`);if(entry.bytecodeSha1)assert.equal(digest(code),entry.bytecodeSha1,name);if(entry.bytecodeSha256)assert.equal(digest(code,'sha256'),entry.bytecodeSha256,name);const methods=methodCodeHashes(code);for(const [signature,hash]of Object.entries(entry.methods??{}))assert.equal(methods[signature],hash,`${name}.${signature}`);classes.set(name,{originalName:name,bytecodeSha1:digest(code),bytecodeSha256:digest(code,'sha256')});}
  for(const binding of report.bindings??[]){const owner=binding.owner,member=binding.member??binding.method,code=archive[owner+'.class'];assert(code);assert.equal(methodCodeHashes(code)[member+binding.descriptor],binding.codeSha256,`${owner}.${member}${binding.descriptor}`);bindings.push(binding);}
  await mkdir(output,{recursive:true});await writeFile(path.join(output,path.basename(filename)),bytes);
 }
 assert(world.adapterConfig,'World-source evidence must supply its final original-client adapterConfig');Object.assign(earlyPatchConfig,world.adapterConfig);
 for(const key of ['minecraft','library','channel','noteBlock','window','openDevice','channelPlay','noteEvent','sourceId','tick','createLevel','server','player','stop','levelSettings','gameType','creative','worldType','flat','allowCommands','overlay','noGravity','moveTo','execute','overworld','dimensionType','overworldDimension','players','blocks','noteBlockConstant','air','defaultState','blockPos','noteProperty','instrumentProperty','instrumentType','instrumentName','instrumentByState','setValue','getValue','setBlock','blockEvent','options','soundSource','sourceMaster','sourceRecords','sourceBlocks','optionVolume'])assert(typeof earlyPatchConfig[key]==='string',`Missing audited alias ${key}`);
 // These two methods are in the independent original audio-class audit. The debug
 // method reports original static/streaming pool capacities without modifying them.
 const audio=JSON.parse(await readFile(files[0],'utf8')),library=audio.classes.find(entry=>(entry.originalName??entry.name)===earlyPatchConfig.library);
 assert(library.methods['a()V']);assert(library.methods['d()Ljava/lang/String;']);
 Object.assign(earlyPatchConfig,{libraryInitialize:'a',libraryDebug:'d'});
 const report={schema:1,version,clientSha1:digest(client),mappings:{kind:'manual-original-bytecode-role-audit',officialClientMappingsAvailable:false,limitation:'No 1.14 or 1.14.4 mappings are inherited; original class bytes and reviewed method Code attributes are checked before each capture.'},sourceReports,classes:[...classes.values()],bindings,adapterConfig:earlyPatchConfig,facts:{...JSON.parse(await readFile(files[0],'utf8')).facts,...world.facts},scopeLimitations:['Selected original audio and world/camera bindings only; source audit does not substitute for real integrated-world recording.','HRTF is a controlled research backend setting, not an original game option.']};
 await writeFile(path.join(output,'adapter-evidence.json'),JSON.stringify(report,null,2));return report;
}
