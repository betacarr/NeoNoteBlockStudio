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

export async function reviewLwjgl2111ContextControl(version='1.11') {
  const found=await discoverLwjgl219(version),root=`.research/lwjgl2111-context-control/${version}`;await mkdir(root,{recursive:true});
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
  const probe='scripts/java/Lwjgl2111ContextAttributeProbe.java',compile=spawnSync('javac',['--release','8','-cp',lwjglFile,'-d',root,probe],{windowsHide:true,encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);
  const run=spawnSync('java',['-cp',[root,lwjglFile].join(path.delimiter),'studio.nbsx.research.Lwjgl2111ContextAttributeProbe'],{windowsHide:true,encoding:'utf8'});assert.equal(run.status,0,run.stderr);const attributeList=JSON.parse(run.stdout.trim());assert.deepEqual(attributeList,[4103,44100,4104,60,4105,0,0]);await writeFile(`${root}/attribute-probe-output.json`,JSON.stringify(attributeList));
  const report={schema:1,version,officialSources:{metadataUrl:found.metadataUrl,metadataSha1:found.metadataSha1,clientUrl:found.metadata.downloads.client.url,clientSha1:found.metadata.downloads.client.sha1},facts:{hrtfControl:false,hrtfControlMode:'device-default'},bindings,classes:records,allClientHrtfReferenceScan:{classes:clientClasses.length,matchingReferences:hrtfReferences},originalAttributeBuilder:{executed:true,arguments:[44100,60,0],result:attributeList,rawOutput:`${root}/attribute-probe-output.json`,sha256:digest(await readFile(`${root}/attribute-probe-output.json`),'sha256')},
    interpretation:'The original game registers the Paulscode library without a game HRTF parameter. Loader creates the original sound system; Library.init calls no-argument LWJGL AL.create. Its original wrapper opens the default device and requests only frequency44100/refresh60/sync0. No game-side HRTF option, HRTF context attribute or reset is present in this reviewed path. Any actual HRTF state is left to device/library defaults.',
    scope:{nativeDeviceOpened:false,nativeContextCreated:false,nativeBackendCapabilityMeasured:false,loopbackEquivalentMeasured:false,actualHrtfStateMeasured:false,attributeBuilderOnlyExecuted:true},
    sources:Object.fromEntries(await Promise.all(['scripts/review-lwjgl2111-context-control.mjs',probe,'scripts/audit-lwjgl219-source.mjs','scripts/review-lwjgl219-source.mjs','scripts/historical-classfile.mjs','scripts/audit-early-world.mjs','scripts/research-utils.mjs'].map(async f=>[f,digest(await readFile(f),'sha256')])))};
  const raw=`${root}/evidence.json`;await writeFile(raw,JSON.stringify(report,null,2));report.rawEvidence={path:raw,sha256:digest(await readFile(raw),'sha256')};const destination=`docs/evidence/java-${version}-hrtf-control-source.json`;await writeFile(destination,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({version,output:destination,hrtfControl:false,mode:'device-default',originalAttributes:attributeList,nativeContextOpened:false}));return report;
}
export async function verifiedLwjgl2111ContextControl(version='1.11',{read=readFile}={}){
  const file=`docs/evidence/java-${version}-hrtf-control-source.json`,bytes=await read(file),report=JSON.parse(bytes);assert.equal(report.version,version);
  for(const[file,hash]of Object.entries(report.sources))assert.equal(digest(await read(file),'sha256'),hash,file);
  assert.equal(digest(await read(report.rawEvidence.path),'sha256'),report.rawEvidence.sha256);assert.equal(digest(await read(report.originalAttributeBuilder.rawOutput),'sha256'),report.originalAttributeBuilder.sha256);
  const rawBody={...report};delete rawBody.rawEvidence;assert.deepEqual(rawBody,JSON.parse(await read(report.rawEvidence.path)),'Public context report must equal its frozen raw document');
  const methods=new Map();for(const c of report.classes){const file=c.artifact.path?path.join('.research/libraries',c.artifact.path):`.research/clients/${version}.jar`,bytes=await read(file);assert.equal(digest(bytes),c.artifact.sha1);const original=unzipSync(bytes,{filter:e=>e.name===c.originalClass+'.class'})[c.originalClass+'.class'];assert.equal(digest(original,'sha256'),c.classSha256);methods.set(c.originalClass,methodCodeHashes(original));}
  for(const b of report.bindings)assert.equal(methods.get(b.owner)[b.member+b.descriptor],b.codeSha256,b.role);
  assert.deepEqual(report.originalAttributeBuilder.result,[4103,44100,4104,60,4105,0,0]);assert.equal(report.scope.nativeContextCreated,false);
  return{version,facts:report.facts,sourceEvidence:{path:file,sha256:digest(bytes,'sha256')},bindings:report.bindings,scope:report.scope};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await reviewLwjgl2111ContextControl(process.argv.includes('--version')?process.argv[process.argv.indexOf('--version')+1]:'1.11');
