import{readFile,writeFile,mkdir}from'node:fs/promises';
import path from'node:path';
import assert from'node:assert/strict';
import{build}from'esbuild';
import{pathToFileURL}from'node:url';
import{reviewLwjgl2172ResourceSelection}from'./review-lwjgl2172-resources.mjs';
import{digest}from'./research-utils.mjs';

const sha=b=>digest(b,'sha256');
const root=path.resolve('.local/lwjgl2172-loader',`run-${Date.now()}`);await mkdir(root,{recursive:true});
const ref=async file=>({path:path.relative(process.cwd(),file).replaceAll('\\','/'),sha256:sha(await readFile(file))});
const report={schema:1,status:'running',version:'1.7.2',worldScenesAdded:0,scope:'Actual production resource loader against independently recorded original File-root resource reads. No native context, waveform or world measurement.'};
try{
 const original=await reviewLwjgl2172ResourceSelection();
 const bundle=path.join(root,'production-loader.mjs');
 const built=await build({stdin:{contents:"export {soundAssetLayout,loadNoteBlockSoundAssets} from './src/core/sound-assets.ts';",resolveDir:process.cwd(),sourcefile:'lwjgl2172-loader-fixture.ts'},outfile:bundle,bundle:true,platform:'node',format:'esm',metafile:true});
 const files=Object.keys(built.metafile.inputs).filter(f=>!f.endsWith('fixture.ts'));report.sourceHashes={};
 for(const file of [...files,'scripts/verify-lwjgl2172-loader.mjs','scripts/register-lwjgl2172-layout.mjs','scripts/review-lwjgl2172-resources.mjs'])report.sourceHashes[file]=sha(await readFile(file));
 const product=await import(pathToFileURL(bundle).href),index=JSON.parse(await readFile(original.index.path));
 const selection=product.soundAssetLayout(original.officialSources.clientSha1,index);assert.equal(selection,'default-domain-root');
 const bySha=new Map(original.expected.map(o=>[o.sha1,o])),reads=[];
 const loaded=await product.loadNoteBlockSoundAssets(index,selection,async object=>{const expected=bySha.get(object.hash);assert(expected,'Unreviewed resource '+object.hash);const bytes=await readFile(expected.file);assert.equal(digest(bytes),object.hash);reads.push({sha1:object.hash,bytes:bytes.length});return new Uint8Array(bytes);});
 const names=['harp','bass','basedrum','snare','hat','pling'];assert.deepEqual(Object.keys(loaded.samples).sort(),[...names].sort());assert.equal(reads.length,7);
 report.observations=[];
 for(const id of names){const sample=loaded.samples[id],event=loaded.soundEvents[id],expected=original.expected.find(o=>o.virtualRelativePath===sample.name);assert(expected);const actualOriginal=original.observations.find(o=>o.logicalPath===expected.logicalPath);assert(actualOriginal);assert.equal(digest(sample.bytes),actualOriginal.sha1);assert.equal(sample.bytes.length,actualOriginal.bytes);assert.equal(sample.sha1,actualOriginal.sha1);assert.equal(event.volume,1);assert.equal(event.pitch,1);assert.equal(event.attenuationDistance,16);report.observations.push({instrument:id,event:event.event,path:sample.name,bytes:sample.bytes.length,sha1:sample.sha1,originalRead:actualOriginal,exact:true});}
 assert.equal(loaded.soundEvents.bass.event,'note.bassattack');assert.equal(loaded.samples.bass.name,'sounds/note/bassattack.ogg');
 const conflict={objects:{...index.objects,'minecraft/sounds.json':{hash:'unselected-decoy',size:1}}};
 assert.equal(product.soundAssetLayout(original.officialSources.clientSha1,conflict),'default-domain-root');
 assert.throws(()=>product.soundAssetLayout('unchecked-client',index),/尚未核对/);
 assert.throws(()=>product.soundAssetLayout('unchecked-client',{objects:{'newsound/note/harp.ogg':index.objects['sounds/note/harp.ogg']}}),/尚未核对/);
 for(const[f,h]of Object.entries(report.sourceHashes))assert.equal(sha(await readFile(f)),h,'Source changed '+f);
 report.status='passed';report.originalEvidence=await ref(path.resolve('docs/evidence/java-1.7.2-resource-selection.json'));report.productionBundle=await ref(bundle);report.reads=reads;report.layout=selection;report.clientSha1=original.officialSources.clientSha1;
 report.limitations=['Seven actual original reads comprise the definition and six sound resources; only five instruments are material-selectable in the original block. Pling remains a resource, not a new block instrument.','Conflicting namespace and unknown-client guards are deterministic loader checks, not additional original Java calls.','No neighbor release, shared index, native context or original-world acceptance is inherited.'];
}catch(error){report.status='failed';report.error=error.stack??String(error);throw error;}
finally{await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n');if(report.status==='passed'&&process.argv.includes('--write-evidence'))await writeFile('docs/evidence/java-1.7.2-resource-loader.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,report:path.join(root,'report.json'),resources:report.observations?.length,worldScenesAdded:0}));}
