import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {digest} from './research-utils.mjs';
import {lwjgl2111Versions,reviewedLwjgl2111Profile} from './review-lwjgl2111-profiles.mjs';

// Corruption exists only in a per-call read fixture. No source, archive, public
// evidence or accepted raw byte is changed to test the fail-closed consumers.
export async function verifyLwjgl2111Negative({writeEvidence=false}={}){
 const observations=[];
 for(const version of lwjgl2111Versions){
  await reviewedLwjgl2111Profile(version);
  const sourceFile=`docs/evidence/java-${version}-audio-source.json`,numericFile=`docs/evidence/java-${version}-numeric-components.json`,contextFile=`docs/evidence/java-${version}-hrtf-control-source.json`;
  const source=JSON.parse(await readFile(sourceFile)),numeric=JSON.parse(await readFile(numericFile)),context=JSON.parse(await readFile(contextFile));
  const flip=b=>{const next=Buffer.from(b);next[next.length-1]^=1;return next;};
  const cases=[
   ['source-version',sourceFile,b=>{const j=JSON.parse(b);j.version='wrong-release';return Buffer.from(JSON.stringify(j));}],
   ['source-public-raw-consistency',sourceFile,b=>{const j=JSON.parse(b);j.facts.broadcastRange=49;return Buffer.from(JSON.stringify(j));}],
   ['original-client-archive',`.research/clients/${version}.jar`,flip],
   ['official-release-metadata',`.research/lwjgl219-source/${version}/official-metadata.json`,flip],
   ['source-raw-document',source.rawEvidence.path,flip],
   ['original-disassembly',source.classes[0].rawDisassembly,flip],
   ['native-original-archive',path.join('.research/libraries',source.originalWindowsNatives[0].artifact.path),flip],
   ['context-original-attribute-output',context.originalAttributeBuilder.rawOutput,flip],
   ['numeric-status',numericFile,b=>{const j=JSON.parse(b);j.status='failed';return Buffer.from(JSON.stringify(j));}],
   ['numeric-public-raw-consistency',numericFile,b=>{const j=JSON.parse(b);j.masterScope='unsupported whole-engine claim';return Buffer.from(JSON.stringify(j));}],
   ['compiled-original-method-probe',Object.keys(numeric.runtimeCompiledClasses).find(p=>p.endsWith('/Lwjgl2111MethodProbe.class')),flip],
   ['original-math-binary',numeric.rawOutputs['math.bin'].path,flip],
   ['original-registered-packet-binary',numeric.rawOutputs['packet.bin'].path,b=>{const next=Buffer.from(b);next[8+24]^=1;return next;}],
   ['original-material-note-binary',numeric.rawOutputs['notes.bin'].path,flip],
  ];
  for(const[name,file,mutate]of cases){
   assert(file,name);const original=await readFile(file),replacement=mutate(original);assert(!replacement.equals(original));let observed=false;
   const read=async(filename,options)=>{if(path.resolve(filename)!==path.resolve(file))return readFile(filename,options);observed=true;const encoding=typeof options==='string'?options:options?.encoding;return encoding?replacement.toString(encoding):replacement;};
   let rejection;try{await reviewedLwjgl2111Profile(version,{read});}catch(error){rejection=String(error);}assert(rejection,`${version} accepted ${name}`);assert(observed,`${version} did not consume fixture ${name}`);
   assert.equal(digest(await readFile(file),'sha256'),digest(original,'sha256'),'Fixture must not alter the real input');
   observations.push({version,fixture:name,path:file,originalSha256:digest(original,'sha256'),fixtureSha256:digest(replacement,'sha256'),rejected:true,rejection:rejection.slice(0,1400)});
  }
 }
 const sources=Object.fromEntries(await Promise.all(['scripts/verify-lwjgl2111-negative.mjs','scripts/review-lwjgl2111-source.mjs','scripts/review-lwjgl2111-context-control.mjs','scripts/probe-lwjgl2111-methods.mjs','scripts/review-lwjgl2111-profiles.mjs'].map(async file=>[file,digest(await readFile(file),'sha256')])));
 const report={schema:1,status:'passed',scope:'Read-only evidence gate corruption fixtures; only per-call file reads are replaced. No product, game, Java or native execution; no real input byte is modified.',fixtures:observations.length,observations,sources,worldScenesAdded:0};
 if(writeEvidence)await writeFile('docs/evidence/java-1.11-reader-guards.json',JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const result=await verifyLwjgl2111Negative({writeEvidence:process.argv.includes('--write-evidence')});console.log(JSON.stringify({status:result.status,fixtures:result.fixtures,worldScenesAdded:0}));}
