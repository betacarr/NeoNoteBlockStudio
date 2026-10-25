import type { Preferences } from '../core/types';

interface Props { appearance: Preferences['appearance']; onChange: (appearance: Preferences['appearance']) => void; }

export function LiquidGlassAppearance({ appearance, onChange }: Props) {
  const enabled = appearance === 'liquid-glass';
  return <section className="appearance-settings" aria-label="外观偏好">
    <h3>界面外观</h3>
    <p className="modal-intro">选择这台设备上的界面风格，即时生效。</p>
    <label className="appearance-choice">
      <span><strong>Liquid Glass</strong><small>透光的玻璃质感，带有折射与柔和的边缘高光。</small></span>
      <input type="checkbox" role="switch" aria-label="启用 Liquid Glass" checked={enabled} onChange={event => onChange(event.target.checked ? 'liquid-glass' : 'classic')} />
    </label>
    <p className="appearance-state" role="status">{enabled ? '已启用 Liquid Glass' : '当前使用经典界面'}</p>
    <p className="field-hint">外观仅保存在本机。音符、钢琴网格与编辑位置保持清晰。</p>
  </section>;
}
