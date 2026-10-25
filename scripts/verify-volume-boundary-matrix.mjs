import{readFile,writeFile}from'node:fs/promises';import{spawn}from'node:child_process';import path from'node:path';import assert from'node:assert/strict';import{digest}from'./research-utils.mjs';
const arg=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined;
const file=path.resolve(arg('--manifest')??'.local/world-volume-boundary/boundary-matrix.json'),manifest=JSON.parse(await readFile(file,'utf8'));
assert.equal(manifest.worldScenes,46);assert.equal(manifest.cohorts.length,6);
const output=path.resolve('.local/world-volume-boundary',`matrix-verification-${Date.now()}.json`),result={schema:1,manifest:file,manifestSha256:digest(await readFile(file),'sha256'),scriptSha256:digest(await readFile('scripts/verify-volume-boundary-matrix.mjs'),'sha256'),status:'running',cohorts:[]};
let sources;
try{for(const cohort of manifest.cohorts){
 const bytes=await readFile(path.join(cohort.directory,'provenance.json'));assert.equal(digest(bytes,'sha256'),cohort.provenanceSha256);const p=JSON.parse(bytes);assert.equal(p.version,cohort.version);assert.equal(p.hrtf,false);assert.equal(p.recordCategoryVolume,cohort.records);assert.equal(p.masterGain,cohort.master);
 const child=spawn(process.execPath,['scripts/verify-volume-boundary-world.mjs','--version',cohort.version,'--capture',cohort.capture,'--broadcast','--write-evidence','--evidence-name',cohort.evidenceName],{windowsHide:true,stdio:'inherit'});
 const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});assert.equal(exit,0,`Strict comparison failed; original capture retained: ${cohort.directory}`);
 const reportFile=path.resolve(`docs/evidence/${cohort.evidenceName}.json`),report=JSON.parse(await readFile(reportFile));assert(report.exact);assert.equal(report.observations.length,cohort.count);assert.equal(report.broadcast,true);assert.equal(report.settings.hrtf,false);
 if(sources)assert.deepEqual(report.rendererSources,sources,'Renderer sources changed during the matrix');else sources=report.rendererSources;
 result.cohorts.push({...cohort,report:reportFile,sha256:digest(await readFile(reportFile),'sha256'),exact:true});await writeFile(output,JSON.stringify(result,null,2));
 }
 result.status='complete';result.worldScenes=result.cohorts.reduce((sum,c)=>sum+c.count,0);await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify({worldScenes:result.worldScenes,reports:result.cohorts.length,exact:true,output}));
}catch(error){result.status='failed';result.error=String(error);await writeFile(output,JSON.stringify(result,null,2));throw error;}
