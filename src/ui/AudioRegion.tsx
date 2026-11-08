import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { audioClipEnd } from '../core/audio-clips';
import { audioClipWithRange, audioSourceDuration, planAudioTrim, type AudioTrimEdge } from '../core/audio-region-edit';
import { visibleFirstBeat } from '../core/audio-tempo';
import { regionChords } from '../core/chord-track';
import type { MeterMap } from '../core/meter';
import type { WaveformPeaks } from '../core/reference';
import { createTempoMap } from '../core/time';
import type { AudioClip, Project } from '../core/types';
import { audioWaveformPath } from './audio-waveform';
import { captureEditorPointer } from './pointer-capture';

type AudioDrag = {
  pointer: number; x: number; scroll: number; origin: number; owner: Project;
  scale: number; step: number; edge?: AudioTrimEdge; stop: () => void;
};

export function AudioRegion({ project, clip, scale, peaks, meter, step, onMove, onTrim, onMenu, onChordDrop, onSelect, selected = false, viewportLeft = 0, viewportWidth = 1600 }: {
  project: Project; clip: AudioClip; scale: number; peaks?: WaveformPeaks; meter: MeterMap; step: number;
  selected?: boolean; viewportLeft?: number; viewportWidth?: number;
  onChordDrop?: () => void; onSelect?: (additive?: boolean) => void;
  onMove: (id: string, start: number, trackId: string) => void;
  onTrim?: (id: string, edge: AudioTrimEdge, tick: number) => void;
  onMenu: (clip: AudioClip, x: number, y: number) => void;
}) {
  const track = project.tracks.find(t => t.id === clip.trackId)!;
  const [preview, setPreview] = useState<AudioClip>();
  const drag = useRef<AudioDrag | undefined>(undefined);
  function cancel() {
    const active = drag.current;
    drag.current = undefined;
    setPreview(undefined);
    active?.stop();
  }
  useLayoutEffect(() => {
    const active = drag.current;
    if (active && (active.owner !== project || active.scale !== scale || active.step !== step)) cancel();
  }, [project, scale, step]);
  useEffect(() => () => {
    const active = drag.current;
    drag.current = undefined;
    active?.stop();
  }, []);

  const shown = preview ?? clip, timing = useMemo(() => createTempoMap(project), [project.tempos, project.ppq]);
  const startSeconds = timing.seconds(shown.start);
  const width = Math.max(14, (timing.tick(startSeconds + shown.durationSeconds) - shown.start) * scale);
  const waveLeft = Math.max(0, Math.floor(viewportLeft - shown.start * scale));
  const waveWidth = Math.max(0, Math.min(width - waveLeft, Math.ceil(viewportLeft + viewportWidth - shown.start * scale) - waveLeft));
  const waveform = useMemo(() => peaks && waveWidth > 0 ? audioWaveformPath(peaks, timing, shown.start, shown.offsetSeconds, shown.durationSeconds, scale, waveLeft, waveWidth) : '',
    [peaks, timing, shown.start, shown.offsetSeconds, shown.durationSeconds, scale, waveLeft, waveWidth]);
  const chords = regionChords(shown);
  const firstBeat = selected && shown.tempoAnalysis ? visibleFirstBeat(shown) : undefined;

  function dragTick(active: AudioDrag, x: number, element: HTMLElement) {
    const scroll = element.closest('.arrangement-scroll')?.scrollLeft ?? 0;
    const pixels = x - active.x + scroll - active.scroll;
    return Math.abs(pixels) < 2 ? active.origin : Math.max(0, meter.snap(active.origin + pixels / scale, step));
  }

  return <div role="button" tabIndex={0} aria-label={`音频片段 ${clip.name}`} aria-pressed={selected}
    data-audio-clip-id={clip.id} data-start-tick={clip.start} data-offset-seconds={clip.offsetSeconds} data-duration-seconds={clip.durationSeconds}
    data-muted={!!clip.muted} className={`audio-region${clip.muted ? ' clip-muted' : ''}${selected ? ' selected' : ''}`}
    style={{ left: shown.start * scale, width, '--region-color': track.color } as React.CSSProperties}
    title={`${clip.name} · ${clip.durationSeconds.toFixed(2)} 秒${clip.tempoAnalysis ? ` · ${clip.tempoAnalysis.bpm} BPM` : ''}${clip.muted ? ' · 片段已静音' : ''}。拖动下缘两端调整范围，右键打开片段菜单。`}
    onContextMenu={event => {
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      if (!selected) onSelect?.();
      onMenu(clip, event.clientX, event.clientY);
    }}
    onKeyDown={event => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault(); event.stopPropagation(); cancel();
      } else if (event.key === 'Enter') {
        event.preventDefault(); onSelect?.(event.shiftKey);
      } else if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
        event.preventDefault();
        if (!selected) onSelect?.();
        const rect = event.currentTarget.getBoundingClientRect();
        onMenu(clip, rect.left, rect.bottom);
      }
    }}
    onDoubleClick={event => event.stopPropagation()}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault(); event.stopPropagation();
      if (!selected || event.shiftKey || track.locked) onSelect?.(event.shiftKey);
      if (track.locked || event.shiftKey) return;
      const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-audio-trim]')?.dataset.audioTrim as AudioTrimEdge | undefined;
      if (edge && selected) onSelect?.();
      event.currentTarget.focus({ preventScroll: true });
      const active: AudioDrag = {
        pointer: event.pointerId, x: event.clientX, scroll: event.currentTarget.closest('.arrangement-scroll')?.scrollLeft ?? 0,
        origin: edge === 'end' ? audioClipEnd(project, clip) : clip.start, owner: project, edge, scale, step, stop: () => {},
      };
      drag.current = active;
      const stop = captureEditorPointer(event.currentTarget, event.pointerId, cancel);
      if (drag.current === active) active.stop = stop; else stop();
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (!active || event.pointerId !== active.pointer) return;
      const tick = dragTick(active, event.clientX, event.currentTarget);
      if (active.edge) {
        const range = planAudioTrim(clip, timing, active.edge, tick, audioSourceDuration(project, clip, peaks?.duration));
        setPreview(range ? audioClipWithRange(clip, range) : undefined);
      } else setPreview(tick === clip.start ? undefined : { ...clip, start: tick });
    }}
    onPointerUp={event => {
      const active = drag.current;
      if (!active || event.pointerId !== active.pointer) return;
      const tick = dragTick(active, event.clientX, event.currentTarget);
      cancel();
      if (project !== active.owner) return;
      if (active.edge) {
        if (tick !== active.origin) onTrim?.(clip.id, active.edge, tick);
        return;
      }
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (onChordDrop && hit?.closest('[data-chord-track]')) { onChordDrop(); return; }
      const target = hit?.closest('[data-track-id]')?.getAttribute('data-track-id') ?? clip.trackId;
      const row = project.tracks.find(t => t.id === target);
      if (Number.isFinite(tick) && row?.kind === 'audio' && !row.audioGroup && !row.locked && (tick !== clip.start || target !== clip.trackId)) onMove(clip.id, tick, target);
      else if (selected) onSelect?.();
    }}
    onPointerCancel={event => { if (drag.current?.pointer === event.pointerId) cancel(); }}
    onLostPointerCapture={event => { if (drag.current?.pointer === event.pointerId) cancel(); }}>
    <strong className="audio-region-title">
      <span>{clip.muted ? '静音 · ' : ''}{clip.name}{!peaks && ' · 正在读取波形…'}</span>
      {clip.tempoAnalysis && width >= 136 && <small>{clip.tempoAnalysis.stable === false ? '≈ ' : ''}{clip.tempoAnalysis.bpm} BPM</small>}
    </strong>
    {firstBeat !== undefined && <span className="audio-region-first-beat" aria-hidden="true"
      style={{ left: (timing.tick(startSeconds + firstBeat) - shown.start) * scale }} />}
    <svg style={{ left: waveLeft, width: waveWidth }} viewBox={`0 0 ${Math.max(1, waveWidth)} 32`} preserveAspectRatio="none" aria-label="音频波形" data-waveform-ready={!!peaks}>
      <line x1="0" y1="16" x2={waveWidth} y2="16" stroke="currentColor" opacity=".25"/>
      <path d={waveform} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 1 }}/>
    </svg>
    {!!chords?.length && <div className="audio-region-chords" aria-label="片段和弦">{chords.map(chord => {
      const start = (timing.tick(startSeconds + chord.start) - shown.start) * scale;
      const end = (timing.tick(startSeconds + Math.min(shown.durationSeconds, chord.end)) - shown.start) * scale;
      return end >= waveLeft && start <= waveLeft + waveWidth && end > start
        ? <span key={chord.id} style={{ left: start, width: end - start }} title={chord.name}>{chord.name}</span> : null;
    })}</div>}
    {onTrim && !track.locked && <>
      <span className="audio-region-resize start" data-audio-trim="start" title="调整音频片段开始边界"/>
      <span className="audio-region-resize end" data-audio-trim="end" title="调整音频片段结束边界"/>
    </>}
  </div>;
}
