import { useMemo } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import type { Project } from '../core/types';
import type { MeterMap } from '../core/meter';
import type { TempoMap } from '../core/time';

export function TimingEditor({ project, meter, tempo, playhead, onEdit, onSeek }: {
  project: Project; meter: MeterMap; tempo: TempoMap; playhead: number;
  onEdit: (label: string, change: (project: Project) => void) => void; onSeek: (tick: number) => void;
}) {
  const signatures = useMemo(() => { const events = new Map(project.timeSignatures.map(event => [event.tick, event])); if (!events.has(0)) events.set(0, { tick: 0, numerator: 4, denominator: 4 }); return [...events.values()].sort((a, b) => a.tick - b.tick); }, [project.timeSignatures]);
  const active = signatures.filter(event => event.tick <= playhead).at(-1) ?? signatures[0];
  const tick = Math.max(0, Math.round(playhead));
  return <div className="modal-body timing-editor">
    <p className="modal-intro">播放头 <b>{meter.format(playhead)}</b> · 在这里插入速度或拍号变化。节点不会移动已有音符。</p>
    <section className="timing-section"><div className="timing-heading"><h3>速度</h3><button disabled={tempo.events.some(event => event.tick === tick)} onClick={() => { const bpm = tempo.at(tick).bpm; onEdit('添加速度变化', p => { p.tempos.push({ tick, bpm }); p.tempos.sort((a, b) => a.tick - b.tick); }); onSeek(tick); }}><Plus size={13} /> 在播放头添加</button></div>
      <div className="timing-list">{tempo.events.map(event => <div key={event.tick} className={`timing-row ${tempo.at(playhead).tick === event.tick ? 'active' : ''}`} data-testid="tempo-event" data-tick={event.tick}>
        <button className="timing-position" title="定位到此节点" onClick={() => onSeek(event.tick)}>{meter.format(event.tick)}</button>
        <label><input aria-label={`速度 ${meter.format(event.tick)}`} type="number" min=".01" max="10000" step=".01" value={+event.bpm.toFixed(4)} onChange={e => { const bpm = Number(e.target.value); if (bpm >= .01 && bpm <= 10000) onEdit('修改速度节点', p => { p.tempos = p.tempos.filter(item => item.tick !== event.tick); p.tempos.push({ tick: event.tick, bpm }); p.tempos.sort((a, b) => a.tick - b.tick); }); }} /><span>BPM · 四分音符</span></label>
        <button aria-label={`删除速度 ${meter.format(event.tick)}`} disabled={event.tick === 0} onClick={() => onEdit('删除速度节点', p => { p.tempos = p.tempos.filter(item => item.tick !== event.tick); })}><Trash size={13} /></button>
      </div>)}</div>
    </section>
    <section className="timing-section"><div className="timing-heading"><h3>拍号</h3><button disabled={signatures.some(event => event.tick === tick)} onClick={() => { onEdit('添加拍号变化', p => { p.timeSignatures.push({ ...active, tick }); p.timeSignatures.sort((a, b) => a.tick - b.tick); }); onSeek(tick); }}><Plus size={13} /> 在播放头添加</button></div>
      <div className="timing-list">{signatures.map(event => <div key={event.tick} className={`timing-row ${active?.tick === event.tick ? 'active' : ''}`} data-testid="meter-event" data-tick={event.tick}>
        <button className="timing-position" title="定位到此节点" onClick={() => onSeek(event.tick)}>{meter.format(event.tick)}</button>
        <label className="meter-inputs"><input aria-label={`拍号分子 ${meter.format(event.tick)}`} type="number" min="1" max="255" value={event.numerator} onChange={e => { const numerator = Number(e.target.value); if (Number.isInteger(numerator) && numerator >= 1 && numerator <= 255) onEdit('修改拍号分子', p => { p.timeSignatures = p.timeSignatures.filter(item => item.tick !== event.tick); p.timeSignatures.push({ ...event, numerator }); p.timeSignatures.sort((a,b) => a.tick-b.tick); }); }} /><span>/</span>
          <select aria-label={`拍号分母 ${meter.format(event.tick)}`} value={event.denominator} onChange={e => onEdit('修改拍号分母', p => { p.timeSignatures = p.timeSignatures.filter(item => item.tick !== event.tick); p.timeSignatures.push({ ...event, denominator: Number(e.target.value) }); p.timeSignatures.sort((a,b) => a.tick-b.tick); })}>{[...new Set([1,2,4,8,16,32,64,event.denominator])].sort((a,b) => a-b).map(value => <option key={value}>{value}</option>)}</select>
        </label>
        <button aria-label={`删除拍号 ${meter.format(event.tick)}`} disabled={event.tick === 0} onClick={() => onEdit('删除拍号节点', p => { p.timeSignatures = p.timeSignatures.filter(item => item.tick !== event.tick); })}><Trash size={13} /></button>
      </div>)}</div>
      <p className="field-hint">新拍号从节点处开始新小节；若插在小节中途，前一小节会缩短。相同拍号的重复消息不会切开小节。吸附的 1/16 等选项始终表示音符时值。</p>
    </section>
  </div>;
}
