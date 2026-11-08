import type { Preferences } from '../core/types';
import './LiquidGlass.css';
interface Props { appearance: Preferences['appearance']; nativeAvailable: boolean; quality?: 'auto' | 'solid'; onQualityChange: (quality: 'auto' | 'solid') => void; onChange: (appearance: Preferences['appearance']) => void; }
export function LiquidGlassAppearance({ appearance, nativeAvailable, quality = 'auto', onQualityChange, onChange }: Props) {
  const choices = [
    { id: 'classic', name: '经典', detail: '使用不透明的工作站界面。' },
    { id: 'liquid-glass', name: 'Liquid Glass · 跨平台', detail: '顶部控制栏、菜单和提示使用实时背景折射、边缘色散和高光。' },
    { id: 'native-glass', name: 'Liquid Glass · macOS 原生', detail: nativeAvailable ? '顶部控制栏使用 Apple 系统玻璃材质，由 macOS 绘制。' : '需要 macOS 26 或更新版本的 NeoNBS 桌面应用。', disabled: !nativeAvailable },
  ] as const;
  return <section className="appearance-settings" aria-label="外观偏好">
    <h3 id="appearance-options">界面外观</h3><p className="modal-intro">选择这台设备上的界面风格，即时生效。</p>
    <div className="appearance-choices" role="radiogroup" aria-labelledby="appearance-options">
      {choices.map(choice => <label className="appearance-choice" key={choice.id}>
        <input type="radio" name="studio-appearance" aria-label={choice.name} checked={appearance === choice.id} disabled={'disabled' in choice && choice.disabled} onChange={() => onChange(choice.id)} />
        <span><strong>{choice.name}</strong><small>{choice.detail}</small></span>
      </label>)}
    </div>
    {appearance === 'liquid-glass' && <>
      <label className="field"><span>玻璃渲染</span><select aria-label="玻璃渲染" value={quality === 'solid' ? 'solid' : 'auto'} onChange={event => onQualityChange(event.target.value as 'auto' | 'solid')}><option value="auto">自动 · 支持时启用折射</option><option value="solid">纯色 · 低性能设备</option></select></label>
      <p className="field-hint">减少动态、减少透明度、高对比度或能力不足时自动使用纯色。</p>
    </>}
  </section>;
}
