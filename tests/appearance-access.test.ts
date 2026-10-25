import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { availableAppearance } from '../src/core/appearance';
import { isShortcutPreset } from '../src/core/shortcuts';
import type { Preferences } from '../src/core/types';

// Execute the application's actual stored-preference and preference-update boundaries.
const source = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8');
const start = source.indexOf('const defaults: Preferences'), end = source.indexOf('const shortcutPlatform');
if (start < 0 || end < start) throw new Error('Appearance preference boundary missing');
const readCode = transformSync(source.slice(start, end), { loader: 'ts' }).code;
const updateLine = source.split(/\r?\n/).find(line => line.trim().startsWith('const setPrefs ='));
if (!updateLine) throw new Error('Appearance update boundary missing');
const updateCode = transformSync(updateLine, { loader: 'ts' }).code;
const read = (stored: string | null, internal = false): Preferences => Function('localStorage', 'isShortcutPreset', 'availableAppearance', `${readCode};return readPreferences();`)(
  { getItem: () => stored }, isShortcutPreset, internal ? (value: unknown) => availableAppearance(value, true) : availableAppearance,
);

describe('public appearance access and stored preference compatibility', () => {
  it('ignores a legacy enabled glass preference while preserving unrelated editor preferences', () => {
    const saved = { appearance: 'liquid-glass', preset: 'logic', snap: 32, noteLength: 8, showMixer: true, showLibrary: false, showInspector: true, shortcuts: { save: 'Ctrl+S' } };
    expect(read(JSON.stringify(saved))).toEqual({ ...saved, appearance: 'classic' });
  });
  it('falls back to classic for missing or malformed preferences', () => {
    expect(read(null).appearance).toBe('classic');
    expect(read('{invalid').appearance).toBe('classic');
  });
  it('rejects unknown appearance values without resetting other preferences', () => {
    expect(read(JSON.stringify({ appearance: 'unknown-theme', noteLength: 32 }))).toMatchObject({ appearance: 'classic', noteLength: 32 });
  });
  it('cannot activate glass through a preference update in the public build', () => {
    let value = read(null);
    const setPrefs = Function('setPreferences', 'availableAppearance', `${updateCode};return setPrefs;`)((update: (previous: Preferences) => Preferences) => { value = update(value); }, availableAppearance);
    setPrefs({ appearance: 'liquid-glass', showMixer: true });
    expect(value).toMatchObject({ appearance: 'classic', showMixer: true, preset: 'fl' });
    setPrefs({ snap: 8 });
    expect(value).toMatchObject({ appearance: 'classic', showMixer: true, snap: 8 });
  });
  it('retains preference compatibility for a separately enabled internal build', () => {
    expect(read(JSON.stringify({ appearance: 'liquid-glass', preset: 'nbs' }), true)).toMatchObject({ appearance: 'liquid-glass', preset: 'nbs' });
    expect(availableAppearance('unknown', true)).toBe('classic');
  });
});
