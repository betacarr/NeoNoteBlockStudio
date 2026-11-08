import { useEffect, useRef, useState } from 'react';
import type { Asset, Project } from '../core/types';
import { mergeChordMarkers, moveChordBoundary, setWorkspaceTempo, stemOutputRoles, validateAudioWorkspace, type AudioAssistProgress, type AudioAssistStatus, type AudioWorkspace, type AudioModelStatus } from '../core/audio-assist';
import { StemPlayer } from '../audio/stem-player';
import { base64ToBytes } from '../core/container';
import { CommitNumberInput, flushActiveNumberInput } from './CommitNumberInput';
import { requestedStemSelection, STEM_SPLITTER_PRESETS, type StemSplitterPreset, type StemSplitterSettings } from '../core/stem-splitter-presets';
import { StemSplitterOptions } from './StemSplitterOptions';
import './audio-assist.css';

export interface AudioAssistDialogProps {
  project: Project;
  mode?: 'split' | 'chords';
  selectedSource?: {assetId:string;name:string;offsetSeconds:number;durationSeconds:number;analysis?:AudioWorkspace;mode:'split'|'chords'};
  splitSelection?: StemSplitterSettings;
  directPreset?: StemSplitterPreset;
  onApply: (workspace: AudioWorkspace, assets: Asset[], applyTempo: boolean, selection?: StemSplitterSettings) => void;
  onClose: () => void;
}
export function AudioModelDownloadCard({ model, pending, onConfirm, onCancel, onRefresh, onDismiss }: { model: AudioModelStatus; pending: boolean; onConfirm: () => void; onCancel: () => void; onRefresh: () => void; onDismiss: () => void }) {
  const downloading = pending || model.state === 'downloading';
  return <section className="aa-model-card" aria-label="六轨模型下载"><div><h3>{model.name}</h3><button aria-label="收起模型下载提示" disabled={downloading} onClick={onDismiss}>×</button></div><p>首次使用需要下载约 {(model.sizeBytes / 1e9).toFixed(2)} GB · {model.license} 许可。下载到本机模型缓存后可离线复用，权重不随应用打包，音频不会上传。</p><p className="aa-model-source">官方来源：<a href={model.sourceUrl} target="_blank" rel="noopener noreferrer">{model.sourceUrl}</a></p><p className="aa-model-source">作者许可说明：<a href={model.licenseUrl} target="_blank" rel="noopener noreferrer">{model.licenseUrl}</a></p><p>候选方案为五类预测＋“其他（残余）”，尚未验证能否满足六声部；不是原生六轨。</p><p className={model.state === 'blocked' || model.state === 'error' ? 'aa-warning' : ''} role="status">{model.message}</p>{downloading && <progress aria-label="模型下载进度" max={1} value={Math.max(0,Math.min(1,model.progress))}/>}<div className="aa-model-actions">{model.state === 'ready' ? <span>资源已校验，可离线复用；声部效果需试听确认</span> : downloading ? <button onClick={onCancel}>取消模型下载</button> : <button className="primary" disabled={model.state === 'blocked'} onClick={onConfirm}>{model.state === 'error' ? '重试下载模型' : '确认下载模型'}</button>}<button disabled={downloading} onClick={onRefresh}>刷新模型状态</button></div></section>;
}
const copy = <T,>(value: T): T => structuredClone(value);
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export const AUDIO_ASSIST_MAX_INPUT = 64 * 1024 * 1024;
export function audioAssistBeatPreview(beats: number[]) {
  const count = Math.min(300, beats.length);
  return Array.from({ length: count }, (_, n) => {
    const i = count < 2 ? 0 : Math.round(n * (beats.length - 1) / (count - 1));
    return { i, beat: beats[i] };
  });
}
export function stepAudioAssistHistory(current: AudioWorkspace, past: AudioWorkspace[], future: AudioWorkspace[], redo: boolean) {
  if (redo) return future.length ? { current: future[0], past: [...past, current], future: future.slice(1) } : undefined;
  return past.length ? { current: past[past.length - 1], past: past.slice(0, -1), future: [current, ...future] } : undefined;
}

/** Trap only Tab's wrap points; native order remains intact inside the dialog. */
export function cycleAudioAssistFocus(section: HTMLElement, backwards: boolean): boolean {
  const elements = Array.from(section.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'))
    .filter(element => !element.closest('[hidden],[inert]') && element.getClientRects().length > 0);
  const first = elements[0], last = elements[elements.length - 1], active = section.ownerDocument.activeElement;
  if (!first) { section.focus(); return true; }
  if (!section.contains(active) || active === section || backwards && active === first || !backwards && active === last) {
    (backwards ? last : first).focus(); return true;
  }
  return false;
}

function ChordName({ value, label, onCommit }: { value: string; label: string; onCommit: (name: string) => void }) {
  const [text, setText] = useState(value);
  const owner = useRef(value);
  // Adopt history changes during render, as CommitNumberInput does. An effect
  // would leave one stale DOM frame after undo and could overwrite fresh typing.
  if (owner.current !== value) { owner.current = value; setText(value); }
  const commit = () => { const name = text.trim(); if (name && name !== value) onCommit(name); else setText(value); };
  return <input aria-label={label} value={text} maxLength={128} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { e.stopPropagation(); setText(value); } }}/>;
}

/** One local transaction. Analysis and preview never write the parent project. */
export function AudioAssistDialog({ project, onApply, onClose, selectedSource, splitSelection, directPreset, mode = 'chords' }: AudioAssistDialogProps) {
  const taskMode = selectedSource?.mode ?? mode, isSplit = taskMode === 'split';
  const title = isSplit ? '大分轨拆分器' : selectedSource ? '分析和弦' : '和弦与速度分析';
  const direct = isSplit && selectedSource && directPreset ? STEM_SPLITTER_PRESETS[directPreset] : undefined;
  const [settings, setSettings] = useState(direct?.settings ?? splitSelection ?? STEM_SPLITTER_PRESETS.all.settings);
  const selection = requestedStemSelection(settings);
  const [workspace, setWorkspace] = useState<AudioWorkspace | undefined>(() => selectedSource?.mode==='chords' && selectedSource.analysis && selectedSource.analysis.analysisPerformed !== false ? copy(selectedSource.analysis) : !isSplit && !selectedSource && project.audioWorkspace && project.audioWorkspace.analysisPerformed !== false ? copy(project.audioWorkspace) : undefined);
  const [assets, setAssets] = useState<Asset[]>(project.assets);
  const [status, setStatus] = useState<AudioAssistStatus>();
  const [model, setModel] = useState<AudioModelStatus>(), [showModel, setShowModel] = useState(false), [modelPending, setModelPending] = useState(false);
  const [showSplitHelp, setShowSplitHelp] = useState(false);
  const [progress, setProgress] = useState<AudioAssistProgress>();
  const [busy, setBusy] = useState(false), [selecting, setSelecting] = useState(false), [decoding, setDecoding] = useState(false), [ready, setReady] = useState(false);
  const [message, setMessage] = useState(''), [applyTempo, setApplyTempo] = useState(false);
  const [acceleration,setAcceleration] = useState<'cpu'|'cuda'|'mps'>('cpu');
  const [cpuThreads,setCpuThreads] = useState(0), [memoryProfile,setMemoryProfile] = useState<'balanced'|'low'>('balanced');
  const [elapsedSeconds,setElapsedSeconds] = useState(0);
  const [position, setPosition] = useState(0), [playing, setPlaying] = useState(false);
  const [past, setPast] = useState<AudioWorkspace[]>([]), [future, setFuture] = useState<AudioWorkspace[]>([]);
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});
  const [selectedBeat, setSelectedBeat] = useState(0);
  const [reloadAudio, setReloadAudio] = useState(0), [relinkAssetId, setRelinkAssetId] = useState(''), [relinking, setRelinking] = useState(false);
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLElement>(null);
  const player = useRef<StemPlayer | undefined>(undefined), latest = useRef(workspace); latest.current = workspace;
  const job = useRef<string | undefined>(undefined), generation = useRef(0), alive = useRef(true), currentAssets = useRef(assets); currentAssets.current = assets;
  const cancelled = useRef(false);
  const downloadingModel = useRef<string | undefined>(undefined);
  const presetStarted = useRef(false);
  const canStartSplit = !!status?.available && !!status.canSeparate && !modelPending
    && (!selection.drumPieces || !!status.canSplitDrums) && stemOutputRoles(selection).length > 0;
  useEffect(()=>{
    if(!busy)return;
    const started=Date.now();setElapsedSeconds(0);
    const timer=window.setInterval(()=>setElapsedSeconds(Math.floor((Date.now()-started)/1000)),1000);
    return ()=>window.clearInterval(timer);
  },[busy]);
  function change(edit: (value: AudioWorkspace) => AudioWorkspace) {
    const before = latest.current; if (!before) return;
    try {
      const next = edit(copy(before)); validateAudioWorkspace(next, currentAssets.current);
      setPast(items => [...items.slice(-49), before]); setFuture([]); latest.current = next; setWorkspace(next); setMessage('');
    } catch (error) { setMessage(errorText(error)); }
  }
  function history(redo: boolean) {
    if (!flushActiveNumberInput() || !latest.current) return;
    // Capture the complete transition now. Deferred React state updaters must
    // never read latest.current after it has already moved to the undo target.
    const next = stepAudioAssistHistory(latest.current, past, future, redo); if (!next) return;
    setPast(next.past); setFuture(next.future); latest.current = next.current; setWorkspace(next.current);
  }
  function undo() { history(false); }
  function redo() { history(true); }
  function stop() { player.current?.stop(); setPlaying(false); }
  function close() { generation.current++; const id = job.current; job.current = undefined; if (id) void window.desktop?.cancelAudioAssist?.(id); const modelId = downloadingModel.current; downloadingModel.current = undefined; if (modelId) void window.desktop?.cancelAudioModel?.(modelId); stop(); onClose(); }
  async function refreshModel() {
    try {
      if (!window.desktop?.audioModelStatus) { setMessage('模型管理需要更新后的桌面开发版。'); return; }
      const next = await window.desktop.audioModelStatus(); if (!alive.current) return; setModel(next);
      const backend = await window.desktop.audioAssistStatus?.(); if (alive.current && backend) setStatus(backend);
    } catch (error) { if (alive.current) setMessage(errorText(error)); }
  }
  async function downloadModel() {
    if (!model || modelPending || model.state === 'blocked' || !window.desktop?.downloadAudioModel) return;
    // This is the only download call site: explicit confirmation, never mount,
    // status refresh, checkbox selection, or analysis import.
    setModelPending(true); downloadingModel.current = model.id;
    try {
      const next = await window.desktop.downloadAudioModel({ id: model.id, confirmed: true }); if (!alive.current) return;
      setModel(next); setMessage(next.message);
      const backend = await window.desktop.audioAssistStatus?.(); if (alive.current && backend) { setStatus(backend);  }
    } catch (error) { if (alive.current) { const message = errorText(error); setModel(value => value ? { ...value,state:'error',message } : value); setMessage(message); } }
    finally { downloadingModel.current = undefined; if (alive.current) setModelPending(false); }
  }
  async function cancelModelDownload() {
    const id = downloadingModel.current; if (!id) return;
    try { await window.desktop?.cancelAudioModel?.(id); if (alive.current) { setMessage('已取消模型下载。'); } }
    catch (error) { if (alive.current) setMessage(errorText(error)); }
  }
  useEffect(() => {
    alive.current = true; const before = document.activeElement as HTMLElement | null; dialog.current?.focus();
    void window.desktop?.audioAssistStatus?.(taskMode).then(value => { if (alive.current) { setStatus(value);  } }).catch(error => { if (alive.current) setMessage(errorText(error)); });
    if (isSplit) void window.desktop?.audioModelStatus?.().then(value => { if (alive.current) setModel(value); }).catch(error => { if (alive.current) setMessage(errorText(error)); });
    const unsubscribe = window.desktop?.onAudioAssistProgress?.(event => {
      if (!alive.current) return;
      if (event.id === job.current) setProgress(event);
      if (event.id === downloadingModel.current && event.phase === 'model-download') setModel(value => value ? { ...value,state:'downloading',progress:event.progress,message:event.message } : value);
    });
    return () => { alive.current = false; generation.current++; unsubscribe?.(); const id = job.current; if (id) void window.desktop?.cancelAudioAssist?.(id); const modelId = downloadingModel.current; if (modelId) void window.desktop?.cancelAudioModel?.(modelId); player.current?.dispose(); if (before?.isConnected) before.focus(); };
  }, []);
  // Re-decode only on source/session replacement, never on a mixer or marker edit.
  useEffect(() => {
    setReady(false); setPeaks({}); setPosition(0); setPlaying(false); setSelectedBeat(0);
    if (!workspace) return;
    let canceled = false; const engine = new StemPlayer(); player.current = engine; setDecoding(true);
    void engine.load(workspace, assets).then(() => {
      if (canceled) return;
      engine.update(latest.current!); setReady(true);
      setPeaks(Object.fromEntries(workspace.stems.map(stem => [stem.id, engine.peaks(stem.id, 360)])));
    }).catch(error => { if (!canceled) setMessage(errorText(error)); }).finally(() => { if (!canceled) setDecoding(false); });
    return () => { canceled = true; engine.dispose(); if (player.current === engine) player.current = undefined; };
  }, [workspace?.id, reloadAudio]);
  useEffect(() => { if (workspace) player.current?.update(workspace); }, [workspace]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => { const engine = player.current; if (!engine) return; setPosition(engine.currentTime); if (!engine.playing) setPlaying(false); }, 45);
    return () => window.clearInterval(timer);
  }, [playing]);
  async function loadAudio(file?: { name: string; bytes?: Uint8Array; sourceAsset?: import('../core/types').AudioFileAsset }) {
    if (busy || selecting) return;
    cancelled.current = false;
    try {
      const selectionGeneration = generation.current;
      setSelecting(!file);
      const source: { name: string; bytes?: Uint8Array; handle?: string; sourceAsset?: import('../core/types').AudioFileAsset } | null | undefined = file ?? (window.desktop?.chooseAudioAssistInput
        ? await window.desktop.chooseAudioAssistInput() : await window.desktop?.openFile('reference'));
      if (!source || !alive.current || selectionGeneration !== generation.current) return;
      if (!window.desktop?.startAudioAssist) throw new Error('音频分析需要桌面本地后台，请使用 NeoNBS 桌面开发版。');
      if (source.bytes && source.bytes.byteLength > AUDIO_ASSIST_MAX_INPUT) throw new Error('浏览器或旧版字节导入通道仅支持 64 MB；请在最新版桌面入口直接选择完整音频文件。');
      stop(); setMessage(''); setBusy(true); const ticket = ++generation.current;
      const id = crypto.randomUUID(); job.current = id; setProgress({ id, phase: 'prepare', progress: 0, message: '准备本地分析…' });
      const result = await window.desktop.startAudioAssist({
        id, name: source.name, ...(source.sourceAsset ? { sourceAsset: source.sourceAsset } : source.handle ? { sourceHandle: source.handle } : { bytes: source.bytes }),
        sourceRange: selectedSource ? { offsetSeconds: selectedSource.offsetSeconds, durationSeconds: selectedSource.durationSeconds } : undefined,
        mode: taskMode, stemSelection: isSplit ? selection : undefined, acceleration, cpuThreads, memoryProfile,
      });
      if (!alive.current || ticket !== generation.current) return;
      validateAudioWorkspace(result.workspace, result.assets);
      if (isSplit) {
        const expected = stemOutputRoles(selection);
        if (result.workspace.analysisPerformed !== false || result.workspace.stems.length !== expected.length
          || expected.some(role => !result.workspace.stems.some(stem => stem.role === role))) throw new Error('分轨结果与所选声部不匹配。');
        onApply(result.workspace, result.assets, false, settings);
        return;
      }
      currentAssets.current = result.assets; setAssets(result.assets);
      setPast([]); setFuture([]); latest.current = result.workspace; setWorkspace(result.workspace); setApplyTempo(false); setMessage('分析完成。可校正和弦标记后应用。');
    } catch (error) { if (alive.current && !cancelled.current) setMessage(errorText(error)); }
    finally { if (alive.current) { setSelecting(false); setBusy(false); job.current = undefined; setProgress(undefined); } }
  }
  async function relink() {
    const candidates = currentAssets.current.filter(asset => asset.audioFile);
    const asset = candidates.find(item => item.id === relinkAssetId) ?? candidates[0]; if (!asset?.audioFile || !window.desktop?.relinkAudioAsset) return;
    const ticket = generation.current; setRelinking(true);
    try {
      const matched = await window.desktop.relinkAudioAsset(asset.audioFile);
      if (!alive.current || ticket !== generation.current) return;
      if (matched) { stop(); setMessage('已核对完整校验值并重新定位音频，正在重新加载试听。'); setReloadAudio(value => value + 1); }
    } catch (error) { if (alive.current && ticket === generation.current) setMessage(errorText(error)); }
    finally { if (alive.current) setRelinking(false); }
  }
  async function cancel() {
    const id = job.current;
    if (!id) return;
    cancelled.current = true;
    generation.current++;
    setMessage(isSplit ? '已取消分轨。' : '已取消分析。');
    try { await window.desktop?.cancelAudioAssist?.(id); }
    catch (error) { if (alive.current && job.current === id) setMessage(errorText(error)); }
  }
  function start() {
    if (selectedSource) {
      const source = project.assets.find(asset => asset.id === selectedSource.assetId);
      if (source?.audioFile) void loadAudio({ name: selectedSource.name, sourceAsset: source.audioFile });
      else if (source?.data) void loadAudio({ name: selectedSource.name, bytes: base64ToBytes(source.data) });
      else setMessage('素材缺失，请先重新定位。');
    } else if (window.desktop) void loadAudio();
    else input.current?.click();
  }
  useEffect(() => {
    if (!direct || !canStartSplit || presetStarted.current) return;
    presetStarted.current = true;
    start();
  }, [direct, canStartSplit]);
  async function togglePlay() {
    if (!ready || !workspace) return;
    if (playing) { setPosition(player.current!.currentTime); stop(); return; }
    try { await player.current!.play(position >= workspace.duration ? 0 : position); setPlaying(true); } catch (error) { setMessage(errorText(error)); }
  }
  async function seek(value: number) { const wasPlaying = player.current?.playing; player.current?.stop(); setPosition(value); if (wasPlaying) { try { await player.current!.play(value); setPlaying(true); } catch (error) { setPlaying(false); setMessage(errorText(error)); } } }
  async function exportWav(stemId?: string) {
    try {
      const bytes = await player.current!.exportWav(stemId); if (!alive.current) return;
      const name = `${workspace!.name.replace(/[<>:"/\\|?*]/g, '_')}-${workspace!.stems.find(s => s.id === stemId)?.name ?? '试听混音'}.wav`;
      if (window.desktop) { const path = await window.desktop.saveFile(name, bytes); if (path) setMessage(`已导出 ${name}（完整时间轴，32 位浮点 WAV）。`); }
      else { const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (error) { setMessage(errorText(error)); }
  }
  function apply() {
    if (!flushActiveNumberInput() || !latest.current) return;
    try { validateAudioWorkspace(latest.current, currentAssets.current); stop(); onApply(copy(latest.current), currentAssets.current, !selectedSource && applyTempo); }
    catch (error) { setMessage(errorText(error)); }
  }
  const w = workspace, max = w?.duration ?? 1;
  const externalAssets = assets.filter(asset => asset.audioFile && w && (asset.id === w.sourceAssetId || w.stems.some(stem => stem.assetId === asset.id)));
  const beatIndex = Math.min(selectedBeat, Math.max(0, (w?.beats.length ?? 1) - 1));
  const compactSplit = isSplit && !direct;
  const needsModel = !!status?.available && !status.canSeparate;
  const modelResources = () => { setShowModel(true); void refreshModel(); };
  return <div className={`audio-assist-backdrop${compactSplit ? ' aa-split-backdrop' : ''}`}><section className={`audio-assist-dialog ${isSplit ? 'aa-split-dialog' : 'aa-chord-dialog'}${compactSplit ? ' aa-split-setup' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={dialog} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Tab' && cycleAudioAssistFocus(event.currentTarget, event.shiftKey)) event.preventDefault();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
  }}>
    <header><div><h2>{title}</h2>{!compactSplit && <p>{direct ? direct.label : selectedSource ? '识别并校正当前音频片段的和弦。' : '分析和校正参考音频的和弦、固定曲速与拍点。'}</p>}</div>{!compactSplit && <button aria-label="关闭音频辅助" onClick={close}>×</button>}</header>
    {selectedSource && !compactSplit && <div className="audio-source-target">源片段：<strong>{selectedSource.name}</strong><small>处理可见范围 {selectedSource.durationSeconds.toFixed(2)} 秒</small></div>}
    {isSplit && !direct && <StemSplitterOptions settings={settings} disabled={busy || selecting} canSplitDrums={!!status?.canSplitDrums} onChange={setSettings}/>}
    <input hidden ref={input} type="file" accept="audio/*" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void file.arrayBuffer().then(bytes => loadAudio({ name: file.name, bytes: new Uint8Array(bytes) })); }}/>
    {compactSplit && <div className="aa-split-help" id="stem-splitter-help" hidden={!showSplitHelp && !needsModel}>
      <p hidden={!showSplitHelp}>{selectedSource ? <><strong>{selectedSource.name}</strong> · 处理可见范围 {selectedSource.durationSeconds.toFixed(2)} 秒。</> : '点按「应用」后选择音频文件。'} 完成后创建分轨组，并静音原音频片段。</p>
      <button disabled={busy || selecting} onClick={modelResources}>模型资源…</button>
    </div>}
    {!isSplit && <div className="aa-command">
        <button className="primary" disabled={busy || selecting} onClick={start}>{selecting ? '正在选择文件…' : selectedSource ? w ? '重新分析' : '开始分析' : '选择音频并分析…'}</button>
        <span>{w?.name ?? (selectedSource?.name || '尚未选择音频')}</span>
        <button disabled={!past.length || busy} onClick={undo}>撤销</button><button disabled={!future.length || busy} onClick={redo}>重做</button>
    </div>}
    {!direct && <details className="aa-compute" hidden={compactSplit && !showSplitHelp}><summary>计算设置 · 默认使用 CPU</summary><div><label>CPU 线程<select aria-label="CPU 线程数" value={cpuThreads} disabled={busy} onChange={e=>setCpuThreads(Number(e.target.value))}><option value={0}>自动（最多 8）</option>{[1,2,4,8,16].map(count=><option key={count} value={count}>{count}</option>)}</select></label><label>内存模式<select aria-label="CPU 内存模式" value={memoryProfile} disabled={busy} onChange={e=>setMemoryProfile(e.target.value as 'balanced'|'low')}><option value="balanced">均衡</option><option value="low">低内存（可能较慢）</option></select></label>{isSplit && <><label title={(status?.optionalCudaAvailable || status?.optionalMpsAvailable)?'GPU 失败时明确转回 CPU':'可选 GPU 环境未安装；CPU 功能完整可用'}><input type="checkbox" aria-label="尝试 GPU 加速" checked={acceleration!=='cpu'} disabled={busy || !(status?.optionalCudaAvailable || status?.optionalMpsAvailable)} onChange={e=>setAcceleration(e.target.checked?(status?.optionalMpsAvailable?'mps':'cuda'):'cpu')}/>{status?.optionalMpsAvailable?'尝试 Apple MPS 加速':'尝试 GPU 加速'}（实验，可选）</label><span>GPU 为实验选项，真实音乐与 CPU 的数值一致性仍待完善。缺包或显存不足时使用 CPU，不会自动下载 GPU 运行包。</span></>}</div></details>}
    {busy && <div className="aa-progress" role="status"><progress max={1} value={Math.max(0, Math.min(1, progress?.progress ?? 0))}/><span>{progress?.message ?? (isSplit ? '分轨中…' : '分析中…')} · 总用时 {Math.floor(elapsedSeconds/60)}:{String(elapsedSeconds%60).padStart(2,'0')}</span><button onClick={() => void cancel()}>{isSplit ? '取消分轨' : '取消分析'}</button></div>}
    {w?.model.device && <p className="aa-compute-result" role="status">本次计算：{w.model.device==='cuda'?'CUDA（FP32）':w.model.device==='mps'?'Apple MPS（FP32）':'CPU'}{w.model.memoryProfile==='low'?' · 低内存模式':''}{w.model.fallbackNote?' · '+w.model.fallbackNote:''}</p>}
    {direct && !status && !message && <p className="aa-runtime" role="status">正在检查分轨环境…</p>}
    {!busy && status && (!status.available || isSplit && !status.canSeparate) && <p className="aa-runtime" role="status">{isSplit && status.available && !direct ? '分轨模型尚未就绪，请在“模型资源…”中确认下载或检查缓存。' : status.message}</p>}
    {direct && status?.canSeparate && selection.drumPieces && !status.canSplitDrums && <p className="aa-runtime" role="status">当前分轨环境不支持单个鼓件。</p>}
    {compactSplit && showSplitHelp && (status?.canSeparate || w?.model.id.startsWith('mvsep-mega-')) && <p className="aa-warning" role="status">Mega 本地分离 ·「其他」为残余。单个鼓件中的镲片包含在其他鼓和打击乐残余中。</p>}
    {direct && !busy && needsModel && !showModel && <div className="aa-command"><button onClick={modelResources}>模型资源…</button></div>}
    {showModel && model && !busy && <AudioModelDownloadCard model={model} pending={modelPending} onConfirm={() => void downloadModel()} onCancel={() => void cancelModelDownload()} onRefresh={() => void refreshModel()} onDismiss={() => setShowModel(false)}/>}
    {!isSplit && <div className="aa-content">{!w ? <div className="aa-empty"><span className="aa-empty-wave">≋</span>{selectedSource ? <p>识别当前片段可见范围的和弦。</p> : <><h3>把参考音频放到同一条时间轴</h3><p>分析曲速、拍点与和弦，保留原始音频用于对齐试听。<br/>结果先在这里校正；应用后，分析修改随工程保存，完整音频保存在同名资源文件夹。</p><small>和弦与速度分析不需要分轨模型；音频只在本机处理。自动标记需要人工校正。</small></>}</div> : <>
      {externalAssets.length > 0 && <div className="aa-files"><label>音频资源 <select aria-label="需定位的音频资源" value={externalAssets.some(asset => asset.id === relinkAssetId) ? relinkAssetId : externalAssets[0].id} onChange={event => setRelinkAssetId(event.target.value)}>{externalAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><button disabled={busy || relinking || typeof window === 'undefined' || !window.desktop?.relinkAudioAsset} onClick={() => void relink()}>定位缺失音频…</button><small>仅接受校验值完全相同的原文件；不会替换分析内容。</small></div>}
      <div className="aa-transport"><button disabled={!ready || busy} aria-label={playing ? '暂停分轨试听' : '播放分轨试听'} onClick={() => void togglePlay()}>{playing ? '暂停' : '播放'}</button><button disabled={!ready} onClick={() => { stop(); setPosition(0); }}>停止</button><output data-testid="audio-assist-position">{time(position)} / {time(w.duration)}</output><input aria-label="分轨试听位置" type="range" min={0} max={w.duration} step={.01} value={position} onChange={e => void seek(Number(e.target.value))}/><button disabled={!ready || busy} onClick={() => void exportWav()}>导出试听混音 WAV</button></div>
      <div className="aa-loop"><label><input type="checkbox" checked={w.loop.enabled} onChange={e => change(v => ({ ...v, loop: { ...v.loop, enabled: e.target.checked } }))}/>循环</label><label>从 <CommitNumberInput aria-label="循环起点秒" contextKey={w.id} value={w.loop.start} min={0} max={w.loop.end - .001} step={.01} onCommit={value => change(v => ({ ...v, loop: { ...v.loop, start: value } }))}/></label><label>到 <CommitNumberInput aria-label="循环终点秒" contextKey={w.id} value={w.loop.end} min={w.loop.start + .001} max={max} step={.01} onCommit={value => change(v => ({ ...v, loop: { ...v.loop, end: value } }))}/>秒</label><small>各分轨使用同一时钟；导出保留完整时间轴。</small></div>
      <div className="aa-stems" data-testid="audio-assist-stems">{w.stems.map((stem, index) => <div className="aa-stem" key={stem.id} data-stem-role={stem.role}><div className="aa-stem-info"><i style={{ background: ['#91b8cd','#cba990','#a5c591','#b69bcb','#c7bd87','#91c4b5'][index % 6] }}/><strong>{stem.name}</strong><button className={stem.muted ? 'active' : ''} aria-label={`${stem.name}静音`} aria-pressed={stem.muted} onClick={() => change(v => ({ ...v, stems: v.stems.map(s => s.id === stem.id ? { ...s, muted: !s.muted } : s) }))}>M</button><button className={stem.solo ? 'active' : ''} aria-label={`${stem.name}独奏`} aria-pressed={stem.solo} onClick={() => change(v => ({ ...v, stems: v.stems.map(s => s.id === stem.id ? { ...s, solo: !s.solo } : s) }))}>S</button></div><div className="aa-wave" role="slider" aria-label={`${stem.name}时间轴`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={position} tabIndex={0} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); void seek(Math.min(max,Math.max(0,position + (e.key === 'ArrowRight' ? 1 : -1)))); } }} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); void seek(Math.max(0,Math.min(max,(e.clientX - rect.left) / rect.width * max))); }}><svg viewBox="0 0 360 44" preserveAspectRatio="none" aria-hidden="true"><path d={(peaks[stem.id] ?? []).map((peak, i) => `M${i} ${22-peak*20}V${22+peak*20}`).join(' ')}/></svg><i className="aa-playhead" style={{ left: `${position / max * 100}%` }}/></div><input type="range" aria-label={`${stem.name}音量`} min={0} max={2} step={.01} value={stem.gain} onChange={e => change(v => ({ ...v, stems: v.stems.map(s => s.id === stem.id ? { ...s, gain: Number(e.target.value) } : s) }))}/><button disabled={!ready || busy} aria-label={`导出${stem.name}WAV`} onClick={() => void exportWav(stem.id)}>WAV ↓</button></div>)}</div>
      <div className={`aa-analysis${selectedSource ? ' aa-region-chords' : ''}`}>{!selectedSource && <section className="aa-tempo"><h3>曲速与拍点 <small>固定速度</small></h3><div className="aa-fields"><label>BPM <CommitNumberInput aria-label="分析BPM" contextKey={w.id} value={w.bpm} min={10} max={1000} step={.01} onCommit={bpm => change(v => setWorkspaceTempo(v,bpm))}/></label><button disabled={w.bpm / 2 < 10} onClick={() => change(v => setWorkspaceTempo(v,v.bpm / 2))}>½ 速度</button><button disabled={w.bpm * 2 > 1000} onClick={() => change(v => setWorkspaceTempo(v,v.bpm * 2))}>2× 速度</button></div><div className="aa-fields"><label>首拍 <CommitNumberInput aria-label="首拍秒" contextKey={w.id} value={w.firstBeat} min={0} max={max} step={.001} onCommit={value => change(v => setWorkspaceTempo(v,v.bpm,value))}/>秒</label><button onClick={() => change(v => setWorkspaceTempo(v,v.bpm,position))}>对齐到播放头</button></div><div className="aa-beat-strip" aria-label="拍点预览">{audioAssistBeatPreview(w.beats).map(({beat,i}) => <button key={i} className={beatIndex === i ? 'active' : ''} aria-label={`拍点${i+1}`} title={`${i+1} · ${beat.toFixed(3)} 秒`} style={{ left: `${beat / max * 100}%` }} onClick={() => { setSelectedBeat(i); void seek(beat); }}/>)}</div><small>拍点缩略预览 · 完整 {w.beats.length} 拍，输入序号可选择任意拍点。</small>{w.beats.length > 0 && <label className="aa-fields">选择拍点 <CommitNumberInput aria-label="拍点序号" contextKey={w.id} value={beatIndex+1} min={1} max={w.beats.length} integer onCommit={value => setSelectedBeat(value-1)}/></label>} {w.beats[beatIndex] !== undefined && <label className="aa-fields">第 {beatIndex+1} 拍 <CommitNumberInput aria-label="拍点秒" contextKey={`${w.id}/${beatIndex}`} value={w.beats[beatIndex]} min={beatIndex ? w.beats[beatIndex-1]+.001 : 0} max={beatIndex+1 < w.beats.length ? w.beats[beatIndex+1]-.001 : max} step={.001} onCommit={value => change(v => ({ ...v, beats: v.beats.map((b,i) => i === beatIndex ? value : b) }))}/></label>}<small>修改 BPM 或首拍会重新生成等间距拍点。手动拍点只作扒谱标记，暂不生成复杂速度图。</small><label className="aa-apply-tempo"><input type="checkbox" checked={applyTempo} onChange={e => setApplyTempo(e.target.checked)}/>应用时将工程改为此固定 BPM</label>{applyTempo && <p className="aa-warning">{project.tempos.length > 1 ? '将替换工程现有速度图。' : '将修改工程速度。'}音频保持原始时长，不做时间拉伸；首拍只校正分析拍点。</p>}</section>}
      <section className="aa-chords"><h3>和弦标记 <small>可修改名称、分界或合并</small></h3><div className="aa-chord-lane">{w.chords.map(chord => <button key={chord.id} title={`${chord.name} · ${time(chord.start)}–${time(chord.end)}`} style={{ left:`${chord.start/max*100}%`, width:`${(chord.end-chord.start)/max*100}%` }} onClick={() => void seek(chord.start)}>{chord.name}</button>)}</div><div className="aa-chord-table"><table><thead><tr><th>和弦</th><th>起点 · 秒</th><th>终点 · 秒</th><th>判断</th><th/></tr></thead><tbody>{w.chords.map((chord,i) => <tr key={chord.id}><td><ChordName label={`和弦${i+1}名称`} value={chord.name} onCommit={name => change(v => ({ ...v,chords:v.chords.map(c => c.id===chord.id ? {...c,name}:c) }))}/></td><td><CommitNumberInput aria-label={`和弦${i+1}起点秒`} contextKey={chord.id} value={chord.start} min={i ? w.chords[i-1].start+.001 : 0} max={chord.end-.001} step={.01} onCommit={value => change(v => ({...v,chords:i ? moveChordBoundary(v.chords,i,value) : v.chords.map((c,j)=>j===0?{...c,start:value}:c)}))}/></td><td><CommitNumberInput aria-label={`和弦${i+1}终点秒`} contextKey={chord.id} value={chord.end} min={chord.start+.001} max={i+1 < w.chords.length ? w.chords[i+1].end-.001 : max} step={.01} onCommit={value => change(v => ({...v,chords:i+1 < v.chords.length ? moveChordBoundary(v.chords,i+1,value) : v.chords.map((c,j)=>j===i?{...c,end:value}:c)}))}/></td><td><span className={chord.confidence < .65 ? 'aa-uncertain' : ''}>{chord.confidence < .65 ? '待确认' : '候选'}</span></td><td><button disabled={i+1===w.chords.length} aria-label={`合并和弦${i+1}与下一段`} onClick={() => change(v => ({...v,chords:mergeChordMarkers(v.chords,i)}))}>合并 →</button></td></tr>)}</tbody></table>{!w.chords.length && <p>没有可用和弦标记。</p>}</div></section></div>
    </>}</div>}
    <div className="aa-message" role="status">{decoding ? '正在加载试听…' : message || (isSplit ? '' : '所有操作先在预览中修改；应用后可在工程中撤销。')}</div>
    <footer>{compactSplit
      ? <button type="button" className="aa-split-help-button" aria-label="分轨帮助和设置" aria-controls="stem-splitter-help" aria-expanded={showSplitHelp} disabled={modelPending || busy} onClick={() => {
        if (showSplitHelp && !needsModel) setShowModel(false);
        setShowSplitHelp(!showSplitHelp);
      }}>?</button>
      : <span>{isSplit ? '完成后创建分轨组，并静音原音频片段。' : '音频保存在工程旁的“工程文件名.assets”资源文件夹；移动时请与 NBSX 一起移动。旧版嵌入音频仍可打开。MIDI / NBS 导出仍为音符轨道。'}</span>}
      <button onClick={close}>取消</button>{direct
        ? presetStarted.current && !busy && canStartSplit && <button className="primary" onClick={start}>重试分轨</button>
        : isSplit ? <button className="primary" disabled={busy || selecting || !canStartSplit} onClick={start}>{selecting ? '选择音频…' : '应用'}</button>
        : <button className="primary" disabled={!w || busy || decoding} onClick={apply}>应用分析</button>}
    </footer>
  </section></div>;
}
