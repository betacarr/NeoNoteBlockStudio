import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const rejectedOriginalHashTypo='9261b66010a845ddef9f61d5e4266fe2f08a53f3605da002e9e8f8d202bbdc5e';

/** Parse literal bytes, never a separately copied display string. Does not load a DLL. */
export function parseControllerOriginalHash(source){
 const code=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,''),matches=[...code.matchAll(/\bstatic\s+const\s+u8\s+originalHash\s*\[\s*32\s*\]\s*=\s*\{([^}]+)\}\s*;/g)];
 assert.equal(matches.length,1,'Exactly one originalHash[32] literal declaration required');
 const tokens=matches[0][1].split(',').map(x=>x.trim());assert.equal(tokens.length,32,'SHA-256 array must contain exactly32 bytes');
 for(const token of tokens)assert(/^0x[0-9a-fA-F]{2}$/.test(token),'Hash entries must be literal byte values: '+token);
 assert(/hashFile\s*\(\s*modulePath\s*,\s*originalHash\s*\)/.test(code),'The parsed originalHash must guard the actual loaded original module file');
 return Buffer.from(tokens.map(x=>parseInt(x.slice(2),16))).toString('hex');
}
export function verifyControllerOriginalIdentity(source,reviewedSha256,originalDll,compiledController){
 assert(/^[a-f0-9]{64}$/.test(reviewedSha256));const actualDllSha256=sha(originalDll),literal=parseControllerOriginalHash(source);
 assert.equal(actualDllSha256,reviewedSha256,'Original DLL bytes differ from reviewed binary identity');
 assert.equal(literal,reviewedSha256,'C++ originalHash bytes differ from reviewed original DLL SHA-256');assert.equal(literal,actualDllSha256);
 let compiledOffset=null;if(compiledController){compiledOffset=compiledController.indexOf(Buffer.from(literal,'hex'));assert(compiledOffset>=0,'Actual compiled controller must contain the verified32-byte originalHash value');}
 return{cppOriginalHashBytesHex:literal,reviewedOriginalDllSha256:reviewedSha256,actualOriginalDllSha256:actualDllSha256,compiledOriginalHashFileOffset:compiledOffset,verifiedWithoutLoadingDll:true};
}
export function controllerIdentityNegativeTests(source,reviewedSha256,originalDll,compiledController){
 verifyControllerOriginalIdentity(source,reviewedSha256,originalDll,compiledController);const results=[],replace=hex=>source.replace(/(\boriginalHash\s*\[\s*32\s*\]\s*=\s*\{)[^}]+(\})/,(_,a,b)=>a+hex.match(/../g).map(x=>'0x'+x).join(',')+b);
 const reject=(name,fn)=>{assert.throws(fn,undefined,name);results.push({name,rejected:true});};
 reject('exact-previous-bb-dc-typo',()=>verifyControllerOriginalIdentity(replace(rejectedOriginalHashTypo),reviewedSha256,originalDll,compiledController));
 const flipped=Buffer.from(reviewedSha256,'hex');flipped[0]^=1;reject('one-byte-mismatch',()=>verifyControllerOriginalIdentity(replace(flipped.toString('hex')),reviewedSha256,originalDll,compiledController));
 reject('truncated31-byte-array',()=>verifyControllerOriginalIdentity(replace(reviewedSha256.slice(0,-2)),reviewedSha256,originalDll,compiledController));
 reject('oversized33-byte-array',()=>verifyControllerOriginalIdentity(replace(reviewedSha256+'00'),reviewedSha256,originalDll,compiledController));
 reject('different-reviewed-identity',()=>verifyControllerOriginalIdentity(source,rejectedOriginalHashTypo,originalDll,compiledController));
 const wrongDll=Buffer.from(originalDll);wrongDll[0]^=1;reject('actual-original-file-mutation',()=>verifyControllerOriginalIdentity(source,reviewedSha256,wrongDll,compiledController));
 reject('old-compiled-array-with-correct-source',()=>verifyControllerOriginalIdentity(source,reviewedSha256,originalDll,Buffer.from(rejectedOriginalHashTypo,'hex')));
 return results;
}
