import type { DelayEffect } from '../core/types';
import { createDefaultDelay, delayEnvelope } from '../core/delay';
import { CommitNumberInput } from './CommitNumberInput';
import './DelayEditor.css';

export interface DelayEditorProps {
  value: DelayEffect | undefined;
  disabled?: boolean;
  contextKey: string;
  onChange: (value: DelayEffect) => void;
  onPendingChange: (field: string, pending: boolean) => void;
  previewDuration?: { beats: number; seconds: number };
  secondsPerBeat?: number;
}

const TIME_FIELDS = ['interval', 'attack', 'decay', 'release', 'releaseOffset', 'tail'] as const;
type TimeField = typeof TIME_FIELDS[number];
type RatioField = 'feedback' | 'wet' | 'sustain' | 'panAmount';
const PRESETS = [{ label: '1/4', beats: 1 }, { label: '1/8', beats: .5 }, { label: '1/16', beats: .25 }, { label: '1/32', beats: .125 }];
const bound = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const timeMinimum = (field: TimeField, unit: DelayEffect['timeUnit']) => field === 'interval' ? unit === 'beats' ? 1 / 128 : .001 : field === 'releaseOffset' ? -256 : 0;

function envelopePreview(effect: DelayEffect, duration: number) {
  const releaseStart = Math.max(0, duration + effect.releaseOffset), releaseEnd = releaseStart + effect.release;
  const end = Math.max(duration, releaseEnd, .001), x = (time: number) => 8 + time / end * 172;
  const y = (level: number) => 54 - bound(level, 0, 1) * 46;
  const times = new Set([0, duration, effect.attack, effect.attack + effect.decay, releaseStart, releaseEnd]);
  for (let i = 0; i <= 80; i++) times.add(end * i / 80);
  const points = [...times].filter(time => time >= 0 && time <= end).sort((a, b) => a - b).map(time => `${x(time)},${y(delayEnvelope(effect, time, duration))}`).join(' ');
  const releaseLevel = delayEnvelope(effect, releaseStart, duration), noteOff = x(duration);
  return <svg className="delay-envelope" role="img" aria-label="Delay ADSR 回声力度曲线" viewBox="0 0 188 82"
    data-time-unit={effect.timeUnit} data-note-duration={duration} data-release-start={releaseStart} data-release-level={releaseLevel}>
    <title>ADSR 仅影响回声音符力度；虚线表示原音符末尾，释放可提前。</title>
    <line className="delay-envelope-axis" x1="8" y1="54" x2="180" y2="54" />
    <line className="delay-note-off" data-testid="delay-note-off" x1={noteOff} y1="8" x2={noteOff} y2="56" strokeDasharray="3 3" />
    <polyline className="delay-envelope-line" data-testid="delay-envelope-line" points={points} />
    <circle className="delay-release-point" cx={x(releaseStart)} cy={y(releaseLevel)} r="2.5"><title>释放从此时的实际力度开始</title></circle>
    <text x={noteOff} y="71" textAnchor={noteOff > 94 ? 'end' : 'start'}>原音符末尾</text>
  </svg>;
}

/** Controlled track settings; original notes are never edited by this panel. */
export function DelayEditor({ value, disabled = false, contextKey, onChange, onPendingChange, previewDuration, secondsPerBeat: suppliedSecondsPerBeat }: DelayEditorProps) {
  const effect = value ?? createDefaultDelay(), milliseconds = effect.timeUnit === 'seconds', displayScale = milliseconds ? 1000 : 1, unit = milliseconds ? '毫秒' : '拍';
  const ratio = suppliedSecondsPerBeat ?? (previewDuration && previewDuration.beats > 0 && previewDuration.seconds > 0 && Number.isFinite(previewDuration.beats) && Number.isFinite(previewDuration.seconds)
    ? previewDuration.seconds / previewDuration.beats : undefined);
  const secondsPerBeat = ratio !== undefined && Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
  const suppliedDuration = previewDuration?.[effect.timeUnit], duration = suppliedDuration !== undefined && Number.isFinite(suppliedDuration) && suppliedDuration >= 0 ? suppliedDuration : 1;
  const change = (patch: Partial<DelayEffect>) => {
    if (disabled || !Object.keys(patch).some(key => !Object.is(key === 'panAmount' ? effect.panAmount ?? 0 : effect[key as keyof DelayEffect], patch[key as keyof DelayEffect]))) return;
    onChange({ ...effect, ...patch });
  };
  const changeUnit = (next: DelayEffect['timeUnit']) => {
    if (next === effect.timeUnit || !secondsPerBeat) return;
    const factor = next === 'seconds' ? secondsPerBeat : 1 / secondsPerBeat, converted = { ...effect, timeUnit: next };
    for (const field of TIME_FIELDS) converted[field] = bound(effect[field] * factor, timeMinimum(field, next), 256);
    change(converted);
  };
  const timeField = (field: TimeField, label: string) => <label className="field delay-field"><span>{label} / {unit}</span><CommitNumberInput
    aria-label={`Delay ${label}`} value={effect[field] * displayScale} min={timeMinimum(field, effect.timeUnit) * displayScale} max={256 * displayScale} step={milliseconds ? 1 : .25}
    disabled={disabled} contextKey={`${contextKey}:delay:${field}:${effect.timeUnit}`} onPendingChange={pending => onPendingChange(`delay-${field}`, pending)}
    onCommit={number => { if (Number.isFinite(number)) change({ [field]: bound(number / displayScale, timeMinimum(field, effect.timeUnit), 256) }); }} /></label>;
  const ratioField = (field: RatioField, label: string) => <label className="field delay-field"><span>{label} / %</span><CommitNumberInput
    aria-label={`Delay ${label}`} value={(effect[field] ?? 0) * 100} min={0} max={100} step={1} disabled={disabled} contextKey={`${contextKey}:delay:${field}`}
    onPendingChange={pending => onPendingChange(`delay-${field}`, pending)} onCommit={number => { if (Number.isFinite(number)) change({ [field]: bound(number, 0, 100) / 100 }); }} /></label>;

  return <div className="inspector-section delay-editor" data-testid="delay-editor" data-enabled={effect.enabled} data-mode={effect.mode}>
    <div className="inspector-heading delay-heading"><span>Delay 回声</span><label className="delay-enabled"><input type="checkbox" aria-label="启用轨道 Delay" checked={effect.enabled} disabled={disabled} onChange={event => change({ enabled: event.currentTarget.checked })} />启用</label></div>
    {!effect.enabled && <p className="delay-hint">已旁路，参数仍会保存。</p>}
    <fieldset className="delay-controls" disabled={disabled}>
      <label className="field delay-field"><span>模式</span><select aria-label="Delay 模式" value={effect.mode} disabled={disabled} onChange={event => { if (event.currentTarget.value === 'gate' || event.currentTarget.value === 'tail') change({ mode: event.currentTarget.value }); }}><option value="gate">时值关联</option><option value="tail">自由尾音</option></select></label>
      <label className="field delay-field"><span>时间单位</span><select aria-label="Delay 时间单位" value={effect.timeUnit} disabled={disabled || !secondsPerBeat} title={secondsPerBeat ? '切换时按当前工程速度换算时间' : '需要工程节拍与秒数才能换算单位'} onChange={event => { if (event.currentTarget.value === 'beats' || event.currentTarget.value === 'seconds') changeUnit(event.currentTarget.value); }}><option value="beats">节拍同步</option><option value="seconds">毫秒</option></select></label>
      {timeField('interval', '回声间隔')}
      {!milliseconds && <div className="delay-presets" aria-label="Delay 常用音符间隔">{PRESETS.map(preset => <button type="button" key={preset.label} disabled={disabled} aria-label={`Delay 间隔 ${preset.label} 音符`} aria-pressed={effect.interval === preset.beats} title={`${preset.label} 音符 · ${preset.beats} 四分拍`} onClick={() => change({ interval: preset.beats })}>{preset.label}</button>)}</div>}
      {ratioField('feedback', '每次保留')}{ratioField('wet', '回声力度')}
      {ratioField('panAmount', '左右摆幅')}
      <p className="delay-hint">逐次左 / 右交替；相对原音声像，0% 关闭。</p>
      {effect.mode === 'gate' ? <div className="delay-gate">
        {envelopePreview(effect, duration)}
        <p className="delay-hint">ADSR 只调节回声音符力度。{milliseconds ? '时间以毫秒显示。' : '拍数以四分音符为 1 拍。'}</p>
        {timeField('attack', '起音 A')}{timeField('decay', '衰减 D')}{ratioField('sustain', '保持 S')}{timeField('release', '释放 R')}{timeField('releaseOffset', '释放偏移')}
        <p className="delay-hint">释放偏移相对原音符末尾；负数表示提前。</p>
      </div> : <div className="delay-tail">{timeField('tail', '独立尾长')}<p className="delay-hint">从每个原音符开始，按独立尾长生成回声。</p></div>}
    </fieldset>
    <p className="delay-hint delay-source-hint">原音符保留；试听与 NBS 导出会展开回声音符，原音自然尾音不会被截断。</p>
  </div>;
}
