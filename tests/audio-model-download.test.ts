import { describe, expect, it } from 'vitest';
import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { AudioModelDownloader, type ModelManifest, type ModelDownloadAudit } from '../electron/audio-model-download';

const payload = Buffer.from('controlled local model fixture; not an official checkpoint');
const sha256 = createHash('sha256').update(payload).digest('hex');
type Respond = (response: ServerResponse, request: IncomingMessage) => void;
async function fixture(run: (root: string, manifest: ModelManifest, requests: () => number, respond: (callback: Respond) => void) => Promise<void>) {
  let requests = 0, respond: Respond = response => { response.writeHead(200, { 'content-length': payload.length, etag: '"fixture-v1"' }); response.end(payload); };
  const server = createServer((request, response) => { requests++; respond(response, request); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const root = await mkdtemp(path.join(tmpdir(), 'neonbs-model-download-'));
  const manifest: ModelManifest = { id: 'controlled-fixture', name: 'Local fixture', sizeBytes: payload.length, license: 'test', licenseUrl: 'https://example.invalid/license', sourceUrl: 'https://example.invalid/source', resources: [{ filename: 'fixture.bin', url: 'http://127.0.0.1:' + port + '/fixture', sha256, bytes: payload.length }] };
  try { await run(root, manifest, () => requests, callback => { respond = callback; }); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
}
const confirmed = { id: 'controlled-fixture', confirmed: true };
async function breakStream(response: ServerResponse, root: string, etag: string | undefined = '"fixture-v1"') {
  response.writeHead(200, { 'content-length': payload.length, ...(etag ? { etag } : {}) });
  response.write(payload.subarray(0, 16));
  // Wait for the actual prefix write instead of racing a 25ms timer against
  // worker startup in the full suite. Otherwise there may be nothing to resume.
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline && !await stat(path.join(root, 'controlled-fixture.partial', 'fixture.bin')).then(s => s.size >= 16).catch(() => false)) await new Promise(resolve => setTimeout(resolve, 5));
  response.destroy();
}
function rangeResponse(response: ServerResponse, request: IncomingMessage, etag = '"fixture-v1"') {
  const [, left, right] = /^bytes=(\d+)-(\d+)$/.exec(String(request.headers.range))!;
  const start = Number(left), end = Math.min(Number(right), payload.length - 1);
  response.writeHead(206, { 'content-range': 'bytes ' + start + '-' + end + '/' + payload.length, 'content-length': end - start + 1, etag });
  response.end(payload.subarray(start, end + 1));
}

describe('model downloads with controlled loopback fixtures only', () => {
  it('requires explicit confirmation without converting a tool failure into a product block', async () => fixture(async (root, manifest, requests) => {
    const service = new AudioModelDownloader(root, manifest);
    expect((await service.status()).state).toBe('missing');
    await expect(service.download(1, { id: manifest.id })).rejects.toThrow('确认'); expect(requests()).toBe(0);
    expect((await service.download(1, confirmed)).state).toBe('ready');
  }));
  it('streams, verifies, atomically publishes and reuses an offline cache without a request', async () => fixture(async (root, manifest, requests) => {
    const progress: number[] = [], service = new AudioModelDownloader(root, manifest, (_owner, status) => progress.push(status.downloadedBytes));
    expect((await service.download(1, confirmed)).state).toBe('ready');
    expect(await readFile(path.join(root, manifest.id, 'fixture.bin'))).toEqual(payload);
    expect((await readdir(root)).some(n => n.endsWith('.partial'))).toBe(false);
    const restored = new AudioModelDownloader(root, manifest); expect((await restored.status()).state).toBe('ready');
    expect((await restored.download(1, confirmed)).state).toBe('ready');
    expect(requests()).toBe(1); expect(Math.max(...progress)).toBe(payload.length);
  }));
  it('quarantines failed whole-file hashes without publishing or automatically fetching again', async () => fixture(async (root, manifest, requests, respond) => {
    respond(response => response.end(Buffer.alloc(payload.length)));
    const service = new AudioModelDownloader(root, manifest);
    await expect(service.download(1, confirmed)).rejects.toThrow('SHA256');
    expect((await service.status()).state).toBe('error'); expect(requests()).toBe(1);
    await expect(stat(path.join(root, manifest.id))).rejects.toThrow();
    expect((await readdir(root)).some(n => n.startsWith(manifest.id + '.partial.invalid-'))).toBe(true);
  }));
  it('cancels only the owner and preserves the app-owned temporary directory', async () => fixture(async (root, manifest, _requests, respond) => {
    respond(response => { response.writeHead(200, { etag: '"fixture-v1"' }); response.write(payload.subarray(0, 5)); });
    const service = new AudioModelDownloader(root, manifest, (_owner, status) => {
      if (status.downloadedBytes && status.state === 'downloading') { expect(service.cancel(2, manifest.id)).toBe(false); expect(service.cancel(1, manifest.id)).toBe(true); }
    });
    await expect(service.download(1, confirmed)).rejects.toThrow('取消');
    expect((await service.status()).state).toBe('missing');
    expect((await readdir(root)).includes(manifest.id + '.partial')).toBe(true);
    await expect(stat(path.join(root, manifest.id))).rejects.toThrow();
  }));
  it('does not retry access denial or an untrusted redirect', async () => fixture(async (root, manifest, requests, respond) => {
    respond(response => { response.writeHead(403); response.end(); });
    const service = new AudioModelDownloader(root, manifest);
    await expect(service.download(1, confirmed)).rejects.toThrow('HTTP 403'); expect(requests()).toBe(1);
    respond(response => { response.writeHead(302, { location: 'http://example.invalid/forbidden' }); response.end(); });
    await expect(service.download(1, confirmed)).rejects.toThrow('可信来源'); expect(requests()).toBe(2);
  }));
  it('preserves corrupt existing cache and recovers only after confirmation', async () => fixture(async (root, manifest, requests) => {
    const directory = path.join(root, manifest.id); await mkdir(directory); await writeFile(path.join(directory, 'fixture.bin'), 'invalid');
    const service = new AudioModelDownloader(root, manifest);
    expect((await service.status()).state).toBe('missing'); expect(requests()).toBe(0);
    expect((await service.download(1, confirmed)).state).toBe('ready');
    const backup = (await readdir(root)).find(n => n.startsWith(manifest.id + '.invalid-'))!;
    expect(await readFile(path.join(root, backup, 'fixture.bin'), 'utf8')).toBe('invalid');
    expect(await readFile(path.join(directory, 'fixture.bin'))).toEqual(payload);
  }));
  it('bounds idle timeout and preserves partial state for a later explicit retry', async () => fixture(async (root, manifest, requests, respond) => {
    respond(response => { response.writeHead(200, { etag: '"fixture-v1"' }); response.write(payload.subarray(0, 5)); });
    const service = new AudioModelDownloader(root, manifest, undefined, { idleTimeoutMs: 70, maxRetries: 0 });
    await expect(service.download(1, confirmed)).rejects.toThrow('中断');
    expect((await service.status()).state).toBe('error');
    respond(response => response.end(payload));
    expect((await service.download(1, confirmed)).state).toBe('ready'); expect(requests()).toBe(2);
  }));
  it('bounds header timeout and permits a fresh attempt', async () => fixture(async (root, manifest, _requests, respond) => {
    respond(() => {});
    const service = new AudioModelDownloader(root, manifest, undefined, { connectionTimeoutMs: 70, maxRetries: 0 });
    await expect(service.download(1, confirmed)).rejects.toThrow('中断'); expect((await service.status()).state).toBe('error');
    respond(response => response.end(payload)); expect((await service.download(1, confirmed)).state).toBe('ready');
  }));
  it('rejects simultaneous requests before filesystem awaits can race', async () => fixture(async (root, manifest, requests) => {
    const service = new AudioModelDownloader(root, manifest), first = service.download(1, confirmed);
    await expect(service.download(2, confirmed)).rejects.toThrow('正在下载'); await first; expect(requests()).toBe(1);
  }));
  it('resumes a real severed stream with Range and If-Range and verifies the entire file', async () => fixture(async (root, manifest, requests, respond) => {
    const audit: ModelDownloadAudit[] = [], seen: IncomingMessage['headers'][] = [];
    respond((response, request) => { seen.push(request.headers); requests() === 1 ? void breakStream(response, root) : rangeResponse(response, request); });
    const service = new AudioModelDownloader(root, manifest, undefined, { retryDelayMs: 1, observe: e => audit.push(e) });
    expect((await service.download(1, confirmed)).state).toBe('ready');
    expect(seen[1].range).toBe('bytes=16-' + (payload.length - 1)); expect(seen[1]['if-range']).toBe('"fixture-v1"');
    expect(await readFile(path.join(root, manifest.id, 'fixture.bin'))).toEqual(payload);
    expect(audit.some(e => e.kind === 'retry')).toBe(true); expect(audit.some(e => e.kind === 'verified' && e.sha256 === sha256)).toBe(true);
  }));
  it('uses contiguous validated 206 segments, including the last shorter segment', async () => fixture(async (root, manifest, requests, respond) => {
    const offsets: number[] = [];
    respond((response, request) => { offsets.push(Number(/^bytes=(\d+)/.exec(String(request.headers.range))![1])); rangeResponse(response, request); });
    const service = new AudioModelDownloader(root, manifest, undefined, { segmentBytes: 8 });
    expect((await service.download(1, confirmed)).state).toBe('ready');
    expect(offsets).toEqual(Array.from({ length: Math.ceil(payload.length / 8) }, (_, i) => i * 8));
    expect(requests()).toBe(offsets.length);
  }));
  it('restarts safely when If-Range gets a 200 full response rather than appending it', async () => fixture(async (root, manifest, requests, respond) => {
    const audit: ModelDownloadAudit[] = [];
    respond(response => { if (requests() === 1) void breakStream(response, root); else { response.writeHead(200, { etag: '"new-version"', 'content-length': payload.length }); response.end(payload); } });
    const service = new AudioModelDownloader(root, manifest, undefined, { retryDelayMs: 1, observe: e => audit.push(e) });
    await service.download(1, confirmed);
    expect(await readFile(path.join(root, manifest.id, 'fixture.bin'))).toEqual(payload);
    expect(audit.some(e => e.kind === 'restart')).toBe(true);
  }));
  it('restarts after application recreation using its original validated partial state', async () => fixture(async (root, manifest, requests, respond) => {
    respond(response => { void breakStream(response, root); });
    const first = new AudioModelDownloader(root, manifest, undefined, { maxRetries: 0 });
    await expect(first.download(1, confirmed)).rejects.toThrow('中断');
    const restored = new AudioModelDownloader(root, manifest); expect((await restored.status()).downloadedBytes).toBe(16);
    respond((response, request) => { expect(request.headers['if-range']).toBe('"fixture-v1"'); expect(request.headers.range).toBe('bytes=16-' + (payload.length - 1)); rangeResponse(response, request); });
    expect((await restored.download(1, confirmed)).state).toBe('ready'); expect(requests()).toBe(2);
  }));
  it.each(['wrong-offset', 'changed-etag', '416'])('does not concatenate invalid resumed responses: %s', async scenario => fixture(async (root, manifest, requests, respond) => {
    respond((response, request) => {
      if (requests() === 1) { void breakStream(response, root); return; }
      if (scenario === '416') { response.writeHead(416, { 'content-range': 'bytes */' + payload.length }); response.end(); }
      else if (scenario === 'changed-etag') rangeResponse(response, request, '"changed"');
      else { response.writeHead(206, { 'content-range': 'bytes 0-' + (payload.length - 1) + '/' + payload.length, etag: '"fixture-v1"' }); response.end(payload); }
    });
    const service = new AudioModelDownloader(root, manifest, undefined, { retryDelayMs: 1 });
    await expect(service.download(1, confirmed)).rejects.toThrow(); expect(requests()).toBe(2);
    await expect(stat(path.join(root, manifest.id))).rejects.toThrow();
    expect((await readdir(root)).some(n => n.includes('.partial.invalid-'))).toBe(true);
  }));
  it('retries transient HTTP failures with a bounded budget', async () => fixture(async (root, manifest, requests, respond) => {
    respond(response => { if (requests() < 3) { response.writeHead(503); response.end(); } else response.end(payload); });
    expect((await new AudioModelDownloader(root, manifest, undefined, { retryDelayMs: 1, maxRetries: 2 }).download(1, confirmed)).state).toBe('ready'); expect(requests()).toBe(3);
  }));
});
