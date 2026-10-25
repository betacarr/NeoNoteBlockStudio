import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {discoverLwjgl2172,patchSha,allowedWindows} from './audit-lwjgl2172-source.mjs';
import {reviewLwjgl2172} from './review-lwjgl2172-source.mjs';
import {digest,verifiedArtifact} from './research-utils.mjs';

export async function auditLwjgl2172Resources({writeEvidence=false}={}){
 const root=path.resolve('.local/lwjgl2172-resources',`run-${Date.now()}`);await mkdir(root,{recursive:true});
 const report={schema:1,status:'running',version:'1.7.2',scope:'Actual original File-root DefaultResourcePack reads from a minimal materialized official legacy index. No ResourceIndex class is substituted. Resource selection only; no SoundEngine, native context or game world.',processes:[],worldScenesAdded:0};
 const reportFile=path.join(root,'report.json'),save=()=>writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
 const execute=async(executable,args,label)=>{const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const record={label,pid:child.pid,executable,args,terminal:false};report.processes.push(record);await save();const terminal=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));});Object.assign(record,terminal,{terminal:true,stdout,stderr});await writeFile(path.join(root,label+'.json'),JSON.stringify(record,null,2));assert.equal(terminal.code,0,stderr+'\n'+stdout);return record;};
 try{
  const reviewed=await reviewLwjgl2172('1.7.2'),found=await discoverLwjgl2172('1.7.2');
  report.officialSources=reviewed.officialSources;report.sourceEvidence={path:'docs/evidence/java-1.7.2-audio-source.json',sha256:patchSha(await readFile('docs/evidence/java-1.7.2-audio-source.json'))};
  report.classIdentities=reviewed.classes.filter(c=>c.roles.some(role=>['DefaultResourcePack','ResourcePathHelper','ResourceLocation'].includes(role)));
  report.bindings=reviewed.bindings.filter(b=>/virtual-|default-pack/.test(b.label));assert(report.bindings.length>=4);assert(!('ResourceIndex' in reviewed.roles));
  const indexFile=path.join(root,'official-index.json');await verifiedArtifact(found.metadata.assetIndex,indexFile);const index=JSON.parse(await readFile(indexFile));assert.equal(index.virtual,true);
  const paths=['sounds.json',...['harp','bassattack','bd','snare','hat','pling'].map(name=>`sounds/note/${name}.ogg`)];
  const materialized=path.join(root,'virtual','legacy'),expected=[];await mkdir(materialized,{recursive:true});
  for(const relative of paths){const object=index.objects[relative];assert(object,relative);const file=path.join(materialized,relative);await mkdir(path.dirname(file),{recursive:true});await verifiedArtifact({url:`https://resources.download.minecraft.net/${object.hash.slice(0,2)}/${object.hash}`,sha1:object.hash,size:object.size},file);expected.push({logicalPath:'minecraft:'+relative,virtualRelativePath:relative,sha1:object.hash,bytes:object.size,file});}
  const dependencies=[];for(const library of found.metadata.libraries.filter(allowedWindows)){const a=library.downloads?.artifact;if(!a)continue;const file=path.resolve('.research/libraries',a.path);await verifiedArtifact(a,file);dependencies.push({name:library.name,artifact:a,file,sha256:patchSha(await readFile(file))});}
  const source='scripts/java/Lwjgl2172ResourceProbe.java',classes=path.join(root,'classes');await mkdir(classes,{recursive:true});
  await execute('javac',['--release','8','-d',classes,source],'compile');
  const open=reviewed.bindings.find(b=>b.label==='default-pack-actual-map-stream');assert(open);
  const invocation=await execute('java',['-Djava.awt.headless=true','-cp',[classes,path.resolve(found.client),...dependencies.map(d=>d.file)].join(path.delimiter),'studio.nbsx.research.Lwjgl2172ResourceProbe',materialized,reviewed.roles.DefaultResourcePack,reviewed.roles.ResourceLocation,open.member,...paths],'original-reads');
  const observations=invocation.stdout.split(/\r?\n/).filter(line=>line.startsWith('RESOURCE\t')).map(line=>{const [,logicalPath,sha1,bytes]=line.split('\t');return{logicalPath,sha1,bytes:Number(bytes)};});assert.equal(observations.length,7);
  for(let i=0;i<expected.length;i++)assert.deepEqual(observations[i],{logicalPath:expected[i].logicalPath,sha1:expected[i].sha1,bytes:expected[i].bytes});
  report.dependencies=dependencies;report.index={...found.metadata.assetIndex,path:indexFile,sha256:patchSha(await readFile(indexFile))};report.materializedDirectory=materialized;report.expected=expected;report.observations=observations;report.loaderLayout='default-domain-root';
  report.sources={};for(const f of ['scripts/audit-lwjgl2172-resources.mjs',source,'scripts/audit-lwjgl2172-source.mjs','scripts/review-lwjgl2172-source.mjs','scripts/lwjgl2172-bindings.mjs'])report.sources[f]=patchSha(await readFile(f));
  report.compiledClasses={};for(const filename of await readdir(path.join(classes,'studio/nbsx/research'))){const file=path.join(classes,'studio/nbsx/research',filename);report.compiledClasses[file]=patchSha(await readFile(file));}
  report.limitations=['Only the official seven-resource minimal virtual tree is materialized; no full playable installation is prepared.','Original pack gives embedded client assets precedence before its virtual-file map. The observed bytes bind the selected files, not arbitrary resource packs or namespace behavior.','Pling is an available event/sample, not one of the five material-selected note-block instruments in this release.','No product layout is inferred from a shared asset index alone; the 1.7.2 original File-root traversal and actual reads are independently checked.'];
  report.status='passed';await save();if(writeEvidence)await writeFile('docs/evidence/java-1.7.2-resource-selection.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,report:reportFile,resources:observations.length,worldScenesAdded:0}));return report;
 }catch(error){report.status='failed';report.error=error.stack??String(error);await save();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await auditLwjgl2172Resources({writeEvidence:process.argv.includes('--write-evidence')});
