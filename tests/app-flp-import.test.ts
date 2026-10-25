import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../src/core/project';
import type { FlpImportPlan } from '../src/core/flp-import';

// Actual App callbacks at async parser/host/dialog boundaries. No DOM/physical
// input claim: core conversion and mounted browser flow have separate checks.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('  async function openBytes('), end = source.indexOf('\n  async function open()', start);
if (start < 0 || end < 0) throw new Error('FLP App callback source boundary missing');
const code = transformSync(source.slice(start, end), { loader: 'ts', target: 'es2022' }).code;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const project = createProject('Keep current'), imported = createProject('Imported FLP');
  const projectRef = { current: project }, savedSnapshot = { current: project as typeof project | undefined }, numberEditOwner = { current: { project, generation: 0 } };
  const flpOpenTicket = { current: 0 }, flpCommitTicket = { current: undefined as number | undefined };
  const state = { review: undefined as any, modal: null as string | null, message: '', dirty: false };
  const plan = { filename: 'test.flp', source: { ppq: 96, bpm: 92 }, channels: [{ id: 1, kind: 0, sample: 'pling.ogg' }], warnings: [], blockers: [] } as unknown as FlpImportPlan;
  const prepareFlpImport = vi.fn(async () => plan), withFlpSampleChecks = vi.fn((input: FlpImportPlan) => input);
  const importFlp = vi.fn(() => ({ project: imported, diagnostics: [] }));
  const desktop = { inspectFlpSamples: vi.fn(async () => ({})), clearRecovery: vi.fn(async (_id: string) => {}) };
  const confirm = vi.fn(() => true), setMessage = vi.fn((value: string) => { state.message = value; });
  const adopt = vi.fn((next: typeof project) => { flpOpenTicket.current++; projectRef.current = next; state.review = undefined; state.modal = null; });
  const scope = { projectRef, savedSnapshot, numberEditOwner, flpOpenTicket, flpCommitTicket, flpImport: state.review,
    keysHeld: { current: new Map() }, window: { desktop, confirm }, prepareFlpImport, withFlpSampleChecks, importFlp, adopt,
    setFlpImport: (value: any) => { state.review = value; }, setModal: (value: string | null) => { state.modal = value; }, setMessage,
    setDirty: (value: boolean) => { state.dirty = value; }, finishNumberDraft: vi.fn(() => true) };
  const actions = () => Function(...Object.keys(scope), `${code}\nreturn {openBytes,beginFlpImport,cancelFlpImport,finishFlpImport};`)(...Object.values({ ...scope, flpImport: state.review }));
  return { project, imported, projectRef, savedSnapshot, numberEditOwner, state, plan, prepareFlpImport, withFlpSampleChecks, importFlp, desktop, confirm, adopt, scope,
    open: (path?: string) => actions().openBytes('test.flp', Uint8Array.of(1), path), cancel: () => actions().cancelFlpImport(), finish: () => actions().finishFlpImport([], true),
    stale: () => { projectRef.current = structuredClone(projectRef.current); numberEditOwner.current.generation++; } };
}

describe('FLP review and adoption transaction', () => {
  it('parses and fingerprints before presenting review, leaving project/recovery/history intact on cancel', async () => {
    const test = fixture(); test.savedSnapshot.current = undefined;
    await test.open('D:/music/test.flp');
    expect(test.state.modal).toBe('flp-import'); expect(test.state.review.plan).toBe(test.plan);
    expect(test.desktop.inspectFlpSamples).toHaveBeenCalledWith('D:/music/test.flp', [{ id: 1, path: 'pling.ogg' }]);
    expect(test.confirm).not.toHaveBeenCalled(); expect(test.desktop.clearRecovery).not.toHaveBeenCalled(); expect(test.adopt).not.toHaveBeenCalled();
    test.cancel(); await test.finish();
    expect(test.projectRef.current).toBe(test.project); expect(test.adopt).not.toHaveBeenCalled(); expect(test.state.modal).toBeNull();
  });

  it('retains the original document on parse/conversion errors and denied discard', async () => {
    const test = fixture(); test.prepareFlpImport.mockRejectedValueOnce(new Error('bad FLP'));
    await test.open(); expect(test.state.message).toBe('bad FLP'); expect(test.state.modal).toBeNull();
    await test.open(); test.importFlp.mockImplementationOnce(() => { throw new Error('invalid pitch'); });
    await test.finish(); expect(test.state.message).toBe('invalid pitch'); expect(test.desktop.clearRecovery).not.toHaveBeenCalled();
    test.savedSnapshot.current = undefined; test.confirm.mockReturnValue(false); await test.finish();
    expect(test.projectRef.current).toBe(test.project); expect(test.adopt).not.toHaveBeenCalled(); expect(test.desktop.clearRecovery).not.toHaveBeenCalled();
    expect(test.state.review).toBeDefined();
  });

  it('creates and validates the replacement before discard, then adopts as an unsaved editable project', async () => {
    const test = fixture(); test.savedSnapshot.current = undefined; await test.open(); await test.finish();
    expect(test.importFlp).toHaveBeenCalledWith(test.plan, [], { acknowledgeWarnings: true });
    expect(test.desktop.clearRecovery).toHaveBeenCalledWith(test.project.id); expect(test.adopt).toHaveBeenCalledWith(test.imported, 'test.flp', undefined, []);
    expect(test.importFlp.mock.invocationCallOrder[0]).toBeLessThan(test.confirm.mock.invocationCallOrder[0]);
    expect(test.savedSnapshot.current).toBeUndefined(); expect(test.state.dirty).toBe(true);
  });

  it.each(['cancel', 'edit'] as const)('ignores deferred parsing after %s', async action => {
    const test = fixture(), pending = deferred<FlpImportPlan>(); test.prepareFlpImport.mockReturnValueOnce(pending.promise);
    const opening = test.open(); if (action === 'cancel') test.cancel(); else test.stale();
    pending.resolve(test.plan); await opening;
    expect(test.state.review).toBeUndefined(); expect(test.state.modal).toBeNull(); expect(test.adopt).not.toHaveBeenCalled(); expect(test.desktop.inspectFlpSamples).not.toHaveBeenCalled();
  });

  it('rejects late sample inspection, stale review confirmation and a second concurrent confirmation', async () => {
    const test = fixture(), inspect = deferred<Record<number, { sha256: string; path: string }>>();
    test.desktop.inspectFlpSamples.mockReturnValueOnce(inspect.promise);
    const opening = test.open('D:/music/test.flp'); await Promise.resolve(); test.cancel(); inspect.resolve({}); await opening;
    expect(test.withFlpSampleChecks).not.toHaveBeenCalled();
    await test.open(); test.stale(); await test.finish(); expect(test.adopt).not.toHaveBeenCalled();
    await test.open(); test.savedSnapshot.current = undefined;
    const clear = deferred<void>(); test.desktop.clearRecovery.mockReturnValueOnce(clear.promise);
    const first = test.finish(); const count = test.importFlp.mock.calls.length; await test.finish();
    expect(test.importFlp.mock.calls).toHaveLength(count); clear.resolve(); await first; expect(test.adopt).toHaveBeenCalledOnce();
  });

  it('falls back to explicit calibration if desktop inspection fails and clears old recovery only after successful adoption', async () => {
    const test = fixture(); test.desktop.inspectFlpSamples.mockRejectedValueOnce(new Error('absent'));
    await test.open('D:/music/test.flp'); expect(test.state.review.plan.warnings).toContain('本机采样文件未能核对，请手动确认音色与采样基准。');
    test.savedSnapshot.current = undefined;
    const clear = deferred<void>(); test.desktop.clearRecovery.mockReturnValueOnce(clear.promise);
    const finishing = test.finish();
    expect(test.projectRef.current).toBe(test.imported);
    expect(test.adopt.mock.invocationCallOrder[0]).toBeLessThan(test.desktop.clearRecovery.mock.invocationCallOrder[0]);
    test.stale(); clear.resolve(); await finishing;
    expect(test.adopt).toHaveBeenCalledOnce();
  });

  it('does not delete recovery on cancellation or owner change during the discard confirmation', async () => {
    for (const action of ['cancel', 'edit']) {
      const test = fixture(); test.savedSnapshot.current = undefined; await test.open();
      test.confirm.mockImplementationOnce(() => { if (action === 'cancel') test.cancel(); else test.stale(); return true; });
      await test.finish(); expect(test.adopt).not.toHaveBeenCalled(); expect(test.desktop.clearRecovery).not.toHaveBeenCalled();
    }
  });
});
