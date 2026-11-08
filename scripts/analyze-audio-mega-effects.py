"""Prepare local, unnormalized listening files and descriptive signal metrics.

No network, perceptual model, reference-stem score, or claimed human listening.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path

import numpy as np
import soundfile as sf


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    qa = json.loads(Path(args.report).read_text(encoding='utf-8'))
    attribution = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    assert qa['status'] == 'passed' and qa['syntheticInput'] is False
    destination = Path(args.output)
    destination.mkdir(parents=True, exist_ok=True)
    result, cache = qa['result'], Path(qa['resultDirectory'])
    files = {file['id']: cache/file['file'] for file in result['files']}
    source, rate = sf.read(files[result['workspace']['sourceAssetId']], dtype='float32', always_2d=True)
    roles = [stem['role'] for stem in result['workspace']['stems']]
    stems = [sf.read(files[stem['assetId']], dtype='float32', always_2d=True)[0] for stem in result['workspace']['stems']]
    assert all(stem.shape == source.shape and np.isfinite(stem).all() for stem in stems)
    audio = [source] + stems
    names = ['original'] + roles
    source_rms = float(np.sqrt(np.mean(source.astype('float64')**2)))
    measures, envelopes = [], []
    for name, data in zip(names, audio):
        target = destination/(name+'.wav')
        sf.write(target, data, rate, subtype='FLOAT')
        energy = np.abs(np.fft.rfft(data, axis=0))**2
        frequency = np.fft.rfftfreq(len(data), 1/rate)
        fractions = {band: float(energy[(frequency >= lower) & (frequency < upper)].sum()/max(energy.sum(), 1e-20))
                     for band, lower, upper in [('below200Hz', 0, 200), ('200to2000Hz', 200, 2000), ('above2000Hz', 2000, rate/2+1)]}
        rms = float(np.sqrt(np.mean(data.astype('float64')**2)))
        envelopes.append(np.sqrt(np.mean(data[:len(data)//1024*1024].reshape(-1, 1024, 2)**2, axis=(1, 2))))
        measures.append(dict(role=name, file=target.name, rms=rms, rmsRelativeToMixDb=20*float(np.log10(max(rms, 1e-20)/source_rms)),
                             peak=float(np.abs(data).max()), samplesAboveUnity=int((np.abs(data)>1).sum()), spectralEnergyFractions=fractions,
                             sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
    sf.write(destination/'five-predictions-sum.wav', np.stack(stems[:5]).sum(0), rate, subtype='FLOAT')
    reconstruction = np.stack(stems).sum(0)
    sf.write(destination/'six-output-sum.wav', reconstruction, rate, subtype='FLOAT')
    baseline = Path(args.baseline)
    old = json.loads((baseline/'outputs.json').read_text(encoding='utf-8'))
    comparisons = []
    for index, file in enumerate(old['files']):
        previous, old_rate = sf.read(baseline/file['file'], dtype='float32', always_2d=True)
        assert old_rate == rate and previous.shape == stems[index].shape
        delta = stems[index] - previous
        comparisons.append(dict(role=roles[index], differenceRms=float(np.sqrt(np.mean(delta.astype('float64')**2))),
                                previousRms=float(np.sqrt(np.mean(previous.astype('float64')**2))),
                                peakAbsoluteDifference=float(np.abs(delta).max())))
    report = dict(status='descriptive-measurements-complete-human-listening-pending', attribution=attribution,
        qaReport=str(Path(args.report).resolve()), frames=len(source), sampleRate=rate,
        gainAdjustment=False, listeningPageCommonVolume=.8, subjectiveListeningPerformed=False, referenceStemsAvailable=False,
        interpretation='RMS, spectral fractions and correlations describe outputs; they are not SDR, true instrument labels, leakage percentages, or perceptual quality scores.',
        measurements=measures, rmsEnvelopeCorrelation=np.corrcoef(envelopes).tolist(),
        envelopeRoleOrder=names, comparisonWithUnpaddedV2=comparisons,
        reconstructionPeakError=float(np.abs(source-reconstruction).max()),
        modelMetrics=qa['metrics'])
    (destination/'signal-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    attribution_text = ('Slow Motion Dream (demo excerpt), Steven M Bryant ©2011; ft CSoul, Alex Beroza & Robert Siekawitch. '
                        'CC BY 3.0. Source: sigsep/spleeter-musdb, audio_example.mp3, commit '+attribution['commit']+'. '
                        'Changes: MP3 decoded to float WAV; model separation and sums; no gain normalization.')
    (destination/'ATTRIBUTION.txt').write_text(attribution_text+'\n'+attribution['original']+'\n'+attribution['licenseUrl']+'\n', encoding='utf-8')
    labels = {'original': '原混音', 'vocals': '人声预测', 'drums': '鼓预测', 'bass': '贝斯预测', 'guitar': '吉他预测（本样本极低电平）', 'piano': '钢琴预测', 'other': '其他残余', 'five-predictions-sum': '五个预测相加', 'six-output-sum': '全部六输出相加（重构）'}
    players = ''.join('<section><h2>'+html.escape(label)+'</h2><audio controls preload="none" src="'+name+'.wav"></audio></section>' for name, label in labels.items())
    page = ('<!doctype html><meta charset="utf-8"><title>Mega 真实音乐本地对比</title>'
            '<style>body{font:16px system-ui;max-width:850px;margin:32px auto;padding:0 20px;background:#15171c;color:#e8eaf0}section{padding:12px 0;border-top:1px solid #424752}h2{font-size:18px}audio{width:100%}a{color:#9bc8ff}</style>'
            '<h1>Mega 真实音乐本地对比</h1><p>五类模型预测＋原混音残余；不是原生六轨。所有文件保持相同原始电平，没有分别归一化。'
            '建议先听原混音，再对比各预测与残余。吉他接近静音不证明原曲没有吉他；六输出能相加还原不证明分离干净。'
            '原 MP3 解码后有少量超过 1 的浮点采样；页面所有播放器统一设为 80% 音量，WAV 本身保持原样。</p>'
            '<p>没有独立参考音轨；尚未完成人耳听感验收。页面只读取同目录文件，不联网或上传。</p>'+players+
            '<p>'+html.escape(attribution_text)+'</p><a href="'+html.escape(attribution['licenseUrl'])+'">CC BY 3.0</a> · '
            '<a href="signal-report.json">信号测量记录</a>'
            '<script>const players=[...document.querySelectorAll("audio")];for(const player of players){player.volume=.8;player.addEventListener("play",()=>players.filter(other=>other!==player).forEach(other=>other.pause()));}</script>')
    (destination/'listen.html').write_text(page, encoding='utf-8')
    print(json.dumps(dict(output=str(destination.resolve()), measurements=measures, comparison=comparisons), ensure_ascii=False))


if __name__ == '__main__':
    main()
