import type { ShortcutPreset } from './types';

export const SHORTCUT_COMMANDS = {
  play: '播放 / 暂停', undo: '撤销', redo: '重做', duplicate: '独立复制', 'split-region': '在播放头拆分片段', draw: '绘制工具', select: '选择工具', erase: '擦除工具', mixer: '混音器', quantize: '量化选中音符',
  'track-up': '上移当前轨道', 'track-down': '下移当前轨道', 'delete-track': '删除当前轨道',
} as const;
export type ShortcutCommand = keyof typeof SHORTCUT_COMMANDS;
export interface ShortcutSettings { preset: ShortcutPreset; shortcuts: Record<string, string> }
export interface ShortcutConfig extends ShortcutSettings { format: 'nbsx-shortcuts'; version: 1 }
export interface ShortcutIssue { commands: string[]; binding?: string; message: string }
export const SHORTCUT_PRESETS: Record<ShortcutPreset, Record<ShortcutCommand, string>> = {
  fl: { play: 'Space', undo: 'Ctrl+Z', redo: 'Ctrl+Y', duplicate: 'Ctrl+B', 'split-region': 'Ctrl+T', draw: 'P', select: 'E', erase: 'D', mixer: 'F9', quantize: 'Ctrl+Q', 'track-up': '', 'track-down': '', 'delete-track': '' },
  logic: { play: 'Space', undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z', duplicate: 'Ctrl+D', 'split-region': 'Ctrl+T', draw: 'P', select: 'T', erase: 'E', mixer: 'X', quantize: 'Q', 'track-up': '', 'track-down': '', 'delete-track': '' },
  nbs: { play: 'Space', undo: 'Ctrl+Z', redo: 'Ctrl+Y', duplicate: 'Ctrl+D', 'split-region': 'Ctrl+T', draw: 'P', select: 'S', erase: 'E', mixer: 'F9', quantize: 'Ctrl+Q', 'track-up': '', 'track-down': '', 'delete-track': '' },
};
export const isShortcutPreset = (value: unknown): value is ShortcutPreset => value === 'fl' || value === 'logic' || value === 'nbs';
const isMac = (platform: string) => /mac|darwin/i.test(platform);
const primaryAliases = new Set(['ctrl', 'control', 'cmd', 'command', 'meta', 'mod', 'cmdorctrl', 'commandorcontrol']);
const keyAliases: Record<string, string> = {
  space: 'Space', spacebar: 'Space', esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete', backspace: 'Backspace', enter: 'Enter', return: 'Enter', tab: 'Tab',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', plus: 'Plus', minus: '-', comma: ',', period: '.', slash: '/', backslash: '\\', semicolon: ';', quote: "'", bracketleft: '[', bracketright: ']', backquote: '`', equal: '=',
};
const baseCodeKeys: Record<string, string> = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' };
function keyName(value: string): string | undefined {
  if (value === ' ') return 'Space';
  if (value === '+') return 'Plus';
  if (/^[a-z0-9]$/i.test(value)) return value.toUpperCase();
  if (/^[,./\\;'\[\]`=\-]$/.test(value)) return value;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(value)) return value.toUpperCase();
  return Object.hasOwn(keyAliases, value.toLowerCase()) ? keyAliases[value.toLowerCase()] : undefined;
}
/** Ctrl is the portable primary modifier: Command on macOS, Control elsewhere. */
export function normalizeShortcut(value: string): string {
  if (typeof value !== 'string' || value.length > 80) throw new Error('按键必须是最多 80 字符的文本。');
  if (!value.trim()) return '';
  const parts = value.trim().split('+').map(part => part.trim());
  if (parts.some(part => !part)) throw new Error('请使用 Ctrl+K 这样的格式；加号键写作 Plus。');
  const key = keyName(parts.pop()!); if (!key) throw new Error('不支持这个按键名称。');
  const modifiers = new Set<string>();
  for (const part of parts) {
    const lower = part.toLowerCase(), modifier = primaryAliases.has(lower) ? 'Ctrl' : lower === 'alt' || lower === 'option' ? 'Alt' : lower === 'shift' ? 'Shift' : undefined;
    if (!modifier) throw new Error(`未知修饰键“${part}”。`);
    if (modifiers.has(modifier)) throw new Error(`修饰键“${modifier}”重复。`);
    modifiers.add(modifier);
  }
  // Plus denotes the main-keyboard plus chord, also accepted from numpad Add.
  if (key === 'Plus') modifiers.add('Shift');
  return `${['Ctrl', 'Alt', 'Shift'].filter(modifier => modifiers.has(modifier)).map(modifier => modifier + '+').join('')}${key === 'Plus' ? '=' : key}`;
}
export function displayShortcut(binding: string, platform: string): string { return isMac(platform) ? binding.replace(/^Ctrl\+/, 'Cmd+') : binding; }
export interface FixedShortcut { command: string; label: string; bindings: string[]; reservedOnly?: boolean }
export function fixedShortcuts(platform: string): FixedShortcut[] {
  return [
    { command: 'play', label: '全局播放 / 暂停（空格固定保留）', bindings: ['Space', 'Shift+Space'] },
    { command: 'new', label: '新建工程', bindings: ['Ctrl+N'] }, { command: 'open', label: '打开 / 导入', bindings: ['Ctrl+O'] }, { command: 'save', label: '保存工程', bindings: ['Ctrl+S'] }, { command: 'save-as', label: '另存为', bindings: ['Ctrl+Shift+S'] },
    { command: 'copy', label: '复制', bindings: ['Ctrl+C'] }, { command: 'cut', label: '剪切', bindings: ['Ctrl+X'] }, { command: 'paste', label: '粘贴', bindings: ['Ctrl+V'] }, { command: 'select-all', label: '全选', bindings: ['Ctrl+A'] },
    { command: 'delete', label: '删除所选', bindings: ['Delete', 'Backspace'] },
    { command: 'transpose-up', label: '升高半音', bindings: ['ArrowUp'] }, { command: 'transpose-down', label: '降低半音', bindings: ['ArrowDown'] }, { command: 'transpose-octave-up', label: '升高八度', bindings: ['Shift+ArrowUp'] }, { command: 'transpose-octave-down', label: '降低八度', bindings: ['Shift+ArrowDown'] },
    { command: 'nudge-left', label: '音符左移一个网格', bindings: ['ArrowLeft'] }, { command: 'nudge-right', label: '音符右移一个网格', bindings: ['ArrowRight'] },
    { command: 'nudge-beat-left', label: '音符左移四分拍', bindings: ['Shift+ArrowLeft'] }, { command: 'nudge-beat-right', label: '音符右移四分拍', bindings: ['Shift+ArrowRight'] },
    { command: 'close-dialog', label: '关闭对话框 / 菜单', bindings: ['Escape'], reservedOnly: true },
    { command: 'activate-control', label: '焦点移动 / 激活控件', bindings: ['Tab', 'Shift+Tab', 'Enter', 'Shift+Enter'], reservedOnly: true },
    { command: 'fullscreen', label: '全屏（系统菜单）', bindings: isMac(platform) ? [] : ['F11'], reservedOnly: true },
    { command: 'devtools', label: '开发工具（系统菜单）', bindings: [isMac(platform) ? 'Ctrl+Alt+I' : 'Ctrl+Shift+I'], reservedOnly: true },
    { command: 'quit', label: '退出程序（系统）', bindings: [isMac(platform) ? 'Ctrl+Q' : 'Alt+F4'], reservedOnly: true },
    { command: 'system', label: '系统保留', bindings: isMac(platform) ? ['Ctrl+Alt+Escape'] : ['Alt+Tab', 'Alt+Space', 'Ctrl+Alt+Delete', 'Ctrl+Shift+Escape'], reservedOnly: true },
  ];
}
export function inspectShortcuts(preset: ShortcutPreset, overrides: unknown, platform: string) {
  const issues: ShortcutIssue[] = [], bindings = { ...SHORTCUT_PRESETS[preset] }, shortcuts: Record<string, string> = {};
  // Command+Q belongs to macOS Quit; retain a working FL/NBS quantize default.
  if (isMac(platform) && bindings.quantize === 'Ctrl+Q') bindings.quantize = 'Alt+Q';
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) issues.push({ commands: [], message: 'shortcuts 必须是命令到按键文本的对象。' });
  else for (const [command, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(SHORTCUT_COMMANDS, command)) { issues.push({ commands: [command], message: `未知或不可自定义的命令“${command}”。` }); continue; }
    try { const normalized = normalizeShortcut(value); shortcuts[command] = normalized; bindings[command as ShortcutCommand] = normalized; }
    catch (error) { bindings[command as ShortcutCommand] = ''; issues.push({ commands: [command], message: `${SHORTCUT_COMMANDS[command as ShortcutCommand]}：${(error as Error).message}` }); }
  }
  const occupied = new Map<string, { command: string; label: string }[]>();
  for (const fixed of fixedShortcuts(platform)) for (const binding of fixed.bindings) occupied.set(binding, [{ command: fixed.command, label: fixed.label }]);
  for (const [command, binding] of Object.entries(bindings)) {
    if (!binding) continue;
    const others = (occupied.get(binding) ?? []).filter(item => item.command !== command);
    const transport = binding === 'Space' || binding === 'Shift+Space';
    if (others.length) issues.push({ commands: transport ? [command] : [...others.map(item => item.command), command], binding, message: transport ? `${binding} 固定保留给全局播放 / 暂停，不能分配给其他命令。` : `${displayShortcut(binding, platform)} 同时用于${[...others.map(item => item.label), SHORTCUT_COMMANDS[command as ShortcutCommand]].map(label => `“${label}”`).join('和')}。` });
    occupied.set(binding, [...others, { command, label: SHORTCUT_COMMANDS[command as ShortcutCommand] }]);
  }
  // Previously stored ambiguous settings cannot silently execute the first match.
  const effective = { ...bindings };
  for (const issue of issues) for (const command of issue.commands) if (Object.hasOwn(effective, command)) effective[command as ShortcutCommand] = '';
  return { issues, valid: issues.length === 0, shortcuts, bindings, effective };
}
export function createShortcutConfig(settings: ShortcutSettings, platform: string): ShortcutConfig {
  if (!isShortcutPreset(settings.preset)) throw new Error('未知的快捷键预设。');
  const checked = inspectShortcuts(settings.preset, settings.shortcuts, platform);
  if (!checked.valid) throw new Error(checked.issues.map(issue => issue.message).join('\n'));
  return { format: 'nbsx-shortcuts', version: 1, preset: settings.preset, shortcuts: checked.shortcuts };
}
export function parseShortcutConfig(text: string, platform: string): { config: ShortcutConfig; legacy: boolean } {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 65536) throw new Error('快捷键配置不能超过 64 KiB。');
  let value: unknown; try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('配置不是有效的 JSON 文件。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是一个对象。');
  const document = value as Record<string, unknown>, legacy = !Object.hasOwn(document, 'format') && !Object.hasOwn(document, 'version');
  if (!legacy) {
    if (document.format !== 'nbsx-shortcuts' || document.version !== 1) throw new Error('不支持这个快捷键配置格式或版本。');
    if (Object.keys(document).some(key => !['format', 'version', 'preset', 'shortcuts'].includes(key))) throw new Error('快捷键配置包含未知字段。');
  }
  if (!isShortcutPreset(document.preset)) throw new Error('未知的快捷键预设。');
  const config = createShortcutConfig({ preset: document.preset, shortcuts: document.shortcuts as Record<string, string> }, platform);
  return { config, legacy };
}
type KeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> & Partial<Pick<KeyboardEvent, 'code' | 'isComposing' | 'getModifierState'>>;
/** Space, with optional Shift, controls transport regardless of focused control. */
export function isTransportSpace(event: KeyEvent): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey
    && !event.isComposing && !event.getModifierState?.('AltGraph')
    && (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar' || event.key === 'Space');
}
export function shortcutForEvent(event: KeyEvent, platform: string): string | undefined {
  if (event.isComposing || event.getModifierState?.('AltGraph')) return;
  // A physical Control on macOS or Windows/Super elsewhere is not the portable primary key.
  if (isMac(platform) ? event.ctrlKey : event.metaKey) return;
  const optionLetter = event.altKey && /^Key[A-Z]$/.test(event.code ?? '') ? event.code!.slice(3) : undefined;
  const code = event.code ?? '', baseKey = /^Digit[0-9]$/.test(code) ? code.slice(5) : Object.hasOwn(baseCodeKeys, code) ? baseCodeKeys[code] : undefined;
  const key = baseKey ?? optionLetter ?? keyName(event.key); if (!key) return;
  return `${(isMac(platform) ? event.metaKey : event.ctrlKey) ? 'Ctrl+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey || key === 'Plus' ? 'Shift+' : ''}${key === 'Plus' ? '=' : key}`;
}
export function commandForShortcut(chord: string | undefined, bindings: Record<ShortcutCommand, string>, platform: string): string | undefined {
  if (!chord) return;
  const fixed = fixedShortcuts(platform).find(item => !item.reservedOnly && item.bindings.includes(chord));
  return fixed?.command ?? Object.keys(SHORTCUT_COMMANDS).find(command => bindings[command as ShortcutCommand] === chord && chord !== '');
}
export const textEditingCommands = new Set(['undo', 'redo', 'copy', 'cut', 'paste', 'select-all', 'delete']);
export function isShortcutInput(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element && !!target.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]');
}
