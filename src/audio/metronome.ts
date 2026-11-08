import { createMeterMap, type MeterMap, type MeterProject } from '../core/meter';
import type { TransportClock } from '../core/transport';

interface Click { at: number; accent: boolean }
const timeTolerance = (time: number) => Math.max(1e-9, Math.abs(time) * Number.EPSILON * 4);

/** Project seconds increase across repetitions, just as they do for note scheduling. */
export function nextMetronomeClick(meter: MeterMap, clock: TransportClock, from: number): Click | undefined {
  const { timing, endTick, loop } = clock, startTick = clock.startTick ?? 0;
  const start = timing.seconds(startTick), end = timing.seconds(endTick), period = end - start;
  if (period <= 0) return;
  const cycle = loop ? Math.max(0, Math.floor((from - start) / period)) : 0;
  const find = (offset: number, seconds: number): Click | undefined => {
    const tick = Math.max(startTick, timing.tick(seconds)), bar = meter.at(tick);
    let beat = Math.max(0, Math.floor((tick - bar.barStart) / bar.beatTicks));
    let candidate = bar.barStart + beat * bar.beatTicks;
    if (timing.seconds(candidate) < seconds - timeTolerance(seconds) || candidate < startTick) {
      candidate = bar.barStart + ++beat * bar.beatTicks;
    }
    // A signature change can cut a bar short. The new signature starts with a downbeat.
    const downbeat = candidate >= bar.barEnd;
    candidate = Math.min(candidate, bar.barEnd);
    if (candidate >= endTick) return;
    return { at: timing.seconds(candidate) + offset, accent: downbeat || beat === 0 };
  };
  const offset = cycle * period;
  return find(offset, Math.max(start, from - offset)) ?? (loop ? find(offset + period, start) : undefined);
}

/** Monitor clicks use their own live output and never enter an offline render. */
export class PlaybackMetronome {
  private enabled = false;
  private project?: MeterProject;
  private meter?: MeterMap;
  private clock?: TransportClock;
  private next = 0;
  private voices = new Set<OscillatorNode>();

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clearClicks();
  }

  configure(project: MeterProject, clock: TransportClock) {
    this.clearClicks();
    if (project.ppq !== this.project?.ppq || project.timeSignatures !== this.project?.timeSignatures) this.meter = undefined;
    this.project = project;
    this.clock = clock;
  }

  stop() {
    this.clearClicks();
    this.project = this.clock = this.meter = undefined;
  }

  private clearClicks() {
    for (const voice of this.voices) voice.stop();
    this.voices.clear();
    this.next = 0;
  }

  pump(context: AudioContext) {
    const { clock, project } = this;
    if (!this.enabled || !clock || !project) return;
    const meter = this.meter ??= createMeterMap(project);
    const now = context.currentTime - clock.startedAt + clock.from;
    for (;;) {
      const click = nextMetronomeClick(meter, clock, Math.max(this.next, now, clock.from));
      if (!click || click.at > now + .15) return;
      // Extremely dense imported grids cannot stack hundreds of overlapping clicks.
      this.next = click.at + Math.max(.025, 2 * timeTolerance(click.at));
      const when = Math.max(context.currentTime, clock.startedAt + click.at - clock.from);
      const voice = context.createOscillator(), envelope = context.createGain();
      voice.type = 'sine';
      voice.frequency.value = click.accent ? 1500 : 1000;
      envelope.gain.setValueAtTime(click.accent ? .16 : .09, when);
      envelope.gain.exponentialRampToValueAtTime(.001, when + .023);
      voice.connect(envelope); envelope.connect(context.destination);
      this.voices.add(voice);
      voice.onended = () => { this.voices.delete(voice); voice.disconnect(); envelope.disconnect(); };
      voice.start(when); voice.stop(when + .024);
    }
  }
}
