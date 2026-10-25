import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';
import { historicalClassfile } from './historical-classfile.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';

const fixture=JSON.parse(await readFile('.local/game-fixtures/1.7.10/fixture.json'));
const metadata=JSON.parse(await readFile('.research/metadata/1.7.10.json'));
const artifact=metadata.libraries.find(item=>item.name==='org.lwjgl.lwjgl:lwjgl:2.9.1').downloads.artifact;
const library=path.join(fixture.root,'libraries',artifact.path),bytes=await readFile(library);assert.equal(digest(bytes),artifact.sha1);
const archive=unzipSync(bytes),bindings=[];
for(const [owner,keys] of [['org/lwjgl/openal/ALC10',['alcCreateContext(Lorg/lwjgl/openal/ALCdevice;Ljava/nio/IntBuffer;)Lorg/lwjgl/openal/ALCcontext;']],['org/lwjgl/openal/ALCcontext',['createAttributeList(III)Ljava/nio/IntBuffer;']],['org/lwjgl/MemoryUtil',['getAddressSafe(Ljava/nio/IntBuffer;)J','getAddress(Ljava/nio/IntBuffer;)J','getAddress(Ljava/nio/IntBuffer;I)J']],['org/lwjgl/openal/AL',['create()V','init(Ljava/lang/String;IIZZ)V']]]) {
  const original=archive[owner+'.class'];assert(original);const parsed=historicalClassfile(original),hashes=methodCodeHashes(original);
  for(const key of keys){assert(hashes[key]);assert(parsed.methods.some(m=>m.name+m.descriptor===key));bindings.push({owner,method:key,classSha1:digest(original),codeSha256:hashes[key]});}
}
const root=path.resolve('.local/lwjgl21710-context-audit',String(Date.now()));await mkdir(root,{recursive:true});
const source='scripts/java/Lwjgl21710ContextAudit.java',asm=path.resolve('.research/tools/asm-9.7.1.jar'),jna=path.resolve('.research/libraries/net/java/dev/jna/jna/4.4.0/jna-4.4.0.jar'),cp=[asm,jna,...fixture.classpath].join(path.delimiter);
const execute=(cmd,args)=>{const result=spawnSync(cmd,args,{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);return result;};
execute('javac',['--release','8','-cp',cp,'-d',root,source]);
const manifest=path.join(root,'MANIFEST.MF');await writeFile(manifest,'Manifest-Version: 1.0\nPremain-Class: studio.nbsx.research.Lwjgl21710ContextAudit\n\n');const agent=path.join(root,'context-audit.jar');execute('jar',['cfm',agent,manifest,'-C',root,'studio']);
const output=path.join(root,'actual.properties');const run=execute('java',[`-Dorg.lwjgl.librarypath=${fixture.nativeDir}`,`-Djava.library.path=${fixture.nativeDir}`,`-javaagent:${agent}`,'-cp',[agent,cp].join(path.delimiter),'studio.nbsx.research.Lwjgl21710ContextAudit',output]);
await writeFile(path.join(root,'console.log'),run.stdout+run.stderr);
const properties=Object.fromEntries((await readFile(output,'utf8')).split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));
assert.equal(properties['entry.position'],'7');assert.equal(properties['entry.limit'],'7');assert.equal(properties['entry.capacity'],'7');assert.equal(properties['entry.nativeAddressOffsetBytes'],'28');assert.equal(properties['entry.observerMutatedOriginal'],'false');assert.equal(properties['actual.contextCreated'],'true');
const report={schema:1,version:'1.7.10',artifact,librarySha1:digest(bytes),source,sourceSha256:digest(await readFile(source),'sha256'),scriptSha256:digest(await readFile('scripts/probe-lwjgl21710-context.mjs'),'sha256'),bindings,root,properties,interpretation:{entryHook:'visitCode before any original ALC10.alcCreateContext instruction; observer returns void and never replaces argument',bounds:'IntBuffer capacity7, position7, native address is base+28 bytes',nativeFirstWordScope:'One read at the same address which original nalcCreateContext reads; this address is outside declared Java buffer. A zero observation is not a guarantee for another allocation/process.',captureRemainingPairs:'[] means no Java remaining pairs, not a certified native attr list',regularDeviceContext:'Original AL.create() unchanged; no sound and no loopback substitution'}};
await writeFile('docs/evidence/java-1.7.10-context-pointer.json',JSON.stringify(report,null,2));console.log(JSON.stringify({root,properties}));
