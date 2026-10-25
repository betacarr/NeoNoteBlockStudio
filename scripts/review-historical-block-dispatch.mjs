import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { digest } from './research-utils.mjs';
import { historicalClassfile } from './historical-classfile.mjs';
import { historicalWorldPatchVersions } from './audit-historical-world-source.mjs';
import { reviewHistoricalWorldSource } from './review-historical-world-source.mjs';

const filename = 'docs/evidence/historical-world-block-dispatch.json';
const hash = bytes => digest(bytes, 'sha256');
function methodSection(text, key) {
  const at = key.indexOf('('), name = key.slice(0, at), descriptor = key.slice(at), lines = text.split(/\r?\n/);
  const begin = lines.findIndex((line, i) => line.trim() === `descriptor: ${descriptor}` && new RegExp(`\\b${name}\\(`).test(lines[i - 1])); assert(begin >= 0, key);
  let end = begin + 1; while (end < lines.length && !/^  (?:public|protected|private|static)/.test(lines[end]) && lines[end] !== '}') end++;
  return lines.slice(begin - 1, end).join('\n');
}
async function inspect(version) {
  const source = `docs/evidence/java-${version}-world-source.json`, sourceBytes = await readFile(source), world = await reviewHistoricalWorldSource(version);
  const roles = world.roles, stateKey = `a(L${roles.World};L${roles.BlockPos};II)Z`, overrideKey = `a(L${roles.BlockState};L${roles.World};L${roles.BlockPos};II)Z`;
  const classes = ['ServerWorld', 'BlockState', 'Block', 'NoteBlock'].map(role => world.classes.find(entry => entry.originalName === roles[role])); assert(classes.every(Boolean));
  const binding = (role, key) => { const entry = classes.find(item => item.originalName === roles[role]); assert(entry.methods[key]); const at = key.indexOf('('); return { owner: entry.originalName, member: key.slice(0, at), descriptor: key.slice(at), codeSha256: entry.methods[key] }; };
  const state = classes[1], parsed = historicalClassfile(await readFile(state.rawClass)), method = parsed.methods.find(item => item.name + item.descriptor === stateKey);
  assert(method.attributes.some(item => item.name === 'Code')); const isInterface = Boolean(parsed.access & 0x0200);
  assert.equal(isInterface, version.startsWith('1.13')); if (isInterface) assert(method.access & 1);
  const stateText = methodSection(await readFile(state.rawDisassembly, 'utf8'), stateKey);
  assert(stateText.includes(`invokevirtual`)); assert(stateText.includes(`Method ${roles.Block}.${overrideKey.slice(0, 1)}:${overrideKey.slice(1)}`));
  const server = classes[0], serverKey = `a(L${roles.BlockEvent};)Z`, serverText = methodSection(await readFile(server.rawDisassembly, 'utf8'), serverKey);
  assert(serverText.includes(`if_acmpne`)); assert(serverText.includes(`${roles.BlockEvent}.b:()L${roles.Block};`)); assert(serverText.includes(`${roles.BlockState}.a:${stateKey.slice(1)}`));
  const note = classes[3], noteText = methodSection(await readFile(note.rawDisassembly, 'utf8'), overrideKey); assert(noteText.includes('java/lang/Math.pow')); assert(noteText.includes('float 3.0f'));
  return { version, clientSha1: world.clientSha1, frozenWorldSource: { path: source, sha256: hash(sourceBytes) },
    classes: classes.map(entry => ({ originalName: entry.originalName, bytecodeSha1: entry.bytecodeSha1, bytecodeSha256: entry.bytecodeSha256, rawClass: entry.rawClass, rawDisassembly: entry.rawDisassembly, disassemblySha256: entry.disassemblySha256 })),
    bindings: [binding('ServerWorld', serverKey), binding('BlockState', stateKey), binding('Block', overrideKey), binding('NoteBlock', overrideKey)],
    stateDispatchKind: isInterface ? 'original-interface-default-method-with-Code-body' : 'original-concrete-class-method-with-Code-body',
    proof: ['Server event compares actual state block identity to queued event block before dispatch.', 'Original state event method has its own Code body and invokes the Block event virtually with this state.', 'Original NoteBlock overrides exactly the same descriptor and emits its selected instrument sound at volume 3.', 'The legacy state interface default-method body was already part of the frozen world-source class and method hash inventory; no unverified concrete implementation is substituted.'],
    integratedWorldScenesAdded: 0 };
}
export async function reviewHistoricalBlockDispatch(version) {
  assert(historicalWorldPatchVersions.includes(version)); const report = JSON.parse(await readFile(filename)), record = report.records.find(item => item.version === version); assert(record);
  assert.deepEqual(record, await inspect(version)); return record;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    const records = []; for (const version of historicalWorldPatchVersions) records.push(await inspect(version));
    await writeFile(filename, JSON.stringify({ schema: 1, records, integratedWorldScenesAdded: 0, scope: 'Supplemental proof over already-cached frozen original classes; no new collection or inherited world scenes.' }, null, 2) + '\n');
  }
  for (const version of historicalWorldPatchVersions) { const record = await reviewHistoricalBlockDispatch(version); console.log(JSON.stringify({ version, bindings: record.bindings.length, kind: record.stateDispatchKind, verified: true })); }
}
