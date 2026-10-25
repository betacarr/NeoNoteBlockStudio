import type { Note } from '../core/types';

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

const finitePoint = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y);
const validRect = (rect: Rect) => finitePoint(rect) && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width >= 0 && rect.height >= 0 && Number.isFinite(rect.x + rect.width) && Number.isFinite(rect.y + rect.height);

/** Point clicks select only the topmost note in paint order. */
export function noteAt<T extends Note>(notes: readonly T[], x: number, y: number, rectFor: (note: T) => Rect): T | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i], rect = rectFor(note);
    if (validRect(rect) && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) return note;
  }
}

/** Closed slab intersection; rectangle edges and corners count as contact. */
function clipSegment(from: Point, to: Point, rect: Rect): [Point, Point] | undefined {
  if (!finitePoint(from) || !finitePoint(to) || !validRect(rect)) return;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  let enter = 0, exit = 1;
  for (const [origin, delta, minimum, maximum] of [[from.x, dx, rect.x, rect.x + rect.width], [from.y, dy, rect.y, rect.y + rect.height]]) {
    if (delta === 0) { if (origin < minimum || origin > maximum) return; }
    else {
      const a = (minimum - origin) / delta, b = (maximum - origin) / delta;
      enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) return;
    }
  }
  return [{ x: from.x + dx * enter, y: from.y + dy * enter }, { x: from.x + dx * exit, y: from.y + dy * exit }];
}

/** Sweep all contacted layers in input order; callers supply a shared scroll space.
 * Bounds exclude the keyboard, ruler and velocity lane. Ignored IDs stay excluded.
 * A stationary event returns nothing: the initial point click belongs to noteAt.
 */
export function notesAlongStroke<T extends Note>(notes: readonly T[], from: Point, to: Point, rectFor: (note: T) => Rect, bounds: Rect, ignored: ReadonlySet<string>): T[] {
  if (from.x === to.x && from.y === to.y) return [];
  const clipped = clipSegment(from, to, bounds);
  if (!clipped) return [];
  const result: T[] = [];
  for (const note of notes) if (!ignored.has(note.id) && clipSegment(clipped[0], clipped[1], rectFor(note))) result.push(note);
  return result;
}
