import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {reviewedJava10Resources} from './review-java10-resources.mjs';
const r=await reviewedJava10Resources(),file='src/data/sound-asset-layouts.json',layouts=JSON.parse(await readFile(file));
const existing=layouts.legacyNewsound;
if(existing)assert.deepEqual(existing.events,r.events);
layouts.legacyNewsound={...existing,clients:{...existing?.clients,[r.clientSha1]:r.version},assetIndexSha1s:[...new Set([...(existing?.assetIndexSha1s??[]),r.assetIndexSha1])],events:r.events,sourceEvidence:r.sourceEvidence};
await writeFile(file,JSON.stringify(layouts,null,2)+'\n');console.log(JSON.stringify({status:'passed',version:r.version,clientSha1:r.clientSha1,events:Object.keys(r.events).length,fullAudioProfilePromoted:false}));
