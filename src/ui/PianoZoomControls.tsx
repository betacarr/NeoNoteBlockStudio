import { Minus, Plus } from '@phosphor-icons/react';
import { clampPianoZoom, clampPianoRowHeight, PIANO_MAX_ZOOM, PIANO_DEFAULT_ROW_HEIGHT, PIANO_MIN_ROW_HEIGHT, PIANO_MAX_ROW_HEIGHT } from './piano-view';

export function PianoZoomControls({ zoom, rowHeight, onZoom, onRowHeight, disabled }: {
  zoom: number; rowHeight: number; onZoom: (value: number) => void; onRowHeight: (value: number) => void; disabled?: boolean;
}) {
  const verticalLabel = `${Math.round(rowHeight / PIANO_DEFAULT_ROW_HEIGHT * 100)}%，每半音 ${rowHeight.toFixed(1)} 像素`;
  return <div className="piano-zoom-controls">
    <div className="piano-zoom-axis" role="group" aria-label="横向时间缩放">
      <button disabled={disabled} aria-label="重置钢琴卷帘横向缩放" title="横向：点击恢复默认时间比例" onClick={() => onZoom(72)}>横向</button>
      <button disabled={disabled} aria-label="缩小钢琴卷帘" title="横向缩小" onClick={() => onZoom(clampPianoZoom(zoom / 1.2))}><Minus size={13} /></button>
      <input disabled={disabled} aria-label="钢琴卷帘缩放" title="横向时间缩放 · Ctrl / Cmd＋滚轮" type="range" min={Math.log2(Math.min(2, zoom))} max={Math.log2(PIANO_MAX_ZOOM)} step=".01" value={Math.log2(zoom)} aria-valuetext={`${Math.round(zoom / 72 * 100)}%`} onChange={event => onZoom(clampPianoZoom(2 ** +event.currentTarget.value))} />
      <button disabled={disabled} aria-label="放大钢琴卷帘" title="横向放大" onClick={() => onZoom(clampPianoZoom(zoom * 1.2))}><Plus size={13} /></button>
    </div>
    <div className="piano-zoom-axis" role="group" aria-label="纵向音高缩放">
      <button disabled={disabled} aria-label="重置钢琴卷帘纵向缩放" title="纵向：点击恢复默认行高" onClick={() => onRowHeight(PIANO_DEFAULT_ROW_HEIGHT)}>纵向</button>
      <button disabled={disabled} aria-label="缩小钢琴卷帘纵向" title="减小音高行距" onClick={() => onRowHeight(clampPianoRowHeight(rowHeight / 1.2))}><Minus size={13} /></button>
      <input disabled={disabled} aria-label="钢琴卷帘纵向缩放" title={`${verticalLabel} · Ctrl / Cmd＋Shift＋滚轮`} type="range" min={Math.log2(Math.min(PIANO_MIN_ROW_HEIGHT, rowHeight))} max={Math.log2(PIANO_MAX_ROW_HEIGHT)} step=".01" value={Math.log2(rowHeight)} aria-valuetext={verticalLabel} onChange={event => onRowHeight(clampPianoRowHeight(2 ** +event.currentTarget.value))} />
      <button disabled={disabled} aria-label="放大钢琴卷帘纵向" title="增大音高行距" onClick={() => onRowHeight(clampPianoRowHeight(rowHeight * 1.2))}><Plus size={13} /></button>
    </div>
  </div>;
}
