import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {digest,verifiedArtifact} from './research-utils.mjs';
import {historicalClassfile} from './historical-classfile.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';

export const lwjgl218Root='.research/lwjgl218-source';
export async function discoverLwjgl218(){
 const version='1.8',release=JSON.parse(await readFile('src/data/java-releases.json')).versions.find(v=>v.id===version);assert(release);
 const metadataSha1=/packages\/([a-f0-9]{40})\//.exec(release.metadataUrl)[1];
 await verifiedArtifact({url:release.metadataUrl,sha1:metadataSha1},`${lwjgl218Root}/official-metadata.json`);
 const metadata=JSON.parse(await readFile(`${lwjgl218Root}/official-metadata.json`));assert.deepEqual(metadata,JSON.parse(await readFile('.research/metadata/1.8.json')));assert(!metadata.downloads.client_mappings);
 const client='.research/clients/1.8.jar',bytes=await readFile(client);assert.equal(digest(bytes),metadata.downloads.client.sha1);
 const archives=[{filename:client,artifact:metadata.downloads.client,files:unzipSync(bytes)}];
 for(const item of metadata.libraries.filter(item=>/^com\.paulscode:/.test(item.name))){const artifact=item.downloads.artifact,filename=path.join('.research/libraries',artifact.path);await verifiedArtifact(artifact,filename);archives.push({filename,artifact,files:unzipSync(await readFile(filename))});}
 const classes=new Map();for(const archive of archives)for(const [name,bytes]of Object.entries(archive.files))if(name.endsWith('.class'))classes.set(name.slice(0,-6),{...historicalClassfile(bytes),bytes,archive});
 const unique=(role,predicate)=>{const found=[...classes.values()].filter(predicate);assert.equal(found.length,1,`${role}: ${found.map(c=>c.name)}`);return found[0].name;};
 const roles={SoundEngine:unique('SoundEngine',c=>c.strings.includes('Unable to play unknown soundEvent: {}')),NoteBlock:unique('NoteBlock',c=>['bassattack','note.','harp'].every(s=>c.strings.includes(s))),TileEntityNote:unique('TileEntityNote',c=>c.strings.includes('note')&&c.fields.some(f=>f.descriptor==='B')),SoundManager:unique('SoundManager',c=>c.strings.includes('Invalid sounds.json')),SoundSerializer:unique('SoundSerializer',c=>c.strings.includes('Invalid volume')&&c.strings.includes('Invalid pitch')),Options:unique('Options',c=>c.strings.includes('soundCategory_'))};
 // These manual roles were selected from the original descriptors/callers, never neighboring mappings.
 Object.assign(roles,{SoundDefinition:'cyz',SoundInstance:'cye',Category:'cxz',SoundAccessor:'czg',SoundList:'cya',SoundListEntry:'cyb',ResourceLocation:'oa',World:'aqu',WorldListener:'ara',ServerWorld:'qt',ServerWorldListener:'qp',ClientWorld:'cen',ClientWorldListener:'ckn',ClientPacketHandler:'cee',PlayerList:'sn',Player:'ahd',ServerPlayer:'qw',Entity:'wv',Block:'atr',BlockState:'bec',BlockPos:'dt',Blocks:'aty',Material:'bof',BlockEvent:'aqk',BlockEventPacket:'iv',SoundPacket:'jv',PacketBuffer:'hd',MathHelper:'uv',EngineLoader:'czb',EngineSoundSystem:'czf',Library:'paulscode/sound/libraries/LibraryLWJGLOpenAL',Source:'paulscode/sound/libraries/SourceLWJGLOpenAL',Channel:'paulscode/sound/libraries/ChannelLWJGLOpenAL',BaseLibrary:'paulscode/sound/Library',SoundSystemConfig:'paulscode/sound/SoundSystemConfig',CodecJOrbis:'paulscode/sound/codecs/CodecJOrbis'});
 Object.assign(roles,{Bootstrap:'od',SoundAccessorLeaf:'czn',SoundAccessorInterface:'czm',NestedSoundAccessor:'czj',SoundListEntryType:'cyc',JsonHelper:'uh'});
 Object.assign(roles,{PositionedSound:'cxy',AbstractSound:'cxt'});
 for(const name of Object.values(roles))assert(classes.has(name),name);
 return{version,metadata,metadataSha1,metadataUrl:release.metadataUrl,client,classes,roles};
}
export async function auditLwjgl218(){
 const found=await discoverLwjgl218(),records=[];await mkdir(`${lwjgl218Root}/classes`,{recursive:true});
 for(const name of new Set(Object.values(found.roles))){const c=found.classes.get(name),base=name.replaceAll('/','_'),rawClass=`${lwjgl218Root}/classes/${base}.class`,rawSource=`${lwjgl218Root}/source/${name}.java`,rawDisassembly=`${lwjgl218Root}/${base}.javap.txt`;await writeFile(rawClass,c.bytes);
 let source=await readFile(rawSource).catch(()=>null);if(!source){const run=spawnSync('java',['-jar','.research/tools/cfr-0.152.jar',rawClass,'--extraclasspath',c.archive.filename,'--outputdir',`${lwjgl218Root}/source`,'--silent','true'],{windowsHide:true,encoding:'utf8'});assert.equal(run.status,0,run.stderr);source=await readFile(rawSource);}
 let disassembly=await readFile(rawDisassembly).catch(()=>null);if(!disassembly){const run=spawnSync('javap',['-p','-s','-c','-classpath',c.archive.filename,name.replaceAll('/','.')],{windowsHide:true,encoding:'utf8'});assert.equal(run.status,0,run.stderr);disassembly=Buffer.from(run.stdout);await writeFile(rawDisassembly,disassembly);}
 records.push({originalName:name,roles:Object.entries(found.roles).filter(([,n])=>n===name).map(([r])=>r),artifact:c.archive.artifact,bytecodeSha1:digest(c.bytes),bytecodeSha256:digest(c.bytes,'sha256'),methods:methodCodeHashes(c.bytes),fields:c.fields.map(({access,name,descriptor})=>({access,name,descriptor})),rawClass,rawSource,sourceSha256:digest(source,'sha256'),rawDisassembly,disassemblySha256:digest(disassembly,'sha256')});
 if(records.length%10===0)console.log(`Original1.8 ${records.length} classes extracted`);
 }
 const report={schema:1,version:found.version,officialSources:{metadataUrl:found.metadataUrl,metadataSha1:found.metadataSha1,clientSha1:found.metadata.downloads.client.sha1,clientUrl:found.metadata.downloads.client.url},mappings:{officialClientMappingsAvailable:false,kind:'manual-original-client-and-official-dependency-role-audit'},roles:found.roles,classes:records};await writeFile(`${lwjgl218Root}/inventory.json`,JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await auditLwjgl218();
