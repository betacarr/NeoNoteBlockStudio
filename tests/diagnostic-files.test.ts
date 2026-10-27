import { mkdir, mkdtemp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { FileDiagnostics, LOG_POLICY } from '../electron/diagnostics';
import { diagnosticArchive } from '../electron/diagnostic-archive';

async function folder() {
  const base = path.resolve('.local/diagnostics-unit'); await mkdir(base, { recursive: true });
  return mkdtemp(path.join(base, 'test-'));
}
describe('Bounded local logs and diagnostic archive', () => {
  it('writes ordered JSON lines with separate session IDs and retains previous sessions', async () => {
    const directory = await folder(), first = new FileDiagnostics(directory);
    first.log({ level: 'info', event: 'app.started', fields: { version: '0.1.57' } });
    first.log({ level: 'info', event: 'audio.preview.ready', fields: { loadedSamples: 20 } });
    await first.flush();
    const second = new FileDiagnostics(directory); second.log({ level: 'info', event: 'renderer.ready' });
    const result = await second.snapshot();
    expect(result.storageAvailable).toBe(true); expect(result.entries).toHaveLength(3);
    expect(result.entries.map(row => row.event)).toEqual(['app.started', 'audio.preview.ready', 'renderer.ready']);
    expect(new Set(result.entries.map(row => row.session)).size).toBe(2);
  });
  it('rotates only owned log files and enforces per-file/count limits', async () => {
    const directory = await folder(); let now = Date.now();
    await writeFile(path.join(directory, 'keep.txt'), 'unrelated');
    const logger = new FileDiagnostics(directory, { maxFileBytes: 350, maxFiles: 3, now: () => new Date(now) });
    for (let i = 0; i < 12; i++) { now += 1000; logger.log({ level: 'info', event: 'audio.play.started', fields: { tracks: i } }); await logger.flush(); }
    const logs = (await readdir(directory)).filter(name => name.endsWith('.log'));
    expect(logs.length).toBe(3);
    for (const file of logs) expect((await stat(path.join(directory, file))).size).toBeLessThanOrEqual(350);
    expect(await readFile(path.join(directory, 'keep.txt'), 'utf8')).toBe('unrelated');
    const reopened = new FileDiagnostics(directory, { maxFileBytes: 350, maxFiles: 3, now: () => new Date(now) });
    expect((await reopened.snapshot()).entries.map(row => row.fields?.tracks)).toEqual([9, 10, 11]);
  });
  it('removes expired records even when an active log also contains recent records', async () => {
    const directory = await folder(); let now = Date.parse('2026-10-01T00:00:00Z');
    const first = new FileDiagnostics(directory, { retentionDays: 30, now: () => new Date(now) });
    first.log({ level: 'info', event: 'app.started' }); await first.flush();
    now += 10 * 86400000; first.log({ level: 'info', event: 'renderer.ready' }); await first.flush();
    const second = new FileDiagnostics(directory, { now: () => new Date(now) });
    expect((await second.snapshot()).entries.map(row => row.event)).toEqual(['renderer.ready']);
    expect(await readFile(path.join(directory, 'runtime.log'), 'utf8')).not.toContain('app.started');
  });
  it('redacts before disk and revalidates tampered/corrupt stored records before export', async () => {
    const directory = await folder(), logger = new FileDiagnostics(directory);
    const secretPath = ['Z:', 'Users', 'PRIVATE_USER_SENTINEL', 'Private Folder', 'private.nbsx'].join('\\');
    logger.log({ level: 'error', event: 'renderer.error', fields: { error: new Error(secretPath) } }); await logger.flush();
    expect(await readFile(path.join(directory, 'runtime.log'), 'utf8')).not.toContain('PRIVATE_USER_SENTINEL');
    const original = JSON.parse((await readFile(path.join(directory, 'runtime.log'), 'utf8')).trim());
    const row = { ...original, sequence: 99, fields: { error: { message: secretPath }, project: { name: 'PRIVATE_PROJECT_SENTINEL' } } };
    await writeFile(path.join(directory, 'runtime.1.log'), JSON.stringify(row) + '\ninvalid private data\n');
    const snapshot = await logger.snapshot(), bytes = diagnosticArchive(snapshot, { version: '0.1.57', platform: 'win32', arch: 'x64', home: secretPath, environment: { TOKEN: 'private' } });
    const files = unzipSync(bytes), text = Object.values(files).map(bytes => strFromU8(bytes)).join('\n');
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'logs/events.jsonl', 'summary.json']);
    for (const value of ['PRIVATE_USER_SENTINEL', 'PRIVATE_PROJECT_SENTINEL', 'invalid private data', secretPath]) expect(text).not.toContain(value);
    const summary = JSON.parse(strFromU8(files['summary.json'])); expect(summary.software).not.toHaveProperty('home'); expect(summary.software).not.toHaveProperty('environment');
    expect(summary.privacy.automaticUpload).toBe(false);
  });
  it('exports bounded memory records when its disk directory is unavailable', async () => {
    const root = await folder(), unavailable = path.join(root, 'not-a-directory'); await writeFile(unavailable, 'fixture');
    const logger = new FileDiagnostics(unavailable); logger.log({ level: 'error', event: 'audio.play.failed', fields: { error: new Error('AudioContext unavailable') } });
    const snapshot = await logger.snapshot();
    expect(snapshot.storageAvailable).toBe(false); expect(snapshot.entries).toHaveLength(1);
    expect(unzipSync(diagnosticArchive(snapshot, { version: '0.1.57' }))['logs/events.jsonl']).toBeDefined();
  });
  it('limits renderer noise and reports dropped records without unbounded memory growth', async () => {
    const logger = new FileDiagnostics(await folder());
    for (let i = 0; i < 1000; i++) logger.log({ level: 'warning', event: 'renderer.console' });
    const snapshot = await logger.snapshot();
    expect(snapshot.entries.length).toBeLessThanOrEqual(LOG_POLICY.memoryRecords);
    expect(snapshot.droppedRecords).toBeGreaterThan(0);
  });
  it('stores fatal records synchronously without installing an exception-swallowing handler', async () => {
    const directory = await folder(), logger = new FileDiagnostics(directory);
    await logger.flush(); logger.emergency({ level: 'error', event: 'app.fatal', fields: { origin: 'uncaughtException', error: new Error('fatal fixture') } });
    expect(await readFile(path.join(directory, 'fatal.log'), 'utf8')).toContain('app.fatal');
  });
  it('serializes export reads with concurrent queued writes and keeps logging usable', async () => {
    const logger = new FileDiagnostics(await folder(), { maxFileBytes: 350, maxFiles: 3 });
    for (let i = 0; i < 8; i++) {
      logger.log({ level: 'info', event: 'audio.play.started', fields: { tracks: i } });
      const snapshot = logger.snapshot();
      logger.log({ level: 'info', event: 'audio.play.stopped' });
      expect((await snapshot).storageAvailable).toBe(true);
    }
    expect((await logger.snapshot()).storageAvailable).toBe(true);
  });
});
