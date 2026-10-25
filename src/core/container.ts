import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Project } from './types';
import { validateProject } from './project';

const MAX_CONTAINER = 256 * 1024 * 1024;
const MAX_EXPANDED = 512 * 1024 * 1024;
const MAX_MANIFEST = 64 * 1024 * 1024;
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let output = '';
  for (let i = 0; i < bytes.length; i += 32768) output += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(output);
};
export const base64ToBytes = (text: string): Uint8Array => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export function saveNbsx(project: Project): Uint8Array {
  validateProject(project);
  const manifest = structuredClone(project);
  if (manifest.midi && !manifest.assets.find(asset => asset.id === manifest.midi?.sourceAssetId)?.data) throw new Error('工程缺少嵌入的原始 MIDI 文件，无法完整保存。');
  if (manifest.provenance?.kind === 'flp' && !manifest.assets.find(asset => asset.id === manifest.provenance?.metadata.sourceAssetId)?.data) throw new Error('工程缺少嵌入的原始 FLP 文件，无法完整保存。');
  manifest.modifiedAt = new Date().toISOString();
  const files: Record<string, Uint8Array> = {};
  for (const asset of manifest.assets) {
    if (asset.data) { files[`assets/${asset.id}`] = base64ToBytes(asset.data); delete asset.data; }
  }
  files['project.json'] = strToU8(JSON.stringify(manifest));
  if (files['project.json'].length > MAX_MANIFEST) throw new Error('工程清单超过 64 MB，请拆分工程后保存。');
  files['mimetype'] = strToU8('application/vnd.exnoteblock.project+zip');
  if (Object.values(files).reduce((size, bytes) => size + bytes.length, 0) > MAX_EXPANDED) throw new Error('工程资源展开后超过 512 MB，请拆分工程或减少嵌入资源。');
  const bytes = zipSync(files, { level: 6 });
  if (bytes.length > MAX_CONTAINER) throw new Error('工程文件超过 256 MB，请拆分工程或减少嵌入资源。');
  return bytes;
}
export function openNbsx(bytes: Uint8Array): Project {
  if (bytes.byteLength > MAX_CONTAINER) throw new Error('工程文件大于 256 MB，请先使用外部资源引用。');
  let expanded = 0;
  const files = unzipSync(bytes, { filter: entry => {
    if (entry.name.includes('..') || entry.name.startsWith('/') || /^[a-z]:/i.test(entry.name)) throw new Error('工程资源路径无效。');
    if (entry.originalSize > MAX_EXPANDED || (expanded += entry.originalSize) > MAX_EXPANDED) throw new Error('工程展开后过大。');
    return entry.name === 'project.json' || entry.name === 'mimetype' || /^assets\/[\w-]+$/.test(entry.name);
  } });
  if (!files['project.json'] || files['project.json'].length > MAX_MANIFEST) throw new Error('工程缺少有效的 project.json。');
  if (files['mimetype'] && strFromU8(files['mimetype']) !== 'application/vnd.exnoteblock.project+zip') throw new Error('不是有效的 NBSX 工程。');
  const manifest = JSON.parse(strFromU8(files['project.json']));
  if (manifest?.format === 'nbsx' && manifest.version === 1) manifest.version = 2;
  const project = validateProject(manifest);
  for (const asset of project.assets) if (files[`assets/${asset.id}`]) asset.data = bytesToBase64(files[`assets/${asset.id}`]);
  if (project.midi && !project.assets.find(asset => asset.id === project.midi?.sourceAssetId)?.data) throw new Error('工程缺少嵌入的原始 MIDI 文件。');
  if (project.provenance?.kind === 'flp' && !project.assets.find(asset => asset.id === project.provenance?.metadata.sourceAssetId)?.data) throw new Error('工程缺少嵌入的原始 FLP 文件。');
  return project;
}
