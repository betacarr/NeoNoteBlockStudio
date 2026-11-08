"""Offline numerical checks for the streamed upstream demix recipe (no weights)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf
import torch

import audio_mega as adapter
sys.path.insert(0, str(Path(__file__).resolve().parent.parent/'third_party'))
from mega_roformer.attend import Attend
from mega_roformer.bs_roformer import Transformer


class ContextModel:
    def __call__(self, x, active_stem_ids):
        # Context-sensitive deterministic stand-in: unpadded tails cannot pass.
        assert active_stem_ids == [49, 15, 4, 20, 33]
        return torch.stack([x * factor + x.mean(-1, keepdim=True) * .02
                            for factor in [.1, .2, .15, .05, .12]], dim=1)


def upstream_reference(audio, window=100, overlap=2):
    """Batch-one generic demix, matching upstream ea7eb9c lines 104–205."""
    x = torch.tensor(audio.T)
    step = window // overlap
    border = window - step
    padded = len(audio) > 2 * border and border > 0
    if padded:
        x = torch.nn.functional.pad(x, (border, border), mode='reflect')
    result = torch.zeros((5,) + x.shape)
    counter = torch.zeros_like(result)
    for start in range(0, x.shape[-1], step):
        part = x[:, start:start + window]
        length = part.shape[-1]
        mode = 'reflect' if length > window // 2 else 'constant'
        part = torch.nn.functional.pad(part, (0, window-length), mode=mode)
        prediction = ContextModel()(part[None], [49, 15, 4, 20, 33])[0]
        envelope = torch.ones(window)
        fade = window // 10
        envelope[:fade] = torch.linspace(0, 1, fade)
        envelope[-fade:] = torch.linspace(1, 0, fade)
        if start == 0:
            envelope[:fade] = 1
        elif start + step >= x.shape[-1]:
            envelope[-fade:] = 1
        result[..., start:start+length] += prediction[..., :length] * envelope[:length]
        counter[..., start:start+length] += envelope[:length]
    result = torch.nan_to_num(result/counter).numpy()
    if padded:
        result = result[..., border:-border]
    return result.transpose(0, 2, 1)


class StreamingRecipeTests(unittest.TestCase):
    def test_batch_slicing_keeps_entire_sequence_and_weights(self):
        torch.manual_seed(108)
        model=Transformer(dim=16,depth=2,heads=2,dim_head=8).eval()
        x=torch.randn(11,37,16)
        with torch.inference_mode():
            expected=model(x)
            model.inference_batch_limit=3
            actual=model(x)
        torch.testing.assert_close(actual,expected,atol=2e-6,rtol=2e-5)
        self.assertEqual(actual.shape,x.shape)

    def test_low_memory_selection_and_invalid_modes(self):
        self.assertEqual(adapter.memory_profile('balanced',4*1024**3),'low')
        self.assertEqual(adapter.memory_profile('balanced',6*1024**3),'balanced')
        self.assertEqual(adapter.memory_profile('low',20*1024**3),'low')
        with self.assertRaises(ValueError):adapter.memory_profile('tiny',None)

    def test_query_tiling_preserves_all_key_value_context(self):
        torch.manual_seed(104)
        q, k, v = torch.randn(2, 3, 511, 16), torch.randn(2, 3, 733, 16), torch.randn(2, 3, 733, 16)
        for scale in [None, .125]:
            attention = Attend(flash=True, scale=scale).eval()
            with torch.inference_mode():
                expected = attention(q, k, v)
                attention.cpu_query_chunk_size = 64
                actual = attention(q, k, v)
            torch.testing.assert_close(actual, expected, atol=2e-6, rtol=2e-5)

    def test_streaming_equals_reference_at_short_exact_and_long_boundaries(self):
        config = {'audio': {'sample_rate': 44100}, 'inference': {
            'chunk_size': 100, 'num_overlap': 2, 'normalize': False}}
        for frames in [1, 49, 50, 51, 99, 100, 101, 150, 201, 351]:
            with self.subTest(frames=frames), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                audio = np.random.default_rng(frames).normal(0, .2, (frames, 2)).astype('float32')
                source = root/'source.wav'
                sf.write(source, audio, 44100, subtype='FLOAT')
                with patch.object(adapter, 'load_model', return_value=(ContextModel(), config, [49, 15, 4, 20, 33], 0)):
                    files, _ = adapter.separate_mega(source, root, root, lambda *args: None)
                actual = np.stack([sf.read(root/file['file'], dtype='float32', always_2d=True)[0] for file in files])
                np.testing.assert_allclose(actual[:5], upstream_reference(audio), atol=1e-7, rtol=1e-6)
                np.testing.assert_allclose(actual.sum(0), audio, atol=1e-7)
                self.assertFalse(list(root.glob('*.tmp')))
                metrics = json.loads((root/'model-metrics.json').read_text(encoding='utf-8'))
                self.assertEqual(metrics['fadeFrames'], 10)
                self.assertEqual(metrics['borderPaddingFrames'], 50 if frames > 100 else 0)

    def test_wrong_rate_and_unreviewed_normalization_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root/'source.wav'
            config = {'audio': {'sample_rate': 44100}, 'inference': {'chunk_size': 100, 'num_overlap': 2, 'normalize': True}}
            with patch.object(adapter, 'load_model', return_value=(ContextModel(), config, [], 0)):
                sf.write(source, np.zeros((100, 2)), 48000)
                with self.assertRaisesRegex(ValueError, '44.1'):
                    adapter.separate_mega(source, root, root, lambda *args: None)
                sf.write(source, np.zeros((100, 2)), 44100)
                with self.assertRaisesRegex(ValueError, 'normalize=false'):
                    adapter.separate_mega(source, root, root, lambda *args: None)


if __name__ == '__main__':
    unittest.main()
