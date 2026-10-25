import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {discoverPre13,executePre13,pre13Versions,shaPre13} from './audit-pre13-audio.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';
import {digest} from './research-utils.mjs';
import {originalSection} from './review-lwjgl219-source.mjs';
export async function inventoryPre13Packet(version,root){
 await mkdir(root,{recursive:true});const f=await discoverPre13(version,{download:false}),unique=(label,p)=>{const rows=[...f.classes.values()].filter(p);assert.equal(rows.length,1,version+' '+label+': '+rows.map(c=>c.name));return rows[0];};
 const queued=f.classes.get(f.roles.TileEntityNote).refs.find(r=>r.owner===f.roles.World&&r.descriptor==='(IIIII)V');assert(queued);
 const handler=unique('ClientPacketHandler',c=>c.fields.some(x=>x.descriptor===`L${f.roles.ClientWorld};`)&&c.refs.some(r=>r.owner===f.roles.Minecraft));
 const records=[];let handlerDispatch,packet;
 for(let i=0;i<2;i++){const c=i===0?handler:packet,classFile=path.join(root,c.name+'.class');await writeFile(classFile,c.bytes);const run=await executePre13('javap',['-J-XX:ActiveProcessorCount=2','-p','-s','-c','-classpath',path.resolve(c.archive.file),c.name],root,c.name),methods=methodCodeHashes(c.bytes);records.push({name:c.name,roles:[i===0?'ClientPacketHandler':'BlockEventPacket'],archive:c.archive.file,artifact:c.archive.artifact,sha1:digest(c.bytes),sha256:shaPre13(c.bytes),classFile,fields:c.fields.map(({name,descriptor,access})=>({name,descriptor,access})),methods,disassembly:{path:run.record.stdoutFile,sha256:shaPre13(Buffer.from(run.stdout))},process:{path:run.file,sha256:shaPre13(await readFile(run.file))}});
  if(i===0){const matches=Object.keys(methods).filter(k=>/\(L[^;]+;\)V$/.test(k)&&originalSection(run.stdout,c.name,k).includes(`Method ${f.roles.World}.${queued.name}:(IIIII)V`));assert.equal(matches.length,1,version+' actual block-event handler');handlerDispatch=matches[0];const packetName=/\(L([^;]+);\)V$/.exec(handlerDispatch)[1];packet=f.classes.get(packetName);assert(packet&&packet.methods.some(m=>m.descriptor==='(Ljava/io/DataInputStream;)V'));}
 }
 const report={schema:1,status:'packet-inventory-only',version,clientSha1:f.metadata.downloads.client.sha1,roles:{BlockEventPacket:packet.name,ClientPacketHandler:handler.name},handlerDispatch,tileQueueMethod:queued,classes:records,sources:Object.fromEntries(await Promise.all(['scripts/audit-pre13-packet.mjs','scripts/audit-pre13-audio.mjs','scripts/historical-classfile.mjs','scripts/audit-early-world.mjs','scripts/research-utils.mjs','scripts/review-lwjgl219-source.mjs'].map(async file=>[file,shaPre13(await readFile(file))]))),nativeExecutions:0,worldScenesAdded:0};await writeFile(path.join(root,'inventory.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({version,packet:packet.name,handler:handler.name,handlerDispatch,inventory:path.join(root,'inventory.json')}));return report;
}
async function cli(){for(const v of process.argv[2]?[process.argv[2]]:pre13Versions){assert(pre13Versions.includes(v));const root=path.resolve('.local/pre13-packet-inventory',v,'run-'+Date.now());await mkdir(root,{recursive:true});const run=await executePre13(process.execPath,[fileURLToPath(import.meta.url),'--execute',v,root],root,'node');console.log(run.stdout);}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv[2]==='--execute')await inventoryPre13Packet(process.argv[3],process.argv[4]);else await cli();}
