import { describe, expect, it } from 'vitest';
import { commandForShortcut, createShortcutConfig, displayShortcut, fixedShortcuts, inspectShortcuts, isTransportSpace, normalizeShortcut, parseShortcutConfig, SHORTCUT_PRESETS, shortcutForEvent } from '../src/core/shortcuts';

const event = (key: string, patch: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...patch });
const nudges = [
  ['ArrowLeft', false, 'nudge-left', '音符左移一个网格'],
  ['ArrowRight', false, 'nudge-right', '音符右移一个网格'],
  ['ArrowLeft', true, 'nudge-beat-left', '音符左移四分拍'],
  ['ArrowRight', true, 'nudge-beat-right', '音符右移四分拍'],
] as const;
describe('effective shortcut mappings', () => {
  it('leaves track organization unbound and keeps Delete focused on the current editor', () => {
    for (const preset of Object.keys(SHORTCUT_PRESETS) as (keyof typeof SHORTCUT_PRESETS)[]) for (const platform of ['win32', 'darwin']) {
      const checked = inspectShortcuts(preset, {}, platform);
      expect(checked.effective).toMatchObject({ 'track-up': '', 'track-down': '', 'delete-track': '' });
      for (const binding of ['Delete', 'Backspace']) expect(commandForShortcut(binding, checked.effective, platform)).toBe('delete');
    }
  });
  it('round-trips optional track shortcuts and rejects collisions with editing and transport', () => {
    for (const platform of ['win32', 'darwin']) {
      const config = createShortcutConfig({ preset: 'fl', shortcuts: { 'track-up': 'Alt+U', 'track-down': 'Alt+J', 'delete-track': 'Alt+K' } }, platform);
      expect(parseShortcutConfig(JSON.stringify(config), platform).config).toEqual(config);
      const checked = inspectShortcuts(config.preset, config.shortcuts, platform);
      for (const [binding, command] of [['Alt+U', 'track-up'], ['Alt+J', 'track-down'], ['Alt+K', 'delete-track']]) expect(commandForShortcut(binding, checked.effective, platform)).toBe(command);
      for (const binding of ['Delete', 'Backspace', 'Space', 'Ctrl+S', 'ArrowUp']) {
        const invalid = inspectShortcuts('fl', { 'delete-track': binding }, platform);
        expect(invalid.valid, binding).toBe(false); expect(invalid.effective['delete-track']).toBe('');
      }
      const collision = inspectShortcuts('fl', { 'track-up': 'Alt+U', 'delete-track': 'Alt+U' }, platform);
      expect(collision.valid).toBe(false); expect(commandForShortcut('Alt+U', collision.effective, platform)).toBeUndefined();
    }
    const old = parseShortcutConfig(JSON.stringify({ format: 'nbsx-shortcuts', version: 1, preset: 'logic', shortcuts: {} }), 'win32');
    expect(inspectShortcuts(old.config.preset, old.config.shortcuts, 'win32').effective).toMatchObject({ 'track-up': '', 'track-down': '', 'delete-track': '' });
  });
  it('routes region split with the portable primary key in all presets', () => {
    for (const preset of Object.keys(SHORTCUT_PRESETS) as (keyof typeof SHORTCUT_PRESETS)[]) for (const platform of ['win32', 'darwin']) {
      const checked = inspectShortcuts(preset, {}, platform);
      const chord = shortcutForEvent(event('t', platform === 'darwin' ? { metaKey: true } : { ctrlKey: true }), platform);
      expect(commandForShortcut(chord, checked.effective, platform)).toBe('split-region');
      expect(displayShortcut(checked.effective['split-region'], platform)).toBe(platform === 'darwin' ? 'Cmd+T' : 'Ctrl+T');
    }
  });
  it('allows split binding replacement or disabling and blocks ambiguous commands', () => {
    const custom = inspectShortcuts('fl', { 'split-region': 'Alt+K' }, 'win32');
    expect(custom.valid).toBe(true); expect(commandForShortcut('Alt+K', custom.effective, 'win32')).toBe('split-region');
    expect(commandForShortcut('Ctrl+T', custom.effective, 'win32')).toBeUndefined();
    const conflict = inspectShortcuts('fl', { 'split-region': 'Ctrl+B' }, 'win32');
    expect(conflict.valid).toBe(false); expect(conflict.effective['split-region']).toBe(''); expect(conflict.effective.duplicate).toBe('');
    const reassigned = inspectShortcuts('fl', { 'split-region': '', mixer: 'Ctrl+T' }, 'win32');
    expect(reassigned.valid).toBe(true); expect(commandForShortcut('Ctrl+T', reassigned.effective, 'win32')).toBe('mixer');
  });
  it('preserves older shortcut files and round-trips an explicit split override', () => {
    const old = parseShortcutConfig(JSON.stringify({ format: 'nbsx-shortcuts', version: 1, preset: 'logic', shortcuts: { duplicate: 'Ctrl+Alt+D' } }), 'win32');
    expect(inspectShortcuts(old.config.preset, old.config.shortcuts, 'win32').effective['split-region']).toBe('Ctrl+T');
    const config = createShortcutConfig({ preset: 'logic', shortcuts: { 'split-region': 'Alt+K' } }, 'darwin');
    expect(parseShortcutConfig(JSON.stringify(config), 'darwin').config).toEqual(config);
  });
  it('keeps all three presets conflict-free on Windows and macOS, including macOS Quit', () => {
    for (const preset of Object.keys(SHORTCUT_PRESETS) as (keyof typeof SHORTCUT_PRESETS)[]) for (const platform of ['win32', 'darwin']) {
      expect(inspectShortcuts(preset, {}, platform).issues).toEqual([]);
    }
    expect(inspectShortcuts('fl', {}, 'win32').effective).toMatchObject({ duplicate: 'Ctrl+B', quantize: 'Ctrl+Q' });
    expect(inspectShortcuts('fl', {}, 'darwin').effective.quantize).toBe('Alt+Q');
    expect(inspectShortcuts('fl', { quantize: 'Cmd+Q' }, 'darwin').valid).toBe(false);
  });
  it('resolves all four fixed time nudges in every preset on Windows and macOS', () => {
    for (const preset of Object.keys(SHORTCUT_PRESETS) as (keyof typeof SHORTCUT_PRESETS)[]) for (const platform of ['win32', 'darwin']) {
      const checked = inspectShortcuts(preset, {}, platform);
      expect(checked.valid).toBe(true);
      for (const [key, shiftKey, command, label] of nudges) {
        const chord = shortcutForEvent(event(key, { shiftKey }), platform);
        expect(chord).toBe(`${shiftKey ? 'Shift+' : ''}${key}`);
        expect(commandForShortcut(chord, checked.effective, platform)).toBe(command);
        expect(fixedShortcuts(platform).find(item => item.command === command)).toEqual({ command, label, bindings: [chord] });
      }
    }
  });
  it('rejects custom bindings that collide with fixed time nudges without disabling the fixed command', () => {
    for (const preset of Object.keys(SHORTCUT_PRESETS) as (keyof typeof SHORTCUT_PRESETS)[]) for (const platform of ['win32', 'darwin']) for (const [key, shiftKey, command] of nudges) {
      const binding = `${shiftKey ? 'Shift+' : ''}${key}`, checked = inspectShortcuts(preset, { duplicate: binding }, platform);
      expect(checked.valid).toBe(false);
      expect(checked.issues).toContainEqual(expect.objectContaining({ binding, commands: [command, 'duplicate'] }));
      expect(checked.effective.duplicate).toBe('');
      expect(commandForShortcut(binding, checked.effective, platform)).toBe(command);
      expect(() => createShortcutConfig({ preset, shortcuts: { duplicate: binding } }, platform)).toThrow();
    }
    expect(inspectShortcuts('fl', { mixer: 'shift+right' }, 'win32').valid).toBe(false);
  });
  it('does not allow fixed time-nudge commands themselves to be customized', () => {
    for (const [, , command] of nudges) {
      expect(inspectShortcuts('fl', { [command]: 'K' }, 'win32').valid).toBe(false);
      expect(() => parseShortcutConfig(JSON.stringify({ format: 'nbsx-shortcuts', version: 1, preset: 'fl', shortcuts: { [command]: 'K' } }), 'win32')).toThrow('不可自定义');
    }
  });
  it('normalizes portable modifiers and order without accepting ambiguous syntax', () => {
    expect(normalizeShortcut(' shift + Command + z ')).toBe('Ctrl+Shift+Z');
    expect(normalizeShortcut('Mod+option+f9')).toBe('Ctrl+Alt+F9');
    expect(normalizeShortcut('Control+Del')).toBe('Ctrl+Delete');
    expect(normalizeShortcut('  ')).toBe('');
    for (const value of ['Ctrl++', 'Ctrl+Cmd+B', 'Alt+Alt+B', 'Control+Mouse1', 'Shift+Control', 'Ctrl+B+C', 'toString', '__proto__']) expect(() => normalizeShortcut(value)).toThrow();
  });
  it('detects alias collisions and prevents either ambiguous command from firing', () => {
    const checked = inspectShortcuts('fl', { undo: 'cmd+y' }, 'win32');
    expect(checked.valid).toBe(false); expect(checked.issues[0].commands).toEqual(['undo', 'redo']);
    expect(checked.effective).toMatchObject({ undo: '', redo: '' });
    expect(commandForShortcut('Ctrl+Y', checked.effective, 'win32')).toBeUndefined();
    expect(commandForShortcut('Ctrl+S', checked.effective, 'win32')).toBe('save');
  });
  it('rejects fixed file, clipboard, transpose, control-navigation and system menu keys', () => {
    for (const binding of ['Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+C', 'Shift+ArrowUp', 'Delete', 'Escape', 'Tab', 'F11', 'Ctrl+Shift+I', 'Alt+F4']) {
      expect(inspectShortcuts('fl', { mixer: binding }, 'win32').valid, binding).toBe(false);
    }
    expect(inspectShortcuts('logic', { mixer: 'Ctrl+Alt+I' }, 'darwin').valid).toBe(false);
  });
  it('supports explicit disabling so a shortcut can be reassigned without hidden precedence', () => {
    const checked = inspectShortcuts('fl', { undo: '', mixer: 'Ctrl+Z' }, 'win32');
    expect(checked.valid).toBe(true); expect(commandForShortcut('Ctrl+Z', checked.effective, 'win32')).toBe('mixer');
    expect(commandForShortcut('F9', checked.effective, 'win32')).toBeUndefined();
  });
  it('uses Command on macOS and Control elsewhere, with exact modifier matching', () => {
    expect(shortcutForEvent(event('b', { metaKey: true }), 'darwin')).toBe('Ctrl+B');
    expect(shortcutForEvent(event('b', { ctrlKey: true }), 'darwin')).toBeUndefined();
    expect(shortcutForEvent(event('b', { metaKey: true }), 'win32')).toBeUndefined();
    expect(shortcutForEvent(event('b', { ctrlKey: true }), 'win32')).toBe('Ctrl+B');
    expect(displayShortcut('Ctrl+Shift+Z', 'darwin')).toBe('Cmd+Shift+Z');
    const bindings = inspectShortcuts('fl', {}, 'win32').effective;
    expect(commandForShortcut(shortcutForEvent(event('c', { ctrlKey: true, altKey: true }), 'win32'), bindings, 'win32')).toBeUndefined();
    expect(commandForShortcut('ArrowUp', bindings, 'win32')).toBe('transpose-up');
    expect(commandForShortcut('Shift+ArrowUp', bindings, 'win32')).toBe('transpose-octave-up');
  });
  it('ignores composition and AltGr while resolving macOS Option letters', () => {
    expect(shortcutForEvent(event('z', { isComposing: true }), 'win32')).toBeUndefined();
    expect(shortcutForEvent(event('q', { ctrlKey: true, altKey: true, getModifierState: name => name === 'AltGraph' }), 'win32')).toBeUndefined();
    expect(shortcutForEvent(event('œ', { code: 'KeyQ', altKey: true }), 'darwin')).toBe('Alt+Q');
  });
  it('matches shifted digits and punctuation by their base keys, including the Plus alias', () => {
    for (const [binding, key, code, ctrlKey] of [
      ['Shift+1', '!', 'Digit1', false], ['Ctrl+Shift+/', '?', 'Slash', true], ['Shift+,', '<', 'Comma', false], ['Shift+=', '+', 'Equal', false], ['Ctrl+Plus', '+', 'Equal', true],
    ] as const) expect(shortcutForEvent(event(key, { code, ctrlKey, shiftKey: true }), 'win32')).toBe(normalizeShortcut(binding));
    expect(normalizeShortcut('Plus')).toBe('Shift+=');
    expect(normalizeShortcut('Ctrl+Shift+Plus')).toBe('Ctrl+Shift+=');
    expect(shortcutForEvent(event('+', { code: 'NumpadAdd' }), 'win32')).toBe(normalizeShortcut('Plus'));
    expect(shortcutForEvent(event('=', { code: 'Equal' }), 'win32')).toBe('=');
    expect(shortcutForEvent(event('/', { code: 'Slash' }), 'win32')).toBe('/');
  });
  it('reserves Space for transport without disabling an additional custom play shortcut', () => {
    for (const platform of ['win32', 'darwin']) {
      const custom = inspectShortcuts('fl', { play: 'K' }, platform);
      expect(custom.valid).toBe(true); expect(commandForShortcut('K', custom.effective, platform)).toBe('play');
      expect(commandForShortcut('Space', custom.effective, platform)).toBe('play');
      const conflict = inspectShortcuts('fl', { play: 'K', duplicate: 'Space' }, platform);
      expect(conflict.issues).toContainEqual({ commands: ['duplicate'], binding: 'Space', message: 'Space 固定保留给全局播放 / 暂停，不能分配给其他命令。' });
      expect(conflict.effective).toMatchObject({ play: 'K', duplicate: '' });
      expect(commandForShortcut('K', conflict.effective, platform)).toBe('play'); expect(commandForShortcut('Space', conflict.effective, platform)).toBe('play');
      expect(() => createShortcutConfig({ preset: 'fl', shortcuts: { play: 'K', duplicate: 'Space' } }, platform)).toThrow('固定保留');
      expect(commandForShortcut('Space', inspectShortcuts('fl', { play: '' }, platform).effective, platform)).toBe('play');
      expect(commandForShortcut('Shift+Space', custom.effective, platform)).toBe('play');
      expect(inspectShortcuts('fl', { play: 'Shift+Space' }, platform).valid).toBe(true);
      const shiftedConflict = inspectShortcuts('fl', { play: 'K', duplicate: 'Shift+Space' }, platform);
      expect(shiftedConflict.issues).toContainEqual({ commands: ['duplicate'], binding: 'Shift+Space', message: 'Shift+Space 固定保留给全局播放 / 暂停，不能分配给其他命令。' });
      expect(shiftedConflict.effective).toMatchObject({ play: 'K', duplicate: '' });
      expect(commandForShortcut('Shift+Space', shiftedConflict.effective, platform)).toBe('play');
      expect(() => createShortcutConfig({ preset: 'fl', shortcuts: { duplicate: 'Shift+Space' } }, platform)).toThrow('固定保留');
    }
  });
  it('recognizes bare Space identities while leaving modifiers, IME and AltGraph to the system', () => {
    for (const key of [' ', 'Spacebar', 'Space']) expect(isTransportSpace(event(key))).toBe(true);
    expect(isTransportSpace(event('Unidentified', { code: 'Space' }))).toBe(true);
    expect(isTransportSpace(event(' ', { shiftKey: true }))).toBe(true);
    for (const patch of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { getModifierState: (name: string) => name === 'AltGraph' }]) expect(isTransportSpace(event(' ', patch))).toBe(false);
    expect(isTransportSpace(event('Enter'))).toBe(false);
  });
});

describe('standalone versioned shortcut configuration', () => {
  it('round trips only shortcut settings, normalized and independent of other preferences', () => {
    const preferences = { preset: 'fl' as const, shortcuts: { duplicate: 'mod+shift+b', erase: '' }, appearance: 'liquid-glass', snap: 32, showMixer: true };
    const exported = createShortcutConfig(preferences, 'win32');
    expect(exported).toEqual({ format: 'nbsx-shortcuts', version: 1, preset: 'fl', shortcuts: { duplicate: 'Ctrl+Shift+B', erase: '' } });
    expect(parseShortcutConfig(JSON.stringify(exported), 'win32')).toEqual({ config: exported, legacy: false });
  });
  it('reads the old whole-Preferences export while dropping appearance and unrelated fields', () => {
    const old = { preset: 'logic', shortcuts: { duplicate: 'Ctrl+Shift+D' }, appearance: 'classic', snap: 4, noteLength: 8, showLibrary: false };
    const result = parseShortcutConfig('\uFEFF' + JSON.stringify(old), 'darwin');
    expect(result.legacy).toBe(true); expect(Object.keys(result.config).sort()).toEqual(['format', 'preset', 'shortcuts', 'version']);
    expect(result.config).toMatchObject({ preset: 'logic', shortcuts: { duplicate: 'Ctrl+Shift+D' } });
    expect(old.appearance).toBe('classic');
  });
  it('rejects the complete import before application if any command, chord, conflict, version or root field is invalid', () => {
    const current = createShortcutConfig({ preset: 'fl', shortcuts: { duplicate: 'Ctrl+Shift+B' } }, 'win32');
    const before = JSON.stringify(current);
    const documents: unknown[] = [
      { ...current, version: 2 }, { ...current, format: 'preferences' }, { ...current, appearance: 'classic' }, { ...current, preset: 'unknown' },
      { ...current, shortcuts: { unknown: 'K' } }, { ...current, shortcuts: { save: 'Ctrl+P' } }, { ...current, shortcuts: { draw: 1 } }, { ...current, shortcuts: { draw: 'Ctrl++' } },
      { ...current, shortcuts: { draw: 'E' } }, { ...current, shortcuts: { duplicate: 'Cmd+S' } }, { ...current, shortcuts: [] }, null, [],
    ];
    for (const value of documents) expect(() => parseShortcutConfig(JSON.stringify(value), 'win32')).toThrow();
    expect(() => parseShortcutConfig('{"preset":"fl","shortcuts":{"__proto__":"K"}}', 'win32')).toThrow();
    expect(JSON.stringify(current)).toBe(before);
  });
  it('limits imports by actual UTF-8 bytes and reports malformed JSON', () => {
    expect(() => parseShortcutConfig('{', 'win32')).toThrow('JSON');
    expect(() => parseShortcutConfig('中'.repeat(22000), 'win32')).toThrow('64 KiB');
  });
});
