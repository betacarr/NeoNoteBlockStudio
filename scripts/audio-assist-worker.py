"""Local audio assistant. JSON-lines progress; input audio never leaves this process."""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import sys
import uuid

ALGORITHM = 'neonbs-audio-assist-2'
MODEL = 'htdemucs_6s'
MAX_DURATION = 7200


def emit(phase, progress, message):
    print(json.dumps(dict(phase=phase, progress=progress, message=message), ensure_ascii=False), flush=True)


def analyze(filename):
    import librosa
    import numpy as np
    import soundfile as sf
    rate, hop = 22050, 512
    onsets, chromas = [], []
    # Each block ends exactly on a feature frame. Keep only low-dimensional
    # features, never the full-song STFT/harmonic waveform in memory.
    with sf.SoundFile(filename) as audio:
        duration = len(audio) / audio.samplerate
        block_frames = hop * 2400 * 2
        count = max(1, math.ceil(len(audio) / block_frames))
        for index, block in enumerate(audio.blocks(blocksize=block_frames, dtype='float32', always_2d=True)):
            mono = librosa.resample(np.mean(block, axis=1), orig_sr=audio.samplerate, target_sr=rate)
            keep = math.ceil(len(mono) / hop)
            onsets.append(librosa.onset.onset_strength(y=mono, sr=rate, hop_length=hop)[:keep])
            harmonic = librosa.effects.harmonic(mono)
            chromas.append(librosa.feature.chroma_stft(y=harmonic, sr=rate, hop_length=hop)[:, :keep])
            emit('analyzing', .8 + .15 * (index + 1) / count, '检测全曲和弦与节拍（%d/%d）' % (index + 1, count))
    onset = np.concatenate(onsets)
    chroma = np.concatenate(chromas, axis=1)
    tempo, positions = librosa.beat.beat_track(onset_envelope=onset, sr=rate, hop_length=hop, trim=False)
    bpm = float(np.asarray(tempo).reshape(-1)[0])
    if not math.isfinite(bpm) or bpm <= 0:
        bpm = 120.0
    beats = [float(t) for t in librosa.frames_to_time(positions, sr=rate, hop_length=hop) if 0 <= t < duration]
    # The tempo lag is quantized by STFT hops. Fit detected beats for a finer
    # fixed-tempo estimate only when they actually follow a stable grid.
    stable = beats[1:-1]
    if len(stable) >= 4:
        index = np.arange(len(stable))
        slope, intercept = np.polyfit(index, stable, 1)
        residual = np.max(np.abs(np.asarray(stable) - (slope * index + intercept)))
        fitted = 60 / slope if slope > 0 else bpm
        if residual < .08 and 10 <= fitted <= 1000 and abs(fitted / bpm - 1) < .15:
            bpm = float(fitted)
    emit('analyzing', .96, '整理全曲和弦与节拍')
    names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    templates, labels = [], []
    for root in range(12):
        for suffix, third in [('', 4), ('m', 3)]:
            t = np.zeros(12)
            t[[root, (root + third) % 12, (root + 7) % 12]] = 1 / math.sqrt(3)
            templates.append(t)
            labels.append(names[root] + suffix)
    templates = np.asarray(templates)
    boundaries = sorted(set([0.0, duration] + beats))
    chords = []
    for start, end in zip(boundaries, boundaries[1:]):
        left, right = int(start * rate / hop), max(int(start * rate / hop) + 1, int(end * rate / hop))
        vector = np.mean(chroma[:, left:right], axis=1) if left < chroma.shape[1] else np.zeros(12)
        norm = float(np.linalg.norm(vector))
        scores = templates @ (vector / max(norm, 1e-12))
        rank = np.argsort(scores)
        best, second = float(scores[rank[-1]]), float(scores[rank[-2]])
        # Ranking heuristic, not a calibrated probability.
        confidence = max(0.0, min(1.0, (best - second) * 5 + max(0, best - .7)))
        name = labels[int(rank[-1])] if norm > .02 and best > .65 else 'N'
        if name == 'N':
            confidence = 0.0
        if chords and chords[-1]['name'] == name:
            chords[-1]['end'] = end
            chords[-1]['confidence'] = min(chords[-1]['confidence'], confidence)
        else:
            chords.append(dict(id=str(uuid.uuid4()), name=name, start=start, end=end, confidence=confidence))
    return bpm, beats[0] if beats else 0.0, beats, chords


def mix_stems(output, filenames):
    from contextlib import ExitStack
    import numpy as np
    import soundfile as sf

    with ExitStack() as stack:
        sources = [stack.enter_context(sf.SoundFile(filename)) for filename in filenames]
        first = sources[0]
        if any((source.samplerate, source.channels, len(source)) != (first.samplerate, first.channels, len(first)) for source in sources):
            raise ValueError('子混音声部的采样率、声道或帧数不一致。')
        target = stack.enter_context(sf.SoundFile(output, 'w', samplerate=first.samplerate, channels=first.channels, subtype='FLOAT'))
        for start in range(0, len(first), 262144):
            frames = min(262144, len(first) - start)
            mix = np.zeros((frames, first.channels), dtype='float32')
            for source in sources:
                mix += source.read(frames, dtype='float32', always_2d=True)
            target.write(mix)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--models', required=True)
    p.add_argument('--name', default='音频分析')
    p.add_argument('--start-seconds',type=float,default=0)
    p.add_argument('--duration-seconds',type=float)
    p.add_argument('--decode-only', action='store_true')
    p.add_argument('--detect-tempo', action='store_true')
    p.add_argument('--tempo-model')
    p.add_argument('--mode', choices=['split', 'chords'])
    p.add_argument('--research-model', action='store_true')
    p.add_argument('--mega-model', action='store_true')
    p.add_argument('--drum-pieces', action='store_true')
    p.add_argument('--device',choices=['cpu','cuda','mps'],default='cpu')
    p.add_argument('--cpu-threads',type=int,default=0)
    p.add_argument('--memory-mode',choices=['balanced','low'],default='balanced')
    args = p.parse_args()
    if args.research_model and args.mega_model:
        raise ValueError('一次分析只能选择一个分离模型。')
    if args.drum_pieces and not args.mega_model:
        raise ValueError('鼓件分离需要 Mega 模型。')
    if args.mode == 'split' and not (args.research_model or args.mega_model) or args.mode == 'chords' and (args.research_model or args.mega_model) or args.mode and args.decode_only:
        raise ValueError('音频任务模式与模型设置冲突。')
    if args.tempo_model and not args.detect_tempo or args.detect_tempo and (not args.decode_only or args.research_model or args.mega_model):
        raise ValueError('曲速检测必须单独运行。')
    import numpy as np
    import soundfile as sf
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    emit('decoding', .02, '读取本地音频')
    info = sf.info(args.input)
    if info.frames <= 0 or info.duration > MAX_DURATION or info.channels not in (1, 2):
        raise ValueError('当前支持不超过两小时的单声道或立体声音频；不会截断输入。')
    expected = math.ceil(info.duration * 44100) * 8
    # Output plus disk-backed six-stem accumulation and final WAV files.
    required = expected * (24 if args.drum_pieces else 15 if args.research_model or args.mega_model else 1) + 64 * 1024 * 1024
    if shutil.disk_usage(out).free < required:
        raise ValueError('分析缓存所在磁盘空间不足，预计至少需要 %.2f GB 可用空间。' % (required / 1024**3))
    files, stems = [], []
    source_id = str(uuid.uuid4())
    source_path = out / (source_id + '.wav')
    # Decode/resample in bounded blocks. soxr retains its filter state across
    # blocks; independently resampling chunks would introduce boundary clicks.
    import soxr
    with sf.SoundFile(args.input) as source, sf.SoundFile(source_path, 'w', samplerate=44100, channels=2, subtype='FLOAT') as target:
        resampler = soxr.ResampleStream(source.samplerate, 44100, 2, dtype='float32') if source.samplerate != 44100 else None
        if not math.isfinite(args.start_seconds) or args.start_seconds<0 or args.start_seconds>=info.duration:
            raise ValueError('片段起点超出源音频。')
        start_frame = round(args.start_seconds * source.samplerate)
        end_frame = len(source)
        if args.duration_seconds is not None:
            end_seconds = args.start_seconds + args.duration_seconds
            if not math.isfinite(end_seconds) or args.duration_seconds <= 0:
                raise ValueError('片段范围超出源音频。')
            # Round both absolute boundaries so adjacent clips share a sample edge.
            end_frame = round(end_seconds * source.samplerate)
        finish = min(len(source), end_frame)
        if finish <= start_frame or end_frame > len(source) + 1:
            raise ValueError('片段范围超出源音频。')
        source.seek(start_frame)
        for block in source.blocks(blocksize=262144,frames=finish-source.tell(), dtype='float32', always_2d=True):
            if not np.isfinite(block).all():
                raise ValueError('音频包含无效采样。')
            if block.shape[1] == 1:
                block = np.repeat(block, 2, axis=1)
            if resampler:
                block = resampler.resample_chunk(block, last=source.tell() == finish)
            target.write(block)
    rate, frames = 44100, sf.info(source_path).frames
    files.append(dict(id=source_id, name=args.name + ' · 原音频.wav', file=source_id + '.wav', mime='audio/wav'))
    if not args.research_model and not args.mega_model:
        stems.append(dict(id=str(uuid.uuid4()), role='original', name='原始音频', assetId=source_id, gain=1, muted=False, solo=False))
    if args.mega_model:
        from audio_mega import separate_mega
        drum_options = {'drum_pieces': True} if args.drum_pieces else {}
        model_files, model_stems = separate_mega(source_path, out, args.models, emit,device=args.device,threads=args.cpu_threads,memory_mode=args.memory_mode,**drum_options)
        files.extend(model_files)
        stems.extend(model_stems)
    if args.research_model:
        import torch
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        torch.set_num_threads(max(1, min(8, os.cpu_count() or 1)))
        torch.hub.set_dir(str(Path(args.models).resolve()))
        emit('model', .06, '准备本地研究用途六轨模型')
        model = get_model(MODEL)
        model.eval()
        emit('separating', .12, '本地六轨分离中')
        if len(model.sources) != 6:
            raise ValueError('模型输出不是六轨。')
        # Outer windows bound the six-stem tensor. Overlap-add uses one shared
        # envelope, preserving identical timing/gain across every source.
        accumulator_path, weight_path = out / 'accumulator.tmp', out / 'weights.tmp'
        accumulator = np.memmap(accumulator_path, dtype='float32', mode='w+', shape=(6, frames, 2))
        weight = np.memmap(weight_path, dtype='float32', mode='w+', shape=(frames,))
        window, overlap = 30 * rate, rate
        starts = range(0, frames, window - overlap)
        with sf.SoundFile(source_path) as source:
            for index, start in enumerate(starts):
                source.seek(start)
                block = source.read(min(window, frames - start), dtype='float32', always_2d=True)
                audio = torch.from_numpy(block.T.copy())
                ref = audio.mean(0)
                mean, std = ref.mean(), ref.std().clamp(min=1e-8)
                with torch.no_grad():
                    result = apply_model(model, ((audio - mean) / std)[None], device='cpu', shifts=0, split=True, overlap=.25, progress=False, num_workers=0)[0]
                result = result * std + mean
                if result.shape[-1] != len(block) or not bool(torch.isfinite(result).all()):
                    raise ValueError('模型输出长度或采样无效。')
                envelope = np.ones(len(block), dtype='float32')
                edge = min(overlap, len(block))
                if start:
                    envelope[:edge] *= np.linspace(0, 1, edge, dtype='float32')
                if start + len(block) < frames:
                    envelope[-edge:] *= np.linspace(1, 0, edge, dtype='float32')
                accumulator[:, start:start + len(block)] += result.permute(0, 2, 1).numpy() * envelope[None, :, None]
                weight[start:start + len(block)] += envelope
                emit('separating', .12 + .65 * (index + 1) / len(starts), '本地六轨分离（%d/%d）' % (index + 1, len(starts)))
                del result, audio
        names = dict(vocals='人声', drums='鼓', bass='贝斯', guitar='吉他', piano='钢琴', other='其他')
        for stem_index, role in enumerate(model.sources):
            asset_id = str(uuid.uuid4())
            with sf.SoundFile(out / (asset_id + '.wav'), 'w', samplerate=rate, channels=2, subtype='FLOAT') as target:
                for start in range(0, frames, 262144):
                    end = min(frames, start + 262144)
                    target.write(accumulator[stem_index, start:end] / np.maximum(weight[start:end, None], 1e-8))
            files.append(dict(id=asset_id, name=names.get(role, role) + '.wav', file=asset_id + '.wav', mime='audio/wav'))
            stems.append(dict(id=str(uuid.uuid4()), role=role, name=names.get(role, role), assetId=asset_id, gain=1, muted=False, solo=False))
        del accumulator, weight
        accumulator_path.unlink()
        weight_path.unlink()
    analysis_performed = not args.decode_only and args.mode != 'split'
    if analysis_performed:
        emit('analyzing', .8, '检测固定速度与拍点')
    # BPM is a schema placeholder when analysisPerformed is false, not an estimate.
    bpm, first, beats, chords = analyze(source_path) if analysis_performed else (120.0, 0.0, [], [])
    if args.mega_model:
        from audio_mega import MODEL_ID, MODEL_VERSION
        model_info = dict(id=MODEL_ID, version=MODEL_VERSION + ('/drum-pieces-v1' if args.drum_pieces else ''))
        compute_metrics=json.loads((out/'model-metrics.json').read_text(encoding='utf-8'))
        model_info.update(device=compute_metrics['device'],memoryProfile=compute_metrics['memoryProfile'])
    else:
        model_info = dict(id=MODEL if args.research_model else 'librosa-analysis', version='4.0.1/' + ALGORITHM if args.research_model else '0.11.0/' + ALGORITHM)
    workspace = dict(id=str(uuid.uuid4()), name=args.name, sourceAssetId=source_id, duration=frames / rate, sampleRate=rate, frames=frames, stems=stems, analysisPerformed=analysis_performed, bpm=bpm, firstBeat=first, beats=beats, chords=chords, model=model_info, loop=dict(enabled=False, start=0, end=frames / rate))
    if args.detect_tempo:
        from audio_tempo import detect_tempo
        tempo, backend = None, 'spectral'
        if args.tempo_model:
            emit('tempo', .84, '正在用 Beat This! 检测拍点与小节重拍')
            try:
                from audio_neural_tempo import detect_neural_tempo
                tempo = detect_neural_tempo(source_path, args.tempo_model)
                backend = 'beat-this'
            except Exception as error:
                print('Beat This! unavailable: ' + type(error).__name__, file=sys.stderr)
                emit('tempo-fallback', .90, '神经网络测拍不可用，使用基础拍点检测')
        if tempo is None:
            emit('tempo', .92, '正在检查是否有稳定的重复节拍')
            tempo = detect_tempo(source_path)
            if tempo:
                tempo.update(method='spectral', stable=True, downbeat=False)
        workspace['tempoDetection'] = backend
        if tempo:
            workspace['tempoAnalysis'] = tempo
    payload = dict(workspace=workspace, files=files, algorithm=ALGORITHM)
    temporary = out / 'result.json.tmp'
    temporary.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    temporary.replace(out / 'result.json')
    emit('complete', 1, '分轨已就绪' if args.mode == 'split' else '音频与分析已就绪，可预览后应用')


if __name__ == '__main__':
    try:
        if sys.argv[1:2] == ['--mix-stems']:
            mix_stems(sys.argv[2], sys.argv[3:])
        else:
            main()
    except Exception as error:
        from audio_mega import CudaFallback
        if isinstance(error,CudaFallback):
            emit('gpu-fallback',.05,str(error))
            raise SystemExit(76)
        emit('error', 0, str(error))
        raise
