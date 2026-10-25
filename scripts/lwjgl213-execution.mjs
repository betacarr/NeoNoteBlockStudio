import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

/** Research children have durable live PID and terminal logs; no timeout restart. */
export async function execute213(executable,args,root,label){
 await mkdir(root,{recursive:true});const file=path.join(root,label+'.process.json'),record={executable,args,cwd:process.cwd(),parentPid:process.pid,startedAt:new Date().toISOString(),terminal:false};
 const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});record.pid=child.pid;await writeFile(file,JSON.stringify(record,null,2)+'\n');let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const reminder=setInterval(()=>console.log(JSON.stringify({observing:true,label,pid:child.pid,process:file})),30000);let terminal;
 try{terminal=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});}catch(error){record.error=String(error);throw error;}finally{clearInterval(reminder);Object.assign(record,terminal,{terminal:true,finishedAt:new Date().toISOString(),stdoutFile:path.join(root,label+'.stdout.log'),stderrFile:path.join(root,label+'.stderr.log')});await writeFile(record.stdoutFile,stdout);await writeFile(record.stderrFile,stderr);await writeFile(file,JSON.stringify(record,null,2)+'\n');}
 assert.equal(record.code,0,`${label}: ${stderr}\n${stdout}`);return{record,file,stdout,stderr};
}

export async function main213(label,fn){
 const root=path.resolve('.local/lwjgl213-executions',label,`run-${Date.now()}`),file=path.join(root,'node.process.json'),record={pid:process.pid,argv:process.argv,startedAt:new Date().toISOString(),terminal:false};await mkdir(root,{recursive:true});await writeFile(file,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({liveNode:process.pid,process:file}));
 try{await fn(root);record.code=0;record.signal=null;}catch(error){record.code=1;record.signal=null;record.error=error.stack??String(error);throw error;}finally{record.terminal=true;record.finishedAt=new Date().toISOString();await writeFile(file,JSON.stringify(record,null,2)+'\n');}
}
