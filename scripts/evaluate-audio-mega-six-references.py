"""Six-role quantitative check from explicitly CC0 instrument recordings.

This constructed, balanced mixture is not an independent natural-song dataset.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import numpy as np
import soundfile as sf
import soxr

import audio_mega

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT/'third_party'))
spec = importlib.util.spec_from_file_location('known_source_metrics', ROOT/'scripts/evaluate-audio-mega-semantics.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
RATE, FRAMES = 44100, 8*44100
ROLES = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']


def read_recording(file):
    assert hashlib.sha256(Path(file['path']).read_bytes()).hexdigest() == file['sha256']
    audio, rate = sf.read(file['path'],dtype='float32',always_2d=True)
    if rate != RATE: audio = soxr.resample(audio,rate,RATE).astype('float32')
    if audio.shape[1] == 1: audio = np.repeat(audio,2,axis=1)
    assert audio.shape[1] == 2 and np.isfinite(audio).all()
    return audio


def sequence(samples, events, limit=1.3):
    output = np.zeros((FRAMES,2),dtype='float32')
    for when,index,gain in events:
        start = round(when*RATE)
        count = min(len(samples[index]),round(limit*RATE),FRAMES-start)
        block = samples[index][:count].copy()
        fade = min(round(.03*RATE),count)
        block[-fade:] *= np.linspace(1,0,fade,dtype='float32')[:,None]
        output[start:start+count] += block*gain
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--models',required=True)
    parser.add_argument('--sources',required=True)
    parser.add_argument('--two-source-references',required=True)
    parser.add_argument('--output',required=True)
    args = parser.parse_args()
    out = Path(args.output);out.mkdir(parents=True,exist_ok=False)
    provenance = json.loads(Path(args.sources).read_text(encoding='utf-8'))
    refs = {}
    for role in ['guitar','piano']:
        refs[role],rate = sf.read(Path(args.two_source_references)/('reference-'+role+'.wav'),dtype='float32',always_2d=True)
        assert rate == RATE and refs[role].shape == (FRAMES,2)
    for entry in provenance:
        samples = [read_recording(file) for file in entry['files']]
        role = entry['role']
        if role == 'drums':
            events = [(i*.5,0,1.) for i in range(16)] + [(i+.5,1,.8) for i in range(8)] + [(i*.25,2,.35) for i in range(32)]
            refs[role] = sequence(samples,events,limit=.8)
        else:
            offset = {'vocals':.30,'bass':0.,'other':.45}[role]
            events = [(when+offset,i%len(samples),1.) for i,when in enumerate([0.,1.,2.,3.2,4.2,5.2,6.4])]
            refs[role] = sequence(samples,events)
    source_gains = {}
    for role in ROLES:
        source_gains[role] = .03/float(np.sqrt(np.mean(refs[role].astype('float64')**2)))
        refs[role] *= source_gains[role]
    mix = np.stack([refs[role] for role in ROLES]).sum(0)
    master = min(1.,.8/max(float(np.abs(mix).max()),1e-20))
    mix *= master
    for role in ROLES:
        refs[role] *= master
        sf.write(out/('reference-'+role+'.wav'),refs[role],RATE,subtype='FLOAT')
    source = out/'six-reference-mixture.wav';sf.write(source,mix,RATE,subtype='FLOAT')
    meta_report = json.loads((Path(args.two_source_references).parent/'report.json').read_text(encoding='utf-8'))
    meta_files = [entry for entry in meta_report['manifest']['files'] if 'meta-piano/' in entry['file'] or 'meta-steel-guitar/' in entry['file']]
    manifest = dict(construction='Balanced 8-second six-role mixture made from CC0 recorded notes; sung vowel, kick/snare/closed hat, bass guitar, steel guitar, upright piano, saxello (other). Not a live multitrack performance or broad music benchmark.',license='CC0-1.0',sources=provenance,metaInstrumentSource='Meta-open-sound at 251c0be57d5d1b3242b91f53e0cde62ab1cb42d9',metaInstrumentFiles=meta_files,referenceRoleOrder=ROLES,sourceGains=source_gains,commonMasterGain=master)
    (out/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    emit = lambda phase,progress,message: print(json.dumps(dict(phase=phase,progress=progress,message=message),ensure_ascii=False),flush=True)
    files,stems = audio_mega.separate_mega(source,out,args.models,emit)
    predictions=[]
    for file,stem in zip(files,stems):
        prediction,rate = sf.read(out/file['file'],dtype='float32',always_2d=True)
        assert rate==RATE and prediction.shape==(FRAMES,2)
        predictions.append(prediction)
        sf.write(out/('prediction-'+stem['role']+'.wav'),prediction,RATE,subtype='FLOAT')
    metrics={role:helpers.score(prediction,refs[role]) for role,prediction in zip(ROLES,predictions)}
    reference_matrix=np.stack([refs[role].ravel() for role in ROLES]).astype('float64')
    estimate_matrix=np.stack([prediction.ravel() for prediction in predictions]).astype('float64')
    gram=reference_matrix@reference_matrix.T
    coefficients=np.linalg.solve(gram,(estimate_matrix@reference_matrix.T).T).T
    report=dict(status='measurements-complete',manifest=manifest,modelMetrics=json.loads((out/'model-metrics.json').read_text(encoding='utf-8')),scores=metrics,
        linearReferenceProjectionGains=coefficients.tolist(),projectionRoleOrder=ROLES,
        referenceGramCondition=float(np.linalg.cond(gram)),
        reconstructionPeakError=float(np.abs(np.stack(predictions).sum(0)-mix).max()),
        subjectiveListeningPerformed=False,interpretation='SI-SDR and scale-dependent SDR compare actual known references only for this constructed mixture. They do not certify other songs or perceptual quality. Other is assessed against known saxello, not declared correct merely because the outputs sum to the mixture.')
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    labels=['人声','鼓组','贝斯','吉他','钢琴','其他（萨克斯管）']
    controls=''.join('<section><h2>'+label+'</h2><p>已知参考</p><audio controls preload="none" src="reference-'+role+'.wav"></audio><p>模型输出</p><audio controls preload="none" src="prediction-'+role+'.wav"></audio></section>' for role,label in zip(ROLES,labels))
    (out/'listen.html').write_text('<!doctype html><meta charset="utf-8"><title>六来源参考对比</title><style>body{font:16px system-ui;max-width:850px;margin:32px auto;padding:20px;background:#171a20;color:#eee}audio{width:100%}section{border-top:1px solid #555;margin-top:20px}</style><h1>六来源参考对比</h1><p>CC0 真实乐器／人声录音拼接的 8 秒受控混合，不是现场六轨演奏。参考和输出保持同一混音电平，输出没有分别归一化。所有资源本地读取，尚未完成主观听感验收。</p><p>原混合</p><audio controls src="six-reference-mixture.wav"></audio>'+controls+'<p>来源：Karoryfer Samples（Hadzi-Fia 人声、Big Little Bass、Big Rusty Drums）、Versilian Studios VCSL Saxello、Meta Open Sound 钢琴／钢弦吉他；均 CC0，完整提交、源文件及校验值见 source-manifest.json。</p><script>const ps=[...document.querySelectorAll("audio")];ps.forEach(p=>{p.volume=.8;p.onplay=()=>ps.filter(q=>q!==p).forEach(q=>q.pause())})</script>',encoding='utf-8')
    print(json.dumps(dict(scores=metrics,modelMetrics=report['modelMetrics']),ensure_ascii=False),flush=True)


if __name__ == '__main__':main()
