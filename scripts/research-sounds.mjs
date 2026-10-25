import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const matrix = JSON.parse(await readFile('.research/audio-version-matrix.json', 'utf8'));
const layouts = JSON.parse(await readFile('src/data/sound-asset-layouts.json', 'utf8'));
await mkdir('.research/sound-indexes', { recursive: true });
const checksum = bytes => createHash('sha1').update(bytes).digest('hex');
async function verified(url, sha1, target) {
  try { const bytes = await readFile(target); if (checksum(bytes) === sha1) return bytes; } catch {}
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer()); if (checksum(bytes) !== sha1) throw new Error(`Checksum mismatch: ${url}`);
  await writeFile(target, bytes); return bytes;
}
const indexes = [...new Map(matrix.versions.filter(v => v.assetIndex).map(v => [v.assetIndex.sha1, v.assetIndex])).values()];
const records = [], failures = []; let cursor = 0;
async function worker() {
  while (cursor < indexes.length) {
    const index = indexes[cursor++];
    try {
      const data = JSON.parse(await verified(index.url, index.sha1, `.research/sound-indexes/${index.sha1}.json`));
      const defaultDomainRoot = layouts.defaultDomainRoot.assetIndexSha1s.includes(index.sha1);
      const prefix = defaultDomainRoot ? '' : 'minecraft/';
      const soundIndex = data.objects?.[`${prefix}sounds.json`]; let definitions = {};
      if (soundIndex) {
        const raw = await verified(`https://resources.download.minecraft.net/${soundIndex.hash.slice(0, 2)}/${soundIndex.hash}`, soundIndex.hash, `.research/sound-indexes/${soundIndex.hash}.sounds.json`);
        definitions = Object.fromEntries(Object.entries(JSON.parse(raw)).filter(([name]) => /^note\.|^block\.note(?:_block)?\./.test(name)));
      }
      const samplePattern = new RegExp(`^${prefix}sounds/(?:note|note_block)/.*\\.ogg$`);
      const samples = Object.fromEntries(Object.entries(data.objects ?? {}).filter(([name]) => samplePattern.test(name)));
      records.push({ id: index.id, sha1: index.sha1, layout: defaultDomainRoot ? 'default-domain-root' : soundIndex ? 'namespaced' : 'unreviewed', definitionsPath: soundIndex ? `${prefix}sounds.json` : undefined, definitionsSha1: soundIndex?.hash, definitions, samples });
      console.log(`${index.id}: ${Object.keys(definitions).length} sound events, ${Object.keys(samples).length} sample objects`);
    } catch (error) { failures.push({ index, error: String(error) }); }
  }
}
await Promise.all([worker(), worker(), worker()]);
await writeFile('.research/audio-sound-assets.json', JSON.stringify({ records, failures }, null, 2));
console.log(JSON.stringify({ indexes: records.length, failures: failures.length }));
if (failures.length) process.exitCode = 1;
