import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { discoverLwjgl219 } from './audit-lwjgl219-source.mjs';
import { originalSection } from './review-lwjgl219-source.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';
import { digest, verifiedArtifact } from './research-utils.mjs';

export async function reviewLwjgl212ContextControl(version='1.12') {
  assert(['1.12','1.12.1'].includes(version),'Select an independently reviewed 1.12 release');
  const found=await discoverLwjgl219(version),root=`.research/lwjgl212-context-control/${version}`;await mkdir(root,{recursive:true});
  const lwjglArtifact=found.metadata.libraries.find(item=>item.name.startsWith('org.lwjgl.lwjgl:lwjgl:')).downloads.artifact;
  const lwjglFile=path.join('.research/libraries',lwjglArtifact.path);await verifiedArtifact(lwjglArtifact,lwjglFile);const lwjgl=unzipSync(await readFile(lwjglFile));
  const libArtifact=found.metadata.libraries.find(item=>item.name.startsWith('com.paulscode:librarylwjglopenal:')).downloads.artifact;
  const libFile=path.join('.research/libraries',libArtifact.path);await verifiedArtifact(libArtifact,libFile);const library=unzipSync(await readFile(libFile));
  const loader=[...found.classes.values()].filter(c=>c.name.startsWith(found.roles.SoundEngine+'$')&&c.interfaces.includes('java/lang/Runnable'));assert.equal(loader.length,1);
  const definitions=[
    ['Engine',found.roles.SoundEngine,found.classes.get(found.roles.SoundEngine).bytes,found.client,found.metadata.downloads.client],
    ['Options',found.roles.Options,found.classes.get(found.roles.Options).bytes,found.client,found.metadata.downloads.client],
    ['Loader',loader[0].name,loader[0].bytes,found.client,found.metadata.downloads.client],
    ['Library','paulscode/sound/libraries/LibraryLWJGLOpenAL',library['paulscode/sound/libraries/LibraryLWJGLOpenAL.class'],libFile,libArtifact],
    ['AL','org/lwjgl/openal/AL',lwjgl['org/lwjgl/openal/AL.class'],lwjglFile,lwjglArtifact],
    ['ALCcontext','org/lwjgl/openal/ALCcontext',lwjgl['org/lwjgl/openal/ALCcontext.class'],lwjglFile,lwjglArtifact],
  ];
  const records=[],texts={};
  for(const [role,name,bytes,archive,artifact] of definitions){assert(bytes);const file=`${root}/${name.replaceAll('/','_')}.javap.txt`,r=spawnSync('javap',['-p','-s','-c','-classpath',archive,name.replaceAll('/','.')],{windowsHide:true,encoding:'utf8',maxBuffer:8e6});assert.equal(r.status,0,r.stderr);await writeFile(file,r.stdout);texts[role]=r.stdout;records.push({role,originalClass:name,classSha256:digest(bytes,'sha256'),artifact,methods:methodCodeHashes(bytes),rawDisassembly:file,disassemblySha256:digest(Buffer.from(r.stdout),'sha256')});}
  const bindings=[];const add=(role,key,tokens)=>{const c=records.find(c=>c.role===role),t=originalSection(texts[role],c.originalClass,key);assert(c.methods[key]);for(const token of tokens)assert(t.includes(token),role+' '+token);const at=key.indexOf('(');bindings.push({role,owner:c.originalClass,member:key.slice(0,at),descriptor:key.slice(at),codeSha256:c.methods[key],semanticInstructionChecks:tokens});return t;};
  const engine=records.find(c=>c.role==='Engine'),ctor=Object.keys(engine.methods).find(key=>key.startsWith('<init>('));add('Engine',ctor,['class paulscode/sound/libraries/LibraryLWJGLOpenAL','SoundSystemConfig.addLibrary:','SoundSystemConfig.setCodec:']);
  const load=add('Loader','run()V',['setMasterVolume:(F)V']);assert(!/HRTF|alcResetDevice|alcCreateContext/i.test(load));
  add('Library','init()V',['org/lwjgl/openal/AL.create:()V']);
  add('AL','create()V',['aconst_null','int 44100','bipush        60','iconst_0','create:(Ljava/lang/String;IIZ)V']);
  add('AL','create(Ljava/lang/String;IIZ)V',['iconst_1','create:(Ljava/lang/String;IIZZ)V']);
  add('AL','create(Ljava/lang/String;IIZZ)V',['init:(Ljava/lang/String;IIZZ)V']);
  add('AL','init(Ljava/lang/String;IIZZ)V',['ALC10.alcOpenDevice:','ALCcontext.createAttributeList:(III)Ljava/nio/IntBuffer;','ALC10.alcCreateContext:']);
  const attrs=add('ALCcontext','createAttributeList(III)Ljava/nio/IntBuffer;',['bipush        7','sipush        4103','sipush        4104','sipush        4105','iconst_0']);assert(!attrs.includes('6550'));assert(!attrs.includes('6554'));
  const clientClasses=[...found.classes.values()].filter(c=>c.archive.filename===found.client),hrtfReferences=clientClasses.flatMap(c=>c.utf8.filter(s=>/HRTF|alcResetDeviceSOFT|ALC_SOFT_HRTF/i.test(s)).map(value=>({owner:c.name,value})));assert.deepEqual(hrtfReferences,[],'Unexpected original client HRTF reference');
  assert(!/hrtf/i.test(texts.Options));
  const probe='scripts/java/Lwjgl212ContextAttributeProbe.java',compile=spawnSync('javac',['--release','8','-cp',lwjglFile,'-d',root,probe],{windowsHide:true,encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);
  const run=spawnSync('java',['-cp',[root,lwjglFile].join(path.delimiter),'studio.nbsx.research.Lwjgl212ContextAttributeProbe'],{windowsHide:true,encoding:'utf8'});assert.equal(run.status,0,run.stderr);const attributeList=JSON.parse(run.stdout.trim());assert.deepEqual(attributeList,[4103,44100,4104,60,4105,0,0]);await writeFile(`${root}/attribute-probe-output.json`,JSON.stringify(attributeList));
  const dependencies=[];
  for(const item of found.metadata.libraries.filter(l=>/^com\.paulscode:|^org\.lwjgl\.lwjgl:/.test(l.name))){let allowed=!item.rules;for(const rule of item.rules??[])if(!rule.os||rule.os.name==='windows')allowed=rule.action==='allow';if(!allowed)continue;
    for(const artifact of [item.downloads?.artifact,item.downloads?.classifiers?.['natives-windows']].filter(Boolean)){
      const file=path.join('.research/libraries',artifact.path);await verifiedArtifact(artifact,file);const bytes=await readFile(file);
      const entry={name:item.name,artifact,path:file,sha256:digest(bytes,'sha256')};
      if(artifact.path.endsWith('-natives-windows.jar'))entry.nativeEntries=Object.entries(unzipSync(bytes,{filter:e=>/\.dll$/i.test(e.name)})).map(([name,bytes])=>({name,size:bytes.length,sha1:digest(bytes),sha256:digest(bytes,'sha256')}));
      dependencies.push(entry);
    }
  }
  const report={schema:1,version,officialSources:{metadataUrl:found.metadataUrl,metadataSha1:found.metadataSha1,clientUrl:found.metadata.downloads.client.url,clientSha1:found.metadata.downloads.client.sha1},facts:{hrtfControl:false,hrtfControlMode:'device-default'},bindings,classes:records,allClientHrtfReferenceScan:{classes:clientClasses.length,matchingReferences:hrtfReferences},originalAttributeBuilder:{executed:true,arguments:[44100,60,0],result:attributeList,rawOutput:`${root}/attribute-probe-output.json`,sha256:digest(await readFile(`${root}/attribute-probe-output.json`),'sha256')},
    interpretation:'The original game registers the Paulscode library without a game HRTF parameter. Loader creates the original sound system; Library.init calls no-argument LWJGL AL.create. Its original wrapper opens the default device and requests only frequency44100/refresh60/sync0. No game-side HRTF option, HRTF context attribute or reset is present in this reviewed path. Any actual HRTF state is left to device/library defaults.',
    scope:{nativeDeviceOpened:false,nativeContextCreated:false,nativeBackendCapabilityMeasured:false,loopbackEquivalentMeasured:false,actualHrtfStateMeasured:false,attributeBuilderOnlyExecuted:true},
    dependencies,componentProcesses:[{program:'javac',pid:compile.pid,exitCode:compile.status,signal:compile.signal},{program:'java',pid:run.pid,exitCode:run.status,signal:run.signal}],
    sources:Object.fromEntries(await Promise.all(['scripts/review-lwjgl212-context-control.mjs',probe,'scripts/audit-lwjgl219-source.mjs','scripts/review-lwjgl219-source.mjs','scripts/historical-classfile.mjs','scripts/audit-early-world.mjs','scripts/research-utils.mjs'].map(async f=>[f,digest(await readFile(f),'sha256')])))};
  const raw=`${root}/evidence.json`;await writeFile(raw,JSON.stringify(report,null,2));report.rawEvidence={path:raw,sha256:digest(await readFile(raw),'sha256')};const destination=`docs/evidence/java-${version}-hrtf-control-source.json`;await writeFile(destination,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({version,output:destination,hrtfControl:false,mode:'device-default',originalAttributes:attributeList,nativeContextOpened:false}));return report;
}
export async function verifiedLwjgl212ContextControl(version='1.12',{evidenceFile=`docs/evidence/java-${version}-hrtf-control-source.json`}={}){
  assert(['1.12','1.12.1'].includes(version));const file=evidenceFile,bytes=await readFile(file),report=JSON.parse(bytes);assert.equal(report.version,version);assert.deepEqual(report.facts,{hrtfControl:false,hrtfControlMode:'device-default'});assert.deepEqual(report.originalAttributeBuilder.result,[4103,44100,4104,60,4105,0,0]);assert.equal(report.scope.nativeContextCreated,false);assert.equal(report.scope.actualHrtfStateMeasured,false);assert.equal(report.bindings.length,8);assert.equal(report.classes.length,6);assert(report.componentProcesses.every(p=>p.exitCode===0&&p.signal===null));
  for(const[file,hash]of Object.entries(report.sources))assert.equal(digest(await readFile(file),'sha256'),hash,file);
  const raw=await readFile(report.rawEvidence.path);assert.equal(digest(raw,'sha256'),report.rawEvidence.sha256);const {rawEvidence,...rawExpected}=report;assert.deepEqual(JSON.parse(raw),rawExpected);assert.equal(digest(await readFile(report.originalAttributeBuilder.rawOutput),'sha256'),report.originalAttributeBuilder.sha256);
  const metadata=JSON.parse(await readFile(`.research/lwjgl219-source/${version}/official-metadata.json`));assert.equal(digest(await readFile(`.research/lwjgl219-source/${version}/official-metadata.json`)),report.officialSources.metadataSha1);assert.equal(metadata.id,version);assert.equal(metadata.downloads.client.sha1,report.officialSources.clientSha1);
  const methods=new Map();for(const c of report.classes){const file=c.artifact.path?path.join('.research/libraries',c.artifact.path):`.research/clients/${version}.jar`,bytes=await readFile(file);assert.equal(digest(bytes),c.artifact.sha1);const original=unzipSync(bytes,{filter:e=>e.name===c.originalClass+'.class'})[c.originalClass+'.class'];assert.equal(digest(original,'sha256'),c.classSha256);assert.deepEqual(methodCodeHashes(original),c.methods);assert.equal(digest(await readFile(c.rawDisassembly),'sha256'),c.disassemblySha256);methods.set(c.originalClass,methodCodeHashes(original));}
  for(const b of report.bindings)assert.equal(methods.get(b.owner)[b.member+b.descriptor],b.codeSha256,b.role);
  const expected=[];for(const item of metadata.libraries.filter(l=>/^com\.paulscode:|^org\.lwjgl\.lwjgl:/.test(l.name))){let allowed=!item.rules;for(const rule of item.rules??[])if(!rule.os||rule.os.name==='windows')allowed=rule.action==='allow';if(allowed)for(const artifact of [item.downloads?.artifact,item.downloads?.classifiers?.['natives-windows']].filter(Boolean))expected.push(artifact);}
  assert.deepEqual(report.dependencies.map(d=>d.artifact),expected);
  for(const d of report.dependencies){const bytes=await readFile(d.path);assert.equal(digest(bytes),d.artifact.sha1);assert.equal(digest(bytes,'sha256'),d.sha256);if(d.nativeEntries)assert.deepEqual(Object.entries(unzipSync(bytes,{filter:e=>/\.dll$/i.test(e.name)})).map(([name,bytes])=>({name,size:bytes.length,sha1:digest(bytes),sha256:digest(bytes,'sha256')})),d.nativeEntries);}
  assert.deepEqual(report.originalAttributeBuilder.result,[4103,44100,4104,60,4105,0,0]);assert.equal(report.scope.nativeContextCreated,false);
  return{version,facts:report.facts,sourceEvidence:{path:file,sha256:digest(bytes,'sha256')},bindings:report.bindings,scope:report.scope};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await reviewLwjgl212ContextControl(process.argv.includes('--version')?process.argv[process.argv.indexOf('--version')+1]:'1.12');
