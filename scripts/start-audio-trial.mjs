import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const report=JSON.parse(await readFile(path.join(workspace,'.local','audio-model-final-report.json'),'utf8'));
const profile=path.resolve(report.trialProfile),project=path.resolve(report.trialProject),local=path.join(workspace,'.local')+path.sep;
if(!profile.startsWith(local)||!project.startsWith(local)||!project.endsWith('.nbsx'))throw new Error('Trial paths must stay inside this workspace QA directory.');
await stat(project);await stat(profile);
const executable=path.join(workspace,'node_modules','electron','dist',process.platform==='win32'?'electron.exe':'electron');await stat(executable);
if(process.argv.includes('--check')){console.log(JSON.stringify({profile,project,modelCache:'Verified on-demand cache; no file copying or new model download.'}));}
else{const env={...process.env,NBSX_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.NBSX_DEV_URL;const child=spawn(executable,[workspace,project,'--user-data-dir='+profile],{cwd:workspace,env,detached:true,windowsHide:true,stdio:'ignore'});child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.unref();}
