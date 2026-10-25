import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {build,version as esbuildVersion} from 'esbuild';
import {reviewLwjgl21516SourceVolume} from './review-lwjgl21516-source-volume.mjs';
import {versions,hash,fbits,inputs,reportFile as oracleFile} from './lwjgl21516-volume-common.mjs';

// Prepared only. Run after all five production legacy/world entries are frozen.
// No original Java process, decoder, OpenAL context, worker or world is started.
const publicEvidence='docs/evidence/java-1.5-1.6-source-volume-product.json';
const script='scripts/audit-lwjgl21516-volume-integration.mjs';
const virtual='lwjgl21516-volume-integration.ts';
const bundleEntry=`
export {gameVolumeParameters} from './src/audio/volume.ts';
export {audioProfile} from './src/audio/profiles.ts';
import {createProject,newNote,flattenNotes,validateProject} from './src/core/project.ts';
export function legalProjectInput(profileId,volume,masterGain) {
  const project=createProject();project.audio.profileId=profileId;project.audio.mode='vanilla';project.audio.masterGain=masterGain;
  project.tracks[0].volume=volume>1?volume:1;
  project.patterns[0].notes=[{...newNote(0,66),velocity:volume>1?1:volume}];
  validateProject(project);const note=flattenNotes(project)[0];
  if(!note)throw Error('Validated project did not expose its note');
  return {volume:note.gain,masterGain:project.audio.masterGain};
}
`;
const fromBits=hex=>{const b=Buffer.alloc(4);b.writeUInt32LE(parseInt(hex,16));return b.readFloatLE();};
const rel=file=>path.relative(process.cwd(),file).replaceAll('\\','/');
const parse=async file=>JSON.parse(await readFile(file));

export async function auditLwjgl21516VolumeIntegration({root}={}) {
 assert(root,'The recorded launcher supplies the isolated output root');
 const snapshots=new Map(),bundleLoaded=new Map(),comparisons=[],diagnostics=[],observations=[];
 const snapshot=async(file,options)=>{
  const absolute=path.resolve(file),bytes=await readFile(absolute),h=hash(bytes),old=snapshots.get(absolute);
  if(old)assert.equal(h,old,'Input changed during audit: '+file);snapshots.set(absolute,h);
  return options?bytes.toString(typeof options==='string'?options:options.encoding):bytes;
 };
 const ref=async file=>({path:rel(file),sha256:hash(await readFile(file))});
 const report={schema:1,status:'running',root,versions,startedAt:new Date().toISOString(),pid:process.pid,observations,
  scope:'Actual production gameVolumeParameters versus frozen per-release original Library/CommandSetVolume/CommandQueue final sourceVolume bits, restricted to project-validated finite volume0..4 and master0..2. Diagnostic exclusions impose no product support requirement. No Java re-execution, native audio, worker, context or world.',
  nativeExecutionsAdded:0,originalJavaExecutionsAdded:0,worldScenesAdded:0};
 const reportPath=path.join(root,'report.json'),save=()=>writeFile(reportPath,JSON.stringify(report,null,2)+'\n');await save();
 try {
  for(const file of [script,'node_modules/esbuild/package.json','node_modules/esbuild/lib/main.js','node_modules/@esbuild/win32-x64/esbuild.exe'])await snapshot(file);
  // The strict frozen consumer reads exact original archives, class/Code hashes,
  // executable/compiled closure, original process terminal records and output.
  const reviewed=await reviewLwjgl21516SourceVolume({read:snapshot});
  const oracle=JSON.parse(await snapshot(oracleFile));assert.equal(hash(await snapshot(oracleFile)),reviewed.evidence.sha256);
  const legacy=JSON.parse(await snapshot('src/data/legacy-audio-facts.json')),world=JSON.parse(await snapshot('src/data/world-audio-facts.json')),validation=JSON.parse(await snapshot('src/data/audio-validation.json'));
  for(const version of versions){assert(legacy.profiles.some(p=>p.id==='java-'+version),'Await final frozen legacy profile: '+version);assert(world.profiles.some(p=>p.id==='java-'+version),'Await final frozen world source profile: '+version);}
  const bundle=path.join(root,'production.mjs');await writeFile(path.join(root,'bundle-entry.ts'),bundleEntry);
  const buildOptions={stdin:{contents:bundleEntry,resolveDir:process.cwd(),sourcefile:virtual},outfile:bundle,bundle:true,platform:'node',format:'esm',metafile:true};
  const built=await build({...buildOptions,plugins:[{name:'record-actual-source-bytes',setup(builder){
   builder.onLoad({filter:/\.(?:ts|tsx|js|mjs|cjs|json)$/},async args=>{
    const bytes=await snapshot(args.path),ext=path.extname(args.path),loader=ext==='.ts'?'ts':ext==='.tsx'?'tsx':ext==='.json'?'json':'js';
    bundleLoaded.set(path.resolve(args.path),hash(bytes));return{contents:bytes,loader,resolveDir:path.dirname(args.path)};
   });
  }}]});
  const bundleInputs={};for(const file of Object.keys(built.metafile.inputs).filter(f=>f!==virtual&&!f.startsWith('<'))){const key=path.resolve(file);assert(bundleLoaded.has(key),'Unobserved bundle input: '+file);bundleInputs[file]=bundleLoaded.get(key);assert.equal(hash(await snapshot(file)),bundleInputs[file]);}
  assert(Object.hasOwn(bundleInputs,'src/audio/volume.ts'));assert(Object.hasOwn(bundleInputs,'src/data/legacy-audio-facts.json'));assert(Object.hasOwn(bundleInputs,'src/data/audio-validation.json'));
  const metafile=path.join(root,'bundle.metafile.json');await writeFile(metafile,JSON.stringify(built.metafile,null,2)+'\n');
  const product=await import(pathToFileURL(bundle).href),allInputs=inputs().rows;
  for(const e of oracle.entries) {
   const id='java-'+e.version,fact=legacy.profiles.find(p=>p.id===id),worldFact=world.profiles.find(p=>p.id===id),profile=product.audioProfile(id);
   assert.equal(fact.clientSha1,e.official.client.sha1);assert.equal(worldFact.clientSha1,e.official.client.sha1);assert.equal(fact.volumeRule,'clamp-before-global-setting');assert.equal(fact.masterVolumePlacement,'source');
   assert.equal(profile.status,'code-reviewed');assert.equal(profile.measurementSummary,undefined);assert(!validation.profiles.some(p=>p.id===id),'No world acceptance inheritance: '+id);
   const raw=await snapshot(e.javaOutput.path);assert.equal(hash(raw),e.javaOutput.sha256);
   const rows=raw.toString().split(/\r?\n/).filter(line=>line.startsWith('ROW\t')).map(line=>line.split('\t').slice(1));assert.equal(rows.length,allInputs.length);
   const countBefore=comparisons.length,diagnosticsBefore=diagnostics.length;let legalRows=0,negativeZeroRows=0;
   for(const[i,input]of allInputs.entries()) {
    const row=rows[i];assert.equal(row[0],input.id);assert.equal(row[1],input.inputBits);
    const volume=fromBits(input.kind==='pipeline'?input.rawBits:input.inputBits),master=input.kind==='pipeline'?fromBits(input.masterBits):1;
    const context={version:e.version,id:input.id,kind:input.kind,volumeBits:fbits(volume),masterBits:fbits(master),originalLibraryArgumentBits:row[1]};
    if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(master)||master<0||master>2) {
     // These original finite values remain useful diagnostics, but the project
     // validator does not authorize negative volume or values above track*velocity4.
     const actual=product.gameVolumeParameters(id,volume,master);
     diagnostics.push({...context,reason:!Number.isFinite(volume)?'nonfinite-volume':volume<0?'negative-volume':'outside-project-validated-volume0..4',actualGainBits:fbits(actual.gain),actualListenerBits:fbits(actual.listenerGain),originalFinalBits:row.slice(2),asserted:false});continue;
    }
    const projectInput=product.legalProjectInput(id,volume,master);assert.equal(fbits(projectInput.volume),fbits(volume));assert.equal(fbits(projectInput.masterGain),fbits(master));
    const actual=product.gameVolumeParameters(id,projectInput.volume,projectInput.masterGain,1,1),actualBits=fbits(actual.gain);
    // Expected values are read only from three independent paths through the
    // original classes. No production formula manufactures expected results.
    for(const[route,originalBits]of ['Library','CommandSetVolume','CommandQueue'].map((name,j)=>[name,row[2+j]])){
     assert.equal(actualBits,originalBits,JSON.stringify({...context,route,actualBits,originalBits}));comparisons.push({...context,route,actualBits,originalBits,exact:true});
    }
    // This is a product/source-ownership contract, not original AL readback.
    assert.equal(fbits(actual.listenerGain),'3f800000');legalRows++;
    if(Object.is(volume,-0)){assert.equal(actualBits,'80000000','Original negative-zero source clamp must remain intact');negativeZeroRows++;}
   }
   for(const label of ['NaN','positive-Infinity','negative-Infinity']) {
    const value=label==='NaN'?NaN:label==='positive-Infinity'?Infinity:-Infinity;
    const actual=product.gameVolumeParameters(id,value,2);
    diagnostics.push({version:e.version,kind:'nonfinite-volume-diagnostic',input:label,inputBits:fbits(value),masterBits:fbits(2),actualGainBits:fbits(actual.gain),actualListenerBits:fbits(actual.listenerGain),originalOracleAvailable:false,asserted:false});
   }
   assert.equal(legalRows,192);assert.equal(comparisons.length-countBefore,576);assert(negativeZeroRows>0);
   observations.push({version:e.version,clientSha1:e.official.client.sha1,originalOutput:e.javaOutput,originalSourceSnapshot:e.sourceSnapshot,profileStatus:profile.status,worldMeasured:false,legalRows,negativeZeroRows,bitComparisons:comparisons.length-countBefore,diagnostics:diagnostics.length-diagnosticsBefore});
  }
  assert.equal(comparisons.length,2880);assert.equal(observations.length,5);
  for(const[file,h]of snapshots)assert.equal(hash(await readFile(file)),h,'Input changed before completion: '+file);
  const comparisonPath=path.join(root,'comparisons.json'),diagnosticPath=path.join(root,'diagnostics.json');await writeFile(comparisonPath,JSON.stringify(comparisons,null,2)+'\n');await writeFile(diagnosticPath,JSON.stringify(diagnostics,null,2)+'\n');
  Object.assign(report,{status:'passed',finishedAt:new Date().toISOString(),exact:true,originalEvidence:reviewed.evidence,totals:{versions:5,legalRows:960,bitComparisons:comparisons.length,diagnostics:diagnostics.length},comparisons:await ref(comparisonPath),diagnostics:await ref(diagnosticPath),
   productionBundle:await ref(bundle),bundleEntry:await ref(path.join(root,'bundle-entry.ts')),bundleMetafile:await ref(metafile),bundleInputSha256:bundleInputs,build:{esbuildVersion,options:buildOptions,sourceBytesObservedBeforeCompilation:true},
   inputSha256:Object.fromEntries([...snapshots].map(([f,h])=>[rel(f),h])),limitations:['Comparison domain is the validator-approved finite subset represented by frozen original inputs: volume0..4 and master0..2. It is not an exhaustive proof over all finite IEEE-754 values.','Negative/nonfinite/outside-project-volume inputs are diagnostics only and have no product support assertion. No new original Java inputs or processes are used.','Pipeline original Library arguments were independently archived by the original component audit. This comparison does not remeasure running asynchronous command scheduling or original mixer/AL listener state.','Three route comparisons share one production scalar result; row and comparison counts are recorded separately. No new native/world measurement or promotion.']});await save();
  console.log(JSON.stringify({status:'passed',report:reportPath,...report.totals}));return report;
 }catch(error){Object.assign(report,{status:'failed',finishedAt:new Date().toISOString(),error:error.stack??String(error),partialComparisons:comparisons.length,partialDiagnostics:diagnostics.length,inputSha256:Object.fromEntries([...snapshots].map(([f,h])=>[rel(f),h]))});await save();throw error;}
}

async function launch() {
 const root=path.resolve('.local/lwjgl21516-volume-integration',`run-${Date.now()}-${randomBytes(3).toString('hex')}`);await mkdir(root,{recursive:true});
 const args=[fileURLToPath(import.meta.url),'--execute',root],p={executable:process.execPath,executableSha256:hash(await readFile(process.execPath)),args,cwd:process.cwd(),launcherPid:process.pid,startedAt:new Date().toISOString(),terminal:false,scriptSha256:hash(await readFile(script))};
 const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});p.pid=child.pid;const processFile=path.join(root,'process.json');await writeFile(processFile,JSON.stringify(p,null,2)+'\n');console.log(JSON.stringify({root,pid:child.pid,terminal:false}));
 let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;process.stdout.write(b);});child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});const reminder=setInterval(()=>console.log(JSON.stringify({observing:true,pid:child.pid,root})),30000);
 try{Object.assign(p,await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));}));}finally{clearInterval(reminder);p.terminal=true;p.finishedAt=new Date().toISOString();await writeFile(path.join(root,'stdout.log'),stdout);await writeFile(path.join(root,'stderr.log'),stderr);p.stdoutSha256=hash(Buffer.from(stdout));p.stderrSha256=hash(Buffer.from(stderr));await writeFile(processFile,JSON.stringify(p,null,2)+'\n');}
 const terminalFile=path.join(root,'terminal.json');await writeFile(terminalFile,JSON.stringify(p,null,2)+'\n');const file=path.join(root,'report.json'),r=await parse(file);r.execution={pid:p.pid,terminal:true,code:p.code,signal:p.signal,process:{path:rel(processFile),sha256:hash(await readFile(processFile))},terminalManifest:{path:rel(terminalFile),sha256:hash(await readFile(terminalFile))}};await writeFile(file,JSON.stringify(r,null,2)+'\n');
 if(p.code===0&&p.signal===null&&r.status==='passed'&&process.argv.includes('--write-evidence'))await writeFile(publicEvidence,JSON.stringify(r,null,2)+'\n');
 console.log(JSON.stringify({status:r.status,root,pid:p.pid,code:p.code,signal:p.signal,terminal:true,reportSha256:hash(await readFile(file))}));process.exitCode=p.code??1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 if(process.argv[2]==='--execute')await auditLwjgl21516VolumeIntegration({root:process.argv[3]});
 else if(process.argv.includes('--run'))await launch();
 else console.log(JSON.stringify({status:'prepared-awaiting-five-profile-freeze',versions,command:'node scripts/audit-lwjgl21516-volume-integration.mjs --run --write-evidence',executed:false,nativeExecuted:false}));
}
