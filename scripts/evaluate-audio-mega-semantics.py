"""Local source-known checks made from CC0 recorded notes, not oscillators.

This is a controlled recording-based mixture, not a natural multitrack performance.
Use alongside, not instead of, the separate real-song UI acceptance test.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path
import sys

import numpy as np
import soundfile as sf
import soxr
import torch

import audio_mega

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT/'third_party'))
RATE, FRAMES = 44100, 8*44100
TARGETS = ['vocal', 'drums', 'bass', 'guitar', 'piano', 'acoustic-guitar', 'electric-guitar', 'digital-piano', 'keys']


def recording_sequence(sample_root, entries, collection, piano=False):
    result = np.zeros((FRAMES, 2), dtype='float32')
    samples = []
    for entry in entries:
        if '/'+collection+'/' not in entry:
            continue
        file = sample_root/entry
        audio, rate = sf.read(file, dtype='float32', always_2d=True)
        if rate != RATE:
            audio = soxr.resample(audio, rate, RATE).astype('float32')
        if audio.shape[1] == 1:
            audio = np.repeat(audio, 2, axis=1)
        samples.append(audio)
    assert len(samples) == 3
    for index, when in enumerate([.15, 1.05, 1.95, 3.15, 4.05, 4.95, 6.15]):
        # Truncate notes with a short release ramp; do not pitch-shift recordings.
        start = int((when + (.20 if piano else 0))*RATE)
        count = min(len(samples[index % 3]), int(1.4*RATE), FRAMES-start)
        block = samples[index % 3][:count].copy()
        fade = min(2205, count)
        block[-fade:] *= np.linspace(1, 0, fade, dtype='float32')[:, None]
        result[start:start+count] += .5*block
    return result


def score(estimate, reference):
    estimate, reference = estimate.astype('float64').ravel(), reference.astype('float64').ravel()
    energy = float(reference@reference)
    alpha = float(estimate@reference/max(energy, 1e-30))
    projection = alpha*reference
    return dict(projectionGain=alpha, rms=float(np.sqrt(np.mean(estimate**2))),
        referenceRms=float(np.sqrt(np.mean(reference**2))),
        cosine=float(estimate@reference/max(np.linalg.norm(estimate)*np.linalg.norm(reference), 1e-30)),
        siSdrDb=10*float(np.log10(max(float(projection@projection), 1e-30)/max(float((estimate-projection)@(estimate-projection)), 1e-30))),
        scaleDependentSdrDb=10*float(np.log10(max(energy, 1e-30)/max(float((estimate-reference)@(estimate-reference)), 1e-30))))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--models', required=True)
    parser.add_argument('--sample-root', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--cases', nargs='+', choices=['nylon', 'steel', 'piano', 'mix'], default=['nylon', 'steel', 'piano', 'mix'])
    args = parser.parse_args()
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=False)
    manifest = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    sample_root = Path(args.sample_root)
    # Each selected preview must match the official collection checksum file.
    source_checks = []
    for entry in manifest['selected']:
        file = sample_root/entry
        checksum_lines = (file.parent.parent/'SHA256SUMS').read_text().splitlines()
        expected = next(line.split()[0] for line in checksum_lines if line.split(maxsplit=1)[1].lstrip('*') == 'ogg/'+file.name)
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        assert digest == expected
        source_checks.append(dict(file=entry,bytes=file.stat().st_size,sha256=digest))
    manifest['files'] = source_checks
    piano = recording_sequence(sample_root, manifest['selected'], 'meta-piano', piano=True)
    nylon = recording_sequence(sample_root, manifest['selected'], 'meta-nylon-guitar')
    steel = recording_sequence(sample_root, manifest['selected'], 'meta-steel-guitar')
    zero = np.zeros_like(piano)
    sources = {'nylon': (nylon, zero), 'steel': (steel, zero), 'piano': (zero, piano), 'mix': (steel, piano)}
    report = dict(status='running',construction='Controlled 8-second sequences from recorded CC0 piano/guitar notes. Not a natural song or a six-source reference dataset.',manifest=manifest,torch=torch.__version__,device='cpu',results=[])
    save = lambda: (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    save()
    emit = lambda phase, progress, message: print(json.dumps(dict(phase=phase,progress=progress,message=message),ensure_ascii=False),flush=True)
    model, config, _, loading = audio_mega.load_model(args.models, emit,active_targets=TARGETS)
    ids = [config['training']['instruments'].index(name) for name in TARGETS]
    report['modelLoadSeconds'], report['targetNames'], report['targetIndices'] = loading, TARGETS, ids
    report['cpuQueryChunkFrames'] = max(getattr(module,'cpu_query_chunk_size',0) for module in model.modules())
    with torch.inference_mode():
        for name in args.cases:
            directory = out/name
            directory.mkdir()
            guitar, piano_part = [data.copy() for data in sources[name]]
            mix = guitar+piano_part
            gain = min(1., .8/max(float(np.abs(mix).max()), 1e-20))
            guitar *= gain; piano_part *= gain; mix *= gain
            for label, signal in [('original',mix),('reference-guitar',guitar),('reference-piano',piano_part)]:
                sf.write(directory/(label+'.wav'), signal, RATE, subtype='FLOAT')
            x = torch.from_numpy(mix.T.copy())[None]
            window = config['inference']['chunk_size']
            x = torch.nn.functional.pad(x,(0,window-FRAMES))
            print(json.dumps(dict(case=name,phase='forward',heads=TARGETS)),flush=True)
            start = time.perf_counter()
            result = model(x,active_stem_ids=ids)[0,:,:,:FRAMES].permute(0,2,1).numpy()
            assert np.isfinite(result).all()
            row = dict(case=name,frames=FRAMES,sourceCommonGain=gain,forwardSeconds=time.perf_counter()-start,heads={})
            for label, signal in zip(TARGETS,result):
                sf.write(directory/(label+'.wav'), signal, RATE, subtype='FLOAT')
                item = dict(rms=float(np.sqrt(np.mean(signal.astype('float64')**2))))
                if np.any(guitar): item['againstGuitar'] = score(signal,guitar)
                if np.any(piano_part): item['againstPiano'] = score(signal,piano_part)
                row['heads'][label] = item
            sf.write(directory/'other-residual.wav',mix-result[:5].sum(0),RATE,subtype='FLOAT')
            report['results'].append(row);save();print(json.dumps(row),flush=True)
    report['peakWorkingSetBytes']=audio_mega.peak_memory();report['status']='measurements-complete';save()


if __name__ == '__main__':
    main()
