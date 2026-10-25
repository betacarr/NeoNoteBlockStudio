import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { unzipSync } from 'fflate';

const root = path.resolve('.research'), cfr = path.join(root, 'tools/cfr-0.152.jar');
const matrix = JSON.parse(await readFile(path.join(root, 'audio-version-matrix.json'), 'utf8'));
const roles = new Set(['Channel', 'Library', 'Listener', 'OggAudioStream', 'JOrbisAudioStream', 'FloatSampleSource', 'ChunkedSampleByteBuf', 'SoundBuffer', 'OpenAlUtil', 'SoundEngine', 'SoundManager', 'SoundBufferLibrary', 'ChannelAccess', 'Sound', 'SoundInstance', 'SimpleSoundInstance', 'AbstractSoundInstance', 'NoteBlock', 'NoteBlockInstrument']);
const onlyMissing = process.argv.includes('--missing');
const relevant = name => roles.has(name.split('.').at(-1)) && /^(com\.mojang\.blaze3d\.audio\.|net\.minecraft\.(?:client\.|world\.level\.block\.))/.test(name);
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
const hash = text => createHash('sha256').update(text).digest('hex');
const results = [], failures = [];
function run(args) { return new Promise((resolve, reject) => { const child = spawn('java', ['-jar', cfr, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = ''; child.stderr.on('data', data => { if (stderr.length < 2000) stderr += data; }); child.on('error', reject); child.on('exit', code => resolve({ code, stderr })); }); }
for (const version of matrix.versions) {
  const clientPath = path.join(root, 'clients', `${version.id.replaceAll(/[^\w.-]/g, '_')}.jar`);
  const metadata = JSON.parse(await readFile(path.join(root, 'metadata', `${version.id.replaceAll(/[^\w.-]/g, '_')}.json`), 'utf8'));
  if (!metadata.downloads?.client_mappings && !/^26\./.test(version.id)) continue;
  const target = path.join(root, 'source-comparison', version.id), extracted = path.join(target, 'classes'), output = path.join(target, 'named');
  await mkdir(target, { recursive: true });
  try {
    let classMap = [], mappingsPath;
    if (metadata.downloads.client_mappings) {
      mappingsPath = path.join(target, 'mappings.txt'); let bytes;
      try { bytes = await readFile(mappingsPath); } catch { const response = await fetch(metadata.downloads.client_mappings.url, { signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`Mappings HTTP ${response.status}`); bytes = Buffer.from(await response.arrayBuffer()); }
      if (sha1(bytes) !== metadata.downloads.client_mappings.sha1) throw new Error('Mapping checksum mismatch');
      await writeFile(mappingsPath, bytes);
      classMap = [...bytes.toString('utf8').matchAll(/^(\S+) -> (\S+):$/gm)].filter(m => relevant(m[1])).map(m => ({ name: m[1], obfuscated: m[2] }));
    }
    const client = await readFile(clientPath);
    if (sha1(client) !== metadata.downloads.client.sha1) throw new Error('Client checksum mismatch');
    const files = unzipSync(client, { filter: entry => entry.name.endsWith('.class') && (classMap.length ? classMap.some(c => entry.name === `${c.obfuscated.replaceAll('.', '/')}.class`) : relevant(entry.name.slice(0, -6).replaceAll('/', '.'))) });
    if (!classMap.length) classMap = Object.keys(files).map(name => ({ name: name.slice(0, -6).replaceAll('/', '.'), obfuscated: name.slice(0, -6).replaceAll('/', '.') }));
    const classes = [];
    for (const entry of classMap) {
      const filename = `${entry.obfuscated.replaceAll('.', '/')}.class`, bytecode = files[filename];
      if (!bytecode) { failures.push({ version: version.id, class: entry.name, error: 'Missing bytecode' }); continue; }
      const sourceClass = path.join(extracted, filename); await mkdir(path.dirname(sourceClass), { recursive: true }); await writeFile(sourceClass, bytecode);
      const args = [sourceClass, '--extraclasspath', clientPath, '--outputdir', output, '--silent', 'true'];
      if (mappingsPath) args.push('--obfuscationpath', mappingsPath);
      let cached = false;
      if (onlyMissing) try { await readFile(path.join(output, filename.replace(/\.class$/, '.java'))); cached = true; } catch { /* new class */ }
      const result = cached ? { code: 0 } : await run(args);
      if (result.code !== 0) { failures.push({ version: version.id, class: entry.name, error: result.stderr }); continue; }
      let source;
      try { source = await readFile(path.join(output, filename.replace(/\.class$/, '.java')), 'utf8'); }
      catch { source = await readFile(path.join(output, path.basename(filename).replace(/\.class$/, '.java')), 'utf8'); }
      const normal = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();
      classes.push({ name: entry.name, obfuscated: entry.obfuscated, bytecodeSha1: sha1(bytecode), namedSourceSha256: hash(normal), length: source.length, status: /Decompilation failed|could not decompile/i.test(source) ? 'decompiler-warning' : 'source-generated-unreviewed' });
    }
    results.push({ id: version.id, clientSha1: metadata.downloads.client.sha1, mappingsSha1: metadata.downloads.client_mappings?.sha1,
      classes, combined: hash(JSON.stringify(classes.map(c => [c.name, c.namedSourceSha256]).sort())), status: 'awaiting-behaviour-review-and-measurement' });
    console.log(`${version.id}: ${classes.length} named audio source classes compared (${failures.length} accumulated errors).`);
  } catch (error) { failures.push({ version: version.id, error: String(error) }); }
  await writeFile(path.join(root, 'audio-source-comparison.json'), JSON.stringify({ results, failures, caveat: 'Matching selected source hashes is evidence for those classes only; generated source, dependency metadata and hashes do not establish in-game audio equivalence.' }, null, 2));
}
console.log(JSON.stringify({ versions: results.length, failures: failures.length, output: path.join(root, 'audio-source-comparison.json') }));
if (failures.length) process.exitCode = 1;
