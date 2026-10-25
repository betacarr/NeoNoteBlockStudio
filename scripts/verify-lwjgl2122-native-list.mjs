import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {digest} from './research-utils.mjs';
import {nativeListEvidenceFile} from './audit-lwjgl2122-native-list.mjs';
import {reviewLwjgl2122NativeListEvidence} from './review-lwjgl2122-native-list.mjs';
const baseline=JSON.parse(await readFile(nativeListEvidenceFile)),root=path.resolve('.local/lwjgl2122-native-list',`validation-${Date.now()}`);await mkdir(root,{recursive:true});
const valid=await reviewLwjgl2122NativeListEvidence();
const mutations=[
 ['promote-old49',r=>r.archived49Promoted=true],
 ['invent-world-count',r=>r.acceptedWorldScenesAdded=49],
 ['pretend-replacement-was-original',r=>r.originalNativeArgumentsReplaced=true],
 ['pointer-is-declared-buffer',r=>r.probe.journal.actualPointer=r.probe.journal.base],
 ['fake-native-list',r=>r.probe.journal.before.words[0]=1234],
 ['unterminated-is-accepted',r=>r.probe.journal.before.status=2],
 ['unstable-native-list',r=>r.probe.properties.prePostSame='false'],
 ['fake-effective-dsp',r=>r.probe.nativeTrace.hrtf='enabled'],
 ['fake-observer-abi',r=>r.probe.properties['abi.pointerSize']='4'],
 ['wrong-native-module',r=>r.probe.moduleHashes['actual.openalModule'].sha256='0'.repeat(64)],
 ['wrong-original-method',r=>r.inputs.originalClass.methodCodeSha256='0'.repeat(64)],
 ['wrong-native-source',r=>r.officialParser.sha256='0'.repeat(64)],
 ['drop-source-closure',r=>delete r.sources['scripts/java/Lwjgl2122NativeListObserver.java']],
 ['erase-failed-attempts',r=>r.previousAttempts=[]],
 ['nonterminal-success',r=>r.probe.exit=null],
];
const rejected=[];for(const[name,mutate]of mutations){const r=structuredClone(baseline);mutate(r);const file=path.join(root,`${name}.json`);await writeFile(file,JSON.stringify(r));await assert.rejects(()=>reviewLwjgl2122NativeListEvidence(file),undefined,name);rejected.push(name);}
const result={verified:true,evidence:nativeListEvidenceFile,evidenceSha256:digest(await readFile(nativeListEvidenceFile),'sha256'),positiveReviews:1,negativeFixturesRejected:rejected.length,rejected,instructionProof:valid.instructionProof,actualOriginalRegularContextCalls:baseline.previousAttempts.filter(a=>a.exit===0&&a.journal?.phase===5).length+1,failedAttemptsPreserved:baseline.previousAttempts.filter(a=>a.exit!==0).length,worldScenesAdded:0,validationSourceSha256:digest(await readFile('scripts/verify-lwjgl2122-native-list.mjs'),'sha256')};await writeFile(path.join(root,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,...result}));
