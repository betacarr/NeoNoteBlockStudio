import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const bank = JSON.parse(await readFile('third_party/minecraft-samples/manifest.json', 'utf8'));
const assetRoot = '.local/minecraft-preview-assets', folder = `${assetRoot}/sounds`;
const provenance = '.local/minecraft-preview-provenance';
await mkdir(folder, { recursive: true });
await mkdir(provenance, { recursive: true });
if ((await readdir(assetRoot)).some(name => name !== 'sounds')
  || (await readdir(folder)).some(name => !bank.samples.some(sample => sample.file === name))) throw new Error('Unexpected file in the dedicated preview asset cache. Inspect it before building.');
const hash = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex');
const objectUrl = sha1 => {
  if (!/^[a-f0-9]{40}$/.test(sha1)) throw new Error('Invalid official object hash.');
  return `https://resources.download.minecraft.net/${sha1.slice(0, 2)}/${sha1}`;
};
async function verifiedJson(url, sha1, size) {
  if (!/^[a-f0-9]{40}$/.test(sha1) || !/^https:\/\/(?:piston-meta\.mojang\.com\/v1\/packages\/[a-f0-9]{40}\/[\w.-]+\.json|resources\.download\.minecraft\.net\/[a-f0-9]{2}\/[a-f0-9]{40})$/.test(url)) throw new Error('Invalid official metadata source.');
  const target = path.join(provenance, `${sha1}.json`);
  const valid = bytes => hash(bytes, 'sha1') === sha1 && (size === undefined || bytes.length === size);
  let bytes; try { const cached = await readFile(target); if (valid(cached)) bytes = cached; } catch { /* Download missing metadata. */ }
  if (!bytes) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Official metadata download failed (${response.status}).`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error('Official metadata checksum mismatch.');
    await writeFile(target, bytes);
  }
  return JSON.parse(bytes.toString('utf8'));
}
// Verify the complete official chain: version metadata -> index -> sound event -> Ogg.
const version = await verifiedJson(bank.metadata.url, bank.metadata.sha1);
if (version.id !== bank.gameVersion || version.assetIndex.sha1 !== bank.assetIndex.sha1 || version.assetIndex.url !== bank.assetIndex.url || version.assetIndex.size !== bank.assetIndex.size) throw new Error('Pinned Minecraft release/index mismatch.');
const index = await verifiedJson(bank.assetIndex.url, bank.assetIndex.sha1, bank.assetIndex.size);
const definitionsObject = index.objects[bank.soundDefinitions.resource];
if (definitionsObject.hash !== bank.soundDefinitions.sha1 || definitionsObject.size !== bank.soundDefinitions.bytes) throw new Error('Pinned sound definitions mismatch.');
const definitions = await verifiedJson(objectUrl(definitionsObject.hash), definitionsObject.hash, definitionsObject.size);
for (const sample of bank.samples) {
  const sounds = definitions[sample.event]?.sounds;
  if (!sounds || sounds.length !== 1) throw new Error(`Ambiguous official sound event: ${sample.id}`);
  const sound = typeof sounds[0] === 'string' ? { name: sounds[0] } : sounds[0];
  if (sound.type && sound.type !== 'file' || `minecraft/sounds/${sound.name.replace(/^minecraft:/, '')}.ogg` !== sample.resource
    || (sound.volume ?? 1) !== sample.volume || (sound.pitch ?? 1) !== sample.pitch || (sound.attenuation_distance ?? 16) !== sample.attenuationDistance
    || sample.volume !== 1 || sample.pitch !== 1 || sample.attenuationDistance !== 16) throw new Error(`Unsupported official sound parameters: ${sample.id}`);
  const object = index.objects[sample.resource];
  if (!object || object.hash !== sample.sha1 || object.size !== sample.bytes) throw new Error(`Official sample mapping mismatch: ${sample.id}`);
}
const valid = (bytes, sample) => bytes.length === sample.bytes && bytes.subarray(0, 4).toString() === 'OggS'
  && hash(bytes, 'sha1') === sample.sha1 && hash(bytes, 'sha256') === sample.sha256;
await Promise.all(bank.samples.map(async sample => {
  if (!/^[a-z_]+\.ogg$/.test(sample.file)) throw new Error('Invalid preview sample filename.');
  const target = path.join(folder, sample.file);
  try { if (valid(await readFile(target), sample)) return; } catch { /* Download a missing or invalid cache entry. */ }
  const response = await fetch(objectUrl(sample.sha1), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Preview sample download failed: ${sample.file} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes, sample)) throw new Error(`Preview sample checksum mismatch: ${sample.file}`);
  await writeFile(target, bytes);
}));
console.log(`Preview samples ready: ${bank.samples.length} unmodified Minecraft Java ${bank.gameVersion} files; official event/index hashes verified.`);
