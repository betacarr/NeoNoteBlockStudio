import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Waveform, X } from '@phosphor-icons/react';
import type { Project } from '../core/types';
import type { MeterMap } from '../core/meter';
import { createTempoMap } from '../core/time';
import type { WaveformPeaks } from '../core/reference';
import { ReferenceWaveform } from './ReferenceWaveform';
import { captureEditorPointer } from './pointer-capture';
import { startHorizontalEdgeScroll } from './edge-scroll';
import './ReferenceTrack.css';

type Change = (patch: { startTick?: number; gain?: number }) => void;
export function ReferenceHeader({ name, reference, ppq, onChange, onRemove }: { name: string; reference: NonNullable<Project['reference']>; ppq: number; onChange: Change; onRemove: () => void }) {
  return <div className="reference-header"><div><Waveform size={14} /><strong title={name}>{name}</strong><button aria-label="移除参考音频" onClick={onRemove}><X size={12} /></button></div><div><label>起点<input aria-label="参考音频起始四分拍" type="number" min="0" step=".25" value={reference.startTick / ppq} onChange={e => { if (Number.isFinite(e.currentTarget.valueAsNumber)) onChange({ startTick: Math.max(0, e.currentTarget.valueAsNumber * ppq) }); }} /></label><label>音量<input aria-label="参考音频音量" type="range" min="0" max="1" step=".01" value={reference.gain} onChange={e => onChange({ gain: e.currentTarget.valueAsNumber })} /></label></div></div>;
}
interface Props { project: Project; name: string; peaks?: WaveformPeaks; meter: MeterMap; step: number; scale: number; scroll: RefObject<HTMLDivElement | null>; left: number; width: number; onChange: Change; onSeek: (tick: number) => void; gestureOwner?: object; getGestureOwner?: () => object; onPreviewExtent?: (owner: object, endTick?: number) => void }
export function ReferenceLane(props: Props) {
  const { project, name, peaks, meter, step, scale, scroll, left, width, onSeek, gestureOwner } = props;
  const timing = useMemo(() => createTempoMap(project), [project.ppq, project.tempos]);
  const [preview, setPreview] = useState<number>();
  const current = useRef(props); current.current = props;
  const snapshot = (value: Props) => {
    const reference = value.project.reference, asset = value.project.assets.find(item => item.id === reference?.assetId);
    return [value.project.id, reference, reference?.assetId, reference?.startTick, reference?.gain, asset, asset?.data, asset?.path,
      value.project.ppq, value.project.tempos, value.peaks, value.scale, value.meter, value.step, value.scroll, value.scroll.current, value.gestureOwner] as const;
  };
  const drag = useRef<{ pointer: number; x: number; clientX: number; scroll: number; tick: number; moved: boolean; owner?: object;
    state: ReturnType<typeof snapshot>; stop: () => void; scroller?: ReturnType<typeof startHorizontalEdgeScroll>;
    timing: ReturnType<typeof createTempoMap>; duration: number; onPreviewExtent?: Props['onPreviewExtent'] } | null>(null);
  type ReferenceGesture = NonNullable<typeof drag.current>;
  const ownerOf = (value: Props) => value.getGestureOwner ? value.getGestureOwner() : value.gestureOwner;
  const valid = (active: NonNullable<typeof drag.current>) => {
    const value = current.current;
    if (ownerOf(value) !== active.owner) return false;
    const state = snapshot(value);
    return state.every((item, index) => Object.is(item, active.state[index]));
  };
  const cancel = (clearPreview = true) => {
    const active = drag.current; drag.current = null;
    if (clearPreview) setPreview(undefined);
    active?.scroller?.stop(); active?.stop();
    active?.onPreviewExtent?.(active, undefined);
  };
  const asset = project.assets.find(item => item.id === project.reference?.assetId);
  useLayoutEffect(() => {
    const active = drag.current; if (active && !valid(active)) cancel();
  }, [project.id, project.reference, project.reference?.assetId, project.reference?.startTick, project.reference?.gain, asset, asset?.data, asset?.path,
    project.ppq, project.tempos, peaks, scale, meter, step, scroll, scroll.current, gestureOwner]);
  useLayoutEffect(() => () => cancel(false), []);
  const startTick = preview ?? project.reference?.startTick ?? 0;
  const endTick = timing.tick(timing.seconds(startTick) + (peaks?.duration ?? 0));
  const tickAt = (active: NonNullable<typeof drag.current>, x: number) => {
    const value = current.current;
    return Math.max(0, value.meter.snap(active.tick + (x - active.x + (value.scroll.current?.scrollLeft ?? 0) - active.scroll) / value.scale, value.step));
  };
  const isActive = (active: NonNullable<typeof drag.current>) => {
    if (drag.current !== active) return false;
    if (!valid(active)) { cancel(); return false; }
    return true;
  };
  const updatePreview = (active: NonNullable<typeof drag.current>) => {
    if (!isActive(active)) return;
    const tick = tickAt(active, active.clientX); setPreview(tick);
    if (active.moved) active.onPreviewExtent?.(active, active.timing.tick(active.timing.seconds(tick) + active.duration));
    if (drag.current === active && !valid(active)) cancel();
  };
  return <div className="reference-lane" aria-label="参考音频轨道：与工程一起播放" title="参考音频跟随工程试听，不混入导出；双击波形定位，拖动标题对齐" onDoubleClick={e => onSeek(Math.max(0, meter.snap((e.clientX - e.currentTarget.getBoundingClientRect().left) / scale, step)))}>
    <div className="reference-clip" data-testid="reference-clip" style={{ left: startTick * scale, width: Math.max(12, (endTick - startTick) * scale) }}>
      <span role="slider" tabIndex={0} aria-label="移动参考音频起点" aria-valuemin={0} aria-valuenow={startTick / project.ppq} aria-valuetext={`${startTick / project.ppq} 四分拍`} title="拖动对齐参考音频；Esc 取消拖动，方向键按网格移动，Home 回到起点"
        onKeyDown={e => {
          if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return;
          e.preventDefault();
          const before = current.current, owner = ownerOf(before);
          if (before.getGestureOwner && before.gestureOwner !== undefined && owner !== before.gestureOwner) { cancel(); return; }
          cancel();
          const value = current.current;
          if (ownerOf(value) !== owner || value.getGestureOwner && value.gestureOwner !== undefined && ownerOf(value) !== value.gestureOwner) return;
          const tick = value.project.reference?.startTick ?? 0;
          value.onChange({ startTick: e.key === 'Home' ? 0 : Math.max(0, value.meter.snap(tick + (e.key === 'ArrowRight' ? value.step : -value.step), value.step)) });
        }}
        onPointerDown={e => {
          const value = current.current, owner = ownerOf(value);
          if (e.button !== 0 || drag.current || !value.project.reference || value.getGestureOwner && value.gestureOwner !== undefined && owner !== value.gestureOwner) return;
          e.preventDefault(); e.stopPropagation();
          const active: ReferenceGesture = { pointer: e.pointerId, x: e.clientX, clientX: e.clientX, moved: false, scroll: value.scroll.current?.scrollLeft ?? 0,
            tick: value.project.reference.startTick, owner, state: snapshot(value), stop: () => {}, timing, duration: value.peaks?.duration ?? 0, onPreviewExtent: value.onPreviewExtent };
          drag.current = active;
          const stop = captureEditorPointer(e.currentTarget, e.pointerId, () => cancel());
          if (drag.current === active) { active.stop = stop; if (!valid(active)) cancel(); } else stop();
        }}
        onPointerMove={e => {
          const active = drag.current; if (active?.pointer !== e.pointerId) return;
          if (!valid(active)) { cancel(); return; }
          active.clientX = e.clientX;
          if (Math.abs(active.clientX - active.x) >= 2 || (current.current.scroll.current?.scrollLeft ?? 0) !== active.scroll) active.moved = true;
          updatePreview(active);
          if (drag.current !== active || !active.moved) return;
          if (!active.scroller && current.current.scroll.current) {
            const scroller = startHorizontalEdgeScroll(current.current.scroll.current, active.clientX, {
              isActive: () => isActive(active), onScroll: () => updatePreview(active),
            });
            if (drag.current === active) active.scroller = scroller; else scroller.stop();
          }
          active.scroller?.move(active.clientX);
        }}
        onPointerUp={e => {
          const active = drag.current; if (active?.pointer !== e.pointerId) return;
          if (!valid(active)) { cancel(); return; }
          const tick = tickAt(active, e.clientX); cancel();
          if (valid(active) && tick !== active.tick) current.current.onChange({ startTick: tick });
        }}
        onPointerCancel={e => { if (drag.current?.pointer === e.pointerId) cancel(); }}
        onLostPointerCapture={e => { if (drag.current?.pointer === e.pointerId) cancel(); }}>{name} · {peaks ? `${peaks.duration.toFixed(1)} 秒` : '正在读取…'}</span>
    </div>
    <ReferenceWaveform peaks={peaks} timing={timing} startTick={startTick} scale={scale} left={left} width={width} />
  </div>;
}
