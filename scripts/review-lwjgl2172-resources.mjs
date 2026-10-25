import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {digest} from './research-utils.mjs';
import {historicalClassfile} from './historical-classfile.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';
import {originalMethodSection} from './audit-lwjgl2172-source.mjs';
import {bindLwjgl2172} from './lwjgl2172-bindings.mjs';

const defaultFile='docs/evidence/java-1.7.2-resource-selection.json';
const resourcePaths=['sounds.json',...['harp','bassattack','bd','snare','hat','pling'].map(name=>`sounds/note/${name}.ogg`)];
const producerSources=['scripts/audit-lwjgl2172-resources.mjs','scripts/java/Lwjgl2172ResourceProbe.java','scripts/audit-lwjgl2172-source.mjs','scripts/review-lwjgl2172-source.mjs','scripts/lwjgl2172-bindings.mjs'];
const resourceRoles=['DefaultResourcePack','ResourcePathHelper','ResourceLocation'];
const sha=b=>digest(b,'sha256'),samePath=(a,b)=>assert.equal(path.resolve(a),path.resolve(b));
const allowedWindows=library=>{let result=!library.rules;for(const rule of library.rules??[])if(!rule.os||rule.os.name==='windows')result=rule.action==='allow';return result;};
async function filesIn(root){const files=[];for(const entry of await readdir(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isDirectory())files.push(...await filesIn(file));else if(entry.isFile())files.push(path.resolve(file));else throw Error('Unexpected non-file fixture entry: '+file);}return files.sort();}

/** Strict local consumption only: no download, javap, compilation, Java or native execution. */
export async function reviewLwjgl2172ResourceSelection(filename=defaultFile,{read=readFile}={}){
 const snapshots=new Map();
 const bytes=async file=>{const data=await read(file),key=path.resolve(file),hash=sha(data);if(snapshots.has(key))assert.equal(hash,snapshots.get(key),'Input changed: '+file);snapshots.set(key,hash);return data;};
 const json=async file=>JSON.parse(await bytes(file));
 const publicBytes=await bytes(filename),report=JSON.parse(publicBytes);assert.equal(report.schema,1);assert.equal(report.status,'passed');assert.equal(report.version,'1.7.2');assert.equal(report.worldScenesAdded,0);assert.equal(report.loaderLayout,'default-domain-root');
 const materialized=path.resolve(report.materializedDirectory),root=path.dirname(path.dirname(materialized));
 samePath(materialized,path.join(root,'virtual','legacy'));assert(/^run-\d+$/.test(path.basename(root)));samePath(path.dirname(root),'.local/lwjgl2172-resources');
 const rawFile=path.join(root,'report.json'),rawBytes=await bytes(rawFile);assert.deepEqual(report,JSON.parse(rawBytes),'Public and original terminal report must agree');
 assert.deepEqual(Object.keys(report.sources).sort(),[...producerSources].sort());for(const[file,hash]of Object.entries(report.sources))assert.equal(sha(await bytes(file)),hash,file);

 const sourceBytes=await bytes(report.sourceEvidence.path),source=JSON.parse(sourceBytes);assert.equal(sha(sourceBytes),report.sourceEvidence.sha256);samePath(report.sourceEvidence.path,'docs/evidence/java-1.7.2-audio-source.json');
 assert.equal(source.version,'1.7.2');assert.equal(source.integratedWorldScenesAdded,0);assert.equal(source.classes.length,53);assert.equal(source.bindings.length,76);assert(!('ResourceIndex' in source.roles));assert.deepEqual(source.officialSources,report.officialSources);
 for(const[file,hash]of Object.entries(source.auditSources))assert.equal(sha(await bytes(file)),hash,file);
 const metadataBytes=await bytes('.research/lwjgl2172-source/1.7.2/official-metadata.json'),metadata=JSON.parse(metadataBytes),official=report.officialSources;
 assert.equal(digest(metadataBytes),official.metadataSha1);assert.equal(/packages\/([a-f0-9]{40})\//.exec(official.metadataUrl)?.[1],official.metadataSha1);assert.equal(metadata.id,'1.7.2');assert.equal(metadata.type,'release');assert(!metadata.downloads.client_mappings);
 assert.equal(metadata.downloads.client.sha1,official.clientSha1);assert.equal(metadata.downloads.client.url,official.clientUrl);assert.deepEqual(metadata,await json('.research/metadata/1.7.2.json'));
 const catalog=await json('src/data/java-releases.json');assert.equal(catalog.versions.find(r=>r.id==='1.7.2')?.metadataUrl,official.metadataUrl);
 const clientFile=path.resolve('.research/clients/1.7.2.jar'),clientBytes=await bytes(clientFile);assert.equal(digest(clientBytes),official.clientSha1);assert.equal(clientBytes.length,metadata.downloads.client.size);
 const selectedDependencies=metadata.libraries.filter(allowedWindows).filter(l=>l.downloads?.artifact),archives=new Map([[clientFile,unzipSync(clientBytes)]]);
 assert.deepEqual(report.dependencies.map(d=>({name:d.name,artifact:d.artifact})),selectedDependencies.map(l=>({name:l.name,artifact:l.downloads.artifact})));
 for(const dependency of report.dependencies){samePath(dependency.file,path.join('.research/libraries',dependency.artifact.path));const data=await bytes(dependency.file);assert.equal(digest(data),dependency.artifact.sha1);assert.equal(data.length,dependency.artifact.size);assert.equal(sha(data),dependency.sha256);}
 const originalClasses=new Map();
 for(const entry of source.classes){
  const isClient=entry.artifact.sha1===metadata.downloads.client.sha1,artifact=isClient?metadata.downloads.client:selectedDependencies.find(l=>l.downloads.artifact.sha1===entry.artifact.sha1)?.downloads.artifact;assert(artifact,entry.originalName+' official archive');assert.deepEqual(entry.artifact,artifact);
  const archiveFile=isClient?clientFile:path.resolve('.research/libraries',artifact.path);if(!archives.has(archiveFile))archives.set(archiveFile,unzipSync(await bytes(archiveFile)));
  const data=archives.get(archiveFile)[entry.originalName+'.class'];assert(data);assert.equal(digest(data),entry.bytecodeSha1);assert.equal(sha(data),entry.bytecodeSha256);assert.deepEqual(methodCodeHashes(data),entry.methods);assert.deepEqual(historicalClassfile(data).fields.map(({access,name,descriptor})=>({access,name,descriptor})),entry.fields);
  assert.equal(sha(await bytes(entry.rawClass)),entry.bytecodeSha256);assert.equal(sha(await bytes(entry.rawDisassembly)),entry.rawDisassemblySha256);originalClasses.set(entry.originalName,entry);
 }
 assert.equal(originalClasses.size,53);assert.deepEqual([...originalClasses.keys()].sort(),[...new Set(Object.values(source.roles))].sort());
 for(const binding of source.bindings){assert.equal(originalClasses.get(binding.owner)?.methods[binding.member+binding.descriptor],binding.codeSha256,binding.label);}
 const bound=await bindLwjgl2172(source);assert.deepEqual(bound.bindings,source.bindings);assert.deepEqual(bound.adapterConfig,source.adapterConfig);
 assert.deepEqual(report.classIdentities,source.classes.filter(c=>c.roles.some(role=>resourceRoles.includes(role))));assert.equal(report.classIdentities.length,3);
 for(const role of resourceRoles)assert.equal(report.classIdentities.filter(c=>c.originalName===source.roles[role]&&c.roles.includes(role)).length,1);
 assert.deepEqual(report.bindings,source.bindings.filter(b=>/virtual-|default-pack/.test(b.label)));assert.deepEqual(report.bindings.map(b=>b.label),['virtual-root-recursive-walk','virtual-relative-path','virtual-file-registration','default-pack-actual-map-stream']);
 const pack=originalClasses.get(source.roles.DefaultResourcePack),location=originalClasses.get(source.roles.ResourceLocation),packText=(await bytes(pack.rawDisassembly)).toString();
 assert(pack.methods['<init>(Ljava/io/File;)V']);assert(location.methods['<init>(Ljava/lang/String;)V']);assert(originalMethodSection(packText,pack.originalName,'<init>(Ljava/io/File;)V').includes('a:(Ljava/io/File;)V'));
 const open=report.bindings.find(b=>b.label==='default-pack-actual-map-stream');assert.equal(open.descriptor,`(L${source.roles.ResourceLocation};)Ljava/io/InputStream;`);

 const{path:indexFile,sha256:indexSha,...indexIdentity}=report.index;assert.deepEqual(indexIdentity,metadata.assetIndex);samePath(indexFile,path.join(root,'official-index.json'));
 const indexBytes=await bytes(indexFile),index=JSON.parse(indexBytes);assert.equal(digest(indexBytes),metadata.assetIndex.sha1);assert.equal(indexBytes.length,metadata.assetIndex.size);assert.equal(sha(indexBytes),indexSha);assert.equal(index.virtual,true);
 assert.equal(report.expected.length,7);assert.equal(report.observations.length,7);assert.deepEqual(report.expected.map(r=>r.virtualRelativePath),resourcePaths);
 for(const [at,relative]of resourcePaths.entries()){
  const item=report.expected[at],object=index.objects[relative];assert(object,relative);assert.equal(item.logicalPath,'minecraft:'+relative);assert.equal(item.sha1,object.hash);assert.equal(item.bytes,object.size);samePath(item.file,path.join(materialized,relative));
  const data=await bytes(item.file);assert.equal(data.length,item.bytes);assert.equal(digest(data),item.sha1);assert.deepEqual(report.observations[at],{logicalPath:item.logicalPath,sha1:item.sha1,bytes:item.bytes});
 }
 assert.deepEqual(await filesIn(materialized),report.expected.map(r=>path.resolve(r.file)).sort());
 const sounds=await json(report.expected[0].file),materialInstruments=['harp','bass','basedrum','snare','hat'];assert.deepEqual(source.resources.samples.map(s=>s.instrument),materialInstruments);
 for(const sample of source.resources.samples){const item=report.expected.find(r=>r.virtualRelativePath===sample.path);assert(item);assert.equal(item.sha1,sample.sha1);assert.equal(item.bytes,sample.bytes);assert.equal(sounds[sample.event].category,'record');assert.deepEqual(sounds[sample.event].sounds,[sample.path.slice('sounds/'.length,-4)]);}
 assert.deepEqual(sounds['note.pling'].sounds,['note/pling']);assert(!source.resources.samples.some(s=>s.instrument==='pling'));

 const classes=path.join(root,'classes'),probeClass=path.join(classes,'studio/nbsx/research/Lwjgl2172ResourceProbe.class'),compiledFiles=await filesIn(classes);assert.deepEqual(compiledFiles,[path.resolve(probeClass)]);assert.deepEqual(Object.keys(report.compiledClasses).map(f=>path.resolve(f)).sort(),compiledFiles);
 const probeBytes=await bytes(probeClass);assert.equal(sha(probeBytes),report.compiledClasses[probeClass]);const helper=historicalClassfile(probeBytes);assert.equal(helper.name,'studio/nbsx/research/Lwjgl2172ResourceProbe');assert(helper.methods.some(m=>m.name==='main'&&m.descriptor==='([Ljava/lang/String;)V'));assert(!helper.utf8.some(s=>/ResourceIndex|Isolated|org\/objectweb\/asm/.test(s)));
 assert.equal(report.processes.length,2);const[compile,reads]=report.processes;assert.equal(compile.label,'compile');assert.equal(reads.label,'original-reads');assert.equal(compile.executable,'javac');assert.equal(reads.executable,'java');
 for(const record of report.processes){assert(Number.isSafeInteger(record.pid)&&record.pid>0);assert.equal(record.terminal,true);assert.equal(record.code,0);assert.equal(record.signal,null);assert.equal(record.stderr,'');assert.deepEqual(await json(path.join(root,record.label+'.json')),record);}
 assert.notEqual(compile.pid,reads.pid);assert.equal(compile.stdout,'');assert.deepEqual(compile.args,['--release','8','-d',classes,'scripts/java/Lwjgl2172ResourceProbe.java']);
 const classpath=[classes,clientFile,...report.dependencies.map(d=>d.file)].join(path.delimiter);
 assert.deepEqual(reads.args,['-Djava.awt.headless=true','-cp',classpath,'studio.nbsx.research.Lwjgl2172ResourceProbe',materialized,source.roles.DefaultResourcePack,source.roles.ResourceLocation,open.member,...resourcePaths]);
 const observations=reads.stdout.trim().split(/\r?\n/).map(line=>{const fields=line.split('\t');assert.equal(fields.length,4);assert.equal(fields[0],'RESOURCE');assert(/^[a-f0-9]{40}$/.test(fields[2]));return{logicalPath:fields[1],sha1:fields[2],bytes:Number(fields[3])};});assert.deepEqual(observations,report.observations);
 for(const file of ['scripts/review-lwjgl2172-resources.mjs','scripts/research-utils.mjs','scripts/historical-classfile.mjs','scripts/audit-early-world.mjs'])await bytes(file);
 for(const[file,hash]of snapshots)assert.equal(sha(await read(file)),hash,'Input changed during read-only review: '+file);
 return{...report,review:{resourceEvidence:{path:filename,sha256:sha(publicBytes)},rawReport:{path:rawFile,sha256:sha(rawBytes)},sourceClasses:53,sourceCodeBindings:76,resources:7,materialInstruments:5,plingMaterialInstrument:false,processesTerminal:2,compiledHelperClasses:1,worldScenesAdded:0,nativeMeasurementsAdded:0,inputSha256:Object.fromEntries([...snapshots].map(([f,h])=>[path.relative(process.cwd(),f).replaceAll('\\','/'),h]))}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const report=await reviewLwjgl2172ResourceSelection(process.argv[2]??defaultFile),{inputSha256,...summary}=report.review;console.log(JSON.stringify({status:'passed',version:report.version,...summary,inputFiles:Object.keys(inputSha256).length}));}
