import { waveformEnvelope, type WaveformPeaks } from '../core/reference';
import type { TempoMap } from '../core/time';
/** One real envelope range per visible CSS pixel, with source offset and tempo mapping. */
export function audioWaveformPath(peaks:WaveformPeaks,timing:TempoMap,start:number,offset:number,duration:number,scale:number,left:number,width:number){
  const origin=timing.seconds(start);let path='';
  for(let pixel=0;pixel<Math.ceil(width);pixel++){
    const from=timing.seconds(start+(left+pixel)/scale)-origin,to=timing.seconds(start+(left+pixel+1)/scale)-origin;
    if(from>=duration)break;
    const envelope=waveformEnvelope(peaks,offset+Math.max(0,from),offset+Math.min(duration,to));
    const top=16-envelope.maximum*14,bottom=16-envelope.minimum*14;
    if(envelope.minimum!==0||envelope.maximum!==0)path+=`M${pixel+.5},${top.toFixed(3)}V${Math.max(top+.1,bottom).toFixed(3)} `;
  }
  return path;
}
