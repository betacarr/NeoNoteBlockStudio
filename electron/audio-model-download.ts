import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, readFile, writeFile, lstat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import type { AudioModelStatus as SharedAudioModelStatus } from '../src/core/audio-assist';

export type AudioModelStatus = SharedAudioModelStatus & { licenseUrl: string };
export interface ModelResource { filename: string; url: string; sha256: string; bytes?: number }
export interface ModelManifest { id: string; name: string; sizeBytes: number; license: string; licenseUrl: string; sourceUrl: string; resources: ModelResource[] }
export interface ModelDownloadAudit {
  kind: 'response' | 'verified' | 'cache' | 'preserved-cache' | 'error' | 'retry' | 'resume' | 'restart' | 'runtime';
  filename?: string; host?: string; status?: number; redirectHost?: string; bytes?: number; contentLength?: number;
  sha256?: string; message?: string; offset?: number; end?: number; total?: number; etag?: string;
  lastModified?: string; ifRange?: string; contentRange?: string; attempt?: number; delayMs?: number; details?: unknown;
}
export interface ModelDownloadOptions {
  connectionTimeoutMs?: number; idleTimeoutMs?: number; totalTimeoutMs?: number;
  maxRetries?: number; retryDelayMs?: number; segmentBytes?: number; observe?: (event: ModelDownloadAudit) => void;
}
// Digests independently checked against the author's GitHub asset list:
// https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/expanded_assets/v1.0.21
export const MEGA_MODEL: ModelManifest = {
  id: 'mvsep-mega-53', name: 'MVSEP Mega 53 Stem BS-RoFormer', sizeBytes: 1368924071, license: 'MIT',
  licenseUrl: 'https://github.com/ZFTurbo/Music-Source-Separation-Training/issues/245',
  sourceUrl: 'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/tag/v1.0.21',
  resources: [
    { filename: 'mvsep_mega_model_bs_roformer_53_stems.yaml', url: 'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.21/mvsep_mega_model_bs_roformer_53_stems.yaml', sha256: '7e198062a251587088adb91215a4f44ab59e67bd62fcc805cf54d6e7dfc51103', bytes: 4184 },
    { filename: 'mvsep_mega_model_bs_roformer_53_stems_v1.ckpt', url: 'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.21/mvsep_mega_model_bs_roformer_53_stems_v1.ckpt', sha256: 'c62820893bbf86d4e734f966bd142d9157cfc8bb8e79e9d8f9ea553f3ff3519f', bytes: 1368919887 },
  ],
};
interface PartialMeta { schema: 1; sha256: string; url: string; etag?: string; lastModified?: string; total?: number }
class DownloadFailure extends Error {
  constructor(message: string, readonly retryable = false, readonly corrupt = false, readonly retryAfterMs?: number) { super(message); }
}
const missing = (error: unknown) => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');
const validator = (meta: PartialMeta | undefined) => meta?.etag && !meta.etag.startsWith('W/') ? meta.etag : meta?.lastModified;
function safeFailure(error: unknown): { message: string; details: unknown; retryable: boolean } {
  const chain: { name: string; code?: string; message: string; bytesRead?: number; bytesWritten?: number }[] = [];
  let item: any = error;
  for (let i = 0; item && i < 4; i++, item = item.cause) {
    const code = typeof item.code === 'string' ? item.code : undefined;
    chain.push({ name: item.name ?? 'Error', code, message: String(item.message ?? item).replace(/https?:\/\/[^\s]+/g, '[URL omitted]').slice(0, 250),
      ...(typeof item.socket?.bytesRead === 'number' ? { bytesRead: item.socket.bytesRead, bytesWritten: item.socket.bytesWritten } : {}) });
  }
  const denied = chain.some(e => /EACCES|EPERM|ACCESS_DENIED|CERT_|SSL_|TLS_|UNABLE_TO_VERIFY|SELF_SIGNED/.test(e.code ?? ''));
  const network = chain.some(e => /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_|MODEL_/.test(e.code ?? '') || ['fetch failed', 'terminated'].includes(e.message));
  return { message: error instanceof DownloadFailure ? error.message : denied ? '模型下载连接被拒绝或证书校验失败，已停止，请检查网络权限。'
    : network ? '模型下载连接中断，已保留可恢复片段。' : error instanceof Error ? error.message : String(error),
    details: chain, retryable: error instanceof DownloadFailure ? error.retryable : network && !denied };
}

/** Main-process manifest only. Renderer supplies no paths, transport or hashes. */
export class AudioModelDownloader {
  private current: AudioModelStatus;
  private active?: { owner: number; controller: AbortController };
  private checkedCache = false;
  private readonly settings: Required<Omit<ModelDownloadOptions, 'observe'>>;
  constructor(private readonly root: string, private readonly manifest: ModelManifest,
    private readonly notify: (owner: number, status: AudioModelStatus) => void = () => {},
    private readonly options: ModelDownloadOptions = {}) {
    if (!/^[\w-]{1,100}$/.test(manifest.id) || !manifest.resources.length || manifest.resources.some(r => !/^[\w-][\w.-]{0,199}$/.test(r.filename) || r.filename.includes('..') || !/^[a-f0-9]{64}$/.test(r.sha256))) throw new Error('模型资源清单无效。');
    this.settings = { connectionTimeoutMs: options.connectionTimeoutMs ?? 30000, idleTimeoutMs: options.idleTimeoutMs ?? 60000,
      totalTimeoutMs: options.totalTimeoutMs ?? 6 * 60 * 60 * 1000, maxRetries: options.maxRetries ?? 5,
      retryDelayMs: options.retryDelayMs ?? 1000, segmentBytes: options.segmentBytes ?? 4 * 1024 ** 2 };
    if (Object.entries(this.settings).some(([key, n]) => !Number.isFinite(n) || n < (key === 'maxRetries' || key === 'retryDelayMs' ? 0 : 1)) || !Number.isInteger(this.settings.maxRetries) || !Number.isInteger(this.settings.segmentBytes)) throw new Error('模型下载设置无效。');
    this.current = { id: manifest.id, name: manifest.name, sizeBytes: manifest.sizeBytes, license: manifest.license, licenseUrl: manifest.licenseUrl, sourceUrl: manifest.sourceUrl,
      state: 'missing', progress: 0, downloadedBytes: 0, totalBytes: manifest.sizeBytes,
      message: '首次使用前请确认下载。断流自动退避重试，取消或关闭后保留片段，下次确认后续传；损坏缓存保留备份。' };
  }
  private audit(event: ModelDownloadAudit): void { try { this.options.observe?.(event); } catch { /* Diagnostics must not change a download. */ } }
  private get partial(): string { return path.join(this.root, this.manifest.id + '.partial'); }
  private identity(): string { return JSON.stringify({ schema: 1, id: this.manifest.id, resources: this.manifest.resources }); }
  private async hashFile(filename: string, signal?: AbortSignal) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) { if (signal?.aborted) throw signal.reason; hash.update(chunk); }
    return hash;
  }
  private async verifyDirectory(directory: string): Promise<boolean> {
    try {
      for (const r of this.manifest.resources) {
        const filename = path.join(directory, r.filename), details = await lstat(filename);
        if (!details.isFile() || details.isSymbolicLink() || r.bytes !== undefined && details.size !== r.bytes) return false;
        if ((await this.hashFile(filename)).digest('hex') !== r.sha256) return false;
      }
      return true;
    } catch (error) { if (missing(error)) return false; throw error; }
  }
  async status(): Promise<AudioModelStatus> {
    if (!this.active && !this.checkedCache) {
      if (await this.verifyDirectory(path.join(this.root, this.manifest.id))) {
        this.current = { ...this.current, state: 'ready', progress: 1, message: '模型资源校验通过，可离线复用；六轨推理仍需单独验证。' };
        this.audit({ kind: 'cache' });
      } else {
        try {
          if (await readFile(path.join(this.partial, '.manifest.json'), 'utf8') === this.identity()) {
            let bytes = 0;
            for (const r of this.manifest.resources) bytes += await stat(path.join(this.partial, r.filename)).then(s => s.isFile() ? s.size : 0).catch(() => 0);
            if (bytes) this.current = { ...this.current, downloadedBytes: bytes, message: '检测到已下载片段（' + (bytes / 1024 ** 2).toFixed(1) + ' MB），确认后校验并继续下载。' };
          }
        } catch (error) { if (!missing(error)) this.audit({ kind: 'error', message: '未采用无法读取的临时片段。' }); }
      }
      this.checkedCache = true;
    }
    return { ...this.current };
  }
  cancel(owner: number, id: unknown): boolean {
    if (id !== this.manifest.id || this.active?.owner !== owner) return false;
    this.active.controller.abort(new Error('模型下载已取消，已保留片段，下次可继续下载。')); return true;
  }
  dispose(): void { this.active?.controller.abort(new Error('模型下载已停止，已保留片段，下次可继续下载。')); }
  private async preserve(directory: string): Promise<void> {
    try { await rename(directory, directory + '.invalid-' + Date.now() + '-' + randomUUID()); this.audit({ kind: 'preserved-cache' }); }
    catch (error) { if (!missing(error)) throw error; }
  }
  private async saveMeta(filename: string, meta: PartialMeta): Promise<void> {
    const temporary = filename + '.tmp-' + randomUUID();
    await writeFile(temporary, JSON.stringify(meta), { flag: 'wx' }); await rename(temporary, filename);
  }
  private async fetchResource(resource: ModelResource, controller: AbortController, headers: Record<string, string>): Promise<Response> {
    const initial = new URL(resource.url), local = ['127.0.0.1', 'localhost', '[::1]'].includes(initial.hostname);
    const hosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
    let current = initial;
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (current.username || current.password || (local ? current.origin !== initial.origin || current.protocol !== 'http:' : current.protocol !== 'https:' || !!current.port && current.port !== '443' || !hosts.has(current.hostname))) throw new DownloadFailure('模型资源下载地址或重定向不在可信来源范围内。');
      const timer = setTimeout(() => controller.abort(Object.assign(new Error('模型下载连接超时。'), { code: 'MODEL_HEADERS_TIMEOUT' })), this.settings.connectionTimeoutMs);
      let response: Response;
      try { response = await fetch(current, { signal: controller.signal, redirect: 'manual', headers }); }
      finally { clearTimeout(timer); }
      const redirect = [301, 302, 303, 307, 308].includes(response.status), location = redirect ? response.headers.get('location') : null;
      this.audit({ kind: 'response', filename: resource.filename, host: current.hostname, status: response.status,
        contentLength: Number(response.headers.get('content-length')) || undefined, contentRange: response.headers.get('content-range') ?? undefined,
        etag: response.headers.get('etag') ?? undefined, lastModified: response.headers.get('last-modified') ?? undefined,
        ...(location ? { redirectHost: new URL(location, current).hostname } : {}) });
      if (redirect) { await response.body?.cancel(); if (!location) throw new DownloadFailure('模型下载重定向缺少地址。'); current = new URL(location, current); continue; }
      return response;
    }
    throw new DownloadFailure('模型资源重定向次数过多。');
  }
  private async resource(resource: ModelResource, signal: AbortSignal, completed: number, publish: () => void): Promise<number> {
    const filename = path.join(this.partial, resource.filename), metaFile = path.join(this.partial, '.' + resource.filename + '.json');
    const limit = resource.bytes ?? 2 * 1024 ** 3;
    let failures = 0, attempt = 0;
    for (;;) {
      if (signal.aborted) throw signal.reason;
      let size = await lstat(filename).then(s => { if (!s.isFile() || s.isSymbolicLink()) throw new DownloadFailure('模型临时文件类型无效。', false, true); return s.size; }).catch(error => { if (missing(error)) return 0; throw error; });
      let meta: PartialMeta | undefined;
      try { meta = JSON.parse(await readFile(metaFile, 'utf8')); } catch (error) { if (!missing(error)) throw new DownloadFailure('模型续传信息无效，已保留原片段。', false, true); }
      if (meta && (meta.schema !== 1 || meta.sha256 !== resource.sha256 || meta.url !== resource.url || meta.total !== undefined && (!Number.isSafeInteger(meta.total) || meta.total < 1 || meta.total > limit))) throw new DownloadFailure('模型续传清单不一致，已保留原片段。', false, true);
      if (size > limit) throw new DownloadFailure('模型临时片段超过大小限制。', false, true);
      let hash = size ? await this.hashFile(filename, signal) : createHash('sha256');
      if (size && hash.copy().digest('hex') === resource.sha256 && (resource.bytes === undefined || size === resource.bytes)) {
        this.audit({ kind: 'verified', filename: resource.filename, bytes: size, sha256: resource.sha256 }); return size;
      }
      if (size && (size === meta?.total || size === resource.bytes)) throw new DownloadFailure('模型资源 SHA256 校验失败，未采用片段。请重试下载。', false, true);
      if (size && !validator(meta)) {
        await this.preserve(filename); size = 0; hash = createHash('sha256'); meta = undefined;
        this.audit({ kind: 'restart', filename: resource.filename, message: '旧片段没有可用验证器，已备份并从头下载。' });
      }
      this.current.downloadedBytes = completed + size; this.current.progress = Math.min(.999, this.current.downloadedBytes / this.current.totalBytes);
      const requestedEnd = Math.min(limit - 1, size + this.settings.segmentBytes - 1, (meta?.total ?? limit) - 1);
      const headers: Record<string, string> = { 'Accept-Encoding': 'identity', Range: 'bytes=' + size + '-' + requestedEnd };
      if (size && validator(meta)) headers['If-Range'] = validator(meta)!;
      if (size) this.audit({ kind: 'resume', filename: resource.filename, offset: size, end: requestedEnd, total: meta?.total, ifRange: headers['If-Range'], etag: meta?.etag, lastModified: meta?.lastModified });
      const controller = new AbortController(), abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      let idle: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await this.fetchResource(resource, controller, headers);
        const length = Number(response.headers.get('content-length')) || undefined;
        if (response.status !== 200 && response.status !== 206) {
          await response.body?.cancel();
          const retryAfter = response.headers.get('retry-after');
          const wait = retryAfter && /^\d+$/.test(retryAfter) ? Math.min(60000, Number(retryAfter) * 1000) : undefined;
          if (response.status === 416) throw new DownloadFailure('服务器拒绝当前续传范围，已保留片段；下次确认将重新下载。', false, true);
          throw new DownloadFailure('模型资源下载失败（HTTP ' + response.status + '）。', response.status === 429 || response.status >= 500, false, wait);
        }
        if (!response.body) throw new DownloadFailure('模型资源响应没有数据。', true);
        if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') { await response.body.cancel(); throw new DownloadFailure('服务器返回压缩内容，无法安全按字节续传。'); }
        let end: number, total: number;
        const etag = response.headers.get('etag') ?? undefined, lastModified = response.headers.get('last-modified') ?? undefined;
        if (response.status === 206) {
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
          if (!match) { await response.body.cancel(); throw new DownloadFailure('续传响应缺少有效 Content-Range。'); }
          const start = Number(match[1]); end = Number(match[2]); total = Number(match[3]);
          if (![start, end, total].every(Number.isSafeInteger) || start !== size || end < start || end > requestedEnd || total <= end || total > limit || length !== undefined && length !== end - start + 1 || size && (meta?.total !== undefined && meta.total !== total || meta?.etag && etag && meta.etag !== etag || !meta?.etag && meta?.lastModified && lastModified && meta.lastModified !== lastModified)) {
            await response.body.cancel(); throw new DownloadFailure('续传范围、长度或资源版本不一致，未拼接响应。', false, true);
          }
        } else {
          if (size) {
            await this.preserve(filename); size = 0; hash = createHash('sha256');
            this.current.downloadedBytes = completed;
            this.audit({ kind: 'restart', filename: resource.filename, message: '服务器返回 200，原片段已备份，使用完整响应从头下载。' });
          }
          total = length ?? resource.bytes ?? 0; end = total ? total - 1 : limit - 1;
        }
        if (total > limit || resource.bytes !== undefined && total && total !== resource.bytes) { await response.body.cancel(); throw new DownloadFailure('模型资源下载长度与清单不一致。', false, true); }
        const nextMeta: PartialMeta = { schema: 1, sha256: resource.sha256, url: resource.url, etag, lastModified, ...(total ? { total } : {}) };
        await this.saveMeta(metaFile, nextMeta);
        if (total && this.manifest.resources.at(-1) === resource) this.current.totalBytes = completed + total;
        let received = 0, lastProgress = 0;
        const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(Object.assign(new Error('模型下载持续未收到数据，已超时。'), { code: 'MODEL_IDLE_TIMEOUT' })), this.settings.idleTimeoutMs); };
        armIdle();
        const meter = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
          armIdle(); received += chunk.length;
          if (size + received > limit || response.status === 206 && size + received > end + 1 || response.status === 200 && total && size + received > total) { callback(new DownloadFailure('模型资源大小超过响应范围或清单限制。', false, true)); return; }
          hash.update(chunk); this.current.downloadedBytes = completed + size + received;
          this.current.progress = Math.min(.999, this.current.downloadedBytes / this.current.totalBytes);
          if (Date.now() - lastProgress >= 250) { lastProgress = Date.now(); publish(); }
          callback(null, chunk);
        } });
        await pipeline(response.body, meter, createWriteStream(filename, { flags: size ? 'a' : 'w' }), { signal: controller.signal });
        clearTimeout(idle);
        const expected = response.status === 206 ? end - size + 1 : total ? total - size : received;
        if (received !== expected) throw new DownloadFailure('模型传输长度不足，已保留片段。', true);
        size += received;
        if (response.status === 200 || size === total) {
          const digest = hash.digest('hex');
          if (digest !== resource.sha256 || resource.bytes !== undefined && size !== resource.bytes) throw new DownloadFailure('模型资源 SHA256 校验失败，未采用片段。请重试下载。', false, true);
          this.audit({ kind: 'verified', filename: resource.filename, bytes: size, sha256: digest }); return size;
        }
        failures = 0; // A complete segment made progress. Fetch the next segment.
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        const reason = controller.signal.aborted ? controller.signal.reason : error, info = safeFailure(reason);
        this.audit({ kind: 'error', filename: resource.filename, message: info.message, details: info.details });
        if (reason instanceof DownloadFailure && reason.corrupt) throw reason;
        if (!info.retryable || failures++ >= this.settings.maxRetries) throw new DownloadFailure(info.message);
        const wait = reason instanceof DownloadFailure && reason.retryAfterMs !== undefined ? reason.retryAfterMs : Math.min(30000, this.settings.retryDelayMs * 2 ** (failures - 1));
        this.current.message = '模型下载中断，' + Math.ceil(wait / 1000) + ' 秒后从已保存位置重试（' + failures + '/' + this.settings.maxRetries + '）。'; publish();
        this.audit({ kind: 'retry', filename: resource.filename, attempt: ++attempt, delayMs: wait, message: info.message });
        await delay(wait, undefined, { signal });
        this.current.message = '正在从官方来源继续下载模型资源。'; publish();
      } finally { clearTimeout(idle); signal.removeEventListener('abort', abort); }
    }
  }
  async download(owner: number, input: { id?: unknown; confirmed?: unknown }): Promise<AudioModelStatus> {
    if (!input || input.id !== this.manifest.id || input.confirmed !== true) throw new Error('请先确认模型名称、资源大小、来源和许可，再开始下载。');
    if (this.active) throw new Error('模型资源正在下载，请等待完成或取消。');
    const active = { owner, controller: new AbortController() }; this.active = active;
    const destination = path.join(this.root, this.manifest.id);
    const totalTimer = setTimeout(() => active.controller.abort(Object.assign(new Error('本次下载达到六小时上限，已保留片段，下次可继续。'), { code: 'MODEL_TOTAL_TIMEOUT' })), this.settings.totalTimeoutMs);
    const publish = () => { try { this.notify(owner, { ...this.current }); } catch { /* The window may have closed. */ } };
    try {
      if (await this.verifyDirectory(destination)) { this.current = { ...this.current, state: 'ready', progress: 1, message: '模型资源校验通过，可离线复用；六轨推理仍需单独验证。' }; this.checkedCache = true; this.audit({ kind: 'cache' }); return { ...this.current }; }
      if (active.controller.signal.aborted) throw active.controller.signal.reason;
      await mkdir(this.root, { recursive: true }); await this.preserve(destination);
      try {
        const entry = await lstat(this.partial);
        if (!entry.isDirectory() || entry.isSymbolicLink() || await readFile(path.join(this.partial, '.manifest.json'), 'utf8') !== this.identity()) await this.preserve(this.partial);
      } catch (error) { if (!missing(error)) { await this.preserve(this.partial); } }
      await mkdir(this.partial, { recursive: true });
      await writeFile(path.join(this.partial, '.manifest.json'), this.identity());
      this.current = { ...this.current, state: 'downloading', progress: 0, downloadedBytes: 0, totalBytes: this.manifest.sizeBytes, message: '正在从官方来源下载模型，支持断点续传。' }; publish();
      let completed = 0;
      for (const r of this.manifest.resources) completed += await this.resource(r, active.controller.signal, completed, publish);
      if (active.controller.signal.aborted) throw active.controller.signal.reason;
      try { await stat(destination); throw new DownloadFailure('模型缓存目录在下载期间发生变化，已保留本次下载，请刷新后重试。'); }
      catch (error) { if (!missing(error)) throw error; }
      await rename(this.partial, destination);
      this.checkedCache = true; this.current = { ...this.current, state: 'ready', progress: 1, downloadedBytes: completed, totalBytes: completed, message: '模型资源下载并校验完成，可离线复用；六轨推理仍需单独验证。' }; publish(); return { ...this.current };
    } catch (error) {
      if (error instanceof DownloadFailure && error.corrupt) await this.preserve(this.partial);
      const reason = active.controller.signal.aborted ? active.controller.signal.reason : error, info = safeFailure(reason);
      this.checkedCache = false;
      const cancelled = active.controller.signal.aborted && (reason as NodeJS.ErrnoException)?.code !== 'MODEL_TOTAL_TIMEOUT';
      this.current = { ...this.current, state: cancelled ? 'missing' : 'error', progress: 0, message: info.message };
      this.audit({ kind: 'error', message: info.message, details: info.details }); publish();
      throw new Error(this.current.message, { cause: reason });
    } finally { clearTimeout(totalTimer); if (this.active === active) this.active = undefined; }
  }
}

export function registerAudioModelDownloads(ipc: IpcMain, cacheRoot: string, allowedSender: (event: IpcMainInvokeEvent) => boolean, options: ModelDownloadOptions = {}): AudioModelDownloader {
  const owners = new Map<number, WebContents>();
  const downloader = new AudioModelDownloader(cacheRoot, MEGA_MODEL, (owner, status) => {
    const sender = owners.get(owner);
    try { if (sender && !sender.isDestroyed()) sender.send('audio-assist:progress', { id: status.id, phase: 'model-download', progress: status.progress, message: status.message, bytes: status.downloadedBytes, total: status.totalBytes }); }
    catch { /* The window may close between check and send. */ }
  }, options);
  const guard = (event: IpcMainInvokeEvent) => { if (!allowedSender(event)) throw new Error('模型下载请求来源无效。'); };
  ipc.handle('audio-model:status', event => { guard(event); return downloader.status(); });
  ipc.handle('audio-model:download', async (event, input) => {
    guard(event); const previous = owners.get(event.sender.id); owners.set(event.sender.id, event.sender);
    const close = () => downloader.cancel(event.sender.id, MEGA_MODEL.id);
    event.sender.once('destroyed', close);
    try { return await downloader.download(event.sender.id, input); }
    finally { event.sender.removeListener('destroyed', close); if (previous) owners.set(event.sender.id, previous); else owners.delete(event.sender.id); }
  });
  ipc.handle('audio-model:cancel', (event, id) => { guard(event); return downloader.cancel(event.sender.id, id); });
  const stop = downloader.dispose.bind(downloader);
  downloader.dispose = () => { stop(); owners.clear(); for (const channel of ['audio-model:status', 'audio-model:download', 'audio-model:cancel']) ipc.removeHandler(channel); };
  return downloader;
}
