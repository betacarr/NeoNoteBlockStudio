import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {unzipSync} from 'fflate';
import assert from 'node:assert/strict';
import {historicalClassfile} from './historical-classfile.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';
import {originalMethodSection} from './audit-lwjgl218-patches.mjs';
import {digest,verifiedArtifact} from './research-utils.mjs';

export const pre17ResourceVersions=['1.1','1.2.1','1.2.2','1.2.3','1.2.4','1.2.5','1.3.1','1.3.2','1.4.2','1.4.4','1.4.5','1.4.6','1.4.7'];
export const pre17ResourceEvents={harp:'harp',bass:'bassattack',basedrum:'bd',snare:'snare',hat:'hat',pling:'pling'};
const sourceFiles=['scripts/audit-pre17-resources.mjs','scripts/java/Pre17Resources.java','scripts/historical-classfile.mjs','scripts/audit-early-world.mjs','scripts/audit-lwjgl218-patches.mjs','scripts/research-utils.mjs'];
const relative=f=>path.relative(process.cwd(),path.resolve(f)).replaceAll('\\','/');
const ref=async f=>{const b=await readFile(f);return{path:relative(f),bytes:b.length,sha256:digest(b,'sha256')}};
const allowed=l=>{let ok=!l.rules;for(const r of l.rules??[])if(!r.os||r.os.name==='windows')ok=r.action==='allow';return ok;};
export async function discoverPre17Resources(version,root){
 assert(pre17ResourceVersions.includes(version));const release=JSON.parse(await readFile('src/data/java-releases.json')).versions.find(v=>v.id===version);assert(release&&release.type==='release');
 const metadataFile=path.join(root,'official-metadata.json'),metadataSha1=/packages\/([a-f0-9]{40})\//.exec(release.metadataUrl)[1];await verifiedArtifact({url:release.metadataUrl,sha1:metadataSha1},metadataFile);const metadataBytes=await readFile(metadataFile);assert.equal(digest(metadataBytes),metadataSha1);const metadata=JSON.parse(metadataBytes);assert.deepEqual(metadata,JSON.parse(await readFile(`.research/metadata/${version}.json`)));assert.equal(metadata.id,version);assert.equal(metadata.assetIndex.id,'pre-1.6');
 const clientFile=`.research/clients/${version}.jar`,client=await readFile(clientFile);assert.equal(digest(client),metadata.downloads.client.sha1);assert.equal(digest(client),release.clientSha1);
 const archive=unzipSync(client),all=Object.entries(archive).filter(([name])=>name.endsWith('.class')).map(([,b])=>historicalClassfile(b));
 const unique=(role,predicate)=>{const matches=all.filter(predicate);assert.equal(matches.length,1,`${version} ${role}: ${matches.map(c=>c.name)}`);return matches[0];};
 const manager=unique('SoundManager',c=>c.refs.some(r=>r.owner==='paulscode/sound/SoundSystem'&&r.name==='newSource'));
 const pool=unique('SoundPool',c=>c.methods.some(m=>m.descriptor==='(Ljava/lang/String;Ljava/io/File;)L'+c.refs.find(r=>r.name==='<init>'&&r.descriptor==='(Ljava/lang/String;Ljava/net/URL;)V')?.owner+';'));
 const entry=all.find(c=>c.name===pool.refs.find(r=>r.name==='<init>'&&r.descriptor==='(Ljava/lang/String;Ljava/net/URL;)V').owner);assert(entry);
 const minecraft=all.find(c=>c.name==='net/minecraft/client/Minecraft');assert(minecraft);
 const concrete=(minecraft.access&1024)?unique('ConcreteMinecraft',c=>c.parent===minecraft.name&&!(c.access&1024)&&(!all.some(other=>other.parent===minecraft.name&&other.fields.some(f=>f.descriptor==='Ljava/awt/Frame;'))||c.fields.some(f=>f.descriptor==='Ljava/awt/Frame;'))):minecraft;
 const downloader=unique('ResourceDownloader',c=>c.parent==='java/lang/Thread'&&c.methods.some(m=>m.name==='<init>'&&m.descriptor===`(Ljava/io/File;L${minecraft.name};)V`));
 const roles={Minecraft:minecraft.name,ConcreteMinecraft:concrete.name,ResourceDownloader:downloader.name,SoundManager:manager.name,SoundPool:pool.name,SoundPoolEntry:entry.name};
 const records=[];await mkdir(root,{recursive:true});for(const name of new Set(Object.values(roles))){const bytes=archive[name+'.class'];const p=spawnSync('javap',['-J-XX:ActiveProcessorCount=2','-p','-c','-s','-classpath',clientFile,name.replaceAll('/','.')],{encoding:'utf8',windowsHide:true,maxBuffer:8e6});assert.equal(p.status,0,p.stderr);const f=path.join(root,name.replaceAll('/','_')+'.javap.txt');await writeFile(f,p.stdout);records.push({name,roles:Object.entries(roles).filter(([,n])=>name===n).map(([r])=>r),sha1:digest(bytes),sha256:digest(bytes,'sha256'),methods:methodCodeHashes(bytes),disassembly:await ref(f)});}
 const text=async role=>readFile(records.find(c=>c.name===roles[role]).disassembly.path,'utf8');
 const one=(label,values)=>{assert.equal(values.length,1,`${version} ${label}`);return values[0];};
 const dispatch=one('dispatch',minecraft.methods.filter(m=>m.descriptor==='(Ljava/lang/String;Ljava/io/File;)V'));
 const dispatchSection=originalMethodSection(await text('Minecraft'),minecraft.name,dispatch.name+dispatch.descriptor);
 const expectedPrefix=version.startsWith('1.4.')?'sound3':'newsound';assert(dispatchSection.includes(`String ${expectedPrefix}`));assert(!dispatchSection.includes(`String ${expectedPrefix==='sound3'?'newsound':'sound3'}`));
 const managerField=one('Minecraft manager field',minecraft.fields.filter(f=>f.descriptor===`L${manager.name};`)).name;
 const downloaderText=await text('ResourceDownloader');const walk=one('local tree walker',downloader.methods.filter(m=>m.descriptor==='()V'&&(m.access&1)&&!['run','start'].includes(m.name)&&originalMethodSection(downloaderText,downloader.name,m.name+m.descriptor).includes('(Ljava/io/File;Ljava/lang/String;)V')));
 const poolFields=manager.fields.filter(f=>f.descriptor===`L${pool.name};`).map(f=>f.name);assert.equal(poolFields.length,3);
 const config={...roles,expectedPrefix,managerField,dispatchMethod:dispatch.name,walkMethod:walk.name,poolFields:poolFields.join(','),soundPoolField:poolFields[0],poolCountField:one('pool counter',pool.fields.filter(f=>f.descriptor==='I'&&(f.access&1))).name,
 lookupMethod:one('lookup',pool.methods.filter(m=>m.descriptor===`(Ljava/lang/String;)L${entry.name};`)).name,entryUrlField:one('URL field',entry.fields.filter(f=>f.descriptor==='Ljava/net/URL;')).name,entryNameField:one('name field',entry.fields.filter(f=>f.descriptor==='Ljava/lang/String;')).name};
 const managerText=await text('SoundManager');const registrations=manager.methods.filter(m=>m.descriptor==='(Ljava/lang/String;Ljava/io/File;)V');assert.equal(registrations.length,3);
 const register=one('sound-pool registration',registrations.filter(m=>originalMethodSection(managerText,manager.name,m.name+m.descriptor).includes(`Field ${config.soundPoolField}:L${pool.name};`)));
 assert(dispatchSection.includes(`Method ${manager.name}.${register.name}:(Ljava/lang/String;Ljava/io/File;)V`));
 const bindingKeys=[['Minecraft',dispatch.name+dispatch.descriptor],['ResourceDownloader',`<init>(Ljava/io/File;L${minecraft.name};)V`],['ResourceDownloader',walk.name+'()V'],['ResourceDownloader',one('recursive walker',downloader.methods.filter(m=>m.descriptor==='(Ljava/io/File;Ljava/lang/String;)V')).name+'(Ljava/io/File;Ljava/lang/String;)V'],['SoundManager',register.name+register.descriptor],['SoundPool',one('pool register',pool.methods.filter(m=>m.descriptor===`(Ljava/lang/String;Ljava/io/File;)L${entry.name};`)).name+`(Ljava/lang/String;Ljava/io/File;)L${entry.name};`],['SoundPool',config.lookupMethod+`(Ljava/lang/String;)L${entry.name};`],['SoundPoolEntry','<init>(Ljava/lang/String;Ljava/net/URL;)V']];
 const bindings=bindingKeys.map(([role,method])=>{const c=records.find(c=>c.name===roles[role]),codeSha256=c.methods[method];assert(codeSha256);return{role,owner:c.name,method,codeSha256};});
 return{version,metadata,metadataSha1,metadataUrl:release.metadataUrl,metadataFile,clientFile,roles,classes:records,config,bindings};
}

export async function auditPre17Resources(version,{writeEvidence=false}={}){
 const root=path.resolve('.local/pre17-resources',version,`run-${Date.now()}`);const d=await discoverPre17Resources(version,path.join(root,'source'));
 const indexFile=path.join(root,'index.json');await verifiedArtifact(d.metadata.assetIndex,indexFile);const index=JSON.parse(await readFile(indexFile));assert.equal(index.map_to_resources,true);
 const classpathArtifacts=d.metadata.libraries.filter(allowed).map(l=>l.downloads?.artifact).filter(Boolean),classpath=[];for(const a of classpathArtifacts){const f=path.join('.research/libraries',a.path);await verifiedArtifact(a,f);classpath.push(path.resolve(f));}
 const fixtures=[];for(const[key,a]of Object.entries(index.objects).filter(([key])=>/^(newsound|sound3)\/note\/[^/]+\.ogg$/.test(key))){const object=path.join('.research/pre17-resource-objects',a.hash);await verifiedArtifact({url:`https://resources.download.minecraft.net/${a.hash.slice(0,2)}/${a.hash}`,sha1:a.hash,size:a.size},object);const file=path.join(root,'fixture','resources',key);await mkdir(path.dirname(file),{recursive:true});await copyFile(object,file);fixtures.push({key,...a,file:relative(file)});}assert.equal(fixtures.length,14);
 const config=path.join(root,'probe.properties');await writeFile(config,Object.entries(d.config).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
 const execute=async(name,command,args)=>{const p=spawnSync(command,args,{encoding:'utf8',windowsHide:true,maxBuffer:4e6,timeout:30000});const stdout=path.join(root,name+'.stdout.log'),stderr=path.join(root,name+'.stderr.log'),terminal=path.join(root,name+'.process.json');await writeFile(stdout,p.stdout??'');await writeFile(stderr,p.stderr??'');await writeFile(terminal,JSON.stringify({command,args,pid:p.pid,terminal:true,exit:p.status,signal:p.signal,error:p.error?String(p.error):null},null,2));assert.equal(p.status,0,`${version} ${name}: ${p.stderr}`);return{stdout:await ref(stdout),stderr:await ref(stderr),process:await ref(terminal)};};
 const compile=await execute('compile','javac',['--release','8','-encoding','UTF-8','-d',path.join(root,'classes'),'scripts/java/Pre17Resources.java']);
 const java=await execute('java','java',['-Djava.awt.headless=true','-cp',[path.join(root,'classes'),path.resolve(d.clientFile),...classpath].join(path.delimiter),'studio.nbsx.research.Pre17Resources',config,path.join(root,'fixture')]);
 const rows=(await readFile(java.stdout.path,'utf8')).trim().split(/\r?\n/).map(line=>line.split('\t'));assert.deepEqual(rows.shift(),['TREE','7']);
 const actualSamples=rows.filter(r=>r[0]==='SAMPLE').map(([,event,name,url,sha1,size])=>({event,name,url,sha1,bytes:Number(size)}));assert.equal(actualSamples.length,6);assert.deepEqual(actualSamples.map(s=>s.event),Object.values(pre17ResourceEvents).map(n=>'note.'+n));
 for(const s of actualSamples){const key=`${d.config.expectedPrefix}/${s.name}`,a=index.objects[key];assert(a);assert.equal(s.sha1,a.hash);assert.equal(s.bytes,a.size);assert(s.url.includes(`/resources/${d.config.expectedPrefix}/`));}
 const dispatchCases=rows.filter(r=>r[0]==='DISPATCH').map(([,prefix,counts])=>({prefix,counts:counts.split(',').map(Number)}));
 const expectedDispatch=['newsound','sound','NEWSOUND','sound3','SOUND3','streaming','music','newmusic','unknown'].map(prefix=>({prefix,counts:[d.config.expectedPrefix==='sound3'?Number(prefix.toLowerCase()==='sound3'):Number(['newsound','sound'].includes(prefix.toLowerCase())),Number(prefix==='streaming'),Number(['music','newmusic'].includes(prefix))]}));assert.deepEqual(dispatchCases,expectedDispatch);
 const sources={},sourceSnapshots={};for(const f of sourceFiles){const bytes=await readFile(f),hash=digest(bytes,'sha256'),snapshot=path.join(root,'source-snapshots',hash);await mkdir(path.dirname(snapshot),{recursive:true});await writeFile(snapshot,bytes);sources[f]=hash;sourceSnapshots[f]=await ref(snapshot);}
 const report={schema:1,status:'passed',version,scope:'Original local-directory traversal, original Minecraft dispatch, original manager registration/pool lookup and actual selected bytes. The real original concrete Minecraft class is Unsafe-allocated; no game constructor, downloader thread, audio system, codec/native call, world or playback is run.',officialSources:{metadataUrl:d.metadataUrl,metadataSha1:d.metadataSha1,client:d.metadata.downloads.client,assetIndex:d.metadata.assetIndex},metadata:await ref(d.metadataFile),index:await ref(indexFile),clientFile:d.clientFile,roles:d.roles,config:d.config,classes:d.classes,bindings:d.bindings,classloadingDependencies:classpathArtifacts,classloadingScope:'Official current launcher metadata dependencies only resolve original class signatures; not a historical installation or native-context claim.',fixtures,actualSamples,dispatchCases,sourcePrefix:d.config.expectedPrefix,originalTreeRegistrations:7,raw:{compile,java,config:await ref(config),compiledProbe:await ref(path.join(root,'classes/studio/nbsx/research/Pre17Resources.class'))},sources,sourceSnapshots,worldScenesAdded:0,fullAudioProfilePromoted:false};
 const file=path.join(root,'report.json');await writeFile(file,JSON.stringify(report,null,2));if(writeEvidence)await writeFile(`docs/evidence/java-${version}-resource-selection.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:'passed',version,report:file,sourcePrefix:report.sourcePrefix,samples:6,dispatchCases:9,worldScenesAdded:0}));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const selected=process.argv.slice(2).filter(s=>!s.startsWith('--'));for(const v of selected.length?selected:pre17ResourceVersions)await auditPre17Resources(v,{writeEvidence:process.argv.includes('--write-evidence')});}
