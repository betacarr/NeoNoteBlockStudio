import type { Asset, Project } from '../core/types';
import { base64ToBytes } from '../core/container';
import { createTempoMap } from '../core/time';
import { audioTrackParents } from '../core/audio-clips';
import { assertPlaybackLoopPeriod } from '../core/transport';
import { referenceSegment, pcmWaveformPeaks, type WaveformPeaks } from '../core/reference';

/** One project transport clock; ordinary audio plays at its recorded speed. */
export class TimelineAudio {
  private buffers = new Map<string,{ key:string; buffer:AudioBuffer; peaks:WaveformPeaks }>();
  private voices = new Map<AudioBufferSourceNode,{gain:GainNode;pans:StereoPannerNode[];trackId:string;clipId:string}>();
  private generation = 0;
  private currentProject?:Project;
  peaks(assetId:string) { return this.buffers.get(assetId)?.peaks; }
  private loadingKey='';
  private loading?:Promise<void>;
  load(project:Project,context:AudioContext):Promise<void>{
    const key=JSON.stringify((project.audioClips??[]).map(c=>project.assets.find(a=>a.id===c.assetId)));
    if(this.loading&&this.loadingKey===key)return this.loading;
    this.loadingKey=key;const promise=this.loadAll(project,context);this.loading=promise;
    void promise.finally(()=>{if(this.loading===promise)this.loading=undefined;}).catch(()=>{});return promise;
  }
  private async loadAll(project:Project, context:AudioContext):Promise<void> {
    const ticket=++this.generation, wanted=new Set((project.audioClips??[]).map(c=>c.assetId));
    let estimate=0;
    for(const id of wanted){const a=project.assets.find(a=>a.id===id);estimate+=(a?.audioFile?.frames??0)*(a?.audioFile?.channels??2)*4;}
    if(estimate>1.5*1024**3)throw new Error('同时加载的音频片段超过 1.5 GiB 解码预算，请缩短或拆分工程。');
    for(const id of wanted){
      const asset=project.assets.find(a=>a.id===id);if(!asset)throw new Error('音频片段资源缺失。');
      const key=asset.audioFile?.sha256??asset.data??'';if(this.buffers.get(id)?.key===key)continue;
      let encoded:ArrayBuffer;
      if(asset.data){const bytes=base64ToBytes(asset.data);encoded=Uint8Array.from(bytes).buffer;}
      else if(asset.audioFile&&window.desktop?.resolveAudioAsset){
        const url=new URL(await window.desktop.resolveAudioAsset(asset.audioFile));
        if(url.protocol!=='nbsx:'||url.hostname!=='app'||!/^\/audio-assets\/[\w-]+$/.test(url.pathname)||url.search||url.hash)throw new Error('音频资源地址无效。');
        const response=await fetch(url);if(!response.ok)throw new Error('音频素材缺失，请右键重新定位。');encoded=await response.arrayBuffer();
        if(encoded.byteLength!==asset.audioFile.bytes)throw new Error('音频资源大小不符，请重新定位。');
      }else throw new Error('音频素材缺失，请右键重新定位。');
      if(ticket!==this.generation)return;
      const buffer=await context.decodeAudioData(encoded);
      if(asset.audioFile&&Math.abs(buffer.duration-asset.audioFile.frames/asset.audioFile.sampleRate)>2/buffer.sampleRate)throw new Error('音频资源长度不符。');
      if(ticket!==this.generation)return;
      this.buffers.set(id,{key,buffer,peaks:pcmWaveformPeaks(Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)),buffer.sampleRate)});
    }
    if(ticket===this.generation)for(const id of this.buffers.keys())if(!wanted.has(id))this.buffers.delete(id);
  }
  private mix(project:Project, trackId:string, clipId:string) {
    const track=project.tracks.find(t=>t.id===trackId),clip=project.audioClips?.find(c=>c.id===clipId);
    const path = track ? [track, ...audioTrackParents(project.tracks, track)] : [];
    const audible = path.length && clip && !clip.muted && !path.some(t => t.muted)
      && (!project.tracks.some(t => t.solo) || path.some(t => t.solo));
    return { gain: audible ? path.reduce((value, t) => value * t.volume, project.audio.masterGain) : 0, path };
  }
  update(project:Project){
    this.currentProject = project;
    for (const voice of this.voices.values()) {
      const mix = this.mix(project, voice.trackId, voice.clipId);
      voice.gain.gain.value = mix.gain;
      voice.pans.forEach((pan, index) => { pan.pan.value = mix.path[index]?.pan ?? 0; });
    }
  }
  schedule(project:Project,context:BaseAudioContext,output:AudioNode|((trackId:string)=>AudioNode),when:number,from:number,loop:boolean,end:number,start=0):()=>void {
    this.currentProject=project;
    const timing=createTempoMap(project),period=end-start;
    if(loop)assertPlaybackLoopPeriod(period);
    if(!Number.isFinite(period)||period<=0)throw new Error('音频循环范围无效。');
    const enqueue=(cycle:number,localFrom:number)=>{
      const at=when+cycle*period+localFrom-from,late=Math.max(0,context.currentTime-at);
      for(const clip of project.audioClips??[]){
        const buffer=this.buffers.get(clip.assetId)?.buffer;if(!buffer)throw new Error('音频片段尚未加载。');
        const segment=referenceSegment(timing.seconds(clip.start),clip.durationSeconds,localFrom+late,end);if(!segment)continue;
        const source = context.createBufferSource(), gain = context.createGain();
        source.buffer = buffer;
        const mix = this.mix(this.currentProject?.id === project.id ? this.currentProject : project, clip.trackId, clip.id);
        gain.gain.value = mix.gain;
        source.connect(gain);
        let node: AudioNode = gain;
        const pans = mix.path.map(track => {
          const pan = context.createStereoPanner();
          pan.pan.value = track.pan;
          node.connect(pan);
          node = pan;
          return pan;
        });
        node.connect(typeof output === 'function' ? output(clip.trackId) : output);
        this.voices.set(source, { gain, pans, trackId: clip.trackId, clipId: clip.id });
        source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect(); pans.forEach(pan => pan.disconnect()); };
        source.start(at+late+segment.delay,clip.offsetSeconds+segment.offset,segment.duration);
      }
    };
    const cycle=loop?Math.max(0,Math.floor((from-start)/period)):0;enqueue(cycle,from-cycle*period);let next=cycle+1;
    return ()=>{if(loop)while(start+next*period<=context.currentTime-when+from+.15){enqueue(next,start);next++;}};
  }
  clear(){this.generation++;this.loading=undefined;this.stop();this.buffers.clear();}
  stop(){for(const [s,v] of this.voices){try{s.stop();}catch{}s.disconnect();v.gain.disconnect();v.pans.forEach(pan=>pan.disconnect());}this.voices.clear();}
}
