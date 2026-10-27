import { appendFile, readFile, writeFile, mkdir, lstat, rename, unlink } from 'node:fs/promises';
import { appendFileSync, mkdirSync, lstatSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDiagnosticRedactor, normalizeDiagnostic, type DiagnosticEntry, type DiagnosticInput } from '../src/core/diagnostics';

export const LOG_POLICY = { maxFileBytes: 512 * 1024, maxFiles: 4, fatalFileBytes: 64 * 1024, retentionDays: 7, memoryRecords: 200, maxExportRecords: 3000 };
interface Options { privateValues?: string[]; now?: () => Date; maxFileBytes?: number; maxFiles?: number; retentionDays?: number }

export class FileDiagnostics {
  readonly session = randomUUID();
  readonly directory: string;
  private redact;
  private now;
  private policy;
  private queue: Promise<void>;
  private memory: DiagnosticEntry[] = [];
  private sequence = 0;
  private pending = 0;
  private dropped = 0;
  private available = true;
  private size = 0;
  private rateWindow = 0;
  private rateCount = 0;
  private maintainedAt = 0;
  constructor(directory: string, options: Options = {}) {
    this.directory = path.resolve(directory);
    this.redact = createDiagnosticRedactor(options.privateValues);
    this.now = options.now ?? (() => new Date());
    this.policy = { ...LOG_POLICY, ...Object.fromEntries(Object.entries(options).filter(([key, value]) => ['maxFileBytes', 'maxFiles', 'retentionDays'].includes(key) && typeof value === 'number' && value > 0)) };
    // The crash file has a separate synchronous writer. Normal queued writes
    // never rotate/truncate it while an exception monitor is running.
    try {
      if (lstatSync(this.directory).isSymbolicLink()) throw new Error('Invalid log directory');
      const info = lstatSync(this.fatalFile());
      if (!info.isFile() || info.isSymbolicLink() || info.size > LOG_POLICY.fatalFileBytes) throw new Error('Invalid crash log');
      const text = readFileSync(this.fatalFile(), 'utf8'), rows = this.decode(text);
      if (!rows.length) unlinkSync(this.fatalFile());
      else { const clean = rows.map(row => JSON.stringify(row)).join('\n') + '\n'; if (clean !== text) writeFileSync(this.fatalFile(), clean); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.available = false; }
    this.queue = this.initialize().catch(() => { this.available = false; });
  }
  private file(index = 0) { return path.join(this.directory, index ? `runtime.${index}.log` : 'runtime.log'); }
  private fatalFile() { return path.join(this.directory, 'fatal.log'); }
  private async regularFile(file: string) {
    try { const value = await lstat(file); if (!value.isFile() || value.isSymbolicLink()) throw new Error('Log target is not a regular file'); return value; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  private decode(text: string): DiagnosticEntry[] {
    const cutoff = this.now().getTime() - this.policy.retentionDays * 86400000;
    return text.split('\n').flatMap(line => {
      try {
        const value = JSON.parse(line), input = normalizeDiagnostic(value, this.redact), time = Date.parse(value.time);
        if (!input || value.schema !== 1 || typeof value.session !== 'string' || !/^[a-f0-9-]{36}$/.test(value.session)
          || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !Number.isFinite(time) || time < cutoff || time > this.now().getTime() + 60000) return [];
        return [{ schema: 1, time: new Date(time).toISOString(), session: value.session, sequence: value.sequence, ...input } as DiagnosticEntry];
      } catch { return []; }
    });
  }
  private async initialize() {
    await mkdir(this.directory, { recursive: true });
    const directory = await lstat(this.directory); if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Invalid log directory');
    await this.compact();
  }
  private async compact() {
    for (let i = 0; i < this.policy.maxFiles; i++) {
      const file = this.file(i), info = await this.regularFile(file); if (!info) continue;
      if (info.size > this.policy.maxFileBytes) throw new Error('Existing log exceeds its size limit');
      const entries = this.decode(await readFile(file, 'utf8'));
      if (entries.length) await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
      else await unlink(file);
    }
    this.size = (await this.regularFile(this.file()))?.size ?? 0;
    this.maintainedAt = this.now().getTime();
  }
  log(input: DiagnosticInput): boolean {
    const clean = normalizeDiagnostic(input, this.redact); if (!clean) return false;
    const time = this.now(), second = Math.floor(time.getTime() / 1000);
    if (second !== this.rateWindow) { this.rateWindow = second; this.rateCount = 0; }
    if (++this.rateCount > 50 || this.pending >= 200) { this.dropped++; return false; }
    const entry: DiagnosticEntry = { schema: 1, time: time.toISOString(), session: this.session, sequence: ++this.sequence, ...clean };
    this.memory.push(entry); if (this.memory.length > LOG_POLICY.memoryRecords) this.memory.shift();
    this.pending++;
    this.queue = this.queue.then(async () => {
      if (!this.available) return;
      if (this.now().getTime() - this.maintainedAt > 3600000) await this.compact();
      const line = JSON.stringify(entry) + '\n', bytes = Buffer.byteLength(line);
      if (bytes > this.policy.maxFileBytes) { this.dropped++; return; }
      await this.regularFile(this.file());
      if (this.size + bytes > this.policy.maxFileBytes) {
        for (let i = this.policy.maxFiles - 1; i >= 0; i--) {
          const file = this.file(i); if (!await this.regularFile(file)) continue;
          if (i === this.policy.maxFiles - 1) await unlink(file);
          else await rename(file, this.file(i + 1));
        }
        this.size = 0;
      }
      await appendFile(this.file(), line, { mode: 0o600 }); this.size += bytes;
    }).catch(() => { this.available = false; }).finally(() => { this.pending--; });
    return true;
  }
  /** Does not catch or change Node's fatal-exception/exit behavior. */
  emergency(input: DiagnosticInput) {
    const clean = normalizeDiagnostic(input, this.redact); if (!clean) return;
    const entry: DiagnosticEntry = { schema: 1, time: this.now().toISOString(), session: this.session, sequence: ++this.sequence, ...clean };
    this.memory.push(entry); if (this.memory.length > LOG_POLICY.memoryRecords) this.memory.shift();
    try {
      mkdirSync(this.directory, { recursive: true }); if (lstatSync(this.directory).isSymbolicLink()) return;
      let size = 0; try { const info = lstatSync(this.fatalFile()); if (!info.isFile() || info.isSymbolicLink()) return; size = info.size; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return; }
      const line = JSON.stringify(entry) + '\n';
      if (Buffer.byteLength(line) > LOG_POLICY.fatalFileBytes) return;
      if (size + Buffer.byteLength(line) > LOG_POLICY.fatalFileBytes) writeFileSync(this.fatalFile(), line, { mode: 0o600 });
      else appendFileSync(this.fatalFile(), line, { mode: 0o600 });
    } catch { /* Preserve the original failure and process exit. */ }
  }
  async flush() { await this.queue; }
  async snapshot() {
    const entries: DiagnosticEntry[] = [];
    this.queue = this.queue.then(async () => {
      if (!this.available) return;
      try {
        await this.compact();
        for (let i = this.policy.maxFiles - 1; i >= 0; i--) {
          const file = this.file(i), info = await this.regularFile(file); if (!info) continue;
          if (info.size > this.policy.maxFileBytes) throw new Error('Log file exceeds export limit');
          entries.push(...this.decode(await readFile(file, 'utf8')));
        }
        const fatal = await this.regularFile(this.fatalFile());
        if (fatal && fatal.size <= LOG_POLICY.fatalFileBytes) entries.push(...this.decode(await readFile(this.fatalFile(), 'utf8')));
      } catch { this.available = false; }
    });
    await this.flush();
    entries.push(...this.decode(this.memory.map(entry => JSON.stringify(entry)).join('\n')));
    const unique = new Map(entries.map(entry => [`${entry.session}:${entry.sequence}`, entry]));
    return { entries: [...unique.values()].sort((a, b) => a.time.localeCompare(b.time) || (a.session === b.session ? a.sequence - b.sequence : 0)).slice(-LOG_POLICY.maxExportRecords),
      storageAvailable: this.available, droppedRecords: this.dropped, policy: { ...LOG_POLICY } };
  }
}
