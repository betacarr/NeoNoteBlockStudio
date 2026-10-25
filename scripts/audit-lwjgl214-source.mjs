import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {historicalClassfile} from './historical-classfile.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';
import {digest,verifiedArtifact} from './research-utils.mjs';
export {originalSection} from './review-lwjgl219-source.mjs';

export const lwjgl214Versions=['1.4.2','1.4.4','1.4.5','1.4.6','1.4.7'];
export const lwjgl214Root='.research/lwjgl214-source';
export const sha214=bytes=>digest(bytes,'sha256');
export async function discoverLwjgl214(version){
 assert(lwjgl214Versions.includes(version),'Only official reviewed Java 1.4 release identities are accepted');
 const catalog=JSON.parse(await readFile('src/data/java-releases.json')),release=catalog.versions.find(v=>v.id===version);assert(release);assert.deepEqual(catalog.versions.filter(v=>v.type==='release'&&/^1\.4(?:\.|$)/.test(v.id)).map(v=>v.id).sort(),[...lwjgl214Versions].sort());
 const metadataSha1=/packages\/([a-f0-9]{40})\//.exec(release.metadataUrl)[1],root=`${lwjgl214Root}/${version}`;await mkdir(root,{recursive:true});
 await verifiedArtifact({url:release.metadataUrl,sha1:metadataSha1},`${root}/official-metadata.json`);const metadata=JSON.parse(await readFile(`${root}/official-metadata.json`));assert.equal(metadata.id,version);assert.equal(metadata.type,'release');assert(!metadata.downloads.client_mappings);
 const client=`.research/clients/${version}.jar`;await verifiedArtifact(metadata.downloads.client,client);const bytes=await readFile(client),zip=unzipSync(bytes),classes=new Map();assert.equal(bytes.length,metadata.downloads.client.size);
 const archives=[{filename:client,artifact:metadata.downloads.client,files:zip}];
 const lwjgl=metadata.libraries.find(l=>l.name==='org.lwjgl.lwjgl:lwjgl:2.9.0');assert(lwjgl);const lwjglFile=path.join('.research/libraries',lwjgl.downloads.artifact.path);await verifiedArtifact(lwjgl.downloads.artifact,lwjglFile);archives.push({filename:lwjglFile,artifact:lwjgl.downloads.artifact,files:unzipSync(await readFile(lwjglFile))});
 for(const archive of archives)for(const[name,bytes]of Object.entries(archive.files))if(name.endsWith('.class'))classes.set(name.slice(0,-6),{...historicalClassfile(bytes),bytes,archive});
 const unique=(role,predicate)=>{const found=[...classes.values()].filter(predicate);assert.equal(found.length,1,`${version} ${role}: ${found.map(c=>c.name)}`);return found[0].name;};
 const r={SoundManager:unique('SoundManager',c=>c.refs.some(ref=>ref.owner==='paulscode/sound/SoundSystem'&&ref.name==='newSource')),NoteBlock:unique('NoteBlock',c=>c.strings.includes('bassattack')&&c.strings.includes('harp')&&c.strings.includes('note.')),TileEntityNote:unique('TileEntityNote',c=>c.strings.includes('note')&&c.fields.some(f=>f.descriptor==='B')),Options:unique('Options',c=>c.strings.includes('invertYMouse')&&c.strings.includes('sound')),SoundPacket:unique('SoundPacket',c=>c.methods.some(m=>m.name==='<init>'&&m.descriptor==='(Ljava/lang/String;DDDFF)V')),ResourceDownloader:unique('ResourceDownloader',c=>c.parent==='java/lang/Thread'&&c.strings.includes('sound3')),Player:unique('Player',c=>c.strings.includes('Inventory')&&c.strings.includes('SleepTimer')),Minecraft:'net/minecraft/client/Minecraft'};
 const tile=classes.get(r.TileEntityNote),trigger=tile.methods.filter(m=>/^\(L[^;]+;III\)V$/.test(m.descriptor));assert.equal(trigger.length,1);r.World=/^\(L([^;]+);/.exec(trigger[0].descriptor)[1];
 r.Material=tile.refs.find(ref=>ref.kind==='field'&&ref.owner!==r.TileEntityNote&&ref.descriptor===`L${ref.owner};`).owner;
 const noteAncestors=new Set();for(let n=r.NoteBlock;classes.has(n);n=classes.get(n).parent)noteAncestors.add(n);r.Block=unique('Block',c=>noteAncestors.has(c.name)&&c.fields.filter(f=>(f.access&8)&&f.descriptor===`L${c.name};`).length>100);
 const manager=classes.get(r.SoundManager);r.SoundPool=unique('SoundPool',c=>manager.fields.some(f=>f.descriptor===`L${c.name};`)&&c.methods.some(m=>m.descriptor.startsWith('(Ljava/lang/String;Ljava/io/File;)L')&&c.refs.some(ref=>ref.name==='<init>'&&ref.descriptor==='(Ljava/lang/String;Ljava/net/URL;)V')));
 const entry=classes.get(r.SoundPool).methods.filter(m=>m.descriptor.startsWith('(Ljava/lang/String;Ljava/io/File;)'));assert.equal(entry.length,1);r.SoundPoolEntry=/\)L([^;]+);/.exec(entry[0].descriptor)[1];
 const listener=manager.methods.filter(m=>/^\(L[^;]+;F\)V$/.test(m.descriptor)&&m.name==='a').filter(m=>{const c=classes.get(/^\(L([^;]+);/.exec(m.descriptor)[1]);return c?.strings.includes('Health')&&c.strings.includes('HurtTime');});assert.equal(listener.length,1);r.ListenerEntity=/^\(L([^;]+);/.exec(listener[0].descriptor)[1];
 r.ServerWorld=unique('ServerWorld',c=>c.parent===r.World&&c.strings.some(s=>s.startsWith('TickNextTick list out of')));r.ClientWorld=unique('ClientWorld',c=>c.parent===r.World&&c.strings.includes('MpServer'));
 r.ServerWorldListener=unique('ServerWorldListener',c=>c.refs.some(ref=>ref.owner===r.SoundPacket&&ref.name==='<init>'));
 const server=classes.get(r.ServerWorldListener),delivery=server.refs.filter(ref=>/^\(DDDDIL[^;]+;\)V$/.test(ref.descriptor));assert.equal(delivery.length,1);r.PlayerList=delivery[0].owner;r.WorldListener=server.interfaces[0];
 r.ServerPlayer=unique('ServerPlayer',c=>c.parent===r.Player&&c.fields.some(f=>f.descriptor==='Lnet/minecraft/server/MinecraftServer;'));
 r.ClientPacketHandler=unique('ClientPacketHandler',c=>c.methods.some(m=>m.descriptor===`(L${r.SoundPacket};)V`)&&c.refs.some(ref=>ref.owner===r.ClientWorld));
 r.ClientWorldListener=unique('ClientWorldListener',c=>c.interfaces.includes(r.WorldListener)&&c.refs.some(ref=>ref.owner===r.SoundManager));
 r.Entity=classes.get(r.ListenerEntity).parent;
 const eventCtors=classes.get(r.ServerWorld).refs.filter(ref=>ref.name==='<init>'&&ref.descriptor==='(IIIIII)V');r.BlockEventPacket=unique('BlockEventPacket',c=>eventCtors.some(ref=>ref.owner===c.name)&&c.parent===classes.get(r.SoundPacket).parent);r.BlockEvent=unique('BlockEvent',c=>eventCtors.some(ref=>ref.owner===c.name)&&c.name!==r.BlockEventPacket);
 r.MathHelper=manager.refs.find(ref=>ref.kind==='method'&&ref.descriptor==='(F)F').owner;
 const extendsRole=(name,parent)=>{while(classes.has(name)){if(name===parent)return true;name=classes.get(name).parent;}return false;};
 const clientPlayers=classes.get(r.Minecraft).fields.filter(field=>field.descriptor.startsWith('L')&&field.descriptor!==`L${r.Player};`&&extendsRole(field.descriptor.slice(1,-1),r.Player));assert.equal(clientPlayers.length,1);r.ClientPlayer=clientPlayers[0].descriptor.slice(1,-1);
 r.TeleportPacket=unique('TeleportPacket',c=>c.methods.some(m=>m.name==='<init>'&&m.descriptor==='(DDDDFFZ)V'));
 r.MovementPacket=classes.get(r.TeleportPacket).parent;
 r.ServerPacketHandler=unique('ServerPacketHandler',c=>c.fields.some(field=>field.descriptor===`L${r.ServerPlayer};`)&&c.strings.some(s=>s.includes('moved too quickly')));
 r.MinecraftServer=classes.get(r.ServerWorldListener).fields.find(f=>f.descriptor==='Lnet/minecraft/server/MinecraftServer;').descriptor.slice(1,-1);
 Object.assign(r,{SoundSystem:'paulscode/sound/SoundSystem',BaseSource:'paulscode/sound/Source',Library:'paulscode/sound/libraries/LibraryLWJGLOpenAL',Source:'paulscode/sound/libraries/SourceLWJGLOpenAL',Channel:'paulscode/sound/libraries/ChannelLWJGLOpenAL',BaseLibrary:'paulscode/sound/Library',SoundSystemConfig:'paulscode/sound/SoundSystemConfig',CodecJOrbis:'paulscode/sound/codecs/CodecJOrbis',LwjglAL:'org/lwjgl/openal/AL',LwjglALCcontext:'org/lwjgl/openal/ALCcontext'});
 for(const name of Object.values(r))assert(classes.has(name),name);
 return{version,root,metadata,metadataUrl:release.metadataUrl,metadataSha1,client,classes,roles:r,missingRequestedRelease:{versions:['1.4','1.4.1','1.4.3'],reason:'not-present-in-current-official-release-catalog',substituted:false}};
}
export async function inventoryLwjgl214(version){
 const f=await discoverLwjgl214(version),records=[];
 for(const name of new Set(Object.values(f.roles))){const c=f.classes.get(name),rawClass=`${f.root}/${name.replaceAll('/','_')}.class`,rawDisassembly=`${f.root}/${name.replaceAll('/','_')}.javap.txt`;await writeFile(rawClass,c.bytes);
  const args=['-J-XX:ActiveProcessorCount=2','-p','-s','-c','-classpath',c.archive.filename,name.replaceAll('/','.')],child=spawn('javap',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const processFile=rawDisassembly+'.process.json',processRecord={program:'javap',args,pid:child.pid,start:new Date().toISOString(),running:true};await writeFile(processFile,JSON.stringify(processRecord,null,2));const terminal=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});await writeFile(rawDisassembly,stdout);await writeFile(rawDisassembly+'.stderr.log',stderr);Object.assign(processRecord,terminal,{running:false,finish:new Date().toISOString(),stdoutSha256:sha214(Buffer.from(stdout)),stderrSha256:sha214(Buffer.from(stderr))});await writeFile(processFile,JSON.stringify(processRecord,null,2));assert.equal(terminal.exitCode,0,stderr);
  records.push({originalName:name,roles:Object.entries(f.roles).filter(([,n])=>n===name).map(([r])=>r),artifact:c.archive.artifact,bytecodeSha1:digest(c.bytes),bytecodeSha256:sha214(c.bytes),methods:methodCodeHashes(c.bytes),fields:c.fields.map(({name,descriptor,access})=>({name,descriptor,access})),rawClass,rawDisassembly,rawDisassemblySha256:sha214(Buffer.from(stdout)),disassemblyProcess:{path:processFile,sha256:sha214(await readFile(processFile))}});
 }
 const report={schema:1,version,officialSources:{metadataUrl:f.metadataUrl,metadataSha1:f.metadataSha1,client:f.metadata.downloads.client,assetIndex:f.metadata.assetIndex},roles:f.roles,classes:records,missingRequestedRelease:f.missingRequestedRelease,mappings:{officialClientMappingsAvailable:false,kind:'independent-original-release-descriptor-caller-Code-discovery'}};await writeFile(`${f.root}/inventory.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({version,classes:records.length,roles:f.roles}));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))for(const version of process.argv[2]?[process.argv[2]]:lwjgl214Versions)await inventoryLwjgl214(version);
