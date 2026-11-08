import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordDiagnostic } from '../src/ui/diagnostics';
import { DiagnosticSnapshotCapture } from '../electron/diagnostic-capture';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('bounded diagnostic snapshot handshake', () => {
  it('returns correlation metadata separately without adding log fields', () => {
    const record = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', { desktop: { recordDiagnostic: record } });
    const input = { level: 'info' as const, event: 'audio.snapshot', fields: { tracks: 2 } };
    recordDiagnostic(input, 'snapshot-1');
    expect(record).toHaveBeenCalledWith(input, 'snapshot-1');
    expect(input.fields).toEqual({ tracks: 2 });
  });
  it('accepts a slow renderer reply after the old 300 ms limit', async () => {
    vi.useFakeTimers();
    const capture = new DiagnosticSnapshotCapture();
    let id = '';
    const result = capture.capture(value => { id = value; });
    await vi.advanceTimersByTimeAsync(2000);
    capture.acknowledge(id);
    expect(await result).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out after five seconds so crash exports can continue', async () => {
    vi.useFakeTimers();
    const capture = new DiagnosticSnapshotCapture();
    const result = capture.capture(() => {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores unsolicited and late old replies during a later request', async () => {
    vi.useFakeTimers();
    const capture = new DiagnosticSnapshotCapture();
    let oldId = '', newId = '';
    const old = capture.capture(id => { oldId = id; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await old).toBe(false);
    const next = capture.capture(id => { newId = id; });
    const settled = vi.fn();
    void next.then(settled);
    capture.acknowledge(undefined);
    capture.acknowledge(oldId);
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).not.toHaveBeenCalled();
    capture.acknowledge(newId);
    expect(await next).toBe(true);
  });
  it('does not let concurrent capture replace the active waiter', async () => {
    vi.useFakeTimers();
    const capture = new DiagnosticSnapshotCapture();
    let id = '';
    const first = capture.capture(value => { id = value; });
    const send = vi.fn();
    expect(await capture.capture(send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    capture.acknowledge(id);
    expect(await first).toBe(true);
  });
  it('falls back on send failure and can immediately retry', async () => {
    vi.useFakeTimers();
    const capture = new DiagnosticSnapshotCapture();
    expect(await capture.capture(() => { throw new Error('renderer gone'); })).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(await capture.capture(id => capture.acknowledge(id))).toBe(true);
  });
});
