import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {historicalClassfile} from './historical-classfile.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';
import {digest,verifiedArtifact} from './research-utils.mjs';
import {execute216} from './lwjgl216-execution.mjs';
export {originalMethodSection} from './audit-lwjgl218-patches.mjs';
export const lwjgl216Versions=['1.6.1','1.6.2','1.6.4'];
export const allowed216=l=>{let ok=!l.rules;for(const r of l.rules??[])if(!r.os||r.os.name==='windows')ok=r.action==='allow';return ok;};
export async function discover216(version){
 assert(lwjgl216Versions.includes(version));const release=JSON.parse(await readFile('src/data/java-releases.json')).versions.find(r=>r.id===version);assert(release);const metadataSha1=/packages\/([a-f0-9]{40})\//.exec(release.metadataUrl)[1],root=`.research/lwjgl216-source/${version}`;
 await verifiedArtifact({url:release.metadataUrl,sha1:metadataSha1},root+'/official-metadata.json');const metadata=JSON.parse(await readFile(root+'/official-metadata.json'));assert.equal(metadata.id,version);assert.equal(metadata.type,'release');assert(!metadata.downloads.client_mappings);
 const client=`.research/clients/${version}.jar`;await verifiedArtifact(metadata.downloads.client,client);const archives=[{file:client,artifact:metadata.downloads.client}];for(const l of metadata.libraries.filter(l=>allowed216(l)&&(/^(com\.paulscode:|org\.lwjgl\.lwjgl:lwjgl:)/.test(l.name)))){const a=l.downloads.artifact,file=path.join('.research/libraries',a.path);await verifiedArtifact(a,file);archives.push({file,artifact:a});}
 const classes=new Map();for(const archive of archives)for(const[name,bytes]of Object.entries(unzipSync(await readFile(archive.file))))if(name.endsWith('.class'))classes.set(name.slice(0,-6),{...historicalClassfile(bytes),bytes,archive});
 const one=(role,predicate)=>{const found=[...classes.values()].filter(predicate);assert.equal(found.length,1,version+' '+role+': '+found.map(c=>c.name));return found[0].name;};
 const roles={SoundManager:one('SoundManager',c=>c.strings.includes('sound_')&&c.refs.some(r=>r.owner==='paulscode/sound/SoundSystem'&&r.name==='newSource')),NoteBlock:one('NoteBlock',c=>['bassattack','harp','note.'].every(s=>c.strings.includes(s))),TileEntityNote:one('TileEntityNote',c=>c.strings.includes('note')&&c.fields.some(f=>f.descriptor==='B')&&c.methods.some(m=>/^\(L[^;]+;III\)V$/.test(m.descriptor))),Minecraft:one('Minecraft',c=>c.methods.some(m=>m.name==='<init>'&&m.descriptor.includes('IIZZLjava/io/File;Ljava/io/File;Ljava/io/File;Ljava/net/Proxy;'))&&c.refs.some(r=>r.owner==='org/lwjgl/opengl/Display'))};
 roles.Options=one('Options',c=>c.strings.includes('sound:')&&c.strings.includes('music:'));
 const manager=classes.get(roles.SoundManager);roles.SoundPool=one('SoundPool',c=>manager.fields.some(f=>f.descriptor===`L${c.name};`)&&c.fields.some(f=>f.descriptor==='Ljava/util/Map;')&&c.methods.some(m=>m.name==='<init>'&&m.descriptor.endsWith('Ljava/lang/String;Z)V')));
 roles.SoundEntry=one('SoundEntry',c=>c.methods.some(m=>m.descriptor==='()Ljava/net/URL;')&&classes.get(roles.SoundPool).methods.some(m=>m.descriptor===`(Ljava/lang/String;)L${c.name};`));
 roles.SoundPacket=one('SoundPacket',c=>c.methods.some(m=>m.name==='<init>'&&m.descriptor==='(Ljava/lang/String;DDDFF)V'));
 roles.World=/^\(L([^;]+);/.exec(classes.get(roles.TileEntityNote).methods.find(m=>/^\(L[^;]+;III\)V$/.test(m.descriptor)).descriptor)[1];
 roles.Material=classes.get(roles.TileEntityNote).refs.find(r=>r.kind==='field'&&r.owner!==roles.TileEntityNote&&r.descriptor===`L${r.owner};`).owner;
 roles.Block=classes.get(classes.get(roles.NoteBlock).parent).parent;assert(classes.get(roles.Block).fields.filter(f=>f.descriptor===`L${roles.Block};`&&(f.access&8)).length>100);
 roles.ServerWorld=one('ServerWorld',c=>c.parent===roles.World&&c.strings.some(s=>s.startsWith('TickNextTick list out of')));roles.ClientWorld=one('ClientWorld',c=>c.parent===roles.World&&c.strings.includes('MpServer'));
 roles.ServerWorldListener=one('ServerWorldListener',c=>c.refs.some(r=>r.owner===roles.SoundPacket&&r.name==='<init>')&&c.refs.some(r=>/^\(DDDDIL[^;]+;\)V$/.test(r.descriptor)));roles.WorldListener=classes.get(roles.ServerWorldListener).interfaces[0];
 roles.PlayerList=classes.get(roles.ServerWorldListener).refs.find(r=>/^\(DDDDIL[^;]+;\)V$/.test(r.descriptor)).owner;
 roles.ServerPlayer=one('ServerPlayer',c=>c.fields.some(f=>f.descriptor==='Lnet/minecraft/server/MinecraftServer;')&&c.parent!==roles.World&&c.parent!=='java/lang/Object'&&c.strings.some(s=>/IP address|playerGameType/.test(s)));
 roles.Player=classes.get(roles.ServerPlayer).parent;
 roles.LivingEntity=classes.get(roles.Player).parent;roles.Entity=classes.get(roles.LivingEntity).parent;roles.PacketBase=classes.get(roles.SoundPacket).parent;
 roles.ClientWorldListener=one('ClientWorldListener',c=>c.interfaces.includes(roles.WorldListener)&&c.refs.some(r=>r.owner===roles.SoundManager));
 roles.BlockEventPacket=one('BlockEventPacket',c=>c.parent===roles.PacketBase&&c.methods.some(m=>m.name==='<init>'&&m.descriptor==='(IIIIII)V'));
 roles.BlockEvent=one('BlockEvent',c=>c.parent!==roles.PacketBase&&c.methods.some(m=>m.name==='<init>'&&m.descriptor==='(IIIIII)V')&&c.methods.filter(m=>m.descriptor==='()I').length===6&&classes.get(roles.ServerWorld).refs.some(r=>r.owner===c.name));
 roles.MathHelper=one('MathHelper',c=>c.fields.some(f=>f.descriptor==='[F')&&manager.refs.some(r=>r.owner===c.name&&r.descriptor==='(F)F'));
 roles.ClientPacketHandler=one('ClientPacketHandler',c=>c.methods.some(m=>m.descriptor===`(L${roles.SoundPacket};)V`)&&c.refs.some(r=>r.owner===roles.ClientWorld));
 roles.EngineLoader=one('EngineLoader',c=>c.interfaces.includes('java/lang/Runnable')&&c.refs.some(r=>r.owner===roles.SoundManager));
 roles.ResourceManager=/^\(L([^;]+);/.exec(classes.get(roles.SoundPool).methods.find(m=>m.name==='<init>').descriptor)[1];
 roles.ResourceLocation=one('ResourceLocation',c=>c.strings.includes('minecraft')&&c.strings.includes(':')&&c.methods.some(m=>m.descriptor==='(Ljava/lang/String;Ljava/lang/String;)V'));
 roles.UrlHandler=one('UrlHandler',c=>c.parent==='java/net/URLStreamHandler'&&c.fields.some(f=>f.descriptor===`L${roles.SoundPool};`));roles.UrlConnection=classes.get(roles.UrlHandler).refs.find(r=>r.name==='<init>'&&r.owner!=='java/net/URLStreamHandler').owner;
 roles.Resource=classes.get(roles.ResourceManager).methods.find(m=>m.descriptor.startsWith(`(L${roles.ResourceLocation};)L`)&&!m.descriptor.endsWith('Ljava/util/List;')).descriptor.match(/\)L([^;]+);/)[1];
 roles.DefaultResourcePack=one('DefaultResourcePack',c=>c.strings.includes('/assets/minecraft/')&&c.strings.includes('Default'));
 roles.ResourcePathHelper=classes.get(roles.DefaultResourcePack).refs.find(r=>r.descriptor==='(Ljava/io/File;Ljava/io/File;)Ljava/lang/String;').owner;
 roles.ReloadableResourceManager=one('ReloadableResourceManager',c=>c.fields.some(f=>f.descriptor==='Ljava/util/Map;')&&c.strings.some(s=>s.startsWith('Reloading ResourceManager:')));
 roles.ResourcePack=classes.get(roles.DefaultResourcePack).interfaces[0]??classes.get(roles.ResourcePathHelper).interfaces[0];
 roles.MetadataSerializer=/^\(L([^;]+);/.exec(classes.get(roles.ReloadableResourceManager).methods.find(m=>m.name==='<init>').descriptor)[1];
 roles.FallbackResourceManager=one('FallbackResourceManager',c=>c.interfaces.includes(roles.ResourceManager)&&c.fields.some(f=>f.descriptor==='Ljava/util/List;'));
 roles.SimpleResource=one('SimpleResource',c=>c.interfaces.includes(roles.Resource)&&c.fields.some(f=>f.descriptor==='Ljava/io/InputStream;'));
 Object.assign(roles,{SoundSystem:'paulscode/sound/SoundSystem',BaseLibrary:'paulscode/sound/Library',Library:'paulscode/sound/libraries/LibraryLWJGLOpenAL',Source:'paulscode/sound/Source',OpenALSource:'paulscode/sound/libraries/SourceLWJGLOpenAL',Vector3D:'paulscode/sound/Vector3D',SoundSystemConfig:'paulscode/sound/SoundSystemConfig',CodecJOrbis:'paulscode/sound/codecs/CodecJOrbis',LwjglAL:'org/lwjgl/openal/AL',LwjglALCcontext:'org/lwjgl/openal/ALCcontext'});
 for(const name of Object.values(roles))assert(classes.has(name),name);return{version,root,metadata,client,classes,roles,officialSources:{metadataUrl:release.metadataUrl,metadataSha1,clientUrl:metadata.downloads.client.url,clientSha1:metadata.downloads.client.sha1}};
}
export async function audit216(version){
 const f=await discover216(version),processRoot=path.resolve('.local/lwjgl216-source-executions',version,`run-${Date.now()}`);await mkdir(processRoot,{recursive:true});const records=[];
 for(const name of new Set(Object.values(f.roles))){const c=f.classes.get(name),base=name.replaceAll('/','_'),r=await execute216('javap',['-J-XX:ActiveProcessorCount=2','-p','-s','-c','-classpath',c.archive.file,name.replaceAll('/','.')],processRoot,base),raw=f.root+'/'+base+'.javap.txt',rawClass=f.root+'/'+base+'.class';await writeFile(raw,r.stdout);await writeFile(rawClass,c.bytes);records.push({originalName:name,roles:Object.entries(f.roles).filter(([,v])=>v===name).map(([role])=>role),artifact:c.archive.artifact,classSha256:digest(c.bytes,'sha256'),methods:methodCodeHashes(c.bytes),fields:c.fields.map(({name,descriptor,access})=>({name,descriptor,access})),rawClass,rawDisassembly:raw,disassemblySha256:digest(Buffer.from(r.stdout),'sha256'),extractionProcess:r.file});}
 const report={schema:1,version,officialSources:f.officialSources,roles:f.roles,classes:records,metadataPath:f.root+'/official-metadata.json',processRoot,worldScenesAdded:0,nativeMeasurementsAdded:0,scope:'Per-release role discovery and original class/Code inventory only; semantic bindings and components pending.'};await writeFile(f.root+'/inventory.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({version,roles:f.roles,classes:records.length,processRoot}));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve('.local/lwjgl216-source-executions',`node-run-${Date.now()}`),record={pid:process.pid,argv:process.argv,startedAt:new Date().toISOString(),terminal:false};await mkdir(root,{recursive:true});await writeFile(root+'/process.json',JSON.stringify(record,null,2));console.log(JSON.stringify({liveNode:process.pid,process:root+'/process.json'}));try{for(const v of process.argv.includes('--version')?[process.argv[process.argv.indexOf('--version')+1]]:lwjgl216Versions)await audit216(v);record.exit=0;}catch(error){record.error=error.stack??String(error);record.exit=1;throw error;}finally{record.terminal=true;record.finishedAt=new Date().toISOString();await writeFile(root+'/process.json',JSON.stringify(record,null,2)+'\n');}
}
