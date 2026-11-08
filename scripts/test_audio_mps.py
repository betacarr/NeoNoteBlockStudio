"""Tiny offline MPS regression; no model weights or network required."""
import sys
import unittest
from pathlib import Path
import torch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'third_party'))
from mega_roformer import BSRoformer

@unittest.skipUnless(torch.backends.mps.is_available(), 'Apple MPS unavailable')
class MpsSpectrumTests(unittest.TestCase):
    def test_dc_suppression_reconstructs_without_complex_scatter_abort(self):
        torch.manual_seed(12)
        model = BSRoformer(dim=16, depth=1, stereo=True, num_stems=2,
            heads=2, dim_head=8, time_transformer_depth=1, freq_transformer_depth=1,
            freqs_per_bands=(8, 9), stft_n_fft=32, stft_win_length=32,
            stft_hop_length=8, zero_dc=True).eval()
        signal = torch.randn(1, 2, 128)
        with torch.inference_mode():
            cpu = model(signal)
            mps = model.to('mps')(signal.to('mps')).cpu()
        self.assertEqual(cpu.shape, mps.shape)
        self.assertTrue(torch.isfinite(mps).all())
        torch.testing.assert_close(mps, cpu, atol=2e-4, rtol=2e-3)

if __name__ == '__main__':
    unittest.main()
