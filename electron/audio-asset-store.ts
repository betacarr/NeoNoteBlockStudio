import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, realpath, mkdir, copyFile, unlink, type FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { AudioFileAsset } from '../src/core/types';
import { validateAudioFileAsset } from '../src/core/audio-assist';
import { openNbsx } from '../src/core/container';

type Entry = { descriptor: AudioFileAsset; path: string; root?: string; verified?: string };
type Meta = Pick<AudioFileAsset, 'sampleRate' | 'frames' | 'channels'>;
const signature = (s: Awaited<ReturnType<typeof stat>>) => `${s.size}/${s.mtimeMs}/${s.ctimeMs}/${s.ino}`;
const same = (a: AudioFileAsset, b: AudioFileAsset) => ['sha256','bytes','sampleRate','frames','channels','file'].every(k => a[k as keyof AudioFileAsset] === b[k as keyof AudioFileAsset]);
const within = (root: string, target: string) => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
async function digest(filename: string): Promise<string> { const hash = createHash('sha256'); for await (const chunk of createReadStream(filename)) hash.update(chunk); return hash.digest('hex'); }

/** Reads only the WAV layout, regardless of the audio duration. */
export async function readAudioWavLayout(file: FileHandle) {
  const details = await file.stat(), header = Buffer.alloc(12);
  await file.read(header, 0, header.length, 0);
  if (!details.isFile() || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') throw new Error('音频资源不是有效 WAV。');
  let format: Buffer | undefined, dataSize = -1, dataOffset = 0;
  const chunk = Buffer.alloc(8);
  for (let position = 12, chunks = 0; position + 8 <= details.size && chunks < 10000; chunks++) {
    await file.read(chunk, 0, 8, position);
    const size = chunk.readUInt32LE(4), start = position + 8;
    if (start + size > details.size) throw new Error('音频 WAV 数据不完整。');
    const type = chunk.toString('ascii', 0, 4);
    if (type === 'fmt ' && size >= 16 && size <= 65554) {
      format = Buffer.alloc(size);
      await file.read(format, 0, size, start);
      if (![1, 3, 65534].includes(format.readUInt16LE(0))) throw new Error('音频 WAV 编码不支持。');
    }
    if (type === 'data') { dataSize = size; dataOffset = start; }
    position = start + size + size % 2;
  }
  if (!format) throw new Error('音频 WAV 采样信息无效。');
  const channels = format.readUInt16LE(2), sampleRate = format.readUInt32LE(4), alignment = format.readUInt16LE(12);
  if (!alignment || !channels || sampleRate < 8000 || dataSize < 0 || dataSize % alignment) throw new Error('音频 WAV 采样信息无效。');
  return { bytes: details.size, sampleRate, frames: dataSize / alignment, channels, alignment, format, dataOffset };
}

export async function inspectAudioWav(filename: string): Promise<Meta & { bytes: number }> {
  const file = await open(filename, 'r');
  try {
    const { bytes, sampleRate, frames, channels } = await readAudioWavLayout(file);
    return { bytes, sampleRate, frames, channels };
  } finally { await file.close(); }
}

export class AudioAssetStore {
  private owners = new Map<number, Map<string, Entry>>();
  private revoked = new Set<number>();
  private capabilities = new Map<string, { owner: number; entry: Entry }>();
  private entries(owner: number) { if(this.revoked.has(owner))throw new Error('音频资源所属窗口已关闭。');let entries=this.owners.get(owner); if (!entries) this.owners.set(owner, entries=new Map()); return entries; }
  async register(owner: number, filename: string, meta: Meta): Promise<AudioFileAsset> {
    const canonical = await realpath(filename), actual = await inspectAudioWav(canonical);
    if (actual.sampleRate !== meta.sampleRate || actual.frames !== meta.frames || actual.channels !== meta.channels) throw new Error('音频资源长度或采样率不一致。');
    const sha256=await digest(canonical), descriptor: AudioFileAsset={...actual,sha256,file:`audio/${sha256}.wav`}; validateAudioFileAsset(descriptor);
    this.entries(owner).set(sha256,{descriptor,path:canonical,verified:signature(await stat(canonical))}); return descriptor;
  }
  async registerProject(owner: number, projectPath: string, bytes: Uint8Array): Promise<void> {
    const root=path.resolve(projectPath + '.assets');
    for (const asset of openNbsx(bytes).assets) if (asset.audioFile) {
      validateAudioFileAsset(asset.audioFile);
      // Do not reject the whole musical project when an audio file is offline.
      this.entries(owner).set(asset.audioFile.sha256,{descriptor:{...asset.audioFile},path:path.join(root,...asset.audioFile.file.split('/')),root});
    }
  }
  private async verify(entry: Entry): Promise<void> {
    try {
      const canonical=await realpath(entry.path);
      if (entry.root) {
        // Resolve the parent, not the sidecar itself: a symlinked sidecar must
        // not grant access outside the directory selected with the project.
        const parent=await realpath(path.dirname(entry.root));
        if (!within(parent,canonical) || !within(path.join(parent,path.basename(entry.root)),canonical)) throw new Error('音频资源路径越出工程资源目录。');
      }
      const details=await stat(canonical), current=signature(details);
      if (!details.isFile() || details.size !== entry.descriptor.bytes) throw new Error('音频资源大小不匹配。');
      if (entry.verified !== current) {
        const info=await inspectAudioWav(canonical);
        if (info.frames!==entry.descriptor.frames || info.sampleRate!==entry.descriptor.sampleRate || info.channels!==entry.descriptor.channels || await digest(canonical)!==entry.descriptor.sha256) throw new Error('音频资源校验不匹配。');
        entry.verified=current;
      }
    } catch (error) { throw new Error(`音频素材缺失或已损坏，请重新定位：${entry.descriptor.sha256.slice(0,12)}（${error instanceof Error ? error.message : '无法读取'}）`); }
  }
  private lookup(owner: number, descriptor: AudioFileAsset): Entry {
    validateAudioFileAsset(descriptor); const entry=this.entries(owner).get(descriptor.sha256);
    if (!entry || !same(entry.descriptor,descriptor)) throw new Error('音频素材尚未获准读取，请打开所属工程或重新定位素材。'); return entry;
  }
  async inputPath(owner: number, descriptor: AudioFileAsset): Promise<string> {
    const entry=this.lookup(owner,descriptor); await this.verify(entry); this.entries(owner); return entry.path;
  }
  async resolve(owner: number, descriptor: AudioFileAsset): Promise<string> {
    const entry=this.lookup(owner,descriptor); await this.verify(entry);
    this.entries(owner); // A close during streamed verification revokes this request too.
    const token=randomBytes(24).toString('hex'); this.capabilities.set(token,{owner,entry}); return `nbsx://app/audio-assets/${token}`;
  }
  async relink(owner: number, descriptor: AudioFileAsset, trustedChosenPath: string): Promise<void> {
    validateAudioFileAsset(descriptor); const info=await inspectAudioWav(trustedChosenPath);
    if (info.bytes!==descriptor.bytes || info.frames!==descriptor.frames || info.channels!==descriptor.channels || info.sampleRate!==descriptor.sampleRate || await digest(trustedChosenPath)!==descriptor.sha256) throw new Error('所选音频与缺失素材的校验值不符，原引用保持不变。');
    this.entries(owner).set(descriptor.sha256,{descriptor:{...descriptor},path:await realpath(trustedChosenPath),verified:signature(await stat(trustedChosenPath))});
  }
  async prepareProjectSave(owner: number, projectPath: string, bytes: Uint8Array): Promise<void> {
    const descriptors=openNbsx(bytes).assets.flatMap(a=>a.audioFile ? [a.audioFile] : []); if (!descriptors.length) return;
    const sidecar=path.resolve(projectPath+'.assets'), parent=await realpath(path.dirname(sidecar));
    for (const folder of [sidecar,path.join(sidecar,'audio')]) {
      try { if(!within(path.join(parent,path.basename(sidecar)),await realpath(folder))) throw new Error('工程资源目录不能链接到外部位置。'); }
      catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
    }
    await mkdir(path.join(sidecar,'audio'),{recursive:true});
    const actual=await realpath(path.join(sidecar,'audio'));
    if (!within(path.join(parent,path.basename(sidecar)),actual)) throw new Error('工程资源目录不能链接到外部位置。');
    for (const descriptor of descriptors) {
      const source=this.lookup(owner,descriptor); await this.verify(source);
      const target=path.join(actual,descriptor.sha256+'.wav');
      try { await stat(target); const existing: Entry={descriptor,path:target,root:sidecar}; await this.verify(existing); continue; }
      catch(error) { if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
      const temporary=target+'.writing-'+randomBytes(12).toString('hex');
      try {
        const hash=createHash('sha256');
        await pipeline(createReadStream(source.path),new Transform({transform(chunk,_encoding,done){hash.update(chunk);done(null,chunk);}}),createWriteStream(temporary,{flags:'wx'}));
        if (hash.digest('hex')!==descriptor.sha256 || (await stat(temporary)).size!==descriptor.bytes) throw new Error('复制音频资源时校验失败，未保存工程。');
        // Publish without replacing an existing destination, even under races.
        try { await copyFile(temporary,target,constants.COPYFILE_EXCL); } catch(error) { if ((error as NodeJS.ErrnoException).code!=='EEXIST') throw error; await this.verify({descriptor,path:target,root:sidecar}); }
      } finally { await unlink(temporary).catch(()=>{}); }
    }
  }
  clearOwner(owner: number): void { this.revoked.add(owner);this.owners.delete(owner); for (const [token,value] of this.capabilities) if(value.owner===owner) this.capabilities.delete(token); }
  async response(request: Request): Promise<Response|undefined> {
    const url=new URL(request.url); if (url.hostname!=='app' || !url.pathname.startsWith('/audio-assets/')) return undefined;
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
    const capability=this.capabilities.get(url.pathname.slice('/audio-assets/'.length)); if (!capability) return new Response('Not found',{status:404});
    const entry=capability.entry;
    try { await this.verify(entry); } catch { return new Response('Audio asset missing or changed',{status:410}); }
    const size=entry.descriptor.bytes; let start=0,end=size-1,status=200;
    const range=request.headers.get('range');
    if (range) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1]&&!match[2])) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
      if (!match[1]) start=Math.max(0,size-Number(match[2])); else { start=Number(match[1]); if(match[2])end=Math.min(end,Number(match[2])); }
      if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}}); status=206;
    }
    const headers: Record<string,string>={'Content-Type':'audio/wav','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store'};
    if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
    return new Response(request.method==='HEAD'?null:Readable.toWeb(createReadStream(entry.path,{start,end})) as unknown as BodyInit,{status,headers});
  }
}
