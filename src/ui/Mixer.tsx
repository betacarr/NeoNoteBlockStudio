import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Project, Track } from '../core/types';
import { filterTracks } from '../core/track-filter';
import { CommitNumberInput } from './CommitNumberInput';
import { InstrumentBlock } from './InstrumentBlock';
import { TrackInstrumentFilter } from './TrackInstrumentFilter';
import { captureEditorPointer } from './pointer-capture';
import './Mixer.css';

export interface MixerProps {
  project: Project; selectedTrack: string; instrumentFilter: string;
  onInstrumentFilter: (value: string) => void; onSelect: (track: Track) => void;
  onTrackChange: (id: string, patch: Partial<Track>) => void; onMasterChange: (gain: number) => void;
  onTrackPreview?: (id: string, patch: Partial<Track> | undefined) => void;
  onMasterPreview?: (gain: number | undefined) => void;
  meters: Record<string, number>; masterMeter?: number; playing: boolean; meterScope: 'tracks' | 'master';
  gestureOwner?: object; getGestureOwner?: () => object;
  numberContextKey?: string; getNumberContextKey?: () => string;
  onNumberPending?: (field: string, pending: boolean) => void;
}
const ownerIds = new WeakMap<object, number>(); let nextOwnerId = 0;
function ownerKey(owner: object) { let id = ownerIds.get(owner); if (id === undefined) { id = ++nextOwnerId; ownerIds.set(owner, id); } return id; }
const gainLabel = (percent: number) => percent === 0 ? '−∞ dB' : `${(20 * Math.log10(percent / 100)).toFixed(1)} dB`;
const panLabel = (percent: number) => percent === 0 ? '居中' : `${percent < 0 ? 'L' : 'R'} ${Math.abs(percent).toFixed(1)}%`;
interface ParameterProps {
  label: string; title: string; value: number; min: number; max: number; reset: number; disabled?: boolean;
  vertical?: boolean; contextKey: string; owner: object; getOwner?: () => object;
  numberContextKey: string; getNumberContextKey?: () => string;
  onCommit: (value: number) => void; onNumberCommit: (value: number) => void; onPending?: MixerProps['onNumberPending'];
  onPreview?: (value: number | undefined) => void;
}
type ParameterTarget = { owner: object; context: string; value: number; min: number; max: number };
type ParameterDrag = ParameterTarget & { pointer: number; preview: number; stop: () => void; onPreview?: ParameterProps['onPreview'] };

/** Pointer changes preview audio; release commits once. Numeric drafts stay local. */
function MixerParameter(props: ParameterProps) {
  const current = useRef(props); current.current = props;
  const active = useRef<ParameterDrag | null>(null), alive = useRef(true), cancelled = useRef(false);
  const [preview, setPreview] = useState<number | null>(null);
  const target = (): ParameterTarget => ({ owner: props.owner, context: props.contextKey, value: props.value, min: props.min, max: props.max });
  const valid = (snapshot: ParameterTarget) => {
    const p = current.current;
    return alive.current && !p.disabled && p.owner === snapshot.owner && p.contextKey === snapshot.context
      && Object.is(p.value, snapshot.value) && p.min === snapshot.min && p.max === snapshot.max
      && (!p.getOwner || p.getOwner() === snapshot.owner);
  };
  const finish = (cancel = true, update = true, clearPreview = true) => {
    const drag = active.current; if (!drag) return;
    active.current = null; cancelled.current = cancel;
    if (update) setPreview(null);
    try { drag.stop(); } finally { if (clearPreview) drag.onPreview?.(undefined); }
  };
  const commit = (value: number, snapshot = target()): void | boolean => {
    if (!valid(snapshot) || !Number.isFinite(value) || value < snapshot.min || value > snapshot.max) return false;
    if (!Object.is(value, current.current.value)) current.current.onCommit(value);
  };
  const commitNumber = (value: number): void | boolean => {
    const p = current.current;
    if (!alive.current || p.disabled || p.numberContextKey !== props.numberContextKey
      || p.getNumberContextKey && p.getNumberContextKey() !== props.numberContextKey
      || !Object.is(p.value, props.value) || p.min !== props.min || p.max !== props.max
      || !Number.isFinite(value) || value < p.min || value > p.max) return false;
    if (!Object.is(value, p.value)) p.onNumberCommit(value);
  };
  const reset = () => { finish(); commit(props.reset); };
  useLayoutEffect(() => { if (active.current && !valid(active.current)) finish(); });
  useEffect(() => { alive.current = true; return () => { alive.current = false; finish(true, false); }; }, []);
  const shown = preview ?? props.value;
  return <div className={`mixer-parameter ${props.vertical ? 'vertical' : 'horizontal'}`}>
    <div className="mixer-control-heading"><span title={`双击恢复${props.vertical ? '100%' : '居中'}`} onDoubleClick={reset}>{props.title}</span>
      <button type="button" className="mixer-reset" disabled={props.disabled} aria-label={`${props.label}恢复${props.vertical ? '100%' : '居中'}`} onClick={reset}>{props.vertical ? '0 dB' : '居中'}</button></div>
    <div className="mixer-range-wrap"><input type="range" aria-label={props.label} min={props.min} max={props.max} step="any" value={shown} disabled={props.disabled}
      onFocus={() => { cancelled.current = false; }} onBlur={() => finish()}
      onPointerDown={event => {
        if (event.button !== 0 || active.current || !valid(target())) return;
        event.stopPropagation(); cancelled.current = false;
        const drag: ParameterDrag = { ...target(), pointer: event.pointerId, preview: props.value, stop: () => {}, onPreview: props.onPreview };
        active.current = drag; setPreview(drag.preview);
        const stop = captureEditorPointer(event.currentTarget, event.pointerId, () => finish());
        if (active.current === drag) { drag.stop = stop; if (!valid(drag)) finish(); } else stop();
      }}
      onChange={event => {
        const value = Number(event.currentTarget.value), drag = active.current;
        if (!Number.isFinite(value)) return;
        if (drag) {
          if (!valid(drag)) { finish(); return; }
          drag.preview = Math.max(props.min, Math.min(props.max, value)); setPreview(drag.preview); drag.onPreview?.(drag.preview);
          if (active.current === drag && !valid(drag)) finish();
        }
        else if (!cancelled.current) commit(value);
      }}
      onPointerUp={event => {
        const drag = active.current; if (!drag || drag.pointer !== event.pointerId) return;
        if (!valid(drag)) { finish(); return; }
        finish(false, true, false);
        try { if (!active.current) commit(drag.preview, drag); } finally { drag.onPreview?.(undefined); }
      }}
      onPointerCancel={event => { if (active.current?.pointer === event.pointerId) finish(); }}
      onLostPointerCapture={event => { if (active.current?.pointer === event.pointerId) finish(); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && active.current) { event.preventDefault(); event.stopPropagation(); finish(); }
        else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) cancelled.current = false;
      }} />
      {props.vertical && <span className="mixer-unity-mark" style={{ bottom: `${100 / props.max * 100}%` }}>0 dB</span>}
    </div>
    <output className="mixer-level-value" title={props.vertical ? '音量增益' : '声像'}>{props.vertical ? gainLabel(shown) : panLabel(shown)}</output>
    <label className="mixer-number"><CommitNumberInput aria-label={`${props.label}百分比`} value={props.value} min={props.min} max={props.max} step={.1}
      disabled={props.disabled} contextKey={props.numberContextKey} onCommit={commitNumber} onPendingChange={pending => props.onPending?.(props.numberContextKey, pending)} /><span>%</span></label>
  </div>;
}

function MixerMeter({ label, value, available, playing, quiet = false }: { label: string; value?: number; available: boolean; playing: boolean; quiet?: boolean }) {
  const peak = playing && Number.isFinite(value) ? Math.max(0, value!) : 0, known = available && (!playing || Number.isFinite(value));
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  // Only the visual scale is logarithmic; ARIA retains the measured peak.
  const height = known ? Math.max(0, Math.min(100, (db + 60) / 60 * 100)) : 0;
  return <div className={`mixer-meter ${quiet ? 'quiet' : ''} ${peak > 1 ? 'clipped' : ''}`} role={known ? 'meter' : undefined}
    aria-label={known ? label : `${label}不可用`} aria-valuemin={known ? 0 : undefined} aria-valuemax={known ? 1 : undefined} aria-valuenow={known ? Math.min(1, peak) : undefined}
    title={known ? `实际峰值 ${peak.toFixed(3)} · ${peak > 0 ? db.toFixed(1) : '−∞'} dBFS${peak > 1 ? ' · 超过 0 dBFS' : ''} · 标尺 −60～0 dBFS` : '当前没有此通道的真实电平数据'}>
    <i style={{ height: `${height}%` }} />{!known && <span>—</span>}
  </div>;
}

export function Mixer(props: MixerProps) {
  const { project, selectedTrack, instrumentFilter, meters, playing, meterScope } = props;
  const owner = props.gestureOwner ?? project, prefix = `mixer:${ownerKey(owner)}`;
  const numberPrefix = props.numberContextKey === undefined ? prefix : `mixer-number:${props.numberContextKey}`;
  const liveNumberPrefix = props.getNumberContextKey ? () => `mixer-number:${props.getNumberContextKey!()}`
    : props.numberContextKey === undefined && props.getGestureOwner ? () => `mixer:${ownerKey(props.getGestureOwner!())}` : undefined;
  const visible = useMemo(() => filterTracks(project.tracks, instrumentFilter), [project.tracks, instrumentFilter]);
  const root = useRef<HTMLElement>(null), scroll = useRef<HTMLDivElement>(null), strips = useRef(new Map<string, HTMLDivElement>());
  const previewOwners = useRef(new Map<string, object>());
  const current = useRef(props); current.current = props;
  const selected = project.tracks.find(track => track.id === selectedTrack), selectedHidden = selected && !visible.includes(selected);
  const instruments = useMemo(() => new Map(project.instruments.map(instrument => [instrument.id, instrument])), [project.instruments]);
  const numbers = useMemo(() => new Map(project.tracks.map((track, index) => [track.id, index + 1])), [project.tracks]);
  const hasSolo = project.tracks.some(track => track.solo);
  const previewFor = (key: string, send: (value: number | undefined) => void) => {
    const token = {};
    return (value: number | undefined) => {
      if (value === undefined) {
        if (previewOwners.current.get(key) !== token) return;
        previewOwners.current.delete(key); send(undefined); return;
      }
      const p = current.current;
      if ((p.gestureOwner ?? p.project) !== owner || p.getGestureOwner && p.getGestureOwner() !== owner) return;
      previewOwners.current.set(key, token); send(value);
    };
  };
  const select = (track: Track) => { const p = current.current; if (p.project.tracks.includes(track) && p.selectedTrack !== track.id) p.onSelect(track); };
  const changeTrack = (track: Track, patch: Partial<Track>, numeric = false) => {
    const p = current.current;
    if (!p.project.tracks.includes(track)) return;
    if (numeric) {
      const currentPrefix = p.numberContextKey === undefined ? `mixer:${ownerKey(p.gestureOwner ?? p.project)}` : `mixer-number:${p.numberContextKey}`;
      if (currentPrefix !== numberPrefix || liveNumberPrefix && liveNumberPrefix() !== numberPrefix) return;
    } else if ((p.gestureOwner ?? p.project) !== owner || p.getGestureOwner && p.getGestureOwner() !== owner) return;
    p.onTrackChange(track.id, patch);
  };
  useLayoutEffect(() => {
    const element = root.current, workspace = element?.closest<HTMLElement>('.center-workspace');
    if (!element || !workspace || workspace.clientHeight <= 0) return;
    const bounds = element.getBoundingClientRect(), top = workspace.getBoundingClientRect().top + workspace.clientTop;
    const bottom = top + workspace.clientHeight;
    const delta = bounds.height > workspace.clientHeight || bounds.top < top ? bounds.top - top : bounds.bottom > bottom ? bounds.bottom - bottom : 0;
    // Reveal once on opening; meter updates and track navigation keep the
    // user's workspace position. Never scroll the page or sibling panels.
    if (delta) workspace.scrollTop += delta;
  }, []);
  useLayoutEffect(() => {
    const element = scroll.current, strip = strips.current.get(selectedTrack); if (!element || !strip) return;
    if (strip.offsetLeft < element.scrollLeft) element.scrollLeft = strip.offsetLeft;
    else if (strip.offsetLeft + strip.offsetWidth > element.scrollLeft + element.clientWidth) element.scrollLeft = strip.offsetLeft + strip.offsetWidth - element.clientWidth;
  }, [selectedTrack, visible]);
  return <section ref={root} className="mixer-console" aria-label="混音器">
    <header className="mixer-toolbar"><strong>混音器</strong><TrackInstrumentFilter tracks={project.tracks} instruments={project.instruments} value={instrumentFilter} onChange={props.onInstrumentFilter} context="混音器" />
      {selectedHidden && <span className="mixer-hidden-selection">所选轨道“{selected.name}”被筛选隐藏 <button type="button" onClick={() => props.onInstrumentFilter(selected.instrumentId)}>显示所选音色</button></span>}</header>
    <div className="mixer-body"><div ref={scroll} className="mixer-scroll" aria-label="混音器轨道" tabIndex={-1}><div className="mixer-strips">
      {visible.map(track => {
        const instrument = instruments.get(track.instrumentId), quiet = track.muted || hasSolo && !track.solo;
        return <div key={track.id} ref={element => { if (element) strips.current.set(track.id, element); else strips.current.delete(track.id); }} data-track-id={track.id}
          className={`mixer-strip ${selectedTrack === track.id ? 'active' : ''}`} aria-current={selectedTrack === track.id ? 'true' : undefined}
          style={{ '--mixer-track-color': track.color } as CSSProperties} onPointerDownCapture={() => select(track)} onFocusCapture={() => select(track)}>
          <button type="button" className="mixer-track-heading" aria-label={`选择轨道 ${numbers.get(track.id)} ${track.name}`} onClick={() => select(track)}>
            <span className="mixer-track-number">{numbers.get(track.id)}</span><InstrumentBlock instrumentId={track.instrumentId} size={22} label={instrument?.name ?? track.instrumentId} /><span className="mixer-track-name">{track.name}</span>
          </button><span className="mixer-instrument-name" title={instrument?.name ?? track.instrumentId}>{instrument?.name ?? track.instrumentId}{track.locked ? ' · 已锁定' : ''}</span>
          <MixerParameter label={`${track.name} 声像`} title="声像" value={track.pan * 100} min={-100} max={100} reset={0} disabled={track.locked}
            owner={owner} getOwner={props.getGestureOwner} contextKey={`${prefix}:track:${track.id}:pan`} numberContextKey={`${numberPrefix}:track:${track.id}:pan`} getNumberContextKey={liveNumberPrefix && (() => `${liveNumberPrefix()}:track:${track.id}:pan`)}
            onPreview={previewFor(`track:${track.id}`, value => current.current.onTrackPreview?.(track.id, value === undefined ? undefined : { pan: value / 100 }))}
            onCommit={value => changeTrack(track, { pan: value / 100 })} onNumberCommit={value => changeTrack(track, { pan: value / 100 }, true)} onPending={props.onNumberPending} />
          <div className="mixer-fader"><MixerParameter label={`${track.name} 音量`} title="音量" value={track.volume * 100} min={0} max={400} reset={100} disabled={track.locked} vertical
            owner={owner} getOwner={props.getGestureOwner} contextKey={`${prefix}:track:${track.id}:volume`} numberContextKey={`${numberPrefix}:track:${track.id}:volume`} getNumberContextKey={liveNumberPrefix && (() => `${liveNumberPrefix()}:track:${track.id}:volume`)}
            onPreview={previewFor(`track:${track.id}`, value => current.current.onTrackPreview?.(track.id, value === undefined ? undefined : { volume: value / 100 }))}
            onCommit={value => changeTrack(track, { volume: value / 100 })} onNumberCommit={value => changeTrack(track, { volume: value / 100 }, true)} onPending={props.onNumberPending} />
            <MixerMeter label={`${track.name} 电平`} value={meters[track.id]} available={meterScope === 'tracks'} playing={playing} quiet={quiet} /></div>
          <div className="mixer-channel-buttons"><button type="button" aria-label={`${track.name} 静音`} aria-pressed={track.muted} onClick={() => changeTrack(track, { muted: !track.muted })}>M</button>
            <button type="button" aria-label={`${track.name} 独奏`} aria-pressed={track.solo} onClick={() => changeTrack(track, { solo: !track.solo })}>S</button></div>
        </div>;
      })}
      {!visible.length && <p className="mixer-empty">没有匹配此音色的轨道。<button type="button" onClick={() => props.onInstrumentFilter('')}>显示全部轨道</button></p>}
    </div></div>
      <div className="mixer-master"><div className="mixer-master-heading">总输出 <small>Master</small></div>
        <div className="mixer-fader"><MixerParameter label="总输出音量" title="音量" value={project.audio.masterGain * 100} min={0} max={200} reset={100} vertical
          owner={owner} getOwner={props.getGestureOwner} contextKey={`${prefix}:master:volume`} numberContextKey={`${numberPrefix}:master:volume`} getNumberContextKey={liveNumberPrefix && (() => `${liveNumberPrefix()}:master:volume`)}
          onPreview={previewFor('master', value => current.current.onMasterPreview?.(value === undefined ? undefined : value / 100))}
          onCommit={value => props.onMasterChange(value / 100)} onNumberCommit={value => props.onMasterChange(value / 100)} onPending={props.onNumberPending} />
          <MixerMeter label="总输出电平" value={props.masterMeter ?? meters.__master ?? 0} available playing={playing} /></div></div>
    </div><footer className="mixer-scope-note">{meterScope === 'master' ? '原生对照试听使用离线快照，仅提供真实总输出电平，分轨电平不可用；混音修改在重新播放后生效。' : '实时试听：音量、声像与 M/S 即时生效；音符与 Delay 变更更新后续发声。显示实际分轨与总输出电平。'}</footer>
  </section>;
}
