import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {lwjgl215Versions,reviewedLwjgl215Resources} from './review-lwjgl215-profiles.mjs';
const file='src/data/sound-asset-layouts.json',data=JSON.parse(await readFile(file));assert(data.schema===1&&data.legacySound3);
const updates=[];for(const version of lwjgl215Versions){const r=await reviewedLwjgl215Resources(version);assert.equal(r.layout,'legacy-sound3');assert.equal(r.acceptedPrefix,'sound3');const client=r.officialSources.client.sha1,index=r.officialSources.assetIndex.sha1,family=data.legacySound3;assert(!family.clients[client]||family.clients[client]===version);family.clients[client]=version;family.assetIndexSha1s=[...new Set([...family.assetIndexSha1s,index])];family.sourceEvidenceByClient[client]=r.resourceEvidence;updates.push({version,client,layout:r.layout});}
await writeFile(file,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify({status:'registered',updates}));
