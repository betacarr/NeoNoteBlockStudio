import { useEffect, type RefObject } from 'react';

export function NativeGlassTheme({ root, onUnavailable }: { root: RefObject<HTMLElement | null>; onUnavailable: () => void }) {
  useEffect(() => {
    const studio = root.current, bar = studio?.querySelector('.control-bar'), update = window.desktop?.setNativeGlass;
    if (!studio || !bar || !update) { onUnavailable(); return; }
    let active = true, frame = 0, previous = '';
    const schedule = () => {
      if (frame || !active) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const { x, y, width, height } = bar.getBoundingClientRect();
        const key = [x, y, width, height, devicePixelRatio].join(':');
        if (key === previous || width <= 0 || height <= 0) return;
        previous = key;
        const finish = (ok: boolean) => {
          if (!active) return;
          if (ok) studio.dataset.nativeGlass = 'active';
          else { delete studio.dataset.nativeGlass; onUnavailable(); }
        };
        void update({ x, y, width, height }).then(finish, () => finish(false));
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(bar); observer.observe(studio);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      active = false; cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('resize', schedule);
      delete studio.dataset.nativeGlass;
      void update(null).catch(() => {});
    };
  }, [root, onUnavailable]);
  return null;
}
