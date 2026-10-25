import type { Note } from '../core/types';

export const PIANO_MIN_ZOOM = 1e-12;
export const PIANO_MAX_ZOOM = 220;
export const PIANO_MIN_ROW_HEIGHT = .25, PIANO_MAX_ROW_HEIGHT = 48, PIANO_DEFAULT_ROW_HEIGHT = 18;
const DEFAULT_ZOOM = 72, DEFAULT_ROW_HEIGHT = PIANO_DEFAULT_ROW_HEIGHT;

export function clampPianoZoom(value: number): number {
  return Math.min(PIANO_MAX_ZOOM, Math.max(PIANO_MIN_ZOOM, Number.isNaN(value) ? DEFAULT_ZOOM : value));
}

export function clampPianoRowHeight(value: number): number {
  return Math.min(PIANO_MAX_ROW_HEIGHT, Math.max(PIANO_MIN_ROW_HEIGHT, Number.isNaN(value) ? DEFAULT_ROW_HEIGHT : value));
}

/** Keep the pitch beneath the anchor fixed; grid edges take precedence. */
export function planPianoRowZoom(rowHeight: number, nextRowHeight: number, scrollY: number, height: number, anchor = height / 2) {
  const previous = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : DEFAULT_ROW_HEIGHT;
  const next = clampPianoRowHeight(nextRowHeight);
  const viewport = Number.isFinite(height) ? Math.max(1, height) : 1;
  const at = Number.isFinite(anchor) ? Math.min(viewport, Math.max(0, anchor)) : viewport / 2;
  const y = ((Number.isFinite(scrollY) ? scrollY : 0) + at) * next / previous - at;
  return { rowHeight: next, y: Math.max(0, Math.min(Math.max(0, next * 128 - viewport), y)) };
}

export interface PianoViewInput {
  notes: readonly Note[];
  ppq: number;
  width: number;
  height: number;
  zoom: number;
  mode: 'locate' | 'fit';
  startTick?: number;
}
export interface PianoViewPlan { x: number; y: number; zoom: number; rowHeight: number }

/** Pure grid-space scroll/zoom plan; callers exclude the piano keys and other lanes. */
export function planPianoView(input: PianoViewInput): PianoViewPlan {
  const ppq = Number.isFinite(input.ppq) && input.ppq > 0 ? input.ppq : 480;
  const width = Number.isFinite(input.width) ? Math.max(1, input.width) : 1;
  const height = Number.isFinite(input.height) ? Math.max(1, input.height) : 1;
  let firstTick = Infinity, endTick = -Infinity, minimumPitch = 127, maximumPitch = 0;
  for (const note of input.notes) {
    firstTick = Math.min(firstTick, note.tick); endTick = Math.max(endTick, note.tick + note.duration);
    minimumPitch = Math.min(minimumPitch, note.midi); maximumPitch = Math.max(maximumPitch, note.midi);
  }
  const empty = input.notes.length === 0;
  if (empty) { firstTick = 0; minimumPitch = maximumPitch = 60; }
  const pitchSpan = maximumPitch - minimumPitch + 1;
  const rowHeight = empty ? DEFAULT_ROW_HEIGHT : Math.min(DEFAULT_ROW_HEIGHT, height / (pitchSpan + 4));
  const zoom = empty ? DEFAULT_ZOOM : input.mode === 'fit'
    ? clampPianoZoom((width - 48) * ppq / Math.max(endTick - firstTick, 4 * ppq))
    : clampPianoZoom(input.zoom < 24 ? DEFAULT_ZOOM : input.zoom);
  // Fit always shows the entire supplied envelope; startTick is a locate/empty hint.
  const tick = (empty || input.mode === 'locate') && Number.isFinite(input.startTick) ? input.startTick! : firstTick;
  const x = Math.max(0, tick * zoom / ppq - 24);
  const centerRow = 127 - (minimumPitch + maximumPitch) / 2 + .5;
  const y = Math.max(0, Math.min(Math.max(0, 128 * rowHeight - height), centerRow * rowHeight - height / 2));
  return { x, y, zoom, rowHeight };
}
