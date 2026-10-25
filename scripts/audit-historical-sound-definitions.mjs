import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';
import { methodCodeHashes } from './audit-early-world.mjs';

const run = (program, args) => { const result = spawnSync(program, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 4e6 }); assert.equal(result.status, 0, result.stderr); return result.stdout; };
const inventory = JSON.parse(await readFile('.research/historical-audio-patches/inventory.json'));
const records = [];
for (const item of inventory.records) {
  const version = item.version, client = path.resolve(`.research/clients/${version}.jar`), bytes = await readFile(client), metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`));
  assert.equal(digest(bytes), metadata.downloads.client.sha1); const archive = unzipSync(bytes);
  const names = Object.entries(archive).filter(([name, bytes]) => name.endsWith('.class') && Buffer.from(bytes).includes(Buffer.from('attenuation_distance'))).map(([name]) => name.slice(0, -6)); assert.equal(names.length, 1);
  const root = path.resolve(`.research/historical-audio-patches/${version}/sound-definitions`); await mkdir(root, { recursive: true });
  const wanted = [[names[0], 'SoundSerializer']], selected = [], added = new Set();
  while (wanted.length) {
    const [name, role] = wanted.shift(); if (added.has(name)) continue; added.add(name); const code = archive[`${name}.class`]; assert(code);
    const classFile = path.join(root, `${name}.class`), sourceFile = path.join(root, `${name}.java`), disassemblyFile = path.join(root, `${name}.javap.txt`);
    await writeFile(classFile, code);
    let source = await readFile(sourceFile, 'utf8').catch(() => undefined);
    if (source === undefined) { run('java', ['-jar', '.research/tools/cfr-0.152.jar', classFile, '--extraclasspath', client, '--outputdir', root, '--silent', 'true']); source = await readFile(sourceFile, 'utf8'); }
    let disassembly = await readFile(disassemblyFile, 'utf8').catch(() => undefined);
    if (disassembly === undefined) { disassembly = run('javap', ['-p', '-s', '-c', '-classpath', client, name]); await writeFile(disassemblyFile, disassembly); }
    selected.push({ role, originalName: name, bytecodeSha1: digest(code), bytecodeSha256: digest(code, 'sha256'), methods: methodCodeHashes(code), rawSource: path.relative(process.cwd(), sourceFile).replaceAll('\\', '/'), sourceSha256: digest(Buffer.from(source), 'sha256'), rawDisassembly: path.relative(process.cwd(), disassemblyFile).replaceAll('\\', '/'), disassemblySha256: digest(Buffer.from(disassembly), 'sha256') });
    if (role === 'SoundSerializer') {
      const registration = /implements JsonDeserializer<(\w+)>/.exec(source)[1]; wanted.push([registration, 'SoundEventRegistration']);
      const definition = /return new (\w+)\(string,/.exec(source)[1]; wanted.push([definition, 'SoundDefinition']);
    }
  }
  records.push({ version, clientSha1: digest(bytes), classes: selected });
  console.log(`${version}: original serializer, registration, definition ${selected.map(x => x.originalName).join(', ')}`);
}
await writeFile('.research/historical-audio-patches/sound-definitions.json', JSON.stringify({ schema: 1, records }, null, 2) + '\n');
