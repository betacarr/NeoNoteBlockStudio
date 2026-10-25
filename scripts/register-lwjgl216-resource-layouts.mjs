import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {lwjgl216Versions,reviewedLwjgl216Resources} from './review-lwjgl216-profiles.mjs';

const file='src/data/sound-asset-layouts.json',data=JSON.parse(await readFile(file));
assert.equal(data.schema,1);
const family=data.legacySound??={clients:{},assetIndexSha1s:[],events:{harp:'harp',bass:'bassattack',basedrum:'bd',snare:'snare',hat:'hat',pling:'pling'},sourceEvidenceByClient:{}};
const updates=[];
for(const version of lwjgl216Versions){
 const r=await reviewedLwjgl216Resources(version);assert.equal(r.layout,'legacy-sound');assert.equal(r.acceptedPrefix,'sound');
 const client=r.officialSources.clientSha1,index=r.assetIndex.sha1;
 assert(!family.clients[client]||family.clients[client]===version);
 family.clients[client]=version;family.assetIndexSha1s=[...new Set([...family.assetIndexSha1s,index])];family.sourceEvidenceByClient[client]=r.resourceEvidence;
 updates.push({version,client,layout:r.layout});
}
await writeFile(file,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify({status:'registered',updates}));
