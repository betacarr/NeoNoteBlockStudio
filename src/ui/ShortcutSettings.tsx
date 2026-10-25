import { useEffect, useRef, useState } from 'react';
import { createShortcutConfig, displayShortcut, fixedShortcuts, inspectShortcuts, parseShortcutConfig, SHORTCUT_COMMANDS, type ShortcutSettings as Settings } from '../core/shortcuts';
import type { ShortcutPreset } from '../core/types';
import './ShortcutSettings.css';

export function ShortcutSettings({ preset, shortcuts, platform, onChange }: Settings & { platform: string; onChange: (settings: Settings) => void }) {
  const [draft, setDraft] = useState<Settings>({ preset, shortcuts }), [notice, setNotice] = useState(''), [importError, setImportError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft({ preset, shortcuts }); }, [preset, shortcuts]);
  const checked = inspectShortcuts(draft.preset, draft.shortcuts, platform);
  const dirty = draft.preset !== preset || JSON.stringify(draft.shortcuts) !== JSON.stringify(shortcuts);
  const change = (next: Settings) => { setDraft(next); setNotice(''); setImportError(''); };
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error('快捷键配置不能超过 64 KiB。');
      const { config, legacy } = parseShortcutConfig(await file.text(), platform);
      const next = { preset: config.preset, shortcuts: config.shortcuts };
      onChange(next); setDraft(next); setImportError('');
      setNotice(legacy ? '已导入旧操作配置的快捷键；外观和其他偏好保持原样。' : '快捷键配置已导入并应用。');
    } catch (error) { setImportError(`未导入：${error instanceof Error ? error.message : String(error)} 当前配置保持原样。`); setNotice(''); }
  }
  async function exportFile() {
    try {
      const config = createShortcutConfig({ preset, shortcuts }, platform), text = JSON.stringify(config, null, 2);
      if (window.desktop) {
        const saved = await window.desktop.saveFile('nbsx-shortcuts.json', new TextEncoder().encode(text));
        if (!saved) return;
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'nbsx-shortcuts.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice('已导出已应用的快捷键配置。'); setImportError('');
    } catch (error) { setImportError(`导出失败：${error instanceof Error ? error.message : String(error)}`); setNotice(''); }
  }
  const appliedValid = inspectShortcuts(preset, shortcuts, platform).valid;
  return <section className="shortcut-settings" aria-label="快捷键配置">
    <p className="modal-intro">默认使用 FL 风格。左键绘制与拖动、右键擦除；Shift 在空白处框选。修改后点击“应用快捷键”，检查通过后才会生效。</p>
    <label className="field"><span>基础预设</span><select aria-label="快捷键基础预设" value={draft.preset} onChange={e => change({ preset: e.target.value as ShortcutPreset, shortcuts: {} })}><option value="fl">FL 风格</option><option value="logic">Logic 风格</option><option value="nbs">NBS 风格</option></select></label>
    <div className="shortcut-list">{Object.entries(SHORTCUT_COMMANDS).map(([command, label]) => {
      const issues = checked.issues.filter(issue => issue.commands.includes(command));
      return <div className="shortcut-row" key={command}><label className="field"><span>{label}</span><input aria-label={`快捷键 ${command}`} aria-invalid={issues.length ? true : undefined} aria-describedby={issues.length ? `shortcut-${command}-error` : undefined} spellCheck={false} maxLength={80} value={draft.shortcuts[command] ?? checked.bindings[command as keyof typeof SHORTCUT_COMMANDS]} onChange={e => change({ ...draft, shortcuts: { ...draft.shortcuts, [command]: e.target.value } })} /></label>{issues.length > 0 && <p className="shortcut-error" id={`shortcut-${command}-error`}>{issues.map(issue => issue.message).join(' ')}</p>}</div>;
    })}</div>
    {checked.issues.length > 0 && <div className="shortcut-problems" role="alert"><strong>配置尚未生效，请先解决以下问题。</strong><ul>{checked.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></div>}
    {dirty && checked.valid && <p className="shortcut-pending" role="status">更改尚未应用。</p>}
    {importError && <p className="shortcut-problems" role="alert">{importError}</p>}
    {notice && <p className="shortcut-notice" role="status">{notice}</p>}
    <div className="button-row shortcut-actions"><button className="primary" disabled={!dirty || !checked.valid} onClick={() => { const config = createShortcutConfig(draft, platform); onChange({ preset: config.preset, shortcuts: config.shortcuts }); setNotice('快捷键已应用。'); setImportError(''); }}>应用快捷键</button><button disabled={!dirty} onClick={() => { change({ preset, shortcuts }); }}>撤销更改</button><button onClick={() => change({ preset: draft.preset, shortcuts: {} })}>恢复预设</button></div>
    <div className="button-row shortcut-actions"><button onClick={() => fileInput.current?.click()}>导入快捷键配置…</button><button disabled={!appliedValid} onClick={() => void exportFile()}>导出已应用配置</button><input ref={fileInput} className="shortcut-file-input" type="file" accept=".json,application/json" aria-label="导入快捷键配置文件" onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void importFile(file); }} /></div>
    <p className="field-hint">格式示例：Ctrl+B、Ctrl+Shift+Z、Space；留空可停用该命令的额外绑定。Space / Shift+Space 固定用于全局播放 / 暂停，在输入框、按钮和弹窗中同样生效，不会代替点击；清空播放快捷键也不会关闭这两个全局按键。配置中的 Ctrl / Cmd / Mod 都表示主命令键：macOS 为 Command，Windows / Linux 为 Ctrl。macOS 物理 Control 不触发编辑器命令。</p>
    <p className="field-hint">macOS 的 FL / NBS 量化预设为 Alt+Q，避开系统 Command+Q。电脑键盘演奏或录入时，音符键优先，相关单字母编辑快捷键暂不生效。输入文字时不触发音符编辑。</p>
    <details className="shortcut-fixed"><summary>固定快捷键与系统保留键</summary><p>这些按键不随预设或导入文件改变；冲突配置不能应用。</p><dl>{fixedShortcuts(platform).filter(item => item.bindings.length).map(item => <div key={item.command}><dt>{item.label}</dt><dd>{item.bindings.map(binding => displayShortcut(binding, platform)).join(' / ')}</dd></div>)}</dl></details>
  </section>;
}
