import type { Project } from './types';
import { createTempoMap, type TempoMap } from './time';
import { projectEnd } from './project';

export interface WaveformLevel { minimum: Float32Array; maximum: Float32Array }
export interface WaveformPeaks { duration: number; values: Float32Array; levels?: WaveformLevel[] }
/** Signed PCM envelope, pooled across channels without phase cancellation.
 * Base bins cover ~128 frames; coarser levels preserve every transient. */
export function pcmWaveformPeaks(channels: readonly Float32Array[], sampleRate: number): WaveformPeaks {
  const frames=channels[0]?.length??0, count=Math.min(1048576,Math.ceil(frames/128));
  const minimum=new Float32Array(count),maximum=new Float32Array(count),values=new Float32Array(count);
  minimum.fill(Infinity);maximum.fill(-Infinity);
  for(const channel of channels)for(let frame=0;frame<frames;frame++){
    const bin=Math.min(count-1,Math.floor(frame*count/frames)),sample=Number.isFinite(channel[frame])?channel[frame]:0;
    minimum[bin]=Math.min(minimum[bin],sample);maximum[bin]=Math.max(maximum[bin],sample);
  }
  for(let i=0;i<count;i++){if(!Number.isFinite(minimum[i]))minimum[i]=maximum[i]=0;values[i]=Math.max(Math.abs(minimum[i]),Math.abs(maximum[i]));}
  const levels:WaveformLevel[]=[{minimum,maximum}];
  while(levels.at(-1)!.minimum.length>1){
    const previous=levels.at(-1)!,length=Math.ceil(previous.minimum.length/2),lo=new Float32Array(length),hi=new Float32Array(length);
    for(let i=0;i<length;i++){const last=Math.min(i*2+1,previous.minimum.length-1);lo[i]=Math.min(previous.minimum[i*2],previous.minimum[last]);hi[i]=Math.max(previous.maximum[i*2],previous.maximum[last]);}
    levels.push({minimum:lo,maximum:hi});
  }
  return {duration:frames/sampleRate,values,levels};
}
/** Range maxima, never isolated point samples. Level selection bounds work per pixel. */
export function waveformEnvelope(peaks:WaveformPeaks,from:number,to:number):{minimum:number;maximum:number}{
  if(!peaks.values.length||to<=0||from>=peaks.duration||to<=from)return {minimum:0,maximum:0};
  const levels=peaks.levels;
  let minimum=0,maximum=0;
  if(levels?.length){
    let level=0;
    // Level widths are based on paired base bins, not equal subdivisions of odd levels.
    const base=peaks.values.length,span=(to-from)/peaks.duration*base;
    while(level+1<levels.length&&2**(level+1)<=span)level++;
    const data=levels[level],first=Math.max(0,Math.floor(from/peaks.duration*base/2**level)),last=Math.min(data.minimum.length,Math.ceil(to/peaks.duration*base/2**level));
    minimum=Infinity;maximum=-Infinity;
    for(let i=first;i<last;i++){minimum=Math.min(minimum,data.minimum[i]);maximum=Math.max(maximum,data.maximum[i]);}
    if(!Number.isFinite(minimum))return {minimum:0,maximum:0};
  }else{
    const first=Math.max(0,Math.floor(from/peaks.duration*peaks.values.length)),last=Math.min(peaks.values.length,Math.ceil(to/peaks.duration*peaks.values.length));
    for(let i=first;i<last;i++)maximum=Math.max(maximum,peaks.values[i]);minimum=-maximum;
  }
  return {minimum:Math.max(-1,minimum),maximum:Math.min(1,maximum)};
}
/** Peaks include every channel, including a silent left / audible right stereo file. */
export function waveformPeaks(channels: readonly Float32Array[], sampleRate: number, bins = 16384): WaveformPeaks {
  const frames = channels[0]?.length ?? 0, count = Math.min(bins, frames), values = new Float32Array(count);
  for (const channel of channels) for (let frame = 0; frame < frames; frame++) {
    const bin = Math.min(count - 1, Math.floor(frame * count / frames));
    values[bin] = Math.max(values[bin], Math.abs(channel[frame] ?? 0));
  }
  return { duration: frames / sampleRate, values };
}
export function referenceEndTick(project: Project, duration: number): number {
  const timing = createTempoMap(project);
  return project.reference ? timing.tick(timing.seconds(project.reference.startTick) + Math.max(0, duration)) : 0;
}
export const playbackEndTick = (project: Project, duration = 0): number => Math.max(projectEnd(project), referenceEndTick(project, duration));

/** A reference remains at its original speed. Tempo changes only change its position on a beat grid. */
export function waveformAmplitude(peaks: WaveformPeaks, timing: TempoMap, startTick: number, leftTick: number, rightTick: number): number {
  const offset = timing.seconds(startTick), from = timing.seconds(leftTick) - offset, to = timing.seconds(rightTick) - offset;
  if (!peaks.values.length || to <= 0 || from >= peaks.duration) return 0;
  const first = Math.max(0, Math.floor(from / peaks.duration * peaks.values.length));
  const last = Math.min(peaks.values.length, Math.max(first + 1, Math.ceil(to / peaks.duration * peaks.values.length)));
  let amplitude = 0;
  for (let i = first; i < last; i++) amplitude = Math.max(amplitude, peaks.values[i]);
  return amplitude;
}
/** One occurrence, cut at the project loop boundary without allocating a silent full-length buffer. */
export function referenceSegment(offset: number, duration: number, from: number, end: number): { delay: number; offset: number; duration: number } | undefined {
  const start = Math.max(from, offset, 0), finish = Math.min(end, offset + duration);
  if (finish <= start) return;
  return { delay: start - from, offset: start - offset, duration: finish - start };
}
