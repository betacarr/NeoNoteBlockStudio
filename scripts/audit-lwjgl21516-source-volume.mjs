import {readFile,writeFile,mkdir,readdir,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {versions,sources,reportFile,hash,ref,originalInventory,bindings,inputTsv,verifyOutput,scope} from './lwjgl21516-volume-common.mjs';

async function executable(name){for(const dir of process.env.PATH.split(path.delimiter)){const file=path.join(dir,name+'.exe');try{await access(file);return path.resolve(file);}catch{}}throw Error('Executable unavailable: '+name);}
async function run(exe,args,root,label){
 const file=path.join(root,label+'.process.json'),p={executable:exe,executableSha256:hash(await readFile(exe)),args,cwd:process.cwd(),parentPid:process.pid,startedAt:new Date().toISOString(),terminal:false};
 const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});p.pid=child.pid;await writeFile(file,JSON.stringify(p,null,2)+'\n');let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const pending=setInterval(()=>console.log(JSON.stringify({observing:label,pid:p.pid,process:file})),30000);
 try{Object.assign(p,await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));}));}finally{clearInterval(pending);p.terminal=true;p.finishedAt=new Date().toISOString();p.stdoutFile=path.join(root,label+'.stdout.log');p.stderrFile=path.join(root,label+'.stderr.log');await writeFile(p.stdoutFile,stdout);await writeFile(p.stderrFile,stderr);await writeFile(file,JSON.stringify(p,null,2)+'\n');}
 assert.equal(p.code,0,`${label}\n${stderr}\n${stdout}`);assert.equal(p.signal,null);return{file,stdout,stderr};
}
async function classFiles(dir){const out={};for(const e of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())Object.assign(out,await classFiles(file));else if(e.name.endsWith('.class'))out[path.relative(process.cwd(),file).replaceAll('\\','/')]=hash(await readFile(file));}return out;}
export async function auditSourceVolume(){
 const root=path.resolve('.local/lwjgl21516-source-volume',`run-${Date.now()}`);await mkdir(root,{recursive:true});const nodeFile=root+'/node.process.json',node={pid:process.pid,executable:process.execPath,executableSha256:hash(await readFile(process.execPath)),argv:process.argv,startedAt:new Date().toISOString(),terminal:false};await writeFile(nodeFile,JSON.stringify(node,null,2)+'\n');console.log(JSON.stringify({liveNode:process.pid,root}));
 try{
  const tools=Object.fromEntries(await Promise.all(['javap','javac','java'].map(async n=>[n,await executable(n)]))),entries=[];
  for(const version of versions){
   const output=root+'/'+version;await mkdir(output,{recursive:true});const original=await originalInventory(version),texts={},disassembly={},processes=[];
   for(const c of original.classes){const label='javap-'+c.role,result=await run(tools.javap,['-J-XX:ActiveProcessorCount=2','-p','-s','-c','-classpath',c.archive,c.name.replaceAll('/','.')],output,label);assert.equal(result.stderr,'');texts[c.name]=result.stdout;disassembly[c.name]=await ref(output+'/'+label+'.stdout.log');processes.push(await ref(result.file));}
   const bound=bindings(original,texts),inputFile=output+'/inputs.tsv';await writeFile(inputFile,inputTsv());
   // The only dependency for 1.6 is the original pure-Java SoundSystem artifact. No LWJGL archive is on this classpath.
   const classpath=[output,...original.artifacts.map(a=>path.resolve(a.file))].join(path.delimiter),compile=await run(tools.javac,['--release','8','-cp',classpath,'-d',output,'scripts/java/Lwjgl21516SourceVolumeProbe.java'],output,'javac');processes.push(await ref(compile.file));
   const java=await run(tools.java,['-XX:ActiveProcessorCount=2','-cp',classpath,'studio.nbsx.research.Lwjgl21516SourceVolumeProbe',inputFile],output,'java');assert.equal(java.stderr,'');processes.push(await ref(java.file));
   const checks=verifyOutput(java.stdout),entry={...original,output,bindings:bound,disassembly,processes,classpath,input:await ref(inputFile),compiledClasses:await classFiles(output),javaOutput:await ref(output+'/java.stdout.log'),checks,scope};entries.push(entry);console.log(JSON.stringify({version,...checks,javaProcess:java.file}));
  }
  Object.assign(node,{terminal:true,code:0,signal:null,finishedAt:new Date().toISOString()});await writeFile(nodeFile,JSON.stringify(node,null,2)+'\n');
  const report={schema:1,status:'passed',classification:'original-java-base-library-source-volume-components-only',versions,entries,scope,totals:{versions:entries.length,rows:entries.reduce((n,e)=>n+e.checks.rows,0),bitComparisons:entries.reduce((n,e)=>n+e.checks.bitComparisons,0)},nodeProcess:await ref(nodeFile),sources:Object.fromEntries(await Promise.all(sources.map(async f=>[f,hash(await readFile(f))]))),mappingScope:'Manual SoundManager role from frozen per-client audit; exact original class/Code and official metadata identities rechecked independently. No official mappings asserted.',executionBoundary:'Original Library and Source allocated using Unsafe; sourceMap contains the real base Source. Source.positionChanged is original Code return. Original private CommandSetVolume and CommandObject14 -> CommandQueue(non-null) -> CommandQueue(null) execute unchanged. Public SoundSystem.setVolume is Code-bound only because no CommandThread is created.',mathScope:'Finite Library arguments, plus component inputs float(unit(instanceFloat)*masterFloat), master0..2. This validates the downstream source clamp; upstream manager semantics are Code-bound and covered by existing independent audits. No manager/worker/native PCM comparison.'};
  const rawFile=root+'/report.json';await writeFile(rawFile,JSON.stringify(report,null,2)+'\n');const publicReport={...report,rawReport:await ref(rawFile)};await writeFile(reportFile,JSON.stringify(publicReport,null,2)+'\n');console.log(JSON.stringify({status:'passed',report:reportFile,sha256:hash(await readFile(reportFile)),totals:report.totals}));return publicReport;
 }catch(error){Object.assign(node,{terminal:true,code:1,signal:null,error:error.stack,finishedAt:new Date().toISOString()});await writeFile(nodeFile,JSON.stringify(node,null,2)+'\n');await writeFile(root+'/failure.json',JSON.stringify({error:error.stack,root},null,2)+'\n');throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await auditSourceVolume();
