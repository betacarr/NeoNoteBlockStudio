"""Real worker pipeline, controlled separator/analyzer; no neural weights required."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import numpy as np
import soundfile as sf
import soxr  # Import once outside patch.dict: native extension cannot be re-imported.

spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('audio-assist-worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class TaskModes(unittest.TestCase):
    def run_mode(self, mode, split):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, output = root/'input.wav', root/'output'
            sf.write(source, np.zeros((4410, 2), dtype='float32'), 44100)
            def separate(source, out, models, emit, **kwargs):
                sf.write(out/'stem.wav', np.zeros((4410, 2), dtype='float32'), 44100, subtype='FLOAT')
                (out/'model-metrics.json').write_text(json.dumps({'device':'cpu','memoryProfile':'balanced'}))
                return [dict(id='stem-asset',name='vocals.wav',file='stem.wav',mime='audio/wav')], [dict(id='stem',role='vocals',name='人声',assetId='stem-asset',gain=1,muted=False,solo=False)]
            fake = types.SimpleNamespace(separate_mega=separate, MODEL_ID='controlled', MODEL_VERSION='1')
            args = ['worker','--input',str(source),'--output',str(output),'--models',str(root)]
            if mode: args += ['--mode',mode]
            if split: args += ['--mega-model']
            with patch.object(sys,'argv',args), patch.dict(sys.modules,{'audio_mega':fake}), patch.object(worker,'analyze',return_value=(99.,0.,[0.],[])) as analyze:
                worker.main()
                result=json.loads((output/'result.json').read_text())['workspace']
                return result, analyze.call_count
    def test_split_skips_analysis(self):
        result,calls=self.run_mode('split',True)
        self.assertEqual(calls,0)
        self.assertFalse(result['analysisPerformed'])
        self.assertEqual(result['beats'],[])
        self.assertEqual(result['chords'],[])
        self.assertEqual(result['stems'][0]['role'],'vocals')
    def test_chords_does_not_separate(self):
        result,calls=self.run_mode('chords',False)
        self.assertEqual(calls,1)
        self.assertTrue(result['analysisPerformed'])
        self.assertEqual(result['stems'][0]['role'],'original')
        self.assertEqual(result['bpm'],99)
    def test_legacy_combined_remains_compatible(self):
        result,calls=self.run_mode(None,True)
        self.assertEqual(calls,1)
        self.assertEqual(result['stems'][0]['role'],'vocals')

    def test_adjacent_crops_share_one_sample_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'input.wav'
            pcm = np.arange(120, dtype='float32').reshape(60, 2) / 128
            sf.write(source, pcm, 44100, subtype='FLOAT')
            crops = []
            for index, (start, end) in enumerate(((1.4, 25.6), (25.6, 51.2))):
                output = root / str(index)
                args = ['worker', '--input', str(source), '--output', str(output), '--models', str(root),
                        '--decode-only', '--start-seconds', str(start / 44100), '--duration-seconds', str((end - start) / 44100)]
                with patch.object(sys, 'argv', args):
                    worker.main()
                result = json.loads((output / 'result.json').read_text())
                samples, _ = sf.read(output / result['files'][0]['file'], dtype='float32')
                crops.append(samples)
            np.testing.assert_array_equal(crops[0], pcm[1:26])
            np.testing.assert_array_equal(crops[1], pcm[26:51])

if __name__=='__main__': unittest.main()
