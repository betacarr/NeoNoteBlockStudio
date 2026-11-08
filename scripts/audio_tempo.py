"""Fixed-grid tempo and first-beat detection; no chord or separation models."""
import math

import numpy as np
import soundfile as sf
import soxr


def detect_tempo(filename):
    rate = 11025
    hop, size = 110, 512
    with sf.SoundFile(filename) as source:
        sample_rate = source.samplerate
        # Limit analysis work independently of the audio imported into the project.
        audio = source.read(min(len(source), 90 * sample_rate), dtype='float32', always_2d=True)
    if len(audio) < 2.5 * sample_rate:
        return None
    if np.max(np.abs(audio)) < 1e-5:
        return None
    signal = soxr.resample(audio, sample_rate, rate)
    padded = np.pad(signal, ((size // 2, size // 2), (0, 0)))
    frames = np.lib.stride_tricks.sliding_window_view(padded, size, axis=0)[::hop]
    window = np.hanning(size)
    features = np.empty(len(frames), dtype=np.float64)
    previous = np.zeros(size // 2 + 1)
    for start in range(0, len(frames), 256):
        # Average magnitudes so opposite-polarity stereo transients stay visible.
        magnitude = np.abs(np.fft.rfft(frames[start:start + 256] * window, axis=-1)).mean(axis=1)
        spectra = np.log1p(magnitude * 4)
        flux = np.maximum(0, np.diff(spectra, axis=0, prepend=previous[None, :]))
        features[start:start + len(spectra)] = flux[:, 1:12].mean(axis=1) * 2 + flux[:, 12:].mean(axis=1)
        previous = spectra[-1]
    limit = np.quantile(features, .99)
    if limit < 1e-5:
        limit = features.max()  # Sparse percussive transients.
    if limit < 1e-5:
        return None
    novelty = np.maximum(0, np.minimum(features, limit * 2) - np.median(features) * 1.5)
    steps = rate / hop
    low, high = math.floor(60 * steps / 240), math.ceil(60 * steps / 45)
    n = len(novelty)
    centered = novelty - novelty.mean()
    fft = np.fft.rfft(centered, n=1 << (2 * n - 1).bit_length())
    corr = np.fft.irfft(fft * fft.conj())[:high * 3 + 2]
    if not len(corr) or corr[0] < 1e-9:
        return None
    corr = np.pad(corr / corr[0], (0, max(0, high * 3 + 2 - len(corr))))
    lags = np.arange(low, high + 1)
    # A gentle octave preference settles near-ties; a convincing slower or
    # faster pulse still wins on periodicity.
    scores = .72 * corr[lags] + .2 * corr[lags * 2] + .08 * corr[lags * 3]
    scores -= .045 * np.abs(np.log2((60 * steps / lags) / 118))
    lag = int(lags[np.argmax(scores)])
    if corr[lag] < .19:
        return None
    left, middle, right = corr[lag - 1:lag + 2]
    peak = lag + (np.clip(.5 * (left - right) / (left - 2 * middle + right), -.5, .5) if left + right < 2 * middle else 0)

    before, after = np.r_[0, novelty[:-1]], np.r_[novelty[1:], 0]
    peaks = np.flatnonzero((novelty > before) & (novelty >= after) & (novelty > .12 * limit))
    if len(peaks) < 5:
        return None
    # Estimate phase from the most prominent repeated transients, then refit
    # against their measured positions for a sub-frame BPM.
    weight = np.minimum(novelty[peaks], limit)
    bins = np.arange(64) * peak / 64
    circular = (peaks[:, None] - bins[None, :] + peak / 2) % peak - peak / 2
    spread = max(2.0, .055 * peak)
    phase = bins[np.argmax((np.exp(-.5 * (circular / spread) ** 2) * weight[:, None]).sum(axis=0))]
    indices = np.rint((peaks - phase) / peak)
    near = np.abs(peaks - phase - indices * peak) <= max(2.5, peak * .11)
    if near.sum() < 5 or np.unique(indices[near]).size < 5 or weight[near].sum() < .32 * weight.sum():
        return None
    # Keep one onset per beat so that closely spaced hits do not bias the fit.
    by_beat = {}
    for onset, index, strength in zip(peaks[near], indices[near], weight[near]):
        if index not in by_beat or strength > by_beat[index][1]:
            by_beat[index] = (onset, strength)
    indices = np.array(list(by_beat))
    onsets = np.array([by_beat[index][0] for index in indices])
    slope, intercept = np.polyfit(indices, onsets, 1)
    if not 60 * steps / 240 <= slope <= 60 * steps / 45 or abs(slope / peak - 1) > .045:
        return None
    if np.median(np.abs(onsets - (slope * indices + intercept))) > max(1.8, slope * .07):
        return None
    first = max(0., (slope * min(indices) + intercept) / steps + (size / 4) / rate)
    if first < .018:
        first = 0.
    bpm = round(float(60 * steps / slope), 2)
    return dict(bpm=bpm, firstBeatSeconds=round(first, 5), confidence=round(float(np.clip(corr[lag], 0, 1)), 3))
