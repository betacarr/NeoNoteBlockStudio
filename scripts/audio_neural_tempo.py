"""Offline adapter for the pinned Beat This! CPU beat and downbeat tracker."""
import hashlib
import inspect
import io
import json
from importlib.metadata import version
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr


def summarize_beats(beats, downbeats, probabilities, duration):
    valid = (beats >= 0) & (beats < duration) & np.isfinite(probabilities)
    beats, probabilities = beats[valid], probabilities[valid]
    if len(beats) < 6 or np.median(probabilities) < .55:
        return None
    intervals = np.diff(beats)
    reasonable = intervals[(intervals >= .25 - .011) & (intervals <= 60 / 45 + .011)]
    if len(reasonable) < max(5, .65 * len(intervals)):
        return None
    period = np.median(reasonable)
    step = np.maximum(1, np.rint(intervals / period))
    index = np.r_[0, np.cumsum(step)]
    fitted, origin = np.polyfit(index, beats, 1)
    max_jitter = max(.065, .13 * period)
    stable = (abs(fitted / period - 1) <= .05
              and np.mean(np.abs(intervals - period * step) <= max_jitter) >= .85
              and np.quantile(np.abs(beats - fitted * index - origin), .9) <= max_jitter)
    bpm = 60 / (fitted if stable else period)
    if not 45 <= bpm <= 240:
        return None
    # Only use a downbeat that also belongs to the accepted beat sequence.
    anchors = [float(beat) for beat in downbeats if 0 <= beat < duration and np.any(np.abs(beats - beat) <= .021)]
    anchor = min(anchors, default=float(beats[0]))
    # A first-frame offset is within the model's temporal resolution. Do not
    # insert an entire preroll bar for a one-frame boundary estimate.
    if anchor <= .025:
        anchor = 0.
    return dict(bpm=round(float(bpm), 2), firstBeatSeconds=round(anchor, 5),
                confidence=round(float(np.median(probabilities)), 3), method='beat-this',
                stable=bool(stable), downbeat=bool(anchors))


def detect_neural_tempo(filename, model_path):
    with sf.SoundFile(filename) as source:
        rate = source.samplerate
        audio = source.read(min(len(source), 90 * rate), dtype='float32', always_2d=True)
    if len(audio) < 2.5 * rate or np.max(np.abs(audio)) < 1e-5:
        return None
    mono = audio.mean(axis=1)
    # For antiphase stereo, retain one channel instead of presenting silence.
    if np.max(np.abs(mono)) < .12 * np.max(np.abs(audio)):
        mono = audio[:, int(np.argmax(np.max(np.abs(audio), axis=0)))]

    manifest = json.loads(Path(__file__).with_name('smart-tempo-model.json').read_text(encoding='utf-8'))
    if version('beat-this') != manifest['packageVersion']:
        raise ValueError('Unexpected Beat This! package version')
    resource = manifest['checkpoint']
    with Path(model_path).open('rb') as file:
        payload = file.read(resource['bytes'] + 1)
    if len(payload) != resource['bytes'] or hashlib.sha256(payload).hexdigest() != resource['sha256']:
        raise ValueError('Beat This! checkpoint SHA-256 mismatch')
    from beat_this.inference import split_predict_aggregate
    from beat_this.model.beat_tracker import BeatThis
    from beat_this.model.postprocessor import Postprocessor
    from beat_this.preprocessing import LogMelSpect
    from beat_this.utils import replace_state_dict_key
    import torch

    # Do not use the upstream hub fallback: a job must never contact the network.
    torch.set_num_threads(min(4, torch.get_num_threads()))
    state = torch.load(io.BytesIO(payload), map_location='cpu', weights_only=True)
    hparams = {key: value for key, value in state['hyper_parameters'].items() if key in inspect.signature(BeatThis).parameters}
    model = BeatThis(**hparams).eval()
    model.load_state_dict(replace_state_dict_key(state['state_dict'], 'model.', ''))
    with torch.inference_mode():
        signal = torch.tensor(soxr.resample(mono, rate, 22050), dtype=torch.float32)
        spect = LogMelSpect(device='cpu')(signal)
        frames = split_predict_aggregate(spect=spect, chunk_size=1500, border_size=6,
                                         overlap_mode='keep_first', model=model)
        beats, downbeats = Postprocessor(type='minimal')(frames['beat'], frames['downbeat'])
        frame_indices = np.clip(np.rint(beats * 50).astype(int), 0, frames['beat'].numel() - 1)
        probabilities = frames['beat'].sigmoid().numpy()[frame_indices]
    return summarize_beats(beats, downbeats, probabilities, len(audio) / rate)
