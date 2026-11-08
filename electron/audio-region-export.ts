import { constants, createWriteStream } from 'node:fs';
import { copyFile, link, mkdtemp, open, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { validateAudioFileAsset } from '../src/core/audio-assist';
import { MAX_AUDIO_EXPORT_REGIONS, type AudioRegionExportRequest } from '../src/core/audio-region-export';
import type { AudioFileAsset } from '../src/core/types';
import { readAudioWavLayout } from './audio-asset-store';

type Region = AudioRegionExportRequest['regions'][number];

export function validateRegionExport(value: AudioRegionExportRequest) {
  if (!value || !Array.isArray(value.regions) || value.regions.length < 1 || value.regions.length > MAX_AUDIO_EXPORT_REGIONS
    || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > value.regions.length) throw new Error('音频片段导出选区无效。');
  let embeddedSize = 0;
  for (const source of value.sources) {
    if (!source || typeof source !== 'object') throw new Error('音频素材无效。');
    if ('file' in source) validateAudioFileAsset(source.file);
    else if (typeof source.data === 'string' && source.data.length > 0) embeddedSize += source.data.length;
    else throw new Error('音频素材无效。');
  }
  if (embeddedSize > 128 * 1024 ** 2) throw new Error('选区内嵌音频过大，请分批导出。');
  for (const region of value.regions) {
    if (!region || typeof region.name !== 'string' || !Number.isInteger(region.source) || !value.sources[region.source]
      || !Number.isFinite(region.offsetSeconds) || region.offsetSeconds < 0 || !Number.isFinite(region.durationSeconds)
      || region.durationSeconds <= 0 || region.durationSeconds > 7200) throw new Error('音频片段导出范围无效。');
  }
}

export function regionWavName(name: string) {
  const clean = name.replace(/\.(?:wav|flac|ogg|mp3|aac|m4a|aiff?)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const stem = [...clean].slice(0, 56).join('').replace(/^[. ]+|[. ]+$/g, '') || '音频片段';
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? '_' : ''}${stem}.wav`;
}

function wavHeader(format: Buffer, frames: number, dataSize: number) {
  const factSize = format.readUInt16LE(0) === 1 ? 0 : 12;
  const formatSize = format.length + format.length % 2;
  const headerSize = 28 + formatSize + factSize;
  const riffSize = headerSize - 8 + dataSize + dataSize % 2;
  if (riffSize > 0xffffffff) throw new Error('片段超过 WAV 文件的长度上限。');
  const header = Buffer.alloc(headerSize);
  header.write('RIFF'); header.writeUInt32LE(riffSize, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(format.length, 16); format.copy(header, 20);
  const afterFormat = 20 + formatSize;
  if (factSize) {
    header.write('fact', afterFormat); header.writeUInt32LE(4, afterFormat + 4); header.writeUInt32LE(frames, afterFormat + 8);
  }
  header.write('data', afterFormat + factSize); header.writeUInt32LE(dataSize, afterFormat + factSize + 4);
  return header;
}

async function sliceWav(source: string, target: string, region: Region) {
  const input = await open(source, 'r');
  try {
    const { sampleRate, frames, alignment, format, dataOffset } = await readAudioWavLayout(input);
    // Match the separation worker's rounding, including half-frame ties.
    const first = roundSample(region.offsetSeconds * sampleRate);
    const end = roundSample((region.offsetSeconds + region.durationSeconds) * sampleRate);
    const count = Math.min(frames, end) - first;
    if (!Number.isSafeInteger(first) || first < 0 || !(count > 0) || end > frames + 1) throw new Error(`片段超出源音频：${region.name}`);
    const size = count * alignment;
    const header = wavHeader(format, count, size);
    const start = dataOffset + first * alignment;
    await pipeline(Readable.from((async function* () {
      yield header;
      let bytes = 0;
      for await (const block of input.createReadStream({ start, end: start + size - 1, autoClose: false })) {
        bytes += block.length;
        yield block;
      }
      if (bytes !== size) throw new Error('导出期间源音频长度发生变化。');
      if (size % 2) yield Buffer.alloc(1);
    })()), createWriteStream(target, { flags: 'wx' }));
  } finally { await input.close(); }
}

function roundSample(value: number) {
  const integer = Math.floor(value);
  return value - integer === .5 && integer % 2 === 0 ? integer : Math.round(value);
}

async function publishWithoutReplacing(staged: string, filename: string) {
  try { await link(staged, filename); }
  catch (error) {
    if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'EMLINK'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    await copyFile(staged, filename, constants.COPYFILE_EXCL);
  }
}

export async function exportAudioRegions(request: AudioRegionExportRequest, destination: { file: string } | { directory: string },
  resolveSource: (file: AudioFileAsset) => Promise<string>): Promise<string[]> {
  const single = 'file' in destination;
  if (single && request.regions.length !== 1) throw new Error('多片段导出需要选择文件夹。');
  const directory = await realpath(single ? path.dirname(destination.file) : destination.directory);
  if (directory.split(path.sep).some(part => /\.nbsx\.assets$/i.test(part))) throw new Error('请选择工程资源目录之外的位置。');
  const pending = await mkdtemp(path.join(directory, '.neonbs-export-'));
  const published: string[] = [];
  const nameKey = (name: string) => name.normalize('NFC').toLowerCase();
  try {
    const sources = new Map<number, string>();
    const staged: string[] = [];
    for (const [index, region] of request.regions.entries()) {
      let source = sources.get(region.source);
      if (!source) {
        const asset = request.sources[region.source];
        if ('file' in asset) source = await resolveSource(asset.file);
        else {
          source = path.join(pending, `source-${region.source}.wav`);
          await writeFile(source, Buffer.from(asset.data, 'base64'), { flag: 'wx' });
        }
        sources.set(region.source, source);
      }
      const filename = path.join(pending, `${index}.wav`);
      await sliceWav(source, filename, region);
      staged.push(filename);
    }
    if (single) {
      const filename = path.join(directory, path.basename(destination.file));
      const canonicalSources = await Promise.all([...sources.values()].map(source => realpath(source)));
      if (canonicalSources.some(source => nameKey(source) === nameKey(filename))) throw new Error('请选择与源音频不同的导出位置。');
      await rename(staged[0], filename);
      return [filename];
    }
    const used = new Set((await readdir(directory)).map(nameKey));
    for (const [index, region] of request.regions.entries()) {
      const base = regionWavName(region.name).slice(0, -4);
      for (let suffix = 1; ; suffix++) {
        const name = `${base}${suffix === 1 ? '' : ` (${suffix})`}.wav`, key = nameKey(name);
        if (used.has(key)) continue;
        used.add(key);
        const filename = path.join(directory, name);
        try {
          await publishWithoutReplacing(staged[index], filename);
          published.push(filename);
          break;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
    }
    return published;
  } catch (error) {
    await Promise.allSettled(published.map(filename => unlink(filename)));
    throw error;
  } finally { await rm(pending, { recursive: true, force: true }); }
}
