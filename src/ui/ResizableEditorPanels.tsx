import { useId, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { clamp } from '../core/project';

type EditorPanel = 'arrangement' | 'piano';
interface Props { arrangement: ReactNode; piano: ReactNode; minimumTop?: number; minimumBottom?: number; activePanel?: EditorPanel; onActivePanel?: (panel: EditorPanel) => void; }
const HANDLE = 9, DEFAULT_RATIO = .4, STORAGE_KEY = 'nbsx-editor-split';
const readRatio = () => {
  try { const value = Number(localStorage.getItem(STORAGE_KEY)); return value > 0 && value < 1 ? value : DEFAULT_RATIO; }
  catch { return DEFAULT_RATIO; }
};

export function ResizableEditorPanels({ arrangement, piano, minimumTop = 150, minimumBottom = 230, activePanel, onActivePanel }: Props) {
  const element = useRef<HTMLDivElement>(null), drag = useRef<{ pointer: number; position: number; height: number } | null>(null);
  const [height, setHeight] = useState(minimumTop + minimumBottom + HANDLE), [ratio, setRatio] = useState(readRatio), [dragging, setDragging] = useState(false);
  const panelId = useId(), available = Math.max(minimumTop + minimumBottom, height - HANDLE);
  const maximum = available - minimumBottom, top = clamp(available * ratio, minimumTop, maximum);
  const resize = (next: number) => {
    const nextRatio = clamp(next, minimumTop, maximum) / available;
    setRatio(nextRatio);
    try { localStorage.setItem(STORAGE_KEY, String(nextRatio)); } catch { /* Resizing still works when preferences cannot be stored. */ }
  };
  const finish = (target: HTMLDivElement, pointer: number) => {
    if (drag.current?.pointer !== pointer) return;
    drag.current = null; setDragging(false);
    if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
  };
  const activate = (panel: EditorPanel, event: PointerEvent<HTMLDivElement>) => {
    onActivePanel?.(panel);
    const control = (event.target as Element).closest('button,input,select,textarea,a[href],[tabindex],[contenteditable]:not([contenteditable="false"]),[role="button"],[role="slider"],[role="scrollbar"]');
    // Title/blank clicks release an inspector's text focus. Controls retain
    // their own default focusing, range keys and pointer handling.
    if (!control || control === event.currentTarget || !event.currentTarget.contains(control)) event.currentTarget.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    const container = element.current; if (!container) return;
    const measure = () => setHeight(container.clientHeight);
    const observer = new ResizeObserver(measure); observer.observe(container); measure();
    return () => observer.disconnect();
  }, []);

  return <div className={`editor-panels ${dragging ? 'resizing' : ''}`} ref={element} style={{ minHeight: minimumTop + minimumBottom + HANDLE, gridTemplateRows: `${top}px ${HANDLE}px minmax(0, 1fr)` }}>
    <div className="arrangement-panel" id={`${panelId}-arrangement`} role="region" aria-label="编曲编辑面板" tabIndex={-1} data-editor-area="arrangement" data-active={activePanel === 'arrangement'} onPointerDownCapture={event => activate('arrangement', event)} onFocusCapture={() => onActivePanel?.('arrangement')}>{arrangement}</div>
    <div className="editor-splitter" role="separator" tabIndex={0} aria-label="调整编曲区与钢琴卷帘高度" aria-orientation="horizontal" aria-controls={`${panelId}-arrangement ${panelId}-piano`} aria-valuemin={Math.round(minimumTop)} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(top)} aria-valuetext={`编曲区 ${Math.round(top)} 像素，钢琴卷帘 ${Math.round(available - top)} 像素`}
      title="拖动调整编曲区与钢琴卷帘高度；方向键微调，双击恢复默认"
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, position: event.clientY, height: top }; setDragging(true);
      }}
      onPointerMove={event => { const active = drag.current; if (active?.pointer === event.pointerId) resize(active.height + event.clientY - active.position); }}
      onPointerUp={event => finish(event.currentTarget, event.pointerId)} onPointerCancel={event => finish(event.currentTarget, event.pointerId)} onLostPointerCapture={event => finish(event.currentTarget, event.pointerId)}
      onDoubleClick={() => resize(available * DEFAULT_RATIO)}
      onKeyDown={event => {
        const step = event.shiftKey ? 48 : 12;
        if (event.key === 'ArrowUp') resize(top - step);
        else if (event.key === 'ArrowDown') resize(top + step);
        else if (event.key === 'Home') resize(minimumTop);
        else if (event.key === 'End') resize(maximum);
        else if (event.key === 'Enter') resize(available * DEFAULT_RATIO);
        else return;
        event.preventDefault(); event.stopPropagation();
      }}><span /></div>
    <div className="piano-panel" id={`${panelId}-piano`} role="region" aria-label="钢琴编辑面板" tabIndex={-1} data-editor-area="piano" data-active={activePanel === 'piano'} onPointerDownCapture={event => activate('piano', event)} onFocusCapture={() => onActivePanel?.('piano')}>{piano}</div>
  </div>;
}
