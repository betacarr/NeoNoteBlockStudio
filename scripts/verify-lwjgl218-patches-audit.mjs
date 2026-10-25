import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {lwjgl218PatchVersions,lwjgl218PatchFacts,reviewLwjgl218Patch} from './review-lwjgl218-patches.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourcePath=version=>`docs/evidence/java-${version}-audio-source.json`;
const numericPath=version=>`docs/evidence/java-${version}-numeric-components.json`;
const mutations=[
 ['client-identity',r=>{r.officialSources.clientSha1='0'.repeat(40);}],
 ['option-map-field',r=>{r.adapterConfig.optionMap='unreviewed-field';}],
 ['original-method-code',r=>{const key=Object.keys(r.classes[0].methods)[0];r.classes[0].methods[key]='0'.repeat(64);}],
 ['gain-order',r=>{r.facts.volumeRule='category-before-clamp';}],
 ['packet-overflow',r=>{r.facts.pitchTransport.overflow='clamp';}],
 ['listener-position',r=>{r.facts.listenerPositionModel='camera-eye-assumed';}],
 ['configured-pool',r=>{r.facts.originalRequestedVoicePool.normal=64;}],
 ['native-bridge-identity',r=>{r.native.lwjglBridgeSha256='0'.repeat(64);}],
 ['missing-caller-owner',r=>{const entry=r.classes.find(e=>e.roles.includes('ClientWorld'));assert(entry);r.classes=r.classes.filter(e=>e!==entry);r.classes.push(structuredClone(r.classes[0]));}],
 ['component-count',r=>{r.numericComponents.engineMathCases+=1;}]
];

export async function verifyLwjgl218PatchesAudit({writeIndex=false}={}){
 const root='.local/lwjgl218-patch-validation';await mkdir(root,{recursive:true});
 const reports=[],negatives=[];
 for(const version of lwjgl218PatchVersions){
  const report=await reviewLwjgl218Patch(version),folder=path.join(root,version);await mkdir(folder,{recursive:true});
  for(const[name,mutate]of mutations){const changed=structuredClone(report);mutate(changed);const filename=path.join(folder,`${name}.json`);await writeFile(filename,JSON.stringify(changed));let rejection;try{await reviewLwjgl218Patch(version,filename);}catch(error){rejection={name:error.name,message:error.message};}assert(rejection,`${version} ${name} must be rejected`);negatives.push({version,mutation:name,rejected:true,error:rejection.name});}
  const sourceBytes=await readFile(sourcePath(version)),numericBytes=await readFile(numericPath(version));
  reports.push({version,source:{path:sourcePath(version),sha256:hash(sourceBytes)},numeric:{path:numericPath(version),sha256:hash(numericBytes)},officialSources:report.officialSources,classes:report.classes.length,methodBindings:report.bindings.length,roles:report.roles,selectedFields:{optionMap:report.adapterConfig.optionMap,defaultState:report.adapterConfig.defaultState,playerEye:report.adapterConfig.playerEye},components:report.numericComponents,native:report.native,assetIndex:report.resources.index});
  console.log(JSON.stringify({version,strictSourceReview:true,negativeMutationsRejected:mutations.length,components:report.numericComponents}));
 }
 const files=['scripts/audit-lwjgl218-patches.mjs','scripts/lwjgl218-patch-bindings.mjs','scripts/probe-lwjgl218-patches.mjs','scripts/review-lwjgl218-patches.mjs','scripts/java/Lwjgl218PatchMethodProbe.java','scripts/verify-lwjgl218-patches-audit.mjs'];const sources={};for(const file of files)sources[file]=hash(await readFile(file));
 const result={schema:1,kind:'original-client-selected-audio-core-source-and-component-audit',versions:lwjgl218PatchVersions,facts:lwjgl218PatchFacts,reviewHelper:{path:'scripts/review-lwjgl218-patches.mjs',export:'reviewLwjgl218Patch',factsExport:'lwjgl218PatchFacts'},sources,reports,strictSourceReviews:reports.length,negativeMutations:{perVersion:mutations.map(([name])=>name),total:negatives.length,allRejected:negatives.every(e=>e.rejected)},components:{engineMathInputsPerVersion:1307,engineMathOriginalInvocations:reports.reduce((a,r)=>a+r.components.engineMathCases,0),originalNoteEventsPerVersion:125,originalNoteEvents:reports.reduce((a,r)=>a+r.components.originalNoteEvents,0),packetBoundariesPerVersion:42,packetBoundaries:reports.reduce((a,r)=>a+r.components.packetBoundaryCases,0),materialSelectionsPerVersion:5,materialSelections:reports.reduce((a,r)=>a+r.components.originalMaterialCases,0),blockedAboveGuardPerVersion:1,eventCompositePerVersion:1,staticConfiguredPoolGetterPerVersion:1},integratedWorldScenesAdded:0,nativeContextMeasurementsAdded:0,limitations:['Independent original calls for each client; common finite input vectors are reused as inputs only.','Selected-core agreement is not equivalence of entire SoundEngine, native context, allocated voices, codec waveform or game-world output.','Configured28normal+4streaming is not an actual allocated-capacity or overflow measurement.','No existing world measurement or prior version component result is inherited.'],negativeDetailsPath:`${root}/negative-results.json`};
 await writeFile(`${root}/negative-results.json`,JSON.stringify({sources,negatives},null,2)+'\n');await writeFile(`${root}/freeze-manifest.json`,JSON.stringify(result,null,2)+'\n');
 if(writeIndex)await writeFile('docs/evidence/java-1.8-patches-audit.json',JSON.stringify(result,null,2)+'\n');
 return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=await verifyLwjgl218PatchesAudit({writeIndex:process.argv.includes('--write-index')});console.log(JSON.stringify({versions:r.versions.length,strict:r.strictSourceReviews,negativeMutations:r.negativeMutations.total,components:r.components,worldScenes:0,indexWritten:process.argv.includes('--write-index')}));}
