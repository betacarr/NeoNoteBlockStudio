import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DrumHit, DrumMapping, DrumPreset, Note, Pattern, Project } from '../core/types';
import { createProject, newNote, newTrack, uid } from '../core/project';
import { createMeterMap } from '../core/meter';
import { inNoteBlockRange, noteName } from '../core/instruments';
import { gmPercussionName } from '../core/gm-percussion';
import { PianoRoll, type Tool } from './PianoRoll';
import { CommitNumberInput, flushActiveNumberInput } from './CommitNumberInput';
import { CommitTextInput, flushActiveTextInput } from './CommitTextInput';
import './drum-presets.css';

export interface DrumPresetDialogProps {
  project: Project;
  trackId: string;
  onApply: (presets: DrumPreset[], presetId: string | undefined) => void;
  onClose: () => void;
  onAudition: (project: Project) => void | Promise<void>;
  onStop: () => void;
}
interface Draft { presets: DrumPreset[]; presetId?: string }
const clone = <T,>(value: T): T => structuredClone(value);
function presetError(presets: DrumPreset[]): string {
  return presets.some(preset => !preset.name.trim() || new Set(preset.mappings.map(mapping => mapping.trigger)).size !== preset.mappings.length || preset.mappings.some(mapping => !mapping.notes.length)) ? '每个预设需有名称，每个触发键需至少一个子音符，触发键不能重复。' : '';
}

/** Local transaction: only Apply changes the parent document and its history. */
export function DrumPresetDialog({ project, trackId, onApply, onClose, onAudition, onStop }: DrumPresetDialogProps) {
  const sourceTrack = project.tracks.find(track => track.id === trackId)!;
  const [draft, setDraft] = useState<Draft>(() => ({ presets: clone(project.drumPresets ?? []), presetId: sourceTrack.drumPresetId }));
  const current = useRef(draft); current.current = draft;
  const [past, setPast] = useState<Draft[]>([]), [future, setFuture] = useState<Draft[]>([]);
  const pastRef = useRef<Draft[]>([]), futureRef = useRef<Draft[]>([]);
  const [mappingId, setMappingId] = useState<string>(), [selected, setSelected] = useState(new Set<string>());
  const [tool, setTool] = useState<Tool>('draw'), [zoom, setZoom] = useState(300), [snap, setSnap] = useState(32);
  const [drawingInstrument, setDrawingInstrument] = useState(project.instruments.some(i => i.id === 'basedrum') ? 'basedrum' : sourceTrack.instrumentId);
  const [filter, setFilter] = useState('all'), [message, setMessage] = useState('');
  const [viewRequest, setViewRequest] = useState({ id: 0, mode: 'all' as const });
  const dialog = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement | null; dialog.current?.focus();
    return () => { onStop(); if (before?.isConnected) before.focus(); };
  }, []);
  const preset = draft.presets.find(item => item.id === draft.presetId);
  const mapping = preset?.mappings.find(item => item.id === mappingId) ?? preset?.mappings[0];
  const hits = mapping?.notes ?? [];
  const hit = hits.find(item => selected.has(item.id));
  const sourceKeys = useMemo(() => {
    const patternIds = new Set(project.regions.filter(region => region.trackId === trackId).map(region => region.patternId));
    return [...new Set(project.patterns.filter(pattern => patternIds.has(pattern.id)).flatMap(pattern => pattern.notes.map(note => note.midi)))].sort((a,b) => a-b);
  }, [project, trackId]);
  const missing = preset ? sourceKeys.filter(key => !preset.mappings.some(item => item.trigger === key)) : [];
  const references = project.tracks.filter(track => track.drumPresetId === preset?.id);
  function change(edit: (value: Draft) => void) {
    const before = current.current, next = clone(before); edit(next);
    pastRef.current = [...pastRef.current.slice(-99), before]; futureRef.current = [];
    setPast(pastRef.current); setFuture([]); current.current = next; setDraft(next); setMessage('');
  }
  function editMapping(edit: (value: DrumMapping) => void) {
    if (!preset || !mapping) return;
    change(next => edit(next.presets.find(p => p.id === preset.id)!.mappings.find(m => m.id === mapping.id)!));
  }
  function flushDrafts() { return flushActiveTextInput() && flushActiveNumberInput(); }
  function navigate(action: () => void) { if (flushDrafts()) { onStop(); setSelected(new Set()); action(); } }
  function undo() {
    if (!flushDrafts() || !pastRef.current.length) return;
    onStop(); const value = pastRef.current.at(-1)!;
    pastRef.current = pastRef.current.slice(0,-1); futureRef.current = [current.current,...futureRef.current];
    setPast(pastRef.current); setFuture(futureRef.current); current.current = value; setDraft(value); setSelected(new Set());
  }
  function redo() {
    if (!flushDrafts() || !futureRef.current.length) return;
    onStop(); const value = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1); pastRef.current = [...pastRef.current,current.current];
    setFuture(futureRef.current); setPast(pastRef.current); current.current = value; setDraft(value); setSelected(new Set());
  }
  function newPreset() {
    navigate(() => {
      const id = uid();
      const mappings = (sourceKeys.length ? sourceKeys : [36,38,42]).map((trigger, index) => ({ id: uid(), trigger, name: gmPercussionName(trigger) ?? '自定义映射', notes: [{ id: uid(), instrumentId: sourceKeys.length ? sourceTrack.instrumentId : ['basedrum','snare','hat'][index], midi: sourceKeys.length ? trigger : 66, offsetBeats: 0, durationBeats: .25, velocity: 1 }] }));
      change(next => { next.presets.push({ id, name: '新鼓组预设', mappings }); next.presetId = id; }); setMappingId(mappings[0]?.id);
    });
  }
  function duplicate() {
    if (!preset) return;
    navigate(() => {
      const copy = clone(preset); copy.id = uid(); copy.name += ' · 独立副本';
      copy.mappings.forEach(mapping => { mapping.id = uid(); mapping.notes.forEach(note => { note.id = uid(); }); });
      change(next => { next.presets.push(copy); next.presetId = copy.id; }); setMappingId(copy.mappings[0]?.id);
    });
  }
  function addMapping() {
    if (!preset) return;
    const trigger = Array.from({ length: 128 }, (_,key) => key).find(key => key >= 36 && !preset.mappings.some(mapping => mapping.trigger === key)) ?? Array.from({length:128},(_,key)=>key).find(key => !preset.mappings.some(mapping => mapping.trigger === key));
    if (trigger === undefined) return;
    const id = uid(); change(next => next.presets.find(p => p.id === preset.id)!.mappings.push({ id, trigger, name: gmPercussionName(trigger) ?? '自定义映射', notes: [] })); setMappingId(id); setSelected(new Set());
  }
  function updateHit(patch: Partial<DrumHit>) { if (hit) editMapping(value => { Object.assign(value.notes.find(note => note.id === hit.id)!, patch); }); }
  async function audition(notes = hits) {
    if (!flushDrafts() || !notes.length) return;
    const preview = createProject('鼓组映射试听'); preview.ppq = project.ppq; preview.tempos = clone(project.tempos.slice(0,1)); preview.tempos[0].tick = 0;
    preview.instruments = clone(project.instruments); preview.assets = clone(project.assets); preview.audio = clone(project.audio);
    const track = newTrack('映射试听',0,drawingInstrument); preview.tracks = [track];
    const pattern: Pattern = { id: uid(), name: '实际子音符', length: Math.max(project.ppq, ...notes.map(note => (note.offsetBeats + note.durationBeats) * project.ppq)), notes: notes.map(note => ({ ...newNote(note.offsetBeats * project.ppq,note.midi,note.durationBeats * project.ppq), instrumentId: note.instrumentId, velocity: note.velocity })) };
    preview.patterns = [pattern]; preview.regions = [{ id: uid(), trackId: track.id, patternId: pattern.id, start: 0, offset: 0, length: pattern.length, loop: false }];
    try { await onAudition(preview); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  const rollNotes: Note[] = useMemo(() => hits.filter(note => filter === 'all' || note.instrumentId === filter).map(note => ({ ...newNote(note.offsetBeats * project.ppq,note.midi,note.durationBeats * project.ppq), id: note.id, instrumentId: note.instrumentId, velocity: note.velocity })), [hits, filter, project.ppq]);
  const rollPattern: Pattern = { id: mapping?.id ?? 'empty-mapping', name: '实际子音符', length: Math.max(project.ppq, ...hits.map(note => (note.offsetBeats + note.durationBeats) * project.ppq)), notes: rollNotes };
  const rollTrack = { ...sourceTrack, id: 'drum-editor-track', instrumentId: drawingInstrument, locked: false, color: '#83baa9' };
  const meter = useMemo(() => createMeterMap({ ...project, timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] }), [project]);
  const error = presetError(draft.presets);
  const context = `${preset?.id}/${mapping?.id}/${hit?.id}`;
  return <div className="drum-preset-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMessage('请使用取消或应用修改关闭编辑器。'); }}>
    <section className="drum-preset-dialog" role="dialog" aria-modal="true" aria-label="鼓组映射预设" tabIndex={-1} ref={dialog} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
      if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(new Set(rollNotes.map(note => note.id))); }
      if (!typing && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); editMapping(mapping => { mapping.notes = mapping.notes.filter(note => !selected.has(note.id)); }); setSelected(new Set()); }
      if (event.key === 'Tab') {
        const fields = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),canvas[tabindex], [tabindex="0"]')].filter(element => element.getClientRects().length);
        if (fields.length && event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields[fields.length-1].focus(); }
        else if (fields.length && !event.shiftKey && document.activeElement === fields[fields.length-1]) { event.preventDefault(); fields[0].focus(); }
      }
    }}>
      <header><div><h2>鼓组映射</h2><p>{sourceTrack.name} · 一个编曲触发音符，可播放多个实际音符</p></div><button onClick={onClose} aria-label="关闭鼓组映射">×</button></header>
      <div className="drum-preset-layout">
        <nav className="drum-preset-nav" aria-label="鼓组预设与触发键">
          <h3>工程内预设</h3>
          <button className={!draft.presetId ? 'active' : ''} onClick={() => navigate(() => change(next => { next.presetId = undefined; }))}>关闭映射 · 普通轨道</button>
          {draft.presets.map(item => <button key={item.id} className={item.id === draft.presetId ? 'active' : ''} onClick={() => navigate(() => change(next => { next.presetId = item.id; }))}><strong>{item.name}</strong><small>{item.mappings.length} 个触发键 · {project.tracks.filter(track => track.drumPresetId === item.id).length} 轨引用</small></button>)}
          <div className="drum-actions"><button onClick={newPreset}>新建预设</button><button disabled={!preset} onClick={duplicate}>复制为独立预设</button></div>
          {preset && <><label className="drum-name">预设名称<CommitTextInput aria-label="鼓组预设名称" contextKey={`${project.id}/${trackId}/${preset.id}/name`} value={preset.name} onCommit={name => change(next => { next.presets.find(p=>p.id===preset.id)!.name=name; })} /></label>
            <button className="drum-delete" disabled={references.some(track => track.id !== trackId)} onClick={() => navigate(() => change(next => { next.presets = next.presets.filter(p=>p.id!==preset.id); next.presetId = undefined; }))}>删除预设</button>
            <h3>触发键</h3><div className="drum-trigger-list">{preset.mappings.map(item => <button key={item.id} className={item.id === mapping?.id ? 'active' : ''} onClick={() => navigate(() => setMappingId(item.id))}><strong title={item.name}>{item.name?.trim() || '未命名映射'} <small>{noteName(item.trigger)} · MIDI {item.trigger}</small></strong><small>{item.notes.length} 个子音符</small></button>)}</div><button onClick={addMapping}>＋ 添加触发键</button></>}
          <p className="drum-sharing">{preset ? references.length > 1 ? `共享预设：应用修改后同时影响 ${references.map(track=>track.name).join('、')}。需要独立编辑请先复制。` : '预设内嵌工程。其他轨道选择同一预设后，共享修改。' : '选择或新建一个预设，将映射分配给当前轨道。'}</p>
        </nav>
        <main className="drum-preset-main">
          {mapping ? <><div className="drum-editor-heading"><h3>{noteName(mapping.trigger)} → 实际子音符</h3><div className="drum-actions"><button onClick={() => audition()} disabled={!hits.length}>试听触发</button><button onClick={onStop}>停止</button></div></div>
            <div className="drum-editor-tools"><label className="drum-mapping-name">映射名称<CommitTextInput aria-label="映射名称" contextKey={`${project.id}/${trackId}/${preset!.id}/${mapping.id}/name`} maxLength={200} value={mapping.name ?? ''} placeholder="未命名映射" onCommit={name=>editMapping(value=>{value.name=name;})} /></label><label>触发 MIDI<CommitNumberInput value={mapping.trigger} min={0} max={127} integer contextKey={context} aria-label="触发键 MIDI" onCommit={trigger => { if (preset!.mappings.some(m=>m.id!==mapping.id && m.trigger===trigger)) { setMessage('该触发键已存在。'); return false; } editMapping(m=>{m.trigger=trigger;}); }} /></label>
              <label>绘制乐器<select aria-label="子音符绘制乐器" value={drawingInstrument} onChange={event=>setDrawingInstrument(event.target.value)}>{project.instruments.map(instrument=><option key={instrument.id} value={instrument.id}>{instrument.name}</option>)}</select></label>
              <label>显示<select aria-label="子音符显示乐器" value={filter} onChange={event=>{setFilter(event.target.value);if(event.target.value!=='all')setDrawingInstrument(event.target.value);setSelected(new Set());}}><option value="all">全部乐器</option>{project.instruments.map(instrument=><option key={instrument.id} value={instrument.id}>{instrument.name}</option>)}</select></label>
              <label>工具<select aria-label="子音符编辑工具" value={tool} onChange={event=>setTool(event.target.value as Tool)}><option value="draw">绘制</option><option value="select">选择</option><option value="erase">擦除</option></select></label>
              <label>吸附<select aria-label="子音符吸附" value={snap} onChange={event=>setSnap(+event.target.value)}><option value={0}>自由</option>{[4,8,16,32,64,128].map(value=><option key={value} value={value}>1/{value}</option>)}</select></label>
              <button onClick={()=>{ const id=uid(); editMapping(value=>{value.notes.push({id,instrumentId:drawingInstrument,midi:66,offsetBeats:0,durationBeats:.25,velocity:1});}); setFilter('all'); setSelected(new Set([id])); }}>＋ 子音符</button><button onClick={()=>setViewRequest(value=>({id:value.id+1,mode:'all'}))}>全部音符</button><button disabled={!past.length} onClick={undo}>撤销</button><button disabled={!future.length} onClick={redo}>重做</button>
            </div>
            <div className="drum-roll" data-testid="drum-mapping-piano"><PianoRoll instruments={project.instruments} pattern={rollPattern} track={rollTrack} ppq={project.ppq} selected={selected} tool={tool} snap={snap} noteLength={16} zoom={zoom} playhead={0} meter={meter} origin={0} preset="fl" viewKey={`${preset!.id}/${mapping.id}/${filter}`} viewRequest={viewRequest} onZoom={setZoom} onSelect={setSelected} onEdit={(_label, edit)=>editMapping(value=>{ const visible = new Set(rollNotes.map(note=>note.id)); const edited = edit(rollNotes); value.notes = [...value.notes.filter(note=>!visible.has(note.id)),...edited.map(note=>({id:note.id,instrumentId:note.instrumentId ?? drawingInstrument,midi:note.midi,offsetBeats:note.tick/project.ppq,durationBeats:note.duration/project.ppq,velocity:note.velocity}))]; })} onAudition={(midi,note)=>audition([{id:uid(),instrumentId:note?.instrumentId??drawingInstrument,midi,offsetBeats:0,durationBeats:.25,velocity:note?.velocity??1}])} onFocus={()=>{}} onSeek={()=>{}} onTrimRegion={()=>{}} /></div>
            <div className="drum-hit-properties"><strong>所选子音符</strong>{hit ? <><label>乐器<select aria-label="子音符乐器" value={hit.instrumentId} onChange={event=>updateHit({instrumentId:event.target.value})}>{project.instruments.map(instrument=><option key={instrument.id} value={instrument.id}>{instrument.name}</option>)}</select></label><label>音高<CommitNumberInput value={hit.midi} min={0} max={127} integer contextKey={context} aria-label="子音符实际 MIDI" onCommit={midi=>updateHit({midi})} /></label><span>{noteName(hit.midi)}</span><label>延迟 / 拍<CommitNumberInput value={hit.offsetBeats} min={0} max={256} step={.001} contextKey={context} aria-label="子音符延迟拍数" onCommit={offsetBeats=>updateHit({offsetBeats})} /></label><label>时值 / 拍<CommitNumberInput value={hit.durationBeats} min={1/32768} max={256} step={.001} contextKey={context} aria-label="子音符时值拍数" onCommit={durationBeats=>updateHit({durationBeats})} /></label><label>力度 ×<CommitNumberInput value={hit.velocity} min={0} max={1} step={.01} contextKey={context} aria-label="子音符力度倍率" onCommit={velocity=>updateHit({velocity})} /></label><button onClick={()=>audition([hit])}>试听单音</button></> : <span>在卷帘中选择音符以编辑属性</span>}<button disabled={!selected.size} onClick={()=>{editMapping(m=>{m.notes=m.notes.filter(note=>!selected.has(note.id));});setSelected(new Set());}}>删除所选</button></div>
            <div className="drum-editor-help"><span>点击空白绘制 · 拖动调整音高与时间 · 右边缘调整时值 · 下方力度条编辑倍率</span><span>{hits.length} 个子音符 / 1 个触发事件</span></div>
            <div className="drum-overlap-list" aria-label="子音符明细">{hits.map(note=><button key={note.id} className={selected.has(note.id)?'active':''} onClick={()=>setSelected(new Set([note.id]))}>{project.instruments.find(instrument=>instrument.id===note.instrumentId)?.name ?? '缺失乐器'} · {noteName(note.midi)} · +{note.offsetBeats} 拍 · ×{note.velocity}</button>)}</div>
            <button className="drum-delete-trigger" onClick={()=>navigate(()=>change(next=>{next.presets.find(p=>p.id===preset!.id)!.mappings=next.presets.find(p=>p.id===preset!.id)!.mappings.filter(m=>m.id!==mapping.id);} ))}>删除此触发键</button>
          </> : <div className="drum-empty"><h3>{preset ? '添加一个触发键' : '选择工程内预设'}</h3><p>主编曲仍使用钢琴卷帘。这里编辑每个触发键实际播放的乐器、音高、相对延迟和力度。</p><button onClick={preset ? addMapping : newPreset}>{preset ? '添加触发键' : '创建预设'}</button></div>}
        </main>
      </div>
      <div className="drum-feedback" aria-live="polite">{message || error || (missing.length ? `当前轨道有未映射触发键：${missing.map(noteName).join('、')}。请补全映射后播放。` : hits.some(note=>!inNoteBlockRange(note.midi,project.instruments.find(instrument=>instrument.id===note.instrumentId)?.rootMidi)) ? '部分实际音高超出原版音符盒音域；导出时请检查转换提示。' : '延迟使用拍单位保存，不受工程 PPQ 变化影响。MIDI / NBS / 音频导出使用实际子音符。')}</div>
      <footer><span>取消会丢弃本窗口修改；应用后可在主工程撤销。</span><div className="drum-actions"><button onClick={onClose}>取消</button><button className="primary" disabled={!!error} onClick={()=>{if(flushDrafts()) {const issue=presetError(current.current.presets);if(issue){setMessage(issue);return;}onStop();try {onApply(current.current.presets,current.current.presetId);} catch (error) {setMessage(error instanceof Error ? error.message : String(error));}}}}>应用修改</button></div></footer>
    </section>
  </div>;
}
