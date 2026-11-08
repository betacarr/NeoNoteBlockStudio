import json,zipfile,io,math,sys
from pathlib import Path
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly
root=Path(sys.argv[1]);channel=1 if '--right' in sys.argv else 0;key='right' if channel else 'left';suffix='-right' if channel else '';c=json.loads((root/'live-capture.json').read_text(encoding="utf-8"));meta=json.loads((root/'report.json').read_text(encoding="utf-8"));rate=c['chunks'][0]['rate'];first=min(chunk['frame'] for chunk in c['chunks']);last=max(chunk['frame']+len(chunk[key]) for chunk in c['chunks']);actual=np.zeros(last-first,dtype=np.float32)
# A seek replaces the master graph: preserve render-frame silence gaps and sum
# overlapping old/new graph blocks, rather than concatenating message arrival order.
for chunk in c['chunks']:actual[chunk['frame']-first:chunk['frame']-first+len(chunk[key])]+=chunk[key]
expected=np.zeros(len(actual),dtype=np.float32)
with zipfile.ZipFile(root/'real-stems.nbsx') as z:
 p=json.loads(z.read('project.json'));buffers=[]
 for clip in p['audioClips']:
  sr,pcm=wavfile.read(io.BytesIO(z.read('assets/'+clip['assetId'])));pcm=pcm[:,min(channel,pcm.shape[1]-1)] if pcm.ndim>1 else pcm
  if pcm.dtype.kind!='f':pcm=pcm.astype(np.float32)/2**(8*pcm.dtype.itemsize-1)
  g=math.gcd(sr,rate);buffers.append(resample_poly(pcm,rate//g,sr//g))
for i,event in enumerate(c['starts']):
 if not buffers:break
 index=i%len(buffers);clip=p['audioClips'][index];track=next(t for t in p['tracks'] if t['id']==clip['trackId']);parent=next((t for t in p['tracks'] if t['id']==track.get('parentTrackId')),{});solo=any(t['solo'] for t in p['tracks'])
 gain=0 if track['muted'] or parent.get('muted') or clip.get('muted') or solo and not(track['solo'] or parent.get('solo')) else track['volume']*parent.get('volume',1)*p['audio']['masterGain']
 start=round(event['when']*rate)-first;offset=round(event['offset']*rate);duration=event.get('duration',len(buffers[index])/rate-event['offset']);duration=min(duration,event.get('stopTime',event['when']+duration)-event['when']);length=max(0,round(duration*rate));dest=max(0,start);src=offset+max(0,-start);length=min(length-max(0,-start),len(expected)-dest,len(buffers[index])-src)
 if length>0:expected[dest:dest+length]+=buffers[index][src:src+length]*gain
error=actual-expected;mask=abs(expected)>.00001
report={'case':meta['caseName'],'frames':len(actual),'peak':float(abs(actual).max()),'rms':float(np.sqrt(np.mean(actual**2))),'clipped':int(np.sum(abs(actual)>=1)),'sourceStarts':len(c['starts']),'continuousRenderFrames':bool(all(b['frame']-a['frame']==len(a['left']) for a,b in zip(c['chunks'],c['chunks'][1:]))),'correlation':float(np.corrcoef(actual,expected)[0,1]) if np.std(expected)>1e-8 else None,'errorRms':float(np.sqrt(np.mean(error**2))),'statusMessage':meta.get('statusMessage')}
report['channel']=key
wavfile.write(root/('captured-output'+suffix+'.wav'),rate,actual);wavfile.write(root/('expected-output'+suffix+'.wav'),rate,expected);(root/('timeline-analysis'+suffix+'.json')).write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
