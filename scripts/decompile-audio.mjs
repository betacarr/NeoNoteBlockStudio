import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const [version, client] = process.argv.slice(2);
if (!version || !client || !/^[\w.-]+$/.test(version)) throw new Error('Usage: node scripts/decompile-audio.mjs <version> <local-client.jar>');
const root = path.resolve('.research'), target = path.join(root, 'decompiled', version), tools = path.join(root, 'tools');
await mkdir(target, { recursive: true }); await mkdir(tools, { recursive: true });
const metadata = JSON.parse(await readFile(path.join(root, 'metadata', `${version}.json`), 'utf8'));
const jar = await readFile(client);
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
if (sha1(jar) !== metadata.downloads.client.sha1) throw new Error('Local client does not match the official version SHA-1.');
if (!metadata.downloads.client_mappings) throw new Error('This version has no official mappings; use a separately documented historical mapping source.');
async function downloaded(filename, url, expected, algorithm = 'sha1') {
  let data;
  try { data = await readFile(filename); } catch { const response = await fetch(url, { signal: AbortSignal.timeout(45000) }); if (!response.ok) throw new Error(`${url}: ${response.status}`); data = Buffer.from(await response.arrayBuffer()); }
  if (createHash(algorithm).update(data).digest('hex') !== expected) throw new Error(`Checksum mismatch: ${filename}`);
  await writeFile(filename, data); return data;
}
const mappingsFile = path.join(target, 'client-mappings.txt');
const mapping = await downloaded(mappingsFile, metadata.downloads.client_mappings.url, metadata.downloads.client_mappings.sha1);
const cfr = path.join(tools, 'cfr-0.152.jar');
await downloaded(cfr, 'https://www.benf.org/other/cfr/cfr-0.152.jar', '8a85ada8cec494121246805a5562b82b', 'md5');
const wanted = /^(?:com\.mojang\.blaze3d\.audio\.(?:Channel|Library|Listener|OggAudioStream|SoundBuffer)|net\.minecraft\.client\.sounds\.(?:SoundEngine|SoundManager)|net\.minecraft\.client\.resources\.sounds\.(?:Sound|SimpleSoundInstance)|net\.minecraft\.world\.level\.block\.NoteBlock)$/;
const classes = [...mapping.toString('utf8').matchAll(/^(\S+) -> (\S+):$/gm)].filter(match => wanted.test(match[1])).map(match => ({ name: match[1], obfuscated: match[2] }));
const names = new Set(classes.map(c => `${c.obfuscated.replaceAll('.', '/')}.class`));
const files = unzipSync(jar, { filter: entry => names.has(entry.name) });
for (const [name, data] of Object.entries(files)) { const filename = path.join(target, 'bytecode', name); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, data); }
const records = [];
for (const entry of classes) {
  const name = `${entry.obfuscated.replaceAll('.', '/')}.class`, bytecode = files[name];
  if (!bytecode) { records.push({ ...entry, error: 'Class not found' }); continue; }
  const processResult = spawnSync('java', ['-jar', cfr, path.join(target, 'bytecode', name), '--extraclasspath', path.resolve(client), '--outputdir', path.join(target, 'source'), '--silent', 'true'], { encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
  records.push({ ...entry, bytecodeSha1: sha1(bytecode), exitCode: processResult.status, error: processResult.error?.message, diagnostics: (processResult.stderr ?? '').slice(0, 1500) });
  console.log(`${version}: ${entry.name} -> ${entry.obfuscated}: exit ${processResult.status}`);
}
await writeFile(path.join(target, 'provenance.json'), JSON.stringify({ version, clientSha1: sha1(jar), mappingsSha1: sha1(mapping), source: metadata.downloads.client_mappings.url, tool: 'CFR 0.152', records, status: 'decompiled-awaiting-code-review-and-game-measurement' }, null, 2));
if (records.some(r => r.error || r.exitCode !== 0)) process.exitCode = 1;
