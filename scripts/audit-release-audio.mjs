import { readFile, writeFile, mkdir, stat, rename, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

const root = path.resolve('.research'), clients = path.join(root, 'clients');
await mkdir(clients, { recursive: true });
const matrix = JSON.parse(await readFile(path.join(root, 'audio-version-matrix.json'), 'utf8'));
const wanted = matrix.versions.filter(v => v.client?.url);
const records = [], failures = []; let cursor = 0, count = 0;
const sha1 = data => createHash('sha1').update(data).digest('hex');
async function download(version) {
  const target = path.join(clients, `${version.id.replaceAll(/[^\w.-]/g, '_')}.jar`);
  try { const cached = await readFile(target); if (sha1(cached) === version.client.sha1) return cached; } catch { /* fetch missing cache */ }
  const temp = `${target}.download-${randomUUID()}`;
  try {
    const response = await fetch(version.client.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const hash = createHash('sha1'); let length = 0;
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) { length += chunk.length; hash.update(chunk); if (length > version.client.size + 1024) callback(new Error('Artifact exceeds declared size')); else callback(null, chunk); } }), createWriteStream(temp, { flags: 'wx' }));
    if (length !== version.client.size || hash.digest('hex') !== version.client.sha1) throw new Error('Official client checksum or size mismatch');
    await rename(temp, target); return await readFile(target);
  } catch (error) { await unlink(temp).catch(() => {}); throw error; }
}
function constantPool(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0xcafebabe) return { strings: [], numbers: [], refs: [] };
  const count = view.getUint16(8), strings = [], numbers = [], classIndices = [], entries = new Map(); let offset = 10;
  for (let index = 1; index < count; index++) {
    const tag = view.getUint8(offset++);
    if (tag === 1) { const length = view.getUint16(offset); offset += 2; const value = strFromU8(bytes.subarray(offset, offset + length)); strings.push(value); entries.set(index, value); offset += length; }
    else if (tag === 3 || tag === 4) { numbers.push(tag === 3 ? view.getInt32(offset) : view.getFloat32(offset)); offset += 4; }
    else if (tag === 5 || tag === 6) { if (tag === 6) numbers.push(view.getFloat64(offset)); offset += 8; index++; }
    else if (tag === 7) { classIndices.push(view.getUint16(offset)); offset += 2; }
    else if ([8, 16, 19, 20].includes(tag)) offset += 2;
    else if ([9, 10, 11, 12, 17, 18].includes(tag)) offset += 4;
    else if (tag === 15) offset += 3;
    else throw new Error(`Unknown constant pool tag ${tag}`);
  }
  return { strings, numbers, refs: classIndices.map(i => entries.get(i)).filter(Boolean) };
}
function inspect(version, bytes) {
  const files = unzipSync(bytes, { filter: e => e.name.endsWith('.class') || e.name === 'assets/minecraft/sounds.json' });
  const parsed = new Map(), selected = new Set();
  for (const [name, data] of Object.entries(files)) {
    if (!name.endsWith('.class')) continue;
    try {
      const pool = constantPool(data); parsed.set(name.slice(0, -6), pool);
      if (pool.strings.some(s => /org\/lwjgl\/(?:openal|stb)|paulscode\/sound|com\/mojang\/blaze3d\/audio/.test(s)) || /(?:client\/(?:sounds|audio)|blaze3d\/audio)\//.test(name)) selected.add(name.slice(0, -6));
    } catch { /* nonstandard classes are recorded as unindexed, never silently verified */ }
  }
  for (let hop = 0; hop < 2; hop++) { const parents = []; for (const [name, pool] of parsed) if (!selected.has(name) && pool.refs.some(ref => selected.has(ref))) parents.push(name); for (const parent of parents) selected.add(parent); }
  const audioClasses = [...selected].sort().map(name => {
    const pool = parsed.get(name), relevantStrings = pool.strings.filter(s => /openal|vorbis|sound|attenuation|distance|pitch|hrtf|paulscode|lwjgl/i.test(s));
    return { name, bytecodeSha1: sha1(files[`${name}.class`]), constants: pool.numbers.filter(Number.isFinite), relevantStrings };
  });
  let noteSounds = {};
  if (files['assets/minecraft/sounds.json']) {
    const definitions = JSON.parse(strFromU8(files['assets/minecraft/sounds.json']));
    noteSounds = Object.fromEntries(Object.entries(definitions).filter(([key]) => /note[._]?block|^note\./i.test(key)));
  }
  return { id: version.id, type: version.type, clientSha1: version.client.sha1, clientUrl: version.client.url,
    mappingUrl: version.mappings?.url, indexedClasses: parsed.size, totalClassFiles: Object.keys(files).filter(k => k.endsWith('.class')).length,
    audioClasses, noteSounds, status: 'bytecode-indexed-not-behaviour-verified', gameMeasurement: null };
}
async function worker() {
  while (cursor < wanted.length) {
    const version = wanted[cursor++];
    try { records.push(inspect(version, await download(version))); }
    catch (error) { failures.push({ id: version.id, error: String(error) }); }
    count++;
    if (count % 10 === 0) console.log(`${count}/${wanted.length} clients verified and audio-indexed (${failures.length} errors).`);
    await writeFile(path.join(root, 'release-audio-audit.json'), JSON.stringify({ status: 'research-in-progress', inspected: records.length, expected: wanted.length,
      source: matrix.source, records, failures, caveat: 'Bytecode indexing and dependency boundaries do not prove behavioural equivalence. Decompilation, review and game recordings are still required.' }));
  }
}
console.log(`Caching and SHA-1 verifying ${wanted.length} official clients; about 1.52 GiB; concurrency 2.`);
await Promise.all([worker(), worker()]);
console.log(JSON.stringify({ inspected: records.length, failures: failures.length, report: path.join(root, 'release-audio-audit.json') }));
if (failures.length) process.exitCode = 1;
