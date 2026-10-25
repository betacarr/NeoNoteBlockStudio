import { useLayoutEffect, useRef } from 'react';
import { waveformAmplitude, type WaveformPeaks } from '../core/reference';
import type { TempoMap } from '../core/time';

interface Props { peaks?: WaveformPeaks; timing: TempoMap; startTick: number; scale: number; left: number; width: number }
/** Only the visible arrangement viewport is rasterized; the beat grid remains the shared scroll surface. */
export function ReferenceWaveform({ peaks, timing, startTick, scale, left, width }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1, height = 52;
    canvas.width = Math.ceil(width * dpr); canvas.height = height * dpr;
    const c = canvas.getContext('2d')!; c.scale(dpr, dpr); c.clearRect(0, 0, width, height);
    if (!peaks) return;
    c.strokeStyle = '#90bfd1'; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x < width; x++) {
      const amplitude = waveformAmplitude(peaks, timing, startTick, (left + x) / scale, (left + x + 1) / scale) * 15;
      if (amplitude) { c.moveTo(x + .5, 31 - amplitude); c.lineTo(x + .5, 31 + amplitude); }
    }
    c.stroke();
  }, [peaks, timing, startTick, scale, left, width]);
  return <canvas className="reference-waveform" ref={ref} aria-label="参考音频波形，与编曲时间轴对齐" style={{ left, width, height: 52 }} />;
}
