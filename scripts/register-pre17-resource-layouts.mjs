import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {reviewPre17Resources,reviewedPre17ResourceVersions,pre17Events} from './review-pre17-resources.mjs';
const filename='src/data/sound-asset-layouts.json',layouts=JSON.parse(await readFile(filename));assert.equal(layouts.schema,1);assert(layouts.legacyNewsound);
const records=[];for(const version of reviewedPre17ResourceVersions)records.push(await reviewPre17Resources(version));
for(const r of records){const key=r.sourcePrefix==='newsound'?'legacyNewsound':'legacySound3';layouts[key]??={clients:{},assetIndexSha1s:[],events:pre17Events,sourceEvidenceByClient:{}};const family=layouts[key];assert.deepEqual(family.events,pre17Events);assert(!family.clients[r.clientSha1]||family.clients[r.clientSha1]===r.version);family.clients[r.clientSha1]=r.version;family.assetIndexSha1s=[...new Set([...family.assetIndexSha1s,r.assetIndexSha1])];family.sourceEvidenceByClient??={};family.sourceEvidenceByClient[r.clientSha1]=r.sourceEvidence;}
await writeFile(filename,JSON.stringify(layouts,null,2)+'\n');console.log(JSON.stringify({status:'registered',versions:records.length,newsound:records.filter(r=>r.sourcePrefix==='newsound').length,sound3:records.filter(r=>r.sourcePrefix==='sound3').length,fullAudioProfilesPromoted:0}));
