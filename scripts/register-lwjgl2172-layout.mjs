import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {reviewLwjgl2172ResourceSelection} from './review-lwjgl2172-resources.mjs';
import {digest} from './research-utils.mjs';

const reviewed=await reviewLwjgl2172ResourceSelection();
assert.equal(reviewed.status,'passed');assert.equal(reviewed.version,'1.7.2');assert.equal(reviewed.loaderLayout,'default-domain-root');
const client=reviewed.officialSources.clientSha1,index=reviewed.index.sha1;
const filename='src/data/sound-asset-layouts.json',layouts=JSON.parse(await readFile(filename));
assert(layouts.defaultDomainRoot&&layouts.schema===1);
// Keep File-root clients separate from later original ResourceIndex clients.
// Both map the same logical path to a root key in the editor's hash index.
const old=layouts.defaultDomainRoot.clients[client];assert(!old||old==='1.7.2');
if(old){delete layouts.defaultDomainRoot.clients[client];layouts.defaultDomainRoot.assetIndexSha1s=layouts.defaultDomainRoot.assetIndexSha1s.filter(hash=>hash!==index);delete layouts.defaultDomainRoot.sourceEvidenceByClient?.[client];if(!Object.keys(layouts.defaultDomainRoot.sourceEvidenceByClient??{}).length)delete layouts.defaultDomainRoot.sourceEvidenceByClient;}
layouts.virtualLegacyRoot??={clients:{},assetIndexSha1s:[],sourceEvidenceByClient:{}};
const current=layouts.virtualLegacyRoot.clients[client];assert(!current||current==='1.7.2');
layouts.virtualLegacyRoot.clients[client]='1.7.2';
layouts.virtualLegacyRoot.assetIndexSha1s=[...new Set([...layouts.virtualLegacyRoot.assetIndexSha1s,index])];
const evidence='docs/evidence/java-1.7.2-resource-selection.json';
layouts.virtualLegacyRoot.sourceEvidenceByClient[client]={path:evidence,sha256:digest(await readFile(evidence),'sha256'),selection:'original-file-root-default-pack-virtual-legacy-directory'};
await writeFile(filename,JSON.stringify(layouts,null,2)+'\n');
console.log(JSON.stringify({status:'registered',version:'1.7.2',clientSha1:client,assetIndexSha1:index,layout:reviewed.loaderLayout}));
