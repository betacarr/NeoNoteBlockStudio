import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {historicalClassfile} from './historical-classfile.mjs';

export const versions=['1.5.1','1.5.2','1.6.1','1.6.2','1.6.4'];
export const reportFile='docs/evidence/java-1.5-1.6-source-volume.json';
export const sources=['scripts/audit-lwjgl21516-source-volume.mjs','scripts/lwjgl21516-volume-common.mjs','scripts/review-lwjgl21516-source-volume.mjs','scripts/java/Lwjgl21516SourceVolumeProbe.java','scripts/historical-classfile.mjs','node_modules/fflate/package.json','node_modules/fflate/esm/index.mjs'];
export const hash=(b,algorithm='sha256')=>createHash(algorithm).update(b).digest('hex');
export const ref=async(file,read=readFile)=>({path:file.replaceAll('\\','/'),sha256:hash(await read(file))});
export const fbits=n=>{const b=Buffer.alloc(4);b.writeFloatLE(n);return b.readUInt32LE().toString(16).padStart(8,'0');};
const fromBits=h=>{const b=Buffer.alloc(4);b.writeUInt32LE(parseInt(h,16));return b.readFloatLE();};
export const unit=n=>n<0?0:n>1?1:n;
export function inputs(){
 const volumeBits=['ff7fffff','c0000000','bf800000','80800000','80000001','80000000','00000000','00000001','00800000',fbits(.001),fbits(.25),fbits(.5),fbits(.999),'3f7fffff','3f800000','3f800001',fbits(1.5),'3fffffff','40000000','40000001',fbits(3),'7f7fffff'];
 const masterBits=['00000000','00000001',fbits(.1),fbits(.5),fbits(.7),'3f7fffff','3f800000','3f800001',fbits(1.5),'3fffffff','40000000'];
 const direct=volumeBits.map((inputBits,i)=>({id:`direct-${i}`,kind:'direct',inputBits}));
 const pipeline=volumeBits.flatMap((rawBits,i)=>masterBits.map((masterBits,j)=>({id:`pipeline-${i}-${j}`,kind:'pipeline',rawBits,masterBits,inputBits:fbits(Math.fround(unit(fromBits(rawBits))*fromBits(masterBits)))})));
 return{direct,pipeline,rows:[...direct,...pipeline],sourceVolumeBits:volumeBits,masterGainBits:masterBits};
}
export const inputTsv=()=>inputs().rows.map(r=>r.id+'\t'+r.inputBits).join('\n')+'\n';
export function section(text,owner,key){
 const p=key.indexOf('('),name=key.slice(0,p),descriptor=key.slice(p),lines=text.split(/\r?\n/),label=(name==='<init>'?owner.split('/').at(-1):name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const begin=lines.findIndex((line,i)=>line.trim()===`descriptor: ${descriptor}`&&(name==='<clinit>'?/static \{\};/.test(lines[i-1]):new RegExp(`\\b${label}\\(`).test(lines[i-1])));assert(begin>=0,owner+'.'+key);
 let end=begin+1;while(end<lines.length&&!/^  (?:public|private|protected|static|synchronized)/.test(lines[end])&&lines[end]!=='}')end++;
 return lines.slice(begin-1,end).join('\n');
}
export const codeMap=bytes=>Object.fromEntries(historicalClassfile(bytes).methods.flatMap(m=>m.attributes.filter(a=>a.name==='Code').map(a=>[m.name+m.descriptor,hash(a.value.subarray(8,8+a.value.readUInt32BE(4)))])));
export async function originalInventory(version,{read=readFile}={}){
 assert(versions.includes(version));const sourceFile=`docs/evidence/java-${version}-audio-source.json`,sourceBytes=await read(sourceFile),prior=JSON.parse(sourceBytes);
 const catalog=JSON.parse(await read('src/data/java-releases.json')),release=catalog.versions.find(v=>v.id===version);assert(release);assert.equal(release.type,'release');
 const metadataFile=`.research/lwjgl21${version.startsWith('1.5')?'5':'6'}-source/${version}/official-metadata.json`,metadataBytes=await read(metadataFile),metadata=JSON.parse(metadataBytes);
 const metadataSha1=/packages\/([a-f0-9]{40})\//.exec(release.metadataUrl)[1];assert.equal(hash(metadataBytes,'sha1'),metadataSha1);assert.equal(metadata.id,version);assert.equal(metadata.type,'release');assert(!metadata.downloads.client_mappings);
 const clientFile=`.research/clients/${version}.jar`,clientBytes=await read(clientFile);assert.equal(hash(clientBytes,'sha1'),metadata.downloads.client.sha1);assert.equal(clientBytes.length,metadata.downloads.client.size);
 const artifacts=[{file:clientFile,artifact:metadata.downloads.client}];
 if(!version.startsWith('1.5')){const library=metadata.libraries.filter(l=>l.name==='com.paulscode:soundsystem:20120107');assert.equal(library.length,1);artifacts.push({file:path.join('.research/libraries',library[0].downloads.artifact.path).replaceAll('\\','/'),artifact:library[0].downloads.artifact});}
 const archives=[];for(const a of artifacts){const bytes=await read(a.file);assert.equal(hash(bytes,'sha1'),a.artifact.sha1);assert.equal(bytes.length,a.artifact.size);archives.push({...a,sha256:hash(bytes),files:unzipSync(bytes)});}
 const roles={SoundManager:prior.roles.SoundManager,Library:'paulscode/sound/Library',Source:'paulscode/sound/Source',SoundSystem:'paulscode/sound/SoundSystem',CommandObject:'paulscode/sound/CommandObject',SoundSystemConfig:'paulscode/sound/SoundSystemConfig'};
 const classes=Object.entries(roles).map(([role,name])=>{const found=archives.filter(a=>a.files[name+'.class']);assert.equal(found.length,1,version+' '+role);const a=found[0],bytes=a.files[name+'.class'],c=historicalClassfile(bytes);assert.equal(c.name,name);const old=prior.classes.find(c=>c.originalName===name);if(old){assert.equal(hash(bytes),old.bytecodeSha256??old.classSha256);assert.deepEqual(codeMap(bytes),old.methods);}return{role,name,archive:a.file,artifact:a.artifact,classSha256:hash(bytes),fields:c.fields.map(({name,descriptor,access})=>({name,descriptor,access})),code:codeMap(bytes)};});
 return{version,sourceSnapshot:{path:sourceFile,sha256:hash(sourceBytes)},official:{metadataUrl:release.metadataUrl,metadataSha1,metadataFile,client:{...metadata.downloads.client,file:clientFile,sha256:hash(clientBytes)}},artifacts:archives.map(({files,...a})=>a),roles,classes};
}
const specs=[
 ['library-source-clamp','Library','setVolume(Ljava/lang/String;F)V',['midiSourcename:','HashMap.get:','fconst_0','fcmpg','fconst_1','fcmpl','putfield','Source.sourceVolume:F','Source.positionChanged:()V']],
 ['null-midi-bypass','Library','midiSourcename(Ljava/lang/String;)Z',['Field midiChannel:','ifnull','ireturn']],
 ['base-position-changed-no-op','Source','positionChanged()V',['0: return']],
 ['public-set-volume-enqueues14','SoundSystem','setVolume(Ljava/lang/String;F)V',['bipush        14','CommandObject."<init>":(ILjava/lang/String;F)V','CommandQueue:','CommandThread.interrupt:']],
 ['command14-forwards-unmodified-float','SoundSystem','CommandSetVolume(Ljava/lang/String;F)V',['Field soundLibrary:','fload_2','Library.setVolume:(Ljava/lang/String;F)V']],
 ['original-queue-drain-dispatch','SoundSystem','CommandQueue(Lpaulscode/sound/CommandObject;)Z',['tableswitch','14:','Field paulscode/sound/CommandObject.floatArgs:[F','faload','CommandSetVolume:','List.add:']],
 ['original-command-float-storage','CommandObject','<init>(ILjava/lang/String;F)V',['Field Command:I','Field stringArgs:[Ljava/lang/String;','Field floatArgs:[F','fastore']],
 ['default-master-is-one','SoundSystemConfig','<clinit>()V',['fconst_1','Field masterGain:F']],
 ['read-default-master','SoundSystemConfig','getMasterGain()F',['getstatic','Field masterGain:F','freturn']],
 ['base-default-master-storage','SoundSystemConfig','setMasterGain(F)V',['putstatic','Field masterGain:F','return']],
 ['manager-pre-global-clamp','SoundManager','a(Ljava/lang/String;FFFFF)V',['fconst_1','fmul','SoundSystem.setVolume:(Ljava/lang/String;F)V']],
];
export function bindings(inventory,texts){return specs.map(([label,role,key,tokens])=>{const c=inventory.classes.find(c=>c.role===role);assert(c.code[key],label);const text=section(texts[c.name],c.name,key);for(const token of tokens)assert(text.includes(token),inventory.version+' '+label+' '+token);if(role==='Source')assert.deepEqual([...text.matchAll(/^\s+(\d+): (\S+)/gm)].map(m=>[m[1],m[2]]),[['0','return']]);return{label,role,owner:c.name,key,codeSha256:c.code[key],tokens};});}
export function verifyOutput(stdout){const rows=stdout.trim().split(/\r?\n/).filter(l=>l.startsWith('ROW\t')).map(l=>l.split('\t').slice(1)),expected=inputs();assert.equal(rows.length,expected.rows.length);for(const[i,row]of rows.entries()){const input=expected.rows[i],want=fbits(unit(fromBits(input.inputBits)));assert.deepEqual(row,[input.id,input.inputBits,want,want,want],'original Library/CommandSetVolume/CommandQueue row '+i);}
 assert(stdout.includes(`SUMMARY\t${expected.rows.length}\t3f800000`));assert(stdout.includes('BOUNDARY\tbase-classes-only\tno-constructors-no-thread-no-device-no-worker'));
 const counterexample=expected.pipeline.find(x=>x.rawBits==='3f800000'&&x.masterBits==='40000000');const i=expected.rows.indexOf(counterexample);assert.deepEqual(rows[i].slice(1),['40000000','3f800000','3f800000','3f800000']);
 return{directInputs:expected.direct.length,pipelineInputs:expected.pipeline.length,routes:3,bitComparisons:rows.length*3,rows:rows.length,defaultMasterBits:'3f800000',negativeZeroPreserved:true,missingSourceUnaffected:true,counterexample:{rawVolume:1,masterGain:2,managerSinkBits:'40000000',finalSourceBits:'3f800000'},finiteScope:true};}
export const scope={originalBaseClassesExecuted:true,openAlSubclassInstantiated:false,originalAudioConstructorsInvoked:false,commandThreadCreated:false,commandThreadStarted:false,deviceOpened:false,audioWorkerForked:false,gameWorldStarted:false,worldScenesAdded:0,nativeMeasurementsAdded:0,pcmEquivalenceClaimed:false};
