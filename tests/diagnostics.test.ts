import { describe, expect, it, vi, afterEach } from 'vitest';
import { createDiagnosticRedactor, diagnosticError, normalizeDiagnostic } from '../src/core/diagnostics';
import { audioDiagnosticSnapshot, recordDiagnostic } from '../src/ui/diagnostics';
import { createProject } from '../src/core/project';
import type { AudioEngine } from '../src/audio/engine';

afterEach(() => vi.unstubAllGlobals());
const person = 'PRIVATE_PERSON_SENTINEL', song = 'PRIVATE_SONG_SENTINEL';
const windowsPath = ['Z:', 'Users', person, 'Music', `${song}.nbsx`].join('\\');
const unixPath = ['', 'home', person, 'Music', `${song}.mid`].join('/');

describe('Diagnostic privacy boundaries', () => {
  it.each([windowsPath, unixPath, windowsPath.replaceAll('\\', '/'), windowsPath.replaceAll('\\', '\\\\'),
    '\\\\private-server\\private-share\\Music\\private-song.wav', 'file:///' + windowsPath.replaceAll('\\', '/')])('removes entire private paths: %s', value => {
    const result = createDiagnosticRedactor()(`Error at ${value}`);
    expect(result).not.toContain(person); expect(result).not.toContain(song);
    expect(result).not.toContain('private-server'); expect(result).not.toContain('private-share');
  });
  it('redacts complete paths before replacing known roots, including directories with spaces', () => {
    const home = ['Z:', 'Users', person].join('\\');
    const result = createDiagnosticRedactor([home])(`Could not read "${home}\\Private Song Folder\\some file.wav"`);
    expect(result).not.toContain(person); expect(result).not.toContain('Private Song Folder'); expect(result).not.toContain('some file');
  });
  it('removes emails, bearer tokens, credential assignments and URL query strings', () => {
    const token = ['gh', 'p_', 'a'.repeat(36)].join('');
    const result = createDiagnosticRedactor()(`me@example.test ${token}\nBearer private.bearer.token\npassword=private password\nhttps://example.test/upload?secret=private-token`);
    for (const value of ['me@example.test', token, 'private.bearer.token', 'private password', 'private-token']) expect(result).not.toContain(value);
  });
  it('never serializes attached project data, buffers or arbitrary field names', () => {
    const value = normalizeDiagnostic({ level: 'info', event: 'audio.play.request', fields: {
      mode: 'realtime', tracks: 4, project: { name: song, notes: [60, 64, 67] }, bytes: new Uint8Array(1000), environment: { SECRET: 'secret' }, filename: song,
    } });
    expect(value).toEqual({ level: 'info', event: 'audio.play.request', fields: { mode: 'realtime', tracks: 4 } });
  });
  it('ignores prototype-like field names instead of treating them as enum definitions', () => {
    const fields = JSON.parse('{"constructor":"private","toString":"private","__proto__":"private","tracks":1}');
    expect(normalizeDiagnostic({ level: 'info', event: 'audio.play.request', fields })?.fields).toEqual({ tracks: 1 });
  });
  it('preserves the official sample bank identity and historical bank IDs without accepting arbitrary strings', () => {
    for (const bankId of ['minecraft-java-26.3-noteblock-v1', 'opennbs-noteblock-preview-v1']) {
      expect(normalizeDiagnostic({ level: 'info', event: 'audio.preview.ready', fields: { bankId } })?.fields).toEqual({ bankId });
    }
    expect(normalizeDiagnostic({ level: 'info', event: 'audio.preview.ready', fields: { bankId: windowsPath } })?.fields).toEqual({});
  });
  it('accepts only known event names, finite numbers, canonical formats and builtin instrument IDs', () => {
    expect(normalizeDiagnostic({ level: 'debug', event: 'audio.play.request' })).toBeUndefined();
    expect(normalizeDiagnostic({ level: 'info', event: song })).toBeUndefined();
    expect(normalizeDiagnostic({ level: 'info', event: 'audio.play.request', fields: { tracks: NaN, missingBuiltins: ['harp', song, 'harp'], profileId: windowsPath, format: song } })?.fields).toEqual({ missingBuiltins: ['harp'] });
  });
  it('strips input fragments from errors and bounds stack/error lengths', () => {
    const error = { name: 'SyntaxError', message: `Unexpected token in "${song}"`, stack: `SyntaxError: ${song}\n    at load (${windowsPath}:12:3)\n${'    at repeated (https://example.test/private.js:1:2)\n'.repeat(100)}`, code: 'ERR_INVALID_ARG_TYPE', data: song };
    const result = diagnosticError(error);
    expect(result.name).toBe('SyntaxError'); expect(result.code).toBe('ERR_INVALID_ARG_TYPE');
    expect(JSON.stringify(result)).not.toContain(song); expect(JSON.stringify(result)).not.toContain(person);
    expect(result.stack.split('\n').length).toBeLessThanOrEqual(8);
  });
  it('does not retain custom instrument names from missing-sample failures', () => {
    expect(diagnosticError(new Error(`缺少采样：${song}`)).message).toBe('缺少采样（自定义名称已隐藏）');
  });
  it('records useful mute/gain/context facts without musical content', () => {
    const project = createProject(song); project.tracks[0].muted = true; project.audio.masterGain = 0;
    const engine = { context: { state: 'suspended', sampleRate: 48000 }, bufferFor: (id: string) => id === 'harp' ? {} : undefined } as unknown as AudioEngine;
    const result = audioDiagnosticSnapshot(project, engine, 'realtime');
    expect(result).toMatchObject({ source: 'builtin', contextState: 'suspended', masterGain: 0, mutedTracks: 1, audibleTracks: 0, loadedSamples: 1 });
    expect(JSON.stringify(result)).not.toContain(song);
  });
  it('keeps logging unavailable/rejected IPC from breaking product code', async () => {
    vi.stubGlobal('window', {});
    expect(() => recordDiagnostic({ level: 'info', event: 'renderer.ready' })).not.toThrow();
    const rejected = vi.fn(async () => { throw new Error('offline logger'); });
    vi.stubGlobal('window', { desktop: { recordDiagnostic: rejected } });
    expect(() => recordDiagnostic({ level: 'error', event: 'renderer.error', fields: { error: new Error(windowsPath) } })).not.toThrow();
    await Promise.resolve(); expect(rejected).toHaveBeenCalledOnce();
    expect(JSON.stringify(rejected.mock.calls)).not.toContain(person);
  });
});
