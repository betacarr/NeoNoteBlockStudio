import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { digest, verifiedArtifact } from './research-utils.mjs';
import { discoverLwjgl219 } from './audit-lwjgl219-source.mjs';
import { originalSection } from './review-lwjgl219-source.mjs';

const found = await discoverLwjgl219('1.9'), inventory = JSON.parse(await readFile(`${found.root}/inventory.json`));
const root = path.resolve('.local/lwjgl219-methods', `run-${Date.now()}`); await mkdir(root, { recursive: true });
const artifacts = [], classpath = [path.resolve(found.client)];
for (const item of found.metadata.libraries) {
  let allowed = !item.rules; for (const rule of item.rules ?? []) if (!rule.os || rule.os.name === 'windows') allowed = rule.action === 'allow';
  if (!allowed || !item.downloads?.artifact) continue;
  const artifact = item.downloads.artifact, file = path.join('.research/libraries', artifact.path); await verifiedArtifact(artifact, file); classpath.push(path.resolve(file)); artifacts.push(artifact);
}
const asmUrl = 'https://repo.maven.apache.org/maven2/org/ow2/asm/asm/9.7.1/asm-9.7.1.jar';
const checksum = await fetch(asmUrl + '.sha256').then(response => { assert(response.ok); return response.text(); }).then(text => text.trim());
const asm = path.resolve('.research/tools/asm-9.7.1.jar'); await verifiedArtifact({ url: asmUrl, sha256: checksum }, asm, 'sha256');
const text = async role => readFile(inventory.classes.find(c => c.originalName === found.roles[role]).rawDisassembly, 'utf8');
const section = async (role, key) => originalSection(await text(role), found.roles[role], key);
const roles = found.roles;
const config = { ...roles, version: '1.9', gainMethod: 'e', pitchMethod: 'd', volumeGetter: 'g', pitchGetter: 'h', masterField: 'a' };
config.engineOptionsField = found.classes.get(roles.SoundEngine).fields.find(field => field.descriptor === `L${roles.Options};`).name;
config.optionMapField = /Field (\w+):Ljava\/util\/Map;/.exec(await section('Options', `a(L${roles.Category};)F`))[1];
config.sampleField = found.classes.get(roles.AbstractSound).fields.find(field => field.descriptor === `L${roles.SoundDefinition};`).name;
config.definitionType = /\(Ljava\/lang\/String;FFIL([^;]+);Z\)V/.exec(found.classes.get(roles.SoundDefinition).methods.find(method => method.name === '<init>').descriptor)[1];
config.attenuationType = `${roles.SoundInstance}$a`;
const noteKey = Object.keys(inventory.classes.find(c => c.originalName === roles.NoteBlock).methods).find(key => key.endsWith(';II)Z'));
config.recordField = new RegExp(`Field ${roles.Category}\\.(\\w+):`).exec(await section('NoteBlock', noteKey))[1];
const blockDefaults = found.classes.get(roles.Block).methods.filter(method => method.descriptor === `()L${roles.BlockState};`); assert.equal(blockDefaults.length, 1); config.defaultStateMethod = blockDefaults[0].name;
const blockInitializer = await section('Blocks', '<clinit>()V');
const blockField = name => { const match = new RegExp(`String ${name}\\s[\\s\\S]*?putstatic[^\\n]+Field (\\w+):`).exec(blockInitializer); assert(match, name); return match[1]; };
config.airField = blockField('air'); const supports = ['dirt', 'stone', 'sand', 'glass', 'planks'].map(block => ({ block, field: blockField(block) })); config.supportFields = supports.map(item => item.field).join(',');
await writeFile(path.join(root, 'config.properties'), Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n'));
const f = Math.fround, unit = value => value < 0 ? 0 : value > 1 ? 1 : value, pitchClamp = value => value < .5 ? .5 : value > 2 ? 2 : value;
const cases = [[3, 1, 1, 1, 1], [3, 1, .5, 1, 1], [3, 1, f(.2), 1, 1], [-0, .5, 1, 1, 1], [f(1.401298464324817e-45), 1, .5, 1, 1]];
let seed = 0x19abc; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
for (let i = 0; i < 1200; i++) cases.push([f(random() * 4), f(random() * 3), f(random()), f(random() * 2), f(random() * 2)]);
for (const value of [0, f(.49999997), .5, f(.50000006), f(.99999994), 1, f(1.0000001), f(1.9999999), 2, f(2.0000002), f(3.9999998)]) for (const factor of [.5, 1, f(1.0000001), 2]) cases.push([value, value, f(.7), factor, factor]);
const neighbor = (value, delta) => { const b = Buffer.alloc(4); b.writeFloatLE(value); b.writeUInt32LE(b.readUInt32LE() + delta); return b.readFloatLE(); };
const packetInputs = [...new Set([0, -.1, -2, 1, 5, 8, f(3.4028234663852886e38), ...[63, 63.5].flatMap(scale => [1, 31, 32, 62, 63, 64, 125, 126, 127, 254, 255, 256].flatMap(code => { const value = f(code / scale); return [neighbor(value, -1), value, neighbor(value, 1)]; }))])];
const encode = value => Object.is(value, -0) ? '-0' : String(value);
await writeFile(path.join(root, 'inputs.tsv'), cases.map(row => row.map(encode).join('\t')).join('\n')); await writeFile(path.join(root, 'inputs.json'), JSON.stringify(cases.map(row => row.map(value => Object.is(value, -0) ? '-0' : value))));
await writeFile(path.join(root, 'packet-inputs.tsv'), packetInputs.map(encode).join('\n'));
const source = 'scripts/java/Lwjgl219MethodProbe.java', cp = [root, asm, ...classpath].join(path.delimiter);
const run = (program, args) => { const result = spawnSync(program, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 8e6 }); assert.equal(result.status, 0, result.stderr + '\n' + result.stdout); return result.stdout; };
run('javac', ['--release', '8', '-cp', cp, '-d', root, source]);
const stdout = run('java', ['-XX:ActiveProcessorCount=4', '-cp', cp, 'studio.nbsx.research.Lwjgl219MethodProbe', path.join(root, 'config.properties'), path.join(root, 'inputs.tsv'), path.join(root, 'math.bin'), path.join(root, 'packet-inputs.tsv'), path.join(root, 'packet.bin'), path.join(root, 'notes.bin')]); await writeFile(path.join(root, 'console.log'), stdout);
assert(stdout.includes('POOL\t28\t4')); assert(stdout.includes('BLOCKED\t-1'));
const math = await readFile(path.join(root, 'math.bin')), packet = await readFile(path.join(root, 'packet.bin')), notes = await readFile(path.join(root, 'notes.bin'));
assert.equal(math.readUInt32LE(4), cases.length); const oldOrderDifferences = [], delayedRoundDifferences = [];
const bits = value => { const b = Buffer.alloc(4); b.writeFloatLE(value); return b.readUInt32LE(); };
for (const [i, [raw, pitch, category, eventVolume, eventPitch]] of cases.entries()) {
  const expected = [f(raw * eventVolume), f(pitch * eventPitch), unit(f(f(raw * eventVolume) * category)), pitchClamp(f(pitch * eventPitch))];
  expected.forEach((value, column) => assert.equal(math.readUInt32LE(8 + i * 16 + column * 4), bits(value), `case ${i} column ${column}`));
  const originalGain = expected[2], old = f(f(unit(raw * eventVolume)) * category), delayed = f(unit(raw * eventVolume * category));
  if (bits(originalGain) !== bits(old)) oldOrderDifferences.push({ input: { raw, eventVolume, category }, originalGain, oldDoubleClampThenCategory: old });
  if (bits(originalGain) !== bits(delayed)) delayedRoundDifferences.push({ input: { raw, eventVolume, category }, originalGain, delayedFloatProduct: delayed });
}
assert(oldOrderDifferences.length > 0); assert(delayedRoundDifferences.length > 0);
const packetResults = [];
for (const [i, input] of packetInputs.entries()) for (const [kind, scale] of [['named', 63], ['registered', 63.5]].entries()) {
  const [name, factor] = scale, scaled = f(input * factor), integer = Math.max(-2147483648, Math.min(2147483647, Math.trunc(scaled))), byte = integer & 255, expected = [f(integer / factor), f(byte / factor), pitchClamp(f(byte / factor))];
  expected.forEach((value, column) => assert.equal(packet.readUInt32LE(8 + i * 24 + kind * 12 + column * 4), bits(value), `${name} packet ${i} column ${column}`));
  packetResults.push({ kind: name, input, scale: factor, constructorInteger: integer, encodedByte: byte, originalConstructorPitch: expected[0], originalWirePitch: expected[1], originalEnginePitch: expected[2] });
}
const eventNames = ['block.note.harp', 'block.note.basedrum', 'block.note.snare', 'block.note.hat', 'block.note.bass'], noteResults = [];
assert.equal(notes.readUInt32LE(4), 125);
for (let instrument = 0; instrument < 5; instrument++) for (let note = 0; note < 25; note++) {
  const off = 8 + (instrument * 25 + note) * 20, emitted = f(2 ** ((note - 12) / 12)), byte = Math.trunc(f(emitted * 63.5)) & 255, transported = f(byte / 63.5), expected = [emitted, transported, pitchClamp(transported), 3, 1];
  expected.forEach((value, column) => assert.equal(notes.readUInt32LE(off + column * 4), bits(value), `note ${instrument}/${note}/${column}`));
  assert(stdout.includes(`NOTE\t${instrument}\t${note}\tminecraft:${eventNames[instrument]}`)); noteResults.push({ instrumentEventId: instrument, event: eventNames[instrument], note, originalEventPitch: emitted, originalWirePitch: transported, originalEnginePitch: expected[2], originalVolume: 3, sourceGainAtCategoryHalf: 1 });
}
const materials = [...stdout.matchAll(/MATERIAL\t(\w+)\t(-?\d+)\t(-?\d+)/g)].map(([, field, eventId, note]) => ({ ...supports.find(item => item.field === field), eventId: Number(eventId), note: Number(note) })); assert.deepEqual(materials.map(item => item.eventId), [0, 1, 2, 3, 4]); assert(materials.every(item => item.note === 12));
const masterOptions = [...stdout.matchAll(/MASTER_OPTION\t([a-f0-9]+)\t([a-f0-9]+)/g)].map(([, inputBits, resultBits]) => { assert.equal(inputBits, resultBits); return { inputBits, originalOptionsReturnBits: resultBits }; }); assert.equal(masterOptions.length, 5);
const rawOutputs = Object.fromEntries(await Promise.all(['config.properties', 'inputs.json', 'inputs.tsv', 'packet-inputs.tsv', 'math.bin', 'packet.bin', 'notes.bin', 'console.log'].map(async name => { const file = path.join(root, name); return [name, { path: path.relative(process.cwd(), file).replaceAll('\\', '/'), sha256: digest(await readFile(file), 'sha256') }]; })));
const report = { schema: 1, version: '1.9', checkedAt: new Date().toISOString(), output: root, officialSources: inventory.officialSources, classpathArtifacts: artifacts, originalClassSources: inventory.classes, config,
  engineMath: { cases: cases.length, outputsPerCase: 4, strictRawFloatBits: true, oldDoubleOrderDifferences: oldOrderDifferences.length, oldDoubleOrderCounterexamples: oldOrderDifferences.slice(0, 8), delayedFloatProductDifferences: delayedRoundDifferences.length, delayedFloatCounterexamples: delayedRoundDifferences.slice(0, 8) },
  packetBoundaries: { inputs: packetInputs.length, actualOriginalConstructorAndNettyWireCases: packetResults.length, strictRawFloatBits: true, checks: packetResults }, originalNoteToPacketToInstanceToEngine: noteResults, originalMaterialSelection: materials, nonAirAboveSuppressesEvent: true,
  originalMasterOptions: masterOptions, masterScope: 'Original Options getter executed; listener ownership is separately bound in source evidence. No AL listener result is claimed by this component probe.', requestedNormalPool: 28, requestedStreamingPool: 4, actualAllocatedVoiceCapacityMeasured: false,
  rawOutputs, tools: { asmUrl, asmSha256: checksum }, sources: Object.fromEntries(await Promise.all(['scripts/probe-lwjgl219-methods.mjs', source, 'scripts/audit-lwjgl219-source.mjs', 'scripts/review-lwjgl219-source.mjs', 'scripts/historical-classfile.mjs', 'scripts/audit-early-world.mjs', 'scripts/research-utils.mjs'].map(async file => [file, digest(await readFile(file), 'sha256')]))),
  integratedWorldScenesAdded: 0, nativeContextOpened: false, scope: 'Original1.9 instance/event getters and private engine helpers; original material/NoteBlock methods with only isolated World state/output callbacks; original packet constructor and real Netty serialization. Synthetic finite scalar domains are distinct from actual note event inputs. No original world/mixer/codec execution or actual voice-capacity measurement.' };
await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n'); await writeFile('docs/evidence/java-1.9-numeric-components.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: path.join(root, 'report.json'), engineCases: cases.length, packetWireCases: packetResults.length, notes: noteResults.length, materials: materials.length, strictBits: true, note12: noteResults.find(item => item.note === 12) }));
