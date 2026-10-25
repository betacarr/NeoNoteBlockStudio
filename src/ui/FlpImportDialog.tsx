import { useLayoutEffect, useRef, useState } from 'react';
import { INSTRUMENTS } from '../core/instruments';
import { flpChannelChoiceError, type FlpChannelChoice, type FlpImportChannel, type FlpImportPlan } from '../core/flp-import';
import { CommitNumberInput, flushActiveNumberInput } from './CommitNumberInput';

export interface FlpImportDialogProps {
  plan: FlpImportPlan;
  onCancel: () => void;
  onImport: (choices: FlpChannelChoice[], acknowledgeWarnings: boolean) => void;
}

interface Review {
  plan: FlpImportPlan;
  choices: FlpChannelChoice[];
  changed: ReadonlySet<FlpChannelChoice['id']>;
  pending: ReadonlySet<FlpChannelChoice['id']>;
  acknowledged: boolean;
}
const initialReview = (plan: FlpImportPlan): Review => ({ plan,
  choices: plan.channels.map(channel => ({ id: channel.id, instrumentId: channel.instrumentId, baselineMidi: channel.baselineMidi, confirmed: false, selected: channel.kind === 0 && channel.selected })),
  changed: new Set(), pending: new Set(), acknowledged: false,
});
const channelKind = (kind: number) => kind === 0 ? '采样器' : kind === 2 ? '插件（不支持）' : kind === 4 ? '音频片段（不支持）' : kind === 5 ? '自动化（不支持）' : '不支持的声道类型';

/** Review note conversion only; no source FLP or samples are modified here. */
export function FlpImportDialog({ plan, onCancel, onImport }: FlpImportDialogProps) {
  const [review, setReview] = useState(() => initialReview(plan));
  const latest = useRef(review), dialog = useRef<HTMLElement>(null);
  const current = review.plan === plan ? review : initialReview(plan);
  latest.current = current;
  if (review.plan !== plan) setReview(current);
  useLayoutEffect(() => {
    const element = dialog.current; if (!element) return;
    const document = element.ownerDocument, previous = document.activeElement as HTMLElement | null;
    element.focus({ preventScroll: true });
    return () => { if (element.contains(document.activeElement) && previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [plan]);
  const update = (change: (before: Review) => Review) => {
    if (latest.current.plan !== plan) return;
    const next = change(latest.current); latest.current = next; setReview(next);
  };
  const changeChoice = (id: FlpChannelChoice['id'], patch: Partial<FlpChannelChoice>, mapping = false) => update(before => {
    const previous = before.choices.find(choice => choice.id === id);
    if (!previous || !Object.entries(patch).some(([key, value]) => !Object.is(previous[key as keyof FlpChannelChoice], value))) return before;
    const changed = new Set(before.changed); if (mapping) changed.add(id);
    return { ...before, changed, choices: before.choices.map(choice => choice.id === id ? { ...choice, ...patch, ...(mapping ? { confirmed: false } : {}) } : choice) };
  });
  const choiceError = (state: Review, choice: FlpChannelChoice) => choice.selected
    ? flpChannelChoiceError(plan, choice) ?? (state.changed.has(choice.id) && !choice.confirmed ? '映射已更改，请重新确认音色与采样基准。' : undefined) : undefined;
  const ready = (state: Review) => !plan.blockers.length && (!plan.warnings.length || state.acknowledged)
    && state.choices.some(choice => choice.selected)
    && state.choices.every(choice => !choiceError(state, choice));
  const cancel = () => { if (latest.current.plan === plan) onCancel(); };
  const importReviewed = () => {
    if (latest.current.plan !== plan || !flushActiveNumberInput()) return;
    const state = latest.current;
    if (state.plan !== plan || state.pending.size || !ready(state)) return;
    onImport(state.choices.map(choice => ({ ...choice })), state.acknowledged);
  };
  const selected = current.choices.filter(choice => choice.selected), selectedIds = new Set(selected.map(choice => choice.id));
  const skipped = plan.channels.filter(channel => !selectedIds.has(channel.id));
  // Keep row parents stable while editing, so selecting a previously skipped
  // channel cannot unmount its numeric field or collapse its native details.
  const primaryChannels = plan.channels.filter(channel => channel.kind === 0 && channel.selected);
  const otherChannels = plan.channels.filter(channel => !primaryChannels.includes(channel));
  const renderChannel = (channel: FlpImportChannel) => {
    const choice = current.choices.find(choice => choice.id === channel.id)!, supported = channel.kind === 0, disabled = !supported || !choice.selected;
    const verified = channel.verified && choice.instrumentId === channel.instrumentId && choice.baselineMidi === channel.baselineMidi && !current.changed.has(channel.id);
    const error = choiceError(current, choice), root = plan.source.channels[channel.id]?.root;
    return <article className="flp-import-channel" data-channel-id={channel.id} key={channel.id}>
      <div className="flp-channel-heading"><label className="checkbox"><input type="checkbox" aria-label={`导入声道 ${channel.id}`} checked={choice.selected} disabled={!supported}
        onChange={event => { if (supported) changeChoice(channel.id, { selected: event.currentTarget.checked }); }} />{channel.name || `声道 ${channel.id}`}</label><span>{channelKind(channel.kind)} · {channel.enabled ? '已启用' : '已静音'}</span></div>
      <p className="flp-channel-sample" title={channel.sample}>{channel.sample || '未提供采样路径'}</p>
      <p className="field-hint">工程使用 {channel.activeNoteCount} / 共 {channel.noteCount} 个音符{!channel.enabled && supported ? '；选入后保持静音' : ''}。FL 原根键：<output>{root ?? '未提供'}</output>（只读）</p>
      {supported && <div className="form-columns flp-channel-mapping">
        <label className="field"><span>音符盒音色</span><select aria-label={`声道 ${channel.id} 音色`} value={choice.instrumentId} disabled={disabled} onChange={event => {
          const id = event.currentTarget.value;
          if (!disabled && (id === '' || INSTRUMENTS.some(instrument => instrument.id === id))) changeChoice(channel.id, { instrumentId: id }, true);
        }}><option value="">请选择音符盒音色</option>{INSTRUMENTS.map(instrument => <option key={instrument.id} value={instrument.id}>{instrument.name}</option>)}</select></label>
        <label className="field"><span>采样基准音高 / MIDI 0–127</span><CommitNumberInput aria-label={`声道 ${channel.id} 采样基准`} value={choice.baselineMidi} min={0} max={127} step={.01}
          contextKey={`${plan.sourceSha256}:flp:${channel.id}:baseline`} disabled={disabled} onPendingChange={pending => update(before => {
            const next = new Set(before.pending); if (pending) next.add(channel.id); else next.delete(channel.id); return { ...before, pending: next };
          })} onCommit={value => {
            if (disabled || !Number.isFinite(value) || value < 0 || value > 127) return false;
            changeChoice(channel.id, { baselineMidi: value }, true);
          }} /></label>
      </div>}
      {supported && <><p className="field-hint">采样在 FL 根键上播放时，应对应这里的音高。66 是编辑器默认音高；每加 1 升高一个半音。</p>
        <p className="flp-channel-status">{verified ? '原版采样已按哈希核对，音色与基准已识别。' : '采样或映射未核对，请自行确认音色与采样基准。'}</p>
        {!verified && <label className="checkbox"><input type="checkbox" aria-label={`确认声道 ${channel.id} 映射`} checked={choice.confirmed} disabled={disabled || !choice.instrumentId}
          onChange={event => { if (!disabled) changeChoice(channel.id, { confirmed: event.currentTarget.checked }); }} />我已确认这个音色和采样基准</label>}</>}
      {channel.issues.length > 0 && <ul className="flp-import-issues">{channel.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
      {error && <p className="field-hint error" role="alert">{error}</p>}
    </article>;
  };
  return <div className="modal-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) cancel(); }} onKeyDownCapture={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); cancel(); }
  }}><section ref={dialog} tabIndex={-1} className="modal wide flp-import-dialog" role="dialog" aria-modal="true" aria-label="导入 FL Studio 工程">
    <header><h2>导入 FL Studio 工程</h2><button type="button" aria-label="关闭 FLP 导入" onClick={cancel}>取消</button></header>
    <div className="modal-body">
      <div className="flp-import-summary"><strong>{plan.filename}</strong><p>FL Studio {plan.source.version || '版本未知'} · {plan.source.bpm} BPM · PPQ {plan.source.ppq}</p>
        <p className="modal-intro">保留音符时值，片段转换为独立副本。插件音频、效果器和自动化不会转换；FLP 原文件保留。</p>
        <p>选入 {selected.length} 个声道；跳过 {skipped.length} 个声道、其中 {skipped.reduce((total, channel) => total + channel.noteCount, 0)} 个源音符。</p>
      </div>
      {plan.blockers.length > 0 && <div className="flp-import-issues" role="alert"><strong>暂时无法导入</strong><ul>{plan.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul></div>}
      <div className="flp-import-channels">{primaryChannels.map(renderChannel)}</div>
      {otherChannels.length > 0 && <details className="flp-import-other" open={primaryChannels.length ? undefined : true}>
        <summary>初始未选入的声道（{otherChannels.length}）</summary><div className="flp-import-channels">{otherChannels.map(renderChannel)}</div>
      </details>}
      {plan.warnings.length > 0 && <div className="flp-import-issues"><strong>转换警告（{plan.warnings.length}）</strong><ul>{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        <label className="checkbox"><input type="checkbox" aria-label="确认 FLP 转换警告" checked={current.acknowledged} onChange={event => update(before => ({ ...before, acknowledged: event.currentTarget.checked }))} />我已了解这些转换限制</label></div>}
      {current.pending.size > 0 && <p className="field-hint" role="status">请完成采样基准输入；无效数值不会被跳过。</p>}
      {!selected.length && <p className="field-hint" role="status">请选择至少一个采样声道；播放列表范围内的有效起音会在导入时再次检查。</p>}
      <div className="button-row end flp-import-actions"><button type="button" onClick={cancel}>取消</button><button type="button" className="primary" disabled={!ready(current)} onClick={importReviewed}>导入为可编辑工程</button></div>
    </div>
  </section></div>;
}
