import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {unzipSync} from 'fflate';
import {digest,verifiedArtifact} from './research-utils.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';

// Original 1.19 classes and official mappings stay in ignored research storage.
const version='1.19',root=path.resolve('.research/world-119/audit');await mkdir(root,{recursive:true});
const manifestUrl='https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const manifest=await fetch(manifestUrl,{signal:AbortSignal.timeout(30000)}).then(r=>{assert(r.ok);return r.json();});
const release=manifest.versions.find(v=>v.id===version);assert.equal(release.type,'release');
const metadataFile=path.join(root,'official-metadata.json');await verifiedArtifact(release,metadataFile);
const metadataBytes=await readFile(metadataFile),metadata=JSON.parse(metadataBytes);
assert.deepEqual(metadata,JSON.parse(await readFile(`.research/metadata/${version}.json`,'utf8')));
const clientFile=path.resolve(`.research/clients/${version}.jar`),client=await readFile(clientFile);assert.equal(digest(client),metadata.downloads.client.sha1);
const mappingsBytes=await readFile(`.research/source-comparison/${version}/mappings.txt`);assert.equal(digest(mappingsBytes),metadata.downloads.client_mappings.sha1);
const mappings=mappingsBytes.toString(),block=name=>mappings.slice(mappings.indexOf(name+' -> ')).split(/\n(?=\S[^\n]* -> )/)[0];
const original=name=>block(name).split('\n')[0].split(' -> ')[1].slice(0,-1);
const member=(owner,signature)=>{const line=block(owner).split('\n').find(line=>line.includes(signature+' -> '));assert(line,signature);return line.split(' -> ')[1];};
const entries=unzipSync(client),classes=[],methods=[],raw={};
const names=['com.mojang.blaze3d.audio.Library','net.minecraft.client.Options','net.minecraft.client.sounds.SoundEngine'];
for(const name of names){
  const obfuscated=original(name),bytes=entries[obfuscated+'.class'];assert(bytes);
  const dis=spawnSync('javap',['-p','-s','-c','-classpath',clientFile,obfuscated],{windowsHide:true,encoding:'utf8',maxBuffer:8e6});assert.equal(dis.status,0,dis.stderr);
  const rawClass=path.join(root,obfuscated+'.class'),rawDisassembly=path.join(root,obfuscated+'.javap.txt');await writeFile(rawClass,bytes);await writeFile(rawDisassembly,dis.stdout);
  classes.push({name,originalName:obfuscated,bytecodeSha256:digest(bytes,'sha256'),rawClass:path.relative(process.cwd(),rawClass).replaceAll('\\','/'),rawDisassembly:path.relative(process.cwd(),rawDisassembly).replaceAll('\\','/'),disassemblySha256:digest(Buffer.from(dis.stdout),'sha256')});raw[name]={text:dis.stdout,hashes:methodCodeHashes(bytes)};
}
const library=names[0],options=names[1],engine=names[2];
const bindings=[
 [library,'void init(java.lang.String,boolean)','(Ljava/lang/String;Z)V','Checks ALC_SOFT_HRTF and requested true before enableHrtf; creates original context with null attributes. False has no reset call.'],
 [library,'void enableHrtf()','()V','Enumerates HRTF count; only when positive resets with ALC_HRTF_SOFT=1 and ALC_HRTF_ID_SOFT=0.'],
 [library,'long openDeviceOrFallback(java.lang.String)','(Ljava/lang/String;)J','Original requested/default device with original fallback, not loopback.'],
 [library,'java.lang.String getCurrentDeviceName()','()Ljava/lang/String;','Original actual device-name lookup.'],
 [options,'void <init>(net.minecraft.client.Minecraft,java.io.File)',`(L${original('net.minecraft.client.Minecraft')};Ljava/io/File;)V`,'directionalAudio boolean option defaults false; callback reloads original SoundManager.'],
 [options,'net.minecraft.client.OptionInstance directionalAudio()',`()L${original('net.minecraft.client.OptionInstance')};`,'Getter for original boolean option.'],
 [options,'void processOptions(net.minecraft.client.Options$FieldAccess)',`(L${original('net.minecraft.client.Options$FieldAccess')};)V`,'Serializes directionalAudio through original Options codec.'],
 [engine,'void loadLibrary()','()V','Passes actual original Options directionalAudio into Library; listener receives master volume.'],
];
for(const [owner,signature,descriptor,evidence] of bindings){const method=member(owner,signature),codeSha256=raw[owner].hashes[method+descriptor];assert(codeSha256,`${owner}.${method}${descriptor}`);methods.push({owner,originalOwner:original(owner),method,descriptor,officialSignature:signature,codeSha256,evidence});}
for(const token of ['ALC10.alcCreateContext','aconst_null','SOFTHRTF.alcResetDeviceSOFT','6546','6550'])assert(raw[library].text.includes(token),token);
assert(raw[options].text.includes('String directionalAudio'));assert(raw[options].text.includes('String options.directionalAudio'));
const fixture=JSON.parse(await readFile('.local/game-fixtures/1.19/fixture.json','utf8'));
const artifacts=metadata.libraries.flatMap(v=>[v.downloads?.artifact,...Object.values(v.downloads?.classifiers??{})]).filter(Boolean);
const native=await readFile(path.join(fixture.nativeDir,'OpenAL.dll'));let nativeLibrary;
for(const artifact of artifacts.filter(v=>/lwjgl-openal.*natives-windows/.test(v.path))){let bytes;try{bytes=await readFile(path.join(fixture.root,'libraries',artifact.path));}catch(e){if(e.code==='ENOENT')continue;throw e;}assert.equal(digest(bytes),artifact.sha1);const archive=unzipSync(bytes);const found=Object.entries(archive).find(([name,value])=>path.basename(name).toLowerCase()==='openal.dll'&&digest(value,'sha256')===digest(native,'sha256'));if(found)nativeLibrary={sha256:digest(native,'sha256'),artifact:artifact.path,artifactSha1:artifact.sha1,artifactUrl:artifact.url};}
assert(nativeLibrary,'Original DLL was not found in official native archives');
const source={schema:1,version,officialSources:{manifestUrl,metadataUrl:release.url,metadataSha1:release.sha1,clientUrl:metadata.downloads.client.url,clientSha1:metadata.downloads.client.sha1,mappingsUrl:metadata.downloads.client_mappings.url,mappingsSha1:digest(mappingsBytes)},classes,methods,nativeLibrary,
 facts:{hrtfControl:true,hrtfControlMode:'enable-only-reset',gameOptionDefault:false,hrtfProfilePolicy:'first-enumerated-profile',requestedProfileIndex:0,offAction:'no-reset',onAction:'reset-if-extension-and-profile-available',originalContextAttributes:null,outputLimiter:'device-default',masterVolumePlacement:'listener'},
 findings:{off:'An off game option leaves the original regular-device backend default unchanged. It is not an explicit HRTF-disable request.',on:'The original reset requests HRTF enabled and profile index 0 before creating a null-attribute context. Backend configuration can determine the effective status.',loopback:'OpenAL Soft 1.21.1 loopback does not use regular playback-device HRTF defaults. Its required format attributes can clear a preceding reset request. Research adapter records original reset and explicitly replays the observed enable/profile request at loopback context creation; false never injects an off attribute.'},
 scopeLimitations:['Focused review of original Library/Options/SoundEngine HRTF initialization only; not a full engine audit.','Source analysis is separate from the actual original-Library no-sound probes and integrated-world PCM recordings.','Profile index 0 is the game request; actual selected profile and status must be measured rather than inferred from the request.']};
const properties=text=>Object.fromEntries(text.split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1).replace(/\\([:=\\])/g,'$1')];}));
const specs=[['normal',false,'1792784815308'],['normal',true,'1792784822778'],['headphones-auto',false,'1792784828754'],['headphones-auto',true,'1792784834721'],['forced-hrtf-on',false,'1792784840739'],['forced-hrtf-on',true,'1792784858452']];
const probes=[];
for(const [configuration,requested,id] of specs){const directory=`.local/game-world-119/1.19/capture-${id}`,bytes=await readFile(directory+'/context-probe.properties'),record=properties(bytes.toString()),run=JSON.parse(await readFile(directory+'/provenance.json','utf8'));
 assert.equal(run.exit,0);assert.equal(record.gameHrtfRequested,String(requested));assert.equal(record.originalResetCalls,requested?'1':'0');assert.equal(record.originalContextAttributes,'{}');assert.equal(record.captureContextAttributes,'{}');assert.equal(record.deviceKind,'original-regular-device-no-audio-played');assert.equal(record.backend,'1.1 ALSOFT 1.21.1');assert.equal(record.hrtfEnabled,configuration==='normal'&&!requested?'0':'1');if(requested)assert.equal(record.originalResetAttributes,'{6546=1, 6550=0}');
 probes.push({configuration,gameOption:requested,rawEvidence:directory+'/context-probe.properties',rawEvidenceSha256:digest(bytes,'sha256'),clientSha1:run.clientSha1,agentSha256:run.agentSha256,agentSourceSha256:run.agentSourceSha256,actualDeviceName:record.actualDeviceName,contextSampleRate:Number(record.contextSampleRate),originalContextAttributes:null,resetCalls:Number(record.originalResetCalls),originalResetAttributes:requested?{6546:1,6550:0}:null,resetResult:requested?record.originalResetResult==='true':null,backend:record.backend,hrtfEnabled:record.hrtfEnabled==='1',hrtfStatus:Number(record.hrtfStatus),profileIndex0:record['hrtfProfile.0'],selectedProfile:record.selectedHrtfProfile??null,outputLimiter:Number(record.outputLimiter),sourcesPlayed:0});
}
const report={schema:1,version,method:'Invoke unmodified original Library initializer and cleanup; instrument only to observe original calls and forward the exact original device/context/reset arguments. No source is created or played.',nativeLibrary,probes,conclusion:'False is device-default, not force-off. All six conditions share the original null context. Enabled/profile state can be transferred to a loopback context for deterministic comparison, but playback-device reason/status is retained separately from loopback status.',limitations:['One Windows x64 physical output device with original OpenAL Soft 1.21.1; headphones-auto and forced-on are isolated ALSOFT_CONF fixtures.','Does not measure acoustic hardware output or claim cross-device equality.','These six no-sound component probes are not counted as integrated-world scenes.']};
await mkdir('docs/evidence',{recursive:true});await writeFile('docs/evidence/java-1.19-audio-source.json',JSON.stringify(source,null,2));await writeFile('docs/evidence/java-1.19-hrtf-context-probes.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({classes:classes.length,methods:methods.length,probes:probes.length,nativeLibrary}));
