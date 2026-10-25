import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {discoverLwjgl219} from './audit-lwjgl219-source.mjs';
import {originalSection} from './review-lwjgl219-source.mjs';
import {reviewLwjgl219ContextControl,verifiedLwjgl219ContextControl} from './review-lwjgl219-context-control.mjs';
import {methodCodeHashes} from './audit-early-world.mjs';
import {digest,verifiedArtifact} from './research-utils.mjs';

export const patchVersions=['1.10','1.10.1','1.10.2'];
const parse=async file=>JSON.parse(await readFile(file));
const sources=['scripts/review-lwjgl2110-source.mjs','scripts/audit-lwjgl2110-chains.mjs','scripts/audit-lwjgl219-source.mjs','scripts/review-lwjgl219-source.mjs','scripts/review-lwjgl219-context-control.mjs','scripts/historical-classfile.mjs','scripts/audit-early-world.mjs','scripts/research-utils.mjs'];
const hashSources=async()=>Object.fromEntries(await Promise.all(sources.map(async file=>[file,digest(await readFile(file),'sha256')])));

async function verifyClasses(version,classes){
 const archives=new Map(),methods=new Map();
 for(const c of classes){const filename=c.artifact.path?path.join('.research/libraries',c.artifact.path):`.research/clients/${version}.jar`;
  if(!archives.has(filename)){const bytes=await readFile(filename);assert.equal(digest(bytes),c.artifact.sha1,filename);archives.set(filename,unzipSync(bytes));}
  const bytes=archives.get(filename)[c.originalClass+'.class'];assert(bytes,c.originalClass);assert.equal(digest(bytes,'sha256'),c.classSha256,c.originalClass);assert.deepEqual(methodCodeHashes(bytes),c.methods,c.originalClass);
  assert.equal(digest(await readFile(c.rawDisassembly),'sha256'),c.disassemblySha256,c.rawDisassembly);methods.set(c.originalClass,c.methods);
 }return methods;
}

export async function reviewLwjgl2110Complete(versions=patchVersions){
 const reports=[];
 for(const version of versions){
  assert(patchVersions.includes(version));const found=await discoverLwjgl219(version),baseFile=`.research/lwjgl2110-chains/${version}/evidence.json`,base=await parse(baseFile);assert.equal(base.version,version);assert.equal(base.officialSources.clientSha1,found.metadata.downloads.client.sha1);
  const originalMethods=await verifyClasses(version,base.classes);for(const b of base.bindings)assert.equal(originalMethods.get(b.owner)[b.member+b.descriptor],b.codeSha256,b.label);
  const root=`.research/lwjgl2110-source/${version}`;await mkdir(root,{recursive:true});const cs=found.classes,r={...base.roles},classes=base.classes.map(c=>({...c})),bindings=base.bindings.map(b=>({...b})),texts=new Map();for(const c of classes)texts.set(c.originalClass,await readFile(c.rawDisassembly,'utf8'));
  const one=(label,list)=>{assert.equal(list.length,1,`${version} ${label}: ${list.map(x=>x.name)}`);return list[0];};
  r.Blocks=one('Blocks',[...cs.values()].filter(c=>c.strings.includes('Accessed Blocks before Bootstrap!'))).name;
  r.Bootstrap=one('Bootstrap',cs.get(r.Blocks).refs.filter(ref=>ref.kind==='method'&&ref.descriptor==='()Z').map(ref=>cs.get(ref.owner))).name;
  r.Material=one('Material',cs.get(r.TileEntityNote).refs.filter(ref=>ref.kind==='field'&&ref.descriptor==='L'+ref.owner+';'&&ref.owner!==r.TileEntityNote).map(ref=>cs.get(ref.owner)).filter((v,i,a)=>a.findIndex(x=>x.name===v.name)===i)).name;
  r.SoundSerializer=one('SoundSerializer',[...cs.values()].filter(c=>['volume','pitch','weight','stream'].every(s=>c.strings.includes(s)))).name;
  r.SoundAccessor=one('SoundAccessor',cs.get(r.AbstractSound).fields.filter(f=>f.descriptor.startsWith('L')&&![r.SoundDefinition,r.Category,r.ResourceLocation].includes(f.descriptor.slice(1,-1))).map(f=>cs.get(f.descriptor.slice(1,-1))).filter(c=>c.parent!=='java/lang/Enum')).name;
  r.SoundList=/\)L([^;]+);$/.exec(one('SoundList serializer entry',cs.get(r.SoundSerializer).methods.filter(m=>m.descriptor.startsWith('(Lcom/google/gson/JsonElement;')&&!m.descriptor.endsWith('Ljava/lang/Object;'))).descriptor)[1];
  r.NestedSoundAccessor=one('NestedSoundAccessor',[...cs.values()].filter(c=>c.name.startsWith(r.SoundManager+'$')&&c.refs.some(ref=>ref.owner===r.SoundAccessor&&ref.descriptor===`()L${r.SoundDefinition};`))).name;
  const particle=one('world particle callback',cs.get(r.NoteBlock).refs.filter(ref=>ref.owner===r.World&&ref.descriptor.endsWith(';DDDDDD[I)V')));r.Particle=particle.descriptor.slice(2,particle.descriptor.indexOf(';'));
  for(const role of ['Blocks','Bootstrap','Material','SoundSerializer','SoundAccessor','SoundList','NestedSoundAccessor','BlockPos','Particle','MathHelper']){
   const name=r[role];if(classes.some(c=>c.originalClass===name))continue;const c=cs.get(name);assert(c,name);const javap=spawnSync('javap',['-p','-s','-c','-classpath',c.archive.filename,name.replaceAll('/','.')],{windowsHide:true,encoding:'utf8',maxBuffer:8e6});assert.equal(javap.status,0,javap.stderr);const rawDisassembly=`${root}/${name.replaceAll('/','_')}.javap.txt`;await writeFile(rawDisassembly,javap.stdout);texts.set(name,javap.stdout);classes.push({originalClass:name,roles:[role],classSha256:digest(c.bytes,'sha256'),artifact:c.archive.artifact,methods:methodCodeHashes(c.bytes),rawDisassembly,disassemblySha256:digest(Buffer.from(javap.stdout),'sha256')});
  }
  const add=(label,role,key,tokens=[])=>{const c=classes.find(c=>c.originalClass===r[role]);assert(c.methods[key],version+' '+role+' '+key);const section=originalSection(texts.get(c.originalClass),c.originalClass,key);for(const token of tokens)assert(section.includes(token),version+' '+label+' '+token);const at=key.indexOf('(');bindings.push({label,role,owner:c.originalClass,member:key.slice(0,at),descriptor:key.slice(at),codeSha256:c.methods[key],semanticInstructionChecks:tokens});return section;};
  const choose=(label,role,predicate,tokens=[])=>{const c=classes.find(c=>c.originalClass===r[role]),keys=Object.keys(c.methods).filter(key=>predicate(key,originalSection(texts.get(c.originalClass),c.originalClass,key)));assert.equal(keys.length,1,version+' '+label+' '+keys);return{key:keys[0],text:add(label,role,keys[0],tokens)};};
  const blockInitializer=add('original-block-identities','Blocks','<clinit>()V',['String air','String dirt','String stone','String sand','String glass','String planks']);
  const blockField=name=>{const match=new RegExp(`String ${name}\\s[\\s\\S]*?putstatic[^\\n]+Field (\\w+):`).exec(blockInitializer);assert(match,name);return match[1];};
  const supports=['dirt','stone','sand','glass','planks'].map((block,eventId)=>({block,field:blockField(block),eventId,event:'block.note.'+['harp','basedrum','snare','hat','bass'][eventId]}));
  const trigger=add('actual-material-air-and-four-branches','TileEntityNote',`a(L${r.World};L${r.BlockPos};)V`,[`${r.Material}.a:L${r.Material};`,`${r.Material}.e:L${r.Material};`,`${r.Material}.p:L${r.Material};`,`${r.Material}.s:L${r.Material};`,`${r.Material}.d:L${r.Material};`,'iconst_0','iconst_1','iconst_2','iconst_3','iconst_4']);assert(!trigger.includes('dmul'));
  const bootstrap=choose('original-bootstrap-registers-sounds-and-blocks','Bootstrap',(key,t)=>key.endsWith('()V')&&t.includes(`${r.SoundEvent}.b:()V`)&&t.includes(`${r.Block}.`));
  const json=choose('json-event-float-volume-pitch','SoundSerializer',key=>key.startsWith('b(Lcom/google/gson/JsonObject;)'),['String volume','String pitch','(Lcom/google/gson/JsonObject;Ljava/lang/String;F)F']);assert(!json.text.includes('doubleValue'));
  add('original-resource-gson-registration','SoundManager','<clinit>()V',[`class ${r.SoundSerializer}`,'GsonBuilder.registerTypeAdapter:']);
  add('original-json-resource-input','SoundManager','a(Ljava/io/InputStream;)Ljava/util/Map;',['Gson.fromJson:']);
  add('original-resource-event-registration','SoundManager',`a(L${r.ResourceLocation};L${r.SoundList};)V`,[`class ${r.SoundAccessor}`,`class ${r.NestedSoundAccessor}`,`${r.SoundDefinition}.`]);
  add('instance-resolves-original-resource-event','AbstractSound',`a(L${r.SoundManager};)L${r.SoundAccessor};`,[`${r.SoundManager}.a:(L${r.ResourceLocation};)L${r.SoundAccessor};`,`${r.SoundAccessor}.a:()L${r.SoundDefinition};`,'putfield']);
  add('original-weighted-file-selection','SoundAccessor',`a()L${r.SoundDefinition};`,['java/util/Random.nextInt:','checkcast']);
  const nested=add('nested-resource-direct-delegation','NestedSoundAccessor',`a()L${r.SoundDefinition};`,[`${r.SoundAccessor}.a:()L${r.SoundDefinition};`,'areturn']);assert(!nested.includes('fmul'));assert(!nested.includes('dmul'));
  add('engine-java-float-clamp','MathHelper','a(FFF)F',['fcmpg','freturn']);
  choose('event-positioned-outer-constructor','PositionedSound',key=>key===`<init>(L${r.SoundEvent};L${r.Category};FFFFF)V`,[`(L${r.SoundEvent};L${r.Category};FFZIL${r.SoundInstance}$a;FFF)V`]);
  choose('event-to-positioned-instance-delegation','PositionedSound',key=>key===`<init>(L${r.SoundEvent};L${r.Category};FFZIL${r.SoundInstance}$a;FFF)V`,[`${r.SoundEvent}.a:()L${r.ResourceLocation};`,`(L${r.ResourceLocation};L${r.Category};FFZIL${r.SoundInstance}$a;FFF)V`]);
  const noteBinding=bindings.find(b=>b.label==='actual-note-pow-record-volume'),note=originalSection(texts.get(r.NoteBlock),r.NoteBlock,noteBinding.member+noteBinding.descriptor),recordField=new RegExp(`Field ${r.Category}\\.(\\w+):`).exec(note)[1];
  add('actual-record-category-identity','Category','<clinit>()V',['String record',`Field ${recordField}:L${r.Category};`]);
  const rangeBinding=bindings.find(b=>b.label==='original-source-range'),range=originalSection(texts.get(r.SoundEngine),r.SoundEngine,rangeBinding.member+rangeBinding.descriptor),volumeGetter=bindings.find(b=>b.label==='original-instance-event-volume').member;assert(range.indexOf(`${r.SoundInstance}.${volumeGetter}:()F`) < range.indexOf('newSource:'));assert(range.includes(`${r.SoundInstance}.a:(L${r.SoundManager};)L${r.SoundAccessor};`));
  choose('actual-manager-constructs-engine','SoundManager',(key,t)=>key.startsWith('<init>(')&&t.includes(`class ${r.SoundEngine}`),[`${r.SoundEngine}."<init>":`]);
  const managerPlay=choose('actual-manager-delegates-play','SoundManager',(key,t)=>key.endsWith(`(L${r.SoundInstance};)V`)&&t.includes(`${r.SoundEngine}.${rangeBinding.member}:(L${r.SoundInstance};)V`));
  add('actual-client-world-calls-manager-play','ClientWorld',`a(DDDL${r.SoundEvent};L${r.Category};FFZ)V`,[`${r.SoundManager}.${managerPlay.key.slice(0,managerPlay.key.indexOf('('))}:(L${r.SoundInstance};)V`]);
  const listenerBinding=bindings.find(b=>b.label==='listener-interpolation-and-eye-getter');choose('actual-manager-delegates-listener','SoundManager',(key,t)=>key.endsWith(`(L${r.Player};F)V`)&&t.includes(`${r.SoundEngine}.${listenerBinding.member}:(L${r.Player};F)V`));
  const materialFields={air:blockField('air'),supports};
  const positionParent=cs.get(cs.get(r.BlockPos).parent),integerFields=positionParent.fields.filter(field=>field.descriptor==='I'&&!(field.access&8));assert(integerFields.length>=3);const posY=positionParent.methods.find(m=>m.descriptor==='()I'&&m.name==='q');assert(posY,version+' original Y getter');
  const callbacks={sound:cs.get(r.NoteBlock).refs.find(ref=>ref.owner===r.World&&ref.descriptor.endsWith(`L${r.SoundEvent};L${r.Category};FF)V`)),particle,state:cs.get(r.TileEntityNote).refs.find(ref=>ref.owner===r.World&&ref.descriptor===`(L${r.BlockPos};)L${r.BlockState};`),queue:cs.get(r.TileEntityNote).refs.find(ref=>ref.owner===r.World&&ref.descriptor===`(L${r.BlockPos};L${r.Block};II)V`)};
  const evidence={schema:1,version,officialSources:base.officialSources,mappings:base.mappings,roles:r,classes,bindings,facts:{...base.facts,category:'record',hrtfControl:false,hrtfControlMode:'device-default'},instruments:base.instruments,resources:base.resources,materialFields,probeBindings:{bootstrapMethod:bootstrap.key.slice(0,bootstrap.key.indexOf('(')),positionYGetter:'q',recordField,callbacks},baseEvidence:{path:baseFile,sha256:digest(await readFile(baseFile),'sha256')},fullDispatchChainReviewed:true,scope:{nativeContextOpened:false,worldScenesAdded:0,actualAllocatedVoiceCapacityMeasured:false},sources:await hashSources()};
  // Verify the independently reviewed official resource definition again. The
  // actual decoder remains unexecuted; all five sample bytes are identity-bound.
  const assets=`.research/lwjgl2110-chains/${version}/assets`,index=await parse(`${assets}/index.json`);assert.equal(digest(await readFile(`${assets}/index.json`)),base.resources.assetIndex.sha1);assert.equal(digest(await readFile(`${assets}/sounds.json`)),base.resources.soundsDefinitionSha1);
  for(const instrument of evidence.instruments){const a=index.objects[instrument.sample];assert.equal(a.hash,instrument.sampleSha1);const filename=`${root}/assets/${instrument.sampleSha1}.ogg`;await verifiedArtifact({url:`https://resources.download.minecraft.net/${a.hash.slice(0,2)}/${a.hash}`,sha1:a.hash},filename);instrument.originalSample={path:filename,sha1:a.hash,sha256:digest(await readFile(filename),'sha256')};}
  const context=await reviewLwjgl219ContextControl(version);evidence.hrtfControlEvidence={path:`docs/evidence/java-${version}-hrtf-control-source.json`,sha256:digest(await readFile(`docs/evidence/java-${version}-hrtf-control-source.json`),'sha256')};assert.deepEqual(context.facts,{hrtfControl:false,hrtfControlMode:'device-default'});
  const raw=`${root}/evidence.json`;await writeFile(raw,JSON.stringify(evidence,null,2)+'\n');evidence.rawEvidence={path:raw,sha256:digest(await readFile(raw),'sha256')};await writeFile(`docs/evidence/java-${version}-audio-source.json`,JSON.stringify(evidence,null,2)+'\n');reports.push({version,classes:classes.length,bindings:bindings.length,contextBindings:context.bindings.length,scale:evidence.facts.pitchTransport.scale});console.log(JSON.stringify(reports.at(-1)));
 }return reports;
}

export async function verifiedLwjgl2110Source(version){
 assert(patchVersions.includes(version));const file=`docs/evidence/java-${version}-audio-source.json`,bytes=await readFile(file),r=JSON.parse(bytes);assert.equal(r.version,version);for(const[file,hash]of Object.entries(r.sources))assert.equal(digest(await readFile(file),'sha256'),hash,file);assert.equal(digest(await readFile(r.rawEvidence.path),'sha256'),r.rawEvidence.sha256);assert.equal(digest(await readFile(r.baseEvidence.path),'sha256'),r.baseEvidence.sha256);
 const metadataPath=`.research/lwjgl219-source/${version}/official-metadata.json`,metadata=await readFile(metadataPath);assert.equal(digest(metadata),r.officialSources.metadataSha1);assert.equal(JSON.parse(metadata).downloads.client.sha1,r.officialSources.clientSha1);
 const methods=await verifyClasses(version,r.classes);for(const b of r.bindings)assert.equal(methods.get(b.owner)[b.member+b.descriptor],b.codeSha256,b.label);
 const assets=`.research/lwjgl2110-chains/${version}/assets`,indexBytes=await readFile(`${assets}/index.json`),soundBytes=await readFile(`${assets}/sounds.json`);assert.equal(digest(indexBytes),r.resources.assetIndex.sha1);assert.equal(digest(soundBytes),r.resources.soundsDefinitionSha1);const index=JSON.parse(indexBytes),sounds=JSON.parse(soundBytes);for(const item of r.instruments){const entry=sounds[item.event];assert.equal(entry.sounds.length,1);const sound=typeof entry.sounds[0]==='string'?{name:entry.sounds[0]}:entry.sounds[0];assert.equal(`minecraft/sounds/${sound.name}.ogg`,item.sample);assert.equal(sound.volume??1,item.eventVolume);assert.equal(sound.pitch??1,item.eventPitch);assert.equal(index.objects[item.sample].hash,item.sampleSha1);}
 for(const item of r.instruments){const sample=await readFile(item.originalSample.path);assert.equal(digest(sample),item.originalSample.sha1);assert.equal(digest(sample,'sha256'),item.originalSample.sha256);}
 const context=await verifiedLwjgl219ContextControl(version);assert.equal(digest(await readFile(r.hrtfControlEvidence.path),'sha256'),r.hrtfControlEvidence.sha256);assert.deepEqual(context.facts,{hrtfControl:false,hrtfControlMode:'device-default'});
 return{version,facts:r.facts,instruments:r.instruments,fullDispatchChainReviewed:true,sourceEvidence:{path:file,sha256:digest(bytes,'sha256')},contextEvidence:context.sourceEvidence,bindings:r.bindings,contextBindings:context.bindings,materialFields:r.materialFields,roles:r.roles,probeBindings:r.probeBindings,scope:r.scope};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await reviewLwjgl2110Complete(process.argv.includes('--version')?[process.argv[process.argv.indexOf('--version')+1]]:undefined);
