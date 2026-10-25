import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {digest} from './research-utils.mjs';
import {reviewLwjgl2172ResourceSelection} from './review-lwjgl2172-resources.mjs';

const sha=b=>digest(b,'sha256'),canonical='docs/evidence/java-1.7.2-resource-selection.json';
const jsonBytes=r=>Buffer.from(JSON.stringify(r)),flip=bytes=>{const b=Buffer.from(bytes);b[b.length-1]^=1;return b;};
export async function verifyLwjgl2172Resources({writeEvidence=false}={}){
 const baseline=await reviewLwjgl2172ResourceSelection(),root=path.resolve('.local/lwjgl2172-resource-validation',`run-${Date.now()}`);await mkdir(root,{recursive:true});
 const raw=baseline.review.rawReport.path,report=JSON.parse(await readFile(canonical)),source=JSON.parse(await readFile(report.sourceEvidence.path)),fixtures=[];
 const reportCase=(name,mutate)=>fixtures.push({name,report:mutate});
 const byteCase=(name,file,mutate=flip)=>fixtures.push({name,file,mutate});
 reportCase('failed-status',r=>{r.status='failed';});reportCase('wrong-version',r=>{r.version='1.7.10';});reportCase('wrong-layout',r=>{r.loaderLayout='hashed-index';});reportCase('invented-world-count',r=>{r.worldScenesAdded=1;});
 reportCase('wrong-official-client',r=>{r.officialSources.clientSha1='0'.repeat(40);});
 reportCase('resource-role-substitution',r=>{r.classIdentities.find(c=>c.roles.includes('DefaultResourcePack')).roles=['ResourceIndex'];});
 reportCase('original-code-binding',r=>{r.bindings[0].codeSha256='0'.repeat(64);});
 reportCase('missing-resource',r=>{r.expected.pop();r.observations.pop();});
 reportCase('wrong-logical-namespace',r=>{r.expected[0].logicalPath='other:sounds.json';});
 reportCase('wrong-materialized-file',r=>{r.expected[1].file=r.expected[2].file;});
 reportCase('missing-compiled-helper',r=>{r.compiledClasses={};});
 reportCase('unreviewed-compiled-substitute',r=>{r.compiledClasses[path.join(path.dirname(Object.keys(r.compiledClasses)[0]),'ResourceIndex.class')]='0'.repeat(64);});
 reportCase('java-still-running',r=>{r.processes[1].terminal=false;});reportCase('java-nonzero-exit',r=>{r.processes[1].code=1;});
 reportCase('java-missing-client',r=>{r.processes[1].args[2]=r.processes[1].args[2].split(path.delimiter).filter(f=>!f.endsWith('1.7.2.jar')).join(path.delimiter);});
 reportCase('java-extra-client',r=>{r.processes[1].args[2]+=path.delimiter+path.resolve('.research/clients/1.7.10.jar');});
 reportCase('java-substitute-main',r=>{r.processes[1].args[3]='studio.nbsx.research.ResourceIndexSubstitute';});
 reportCase('java-wrong-root',r=>{r.processes[1].args[4]=path.join(path.dirname(r.materializedDirectory),'other');});
 reportCase('compile-wrong-source',r=>{r.processes[0].args[4]='scripts/java/OtherResourceProbe.java';});
 reportCase('java-forged-read-hash',r=>{r.processes[1].stdout=r.processes[1].stdout.replace(/\t[a-f0-9]{40}\t/,'\t'+'0'.repeat(40)+'\t');});
 byteCase('official-metadata-bytes','.research/lwjgl2172-source/1.7.2/official-metadata.json');byteCase('original-client-bytes','.research/clients/1.7.2.jar');byteCase('official-index-virtual-flag',report.index.path,b=>{const r=JSON.parse(b);r.virtual=false;return jsonBytes(r);});
 byteCase('official-index-object-hash',report.index.path,b=>{const r=JSON.parse(b);r.objects['sounds/note/harp.ogg'].hash='0'.repeat(40);return jsonBytes(r);});
 byteCase('materialized-sounds-json',report.expected[0].file);byteCase('materialized-harp',report.expected[1].file);byteCase('materialized-pling',report.expected[6].file);
 byteCase('compiled-helper-bytes',Object.keys(report.compiledClasses)[0]);byteCase('original-class-bytes',report.classIdentities[0].rawClass);byteCase('original-disassembly',report.classIdentities[0].rawDisassembly);
 byteCase('producer-java-source','scripts/java/Lwjgl2172ResourceProbe.java');byteCase('terminal-sidecar',path.join(path.dirname(raw),'original-reads.json'));
 for(const[name,mutate]of [['invented-source-ResourceIndex',s=>{s.roles.ResourceIndex=s.roles.DefaultResourcePack;}],['invented-source-pling-material',s=>{s.resources.samples.push({...s.resources.samples[0],instrument:'pling',event:'note.pling',path:'sounds/note/pling.ogg'});}]] )fixtures.push({name,source:mutate});
 const observations=[];
 for(const fixture of fixtures){
  const overrides=new Map(),before=new Map(),hits=new Set();
  const override=async(file,data)=>{const key=path.resolve(file);before.set(key,sha(await readFile(file)));overrides.set(key,data);};
  if(fixture.report||fixture.source){const changed=structuredClone(report);if(fixture.report)fixture.report(changed);if(fixture.source){const altered=structuredClone(source);fixture.source(altered);const data=jsonBytes(altered);await override(report.sourceEvidence.path,data);changed.sourceEvidence.sha256=sha(data);}
   const data=jsonBytes(changed);await override(canonical,data);await override(raw,data);for(const process of changed.processes)await override(path.join(path.dirname(raw),process.label+'.json'),jsonBytes(process));
  }else{await override(fixture.file,fixture.mutate(await readFile(fixture.file)));}
  const read=async(file,options)=>{const key=path.resolve(file);if(!overrides.has(key))return readFile(file,options);hits.add(key);const encoding=typeof options==='string'?options:options?.encoding;return encoding?overrides.get(key).toString(encoding):overrides.get(key);};
  let error;try{await reviewLwjgl2172ResourceSelection(canonical,{read});}catch(rejection){error={name:rejection.name,message:rejection.message.slice(0,1800)};}
  assert(error,fixture.name+' must be rejected');const primary=path.resolve(fixture.file??canonical);assert(hits.has(primary),fixture.name+' must reach its changed input');for(const[file,hash]of before)assert.equal(sha(await readFile(file)),hash,'Real input changed by fixture');
  observations.push({fixture:fixture.name,rejected:true,error,changedReads:[...overrides].map(([file,data])=>({path:path.relative(process.cwd(),file).replaceAll('\\','/'),originalSha256:before.get(file),fixtureSha256:sha(data)}))});
 }
 const sources={...baseline.review.inputSha256};for(const file of ['scripts/review-lwjgl2172-resources.mjs','scripts/verify-lwjgl2172-resources.mjs'])sources[file]=sha(await readFile(file));
 const output={schema:1,status:'passed',kind:'original-1.7.2-resource-selection-strict-consumer',sourceEvidence:baseline.sourceEvidence,resourceEvidence:baseline.review.resourceEvidence,rawReport:baseline.review.rawReport,reviewHelper:{path:'scripts/review-lwjgl2172-resources.mjs',export:'reviewLwjgl2172ResourceSelection'},sources,checks:{originalSourceClasses:53,originalCodeBindings:76,resourceRoles:3,actualOriginalResources:7,materialInstruments:5,plingMaterialInstrument:false,compiledHelperClasses:1,originalProcessesTerminal:2,negativeFixtures:observations.length,allRejected:true},processes:report.processes.map(({label,pid,terminal,code,signal})=>({label,pid,terminal,code,signal})),negativeFixtures:observations,worldScenesAdded:0,nativeMeasurementsAdded:0,scope:'Strict read-only consumption of accepted original Java resource reads; negative mutations are per-call read fixtures only. No original Java/native/world rerun and no real input byte changed.',limitations:report.limitations};
 await writeFile(path.join(root,'report.json'),JSON.stringify(output,null,2)+'\n');output.rawValidation={path:path.join(root,'report.json'),sha256:sha(await readFile(path.join(root,'report.json')))};
 if(writeEvidence)await writeFile('docs/evidence/java-1.7.2-resource-selection-review.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({status:'passed',resources:7,negativeFixtures:observations.length,processesTerminal:2,worldScenesAdded:0,rawValidation:output.rawValidation}));return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await verifyLwjgl2172Resources({writeEvidence:process.argv.includes('--write-evidence')});
