import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {digest} from './research-utils.mjs';

const baselineRef='82d550f67cf447fc1e26bf828f1a2c717cee7044';
const baseline=spawnSync('git',['show',`${baselineRef}:src/core/nbs.ts`],{windowsHide:true});assert.equal(baseline.status,0);
const output=path.resolve('.local/nbs-scaling',`run-${Date.now()}`);await mkdir(output,{recursive:true});
const ref=async file=>({path:path.relative(process.cwd(),file).replaceAll('\\','/'),sha256:digest(await readFile(file),'sha256')});
await writeFile(path.join(output,'baseline-nbs.ts'),baseline.stdout);
const contents="export {importNbs,exportNbs} from './src/core/nbs.ts';export {nbsFixture} from './tests/fixtures/nbs-interop.ts';export {validateProject} from './src/core/project.ts';export {saveNbsx,openNbsx} from './src/core/container.ts';";
async function bundle(name,old){const file=path.join(output,`${name}.mjs`);await build({stdin:{contents,resolveDir:process.cwd(),sourcefile:'nbs-scaling.ts'},outfile:file,bundle:true,platform:'node',format:'esm',plugins:old?[{name:'old-nbs',setup(b){b.onLoad({filter:/[\\/]src[\\/]core[\\/]nbs\.ts$/},()=>({contents:baseline.stdout.toString(),loader:'ts',resolveDir:path.resolve('src/core')}));}}]:[]});return{api:await import(pathToFileURL(file).href),bundle:await ref(file)};}
const before=await bundle('before',true),after=await bundle('after',false);
function canonical(project){const p=structuredClone(project);const ids=new Map();let serial=0;const replace=value=>{if(typeof value==='string'&&ids.has(value))return ids.get(value);if(Array.isArray(value))return value.map(replace);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['createdAt','modifiedAt'].includes(key)).map(([key,v])=>[key,replace(v)]));return value;};for(const obj of [p,...p.instruments,...p.assets,...p.tracks,...p.patterns,...p.regions,...p.patterns.flatMap(p=>p.notes)])if(obj.id&&!ids.has(obj.id))ids.set(obj.id,`object-${serial++}`);return replace(p);}
const cases=[];
for(const settings of [
 {name:'mixed-empty-layers',layers:64,ticks:24,active:8,controls:true},
 {name:'wide-32768-notes',layers:2048,ticks:16,active:2048,controls:false},
 {name:'functional-16384-notes',layers:128,ticks:128,active:128,controls:true},
]){
 const {name,layers,ticks,active,controls}=settings,notes=[];
 for(let tick=0;tick<ticks;tick++)for(let layer=0;layer<active;layer++)notes.push({tick,layer,instrument:controls&&layer===active-1?16:layer%16,key:36+(tick+layer)%36,velocity:20+(tick*7+layer)%81,pan:(tick*3+layer)%201,detune:controls&&layer===active-1?150+(tick%4)*30:(tick+layer)%41-20});
 const bytes=after.api.nbsFixture({version:5,builtinCount:16,name,layers:Array.from({length:layers},(_,i)=>({name:`Layer ${i}`,volume:50+i%51,pan:75+i%51})),custom:controls?[{name:'Tempo Changer',soundFile:''}]:[],notes});
 const file=path.join(output,name+'.nbs');await writeFile(file,bytes);
 let oldProject,newProject;const times={before:[],after:[]};
 for(let repeat=0;repeat<3;repeat++)for(const[mode,api]of [['before',before.api],['after',after.api]]){const t=performance.now(),result=api.importNbs(bytes,name+'.nbs'),ms=performance.now()-t;if(repeat>0)times[mode].push(ms);if(mode==='before')oldProject=result.project;else newProject=result.project;}
 assert.deepEqual(canonical(newProject),canonical(oldProject),name+' imported semantic content changed');after.api.validateProject(newProject);
 const nbsx=after.api.saveNbsx(newProject),reopened=after.api.openNbsx(nbsx);assert.deepEqual(canonical(reopened),canonical(newProject),name+' saved project changed');
 const projectFile=path.join(output,name+'.nbsx');await writeFile(projectFile,nbsx);
 const exportTimes={before:[],after:[]};let oldExport,newExport;
 for(let repeat=0;repeat<3;repeat++)for(const[mode,api,project]of [['before',before.api,oldProject],['after',after.api,newProject]]){const t=performance.now(),result=api.exportNbs(project,6,20),ms=performance.now()-t;if(repeat>0)exportTimes[mode].push(ms);if(mode==='before')oldExport=result;else newExport=result;}
 assert.deepEqual(newExport.bytes,oldExport.bytes,name+' exported NBS bytes changed');assert.deepEqual(newExport.diagnostics,oldExport.diagnostics);
 const mean=xs=>xs.reduce((s,n)=>s+n,0)/xs.length;
 cases.push({name,input:await ref(file),project:await ref(projectFile),layers,inputNotes:notes.length,importedNotes:newProject.patterns.reduce((n,p)=>n+p.notes.length,0),tempoEvents:newProject.tempos.length,importMs:{before:mean(times.before),after:mean(times.after),samples:times},exportMs:{before:mean(exportTimes.before),after:mean(exportTimes.after),samples:exportTimes},semanticProjectEqual:true,exportedBytesEqual:true,nbsxSavedAndReopened:true,nbsxSha256:digest(nbsx,'sha256'),exportedSha256:digest(newExport.bytes,'sha256')});
}
const files=['src/core/nbs.ts','src/core/project.ts','src/core/time.ts','src/core/container.ts','tests/fixtures/nbs-interop.ts','scripts/audit-nbs-scaling.mjs'],sources={};for(const file of files)sources[file]=digest(await readFile(file),'sha256');
const report={schema:1,status:'passed',scope:'Actual before/after importer and exporter, independently encoded NBS fixtures, semantic project identity, exact exported NBS bytes and NBSX save/reopen. CLI elapsed samples are local measurements, not UI frame-time or broad performance guarantees.',baselineRef,baselineNbs:await ref(path.join(output,'baseline-nbs.ts')),bundles:{before:before.bundle,after:after.bundle},sources,cases};
const file=path.join(output,'report.json');await writeFile(file,JSON.stringify(report,null,2));if(process.argv.includes('--write-evidence'))await writeFile('docs/evidence/nbs-scaling.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,report:file,cases:cases.map(({name,layers,inputNotes,importMs,exportMs})=>({name,layers,inputNotes,importMs:{before:importMs.before,after:importMs.after},exportMs:{before:exportMs.before,after:exportMs.after}}))}));
