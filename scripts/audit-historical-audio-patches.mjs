import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';

// Manual role discovery over original clients. These are NOT official mappings.
const versions = ['1.13', '1.13.1', '1.13.2', '1.14', '1.14.1', '1.14.2', '1.14.3'];
const target = path.resolve('.research/historical-audio-patches'); await mkdir(target, { recursive: true });
const cfr = path.resolve('.research/tools/cfr-0.152.jar');
assert.equal(digest(await readFile(cfr), 'md5'), '8a85ada8cec494121246805a5562b82b');
function pool(input) {
  const bytes = Buffer.from(input); let at = 8;
  const u1 = () => bytes.readUInt8(at++), u2 = () => { const value = bytes.readUInt16BE(at); at += 2; return value; };
  const entries = new Array(u2()), literals = [], utf8 = [];
  for (let i = 1; i < entries.length; i++) {
    const tag = u1();
    if (tag === 1) { const length = u2(); entries[i] = { tag, text: bytes.toString('utf8', at, at + length) }; utf8.push(entries[i].text); at += length; }
    else if ([7, 8, 16, 19, 20].includes(tag)) entries[i] = { tag, index: u2() };
    else if ([3, 4, 9, 10, 11, 12, 17, 18].includes(tag)) { entries[i] = { tag }; at += 4; }
    else if ([5, 6].includes(tag)) { at += 8; i++; }
    else if (tag === 15) at += 3;
    else throw new Error(`Unexpected constant pool tag ${tag}`);
  }
  for (const entry of entries) if (entry?.tag === 8) literals.push(entries[entry.index].text);
  const className = index => entries[entries[index]?.index]?.text;
  at += 2; const name = className(u2()), parent = className(u2());
  return { name, parent, utf8, literals };
}
const run = (program, args) => new Promise((resolve, reject) => {
  const child = spawn(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
  child.once('error', reject); child.once('exit', code => code ? reject(new Error(`${program} exited ${code}: ${stderr}`)) : resolve(stdout));
});
const records = [], jobs = [];
for (const version of versions) {
  const metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`)); assert(!metadata.downloads.client_mappings);
  const client = path.resolve(`.research/clients/${version}.jar`), bytes = await readFile(client); assert.equal(digest(bytes), metadata.downloads.client.sha1);
  const files = unzipSync(bytes, { filter: entry => entry.name.endsWith('.class') });
  const parsed = Object.entries(files).map(([filename, code]) => ({ filename, code, ...pool(code) }));
  const find = (role, predicate) => { const matches = parsed.filter(predicate); assert.equal(matches.length, 1, `${version} ${role}: ${matches.map(item => item.name)}`); return matches[0].name; };
  const has = (...texts) => item => texts.every(text => item.utf8.includes(text));
  const roles = {
    Library: find('Library', has('org/lwjgl/openal/ALC10', 'alcCreateContext')),
    Channel: find('Channel', has('org/lwjgl/openal/AL10', 'alSourcePlay')),
    SoundEngine: find('SoundEngine', item => item.literals.includes('Unable to play unknown soundEvent: {}')),
    SoundManager: find('SoundManager', item => item.literals.some(text => text.startsWith('Invalid sounds.json'))),
    Instrument: find('Instrument', item => item.parent === 'java/lang/Enum' && ['harp', 'guitar', 'xylophone'].every(text => item.literals.includes(text))),
    Options: find('Options', item => item.literals.includes('soundCategory_')),
  };
  roles.NoteBlock = find('NoteBlock', item => item.utf8.includes(roles.Instrument) && item.utf8.includes('java/lang/Math') && item.utf8.includes('pow'));
  if (version.startsWith('1.13')) roles.Source = find('Source', item => item.parent === 'paulscode/sound/Source');
  else {
    roles.Decoder = find('Decoder', has('stb_vorbis_open_pushdata'));
    roles.Listener = find('Listener', has('org/lwjgl/openal/AL10', 'alListenerf', 'alListener3f'));
    roles.SoundBuffer = find('SoundBuffer', has('org/lwjgl/openal/AL10', 'alBufferData', 'Creating buffer'));
    roles.BufferLibrary = find('BufferLibrary', item => item.utf8.includes(roles.Decoder) && item.utf8.includes('java/util/concurrent/CompletableFuture') && item.utf8.includes('computeIfAbsent'));
  }
  const root = path.join(target, version); await mkdir(path.join(root, 'classes'), { recursive: true });
  const selected = [...new Set(Object.values(roles))];
  for (const item of parsed) if (selected.some(name => item.name.startsWith(`${name}$`))) selected.push(item.name);
  const record = { version, clientSha1: digest(bytes), clientUrl: metadata.downloads.client.url, officialClientMappingsAvailable: false,
    assetIndex: metadata.assetIndex, roles, classes: [], scope: 'Original class/source inventory, awaiting explicit method review; no world acceptance inferred.' };
  for (const name of [...new Set(selected)]) {
    const code = files[`${name}.class`]; assert(code);
    const filename = path.join(root, 'classes', `${name}.class`); await writeFile(filename, code);
    const entry = { name, role: Object.entries(roles).find(([, value]) => value === name)?.[0] ?? 'nested-audio-class', bytecodeSha1: digest(code), methods: methodCodeHashes(code) };
    record.classes.push(entry);
    jobs.push(async () => {
      const sourceFile = path.join(root, 'source', `${name}.java`), javapFile = path.join(root, `${name}.javap.txt`);
      let source = await readFile(sourceFile, 'utf8').catch(() => undefined);
      if (source === undefined) { await run('java', ['-jar', cfr, filename, '--extraclasspath', client, '--outputdir', path.join(root, 'source'), '--silent', 'true']); source = await readFile(sourceFile, 'utf8'); }
      let disassembly = await readFile(javapFile, 'utf8').catch(() => undefined);
      if (disassembly === undefined) { disassembly = await run('javap', ['-p', '-s', '-c', '-classpath', client, name]); await writeFile(javapFile, disassembly); }
      entry.rawSourceSha256 = digest(Buffer.from(source), 'sha256'); entry.disassemblySha256 = digest(Buffer.from(disassembly), 'sha256');
      entry.decompilerWarning = /Decompilation failed|could not decompile/i.test(source);
    });
  }
  records.push(record); console.log(`${version}: identified ${Object.keys(roles).length} manual original roles, ${record.classes.length} classes`);
}
let cursor = 0;
await Promise.all(Array.from({ length: 2 }, async () => { while (cursor < jobs.length) await jobs[cursor++](); }));
// Follow the actual arithmetic/error/stream/handle callees rather than assuming
// that a renamed call target in the main engine retained the same behavior.
for (const record of records) {
  const root = path.join(target, record.version), source = name => readFile(path.join(root, 'source', `${name}.java`), 'utf8');
  const engine = await source(record.roles.SoundEngine), library = await source(record.roles.Library);
  record.roles.MathHelper = /return (\w+)\.a\(\w+\.g\(\), 0\.5f, 2\.0f\)/.exec(engine)[1];
  record.roles.SoundSource = /private final Multimap<(\w+),/.exec(engine)[1];
  if (!record.version.startsWith('1.13')) {
    record.roles.OpenAlUtil = /if \((\w+)\.a\(this\.b, "Get capabilities"\)/.exec(library)[1];
    record.roles.AudioStream = /implements (\w+) \{/.exec(await source(record.roles.Decoder))[1];
    record.roles.ChannelAccess = /private final Map<\w+, (\w+)\.a> m/.exec(engine)[1];
  }
  const wanted = Object.entries(record.roles).filter(([, name]) => !record.classes.some(item => item.name === name));
  if (record.roles.ChannelAccess) wanted.push(['ChannelHandle', record.roles.ChannelAccess + '$a']);
  const client = path.resolve(`.research/clients/${record.version}.jar`), files = unzipSync(await readFile(client), { filter: entry => wanted.some(([, name]) => entry.name === `${name}.class`) });
  for (const [role, name] of wanted) {
    const code = files[`${name}.class`]; assert(code); const filename = path.join(root, 'classes', `${name}.class`); await writeFile(filename, code);
    let text = await source(name).catch(() => undefined);
    if (text === undefined) { await run('java', ['-jar', cfr, filename, '--extraclasspath', client, '--outputdir', path.join(root, 'source'), '--silent', 'true']); text = await source(name); }
    const javapFile = path.join(root, `${name}.javap.txt`); let disassembly = await readFile(javapFile, 'utf8').catch(() => undefined);
    if (disassembly === undefined) { disassembly = await run('javap', ['-p', '-s', '-c', '-classpath', client, name]); await writeFile(javapFile, disassembly); }
    record.classes.push({ role, name, bytecodeSha1: digest(code), methods: methodCodeHashes(code), rawSourceSha256: digest(Buffer.from(text), 'sha256'), disassemblySha256: digest(Buffer.from(disassembly), 'sha256'), decompilerWarning: /Decompilation failed|could not decompile/i.test(text) });
  }
}
await writeFile(path.join(target, 'inventory.json'), JSON.stringify({ schema: 1, scriptSha256: digest(await readFile('scripts/audit-historical-audio-patches.mjs'), 'sha256'), records }, null, 2));
console.log(JSON.stringify({ versions: records.length, classes: records.reduce((sum, item) => sum + item.classes.length, 0), inventory: path.join(target, 'inventory.json') }));
