import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {unzipSync} from 'fflate';
import assert from 'node:assert/strict';
import {digest,verifiedArtifact} from './research-utils.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';

const root=path.resolve('.local/java10-resources',`run-${Date.now()}`);await mkdir(root,{recursive:true});
const rel=file=>path.relative(process.cwd(),path.resolve(file)).replaceAll('\\','/');
const ref=async file=>({path:rel(file),sha256:digest(await readFile(file),'sha256')});
const release=JSON.parse(await readFile('src/data/java-releases.json')).versions.find(v=>v.id==='1.0');
const metadataSha1=/packages\/([a-f0-9]{40})\//.exec(release.metadataUrl)[1];
const metadataFile=path.join(root,'metadata.json');await verifiedArtifact({url:release.metadataUrl,sha1:metadataSha1},metadataFile);
const metadata=JSON.parse(await readFile(metadataFile)),clientFile='.research/clients/1.0.jar',client=await readFile(clientFile);assert.equal(digest(client),metadata.downloads.client.sha1);
const indexFile=path.join(root,'index.json');await verifiedArtifact(metadata.assetIndex,indexFile);const index=JSON.parse(await readFile(indexFile));assert.equal(index.map_to_resources,true);
const allowed=l=>{let ok=!l.rules;for(const r of l.rules??[])if(!r.os||r.os.name==='windows')ok=r.action==='allow';return ok;};
const classpathArtifacts=metadata.libraries.filter(allowed).map(l=>l.downloads?.artifact).filter(Boolean);
const classpath=[];for(const a of classpathArtifacts){const file=path.join('.research/libraries',a.path);await verifiedArtifact(a,file);classpath.push(path.resolve(file));}
const fixtures=[];for(const [key,a]of Object.entries(index.objects).filter(([key])=>/^(newsound|sound3)\/note\/[^/]+\.ogg$/.test(key))){
    const object=path.join(root,'objects',a.hash);await verifiedArtifact({url:`https://resources.download.minecraft.net/${a.hash.slice(0,2)}/${a.hash}`,sha1:a.hash},object);assert.equal((await readFile(object)).length,a.size);
    const file=path.join(root,'fixture','resources',key);await mkdir(path.dirname(file),{recursive:true});await copyFile(object,file);fixtures.push({key,...a,file:rel(file)});
}
assert.equal(fixtures.length,14);
const zip=unzipSync(client),roles={Minecraft:'net/minecraft/client/Minecraft',ConcreteMinecraft:'ahy',ResourceDownloader:'ng',SoundManager:'ahm',SoundPool:'cf',SoundPoolEntry:'lr'},classes=[];
for(const [role,name]of Object.entries(roles)){
    const bytes=zip[name+'.class'];assert(bytes);const javap=spawnSync('javap',['-p','-s','-c','-classpath',clientFile,name.replaceAll('/','.')],{encoding:'utf8',windowsHide:true,maxBuffer:8e6});assert.equal(javap.status,0,javap.stderr);
    const file=path.join(root,name.replaceAll('/','_')+'.javap.txt');await writeFile(file,javap.stdout);classes.push({role,name,classSha256:digest(bytes,'sha256'),methods:methodCodeHashes(bytes),disassembly:await ref(file)});
}
const minecraftText=await readFile(path.join(root,'net_minecraft_client_Minecraft.javap.txt'),'utf8');const dispatch=minecraftText.slice(minecraftText.indexOf('public void a(java.lang.String, java.io.File)'),minecraftText.indexOf('public void a(java.lang.String, java.io.File)')+4800);
for(const token of ['String sound','String newsound','String streaming','String music','String newmusic','ahm.a:(Ljava/lang/String;Ljava/io/File;)V'])assert(dispatch.includes(token),token);
const probe='scripts/java/Legacy10Resources.java',compile=spawnSync('javac',['--release','8','-encoding','UTF-8','-d',path.join(root,'classes'),probe],{encoding:'utf8',windowsHide:true});assert.equal(compile.status,0,compile.stderr);
const args=['-Djava.awt.headless=true','-cp',[path.join(root,'classes'),path.resolve(clientFile),...classpath].join(path.delimiter),'studio.nbsx.research.Legacy10Resources',path.join(root,'fixture')];
const run=spawnSync('java',args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2e6});await writeFile(path.join(root,'stdout.tsv'),run.stdout??'');await writeFile(path.join(root,'stderr.log'),run.stderr??'');
await writeFile(path.join(root,'process.json'),JSON.stringify({pid:run.pid,args,exit:run.status,signal:run.signal,error:run.error?String(run.error):null,terminal:true},null,2));assert.equal(run.status,0,run.stderr);
const rows=run.stdout.trim().split(/\r?\n/).map(line=>line.split('\t'));assert.deepEqual(rows.shift(),['TREE','7']);const samples=rows.filter(r=>r[0]==='SAMPLE').map(([,event,name,url,sha1,bytes])=>({event,name,url,sha1,bytes:Number(bytes)}));assert.equal(samples.length,6);
for(const sample of samples){const key='newsound/'+sample.name;assert.equal(sample.sha1,index.objects[key].hash);assert.equal(sample.bytes,index.objects[key].size);assert(sample.url.includes('/resources/newsound/'));}
const dispatchCases=rows.filter(r=>r[0]==='DISPATCH').map(([,prefix,counts])=>({prefix,counts:counts.split(',').map(Number)}));assert.deepEqual(dispatchCases,[['newsound',[1,0,0]],['sound',[1,0,0]],['NEWSOUND',[1,0,0]],['sound3',[0,0,0]],['streaming',[0,1,0]],['music',[0,0,1]],['newmusic',[0,0,1]],['unknown',[0,0,0]]].map(([prefix,counts])=>({prefix,counts})));
const bindings=[];for(const [role,key]of [['Minecraft','a(Ljava/lang/String;Ljava/io/File;)V'],['ResourceDownloader','<init>(Ljava/io/File;Lnet/minecraft/client/Minecraft;)V'],['ResourceDownloader','a()V'],['ResourceDownloader','a(Ljava/io/File;Ljava/lang/String;)V'],['SoundManager','a(Ljava/lang/String;Ljava/io/File;)V'],['SoundPool','a(Ljava/lang/String;Ljava/io/File;)Llr;'],['SoundPool','a(Ljava/lang/String;)Llr;'],['SoundPoolEntry','<init>(Ljava/lang/String;Ljava/net/URL;)V']]){const c=classes.find(c=>c.role===role);assert(c.methods[key],role+' '+key);bindings.push({role,owner:c.name,method:key,codeSha256:c.methods[key]});}
const sources={};for(const file of ['scripts/audit-java10-resources.mjs',probe,'scripts/historical-classfile.mjs','scripts/audit-early-world.mjs','scripts/research-utils.mjs'])sources[file]=digest(await readFile(file),'sha256');
const report={schema:1,status:'passed',version:'1.0',scope:'Unmodified original resource-directory traversal, Minecraft dispatch, SoundManager registration, SoundPool lookup and actual selected file bytes. Minecraft allocation bypasses its constructor; downloader thread is never started. No SoundSystem instance, native context, decoder, world or playback acceptance.',officialSources:{metadataUrl:release.metadataUrl,metadataSha1,client:metadata.downloads.client,assetIndex:metadata.assetIndex},metadata:await ref(metadataFile),index:await ref(indexFile),classloadingDependencies:classpathArtifacts,classloadingScope:'Official modern launch metadata dependencies resolve original class signatures only; not a claim about historical deployment or native initialization.',classes,bindings,fixtures,actualSamples:samples,dispatchCases,sourcePrefix:'newsound',ignoredPrefix:'sound3',resourceEvents:samples.map(s=>s.event),originalTreeRegistrations:7,raw:{output:await ref(path.join(root,'stdout.tsv')),error:await ref(path.join(root,'stderr.log')),process:await ref(path.join(root,'process.json')),compiledProbe:await ref(path.join(root,'classes/studio/nbsx/research/Legacy10Resources.class'))},sources,worldScenesAdded:0,fullAudioProfilePromoted:false};
const file=path.join(root,'report.json');await writeFile(file,JSON.stringify(report,null,2));if(process.argv.includes('--write-evidence'))await writeFile('docs/evidence/java-1.0-resource-selection.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:'passed',report:file,samples:samples.length,dispatchCases:dispatchCases.length,originalTreeRegistrations:7,sourcePrefix:'newsound'}));
