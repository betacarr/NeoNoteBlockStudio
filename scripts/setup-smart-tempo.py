"""Provision the pinned, MIT-licensed Beat This! CPU model in the current venv."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.request import urlopen


def verified_download(item, destination):
    if destination.is_file() and destination.stat().st_size == item['bytes']:
        if hashlib.sha256(destination.read_bytes()).hexdigest() == item['sha256']:
            return
    # Read only the pinned asset length; an HTTP error page or replaced asset
    # cannot be installed as either code or a model checkpoint.
    with urlopen(item['url'], timeout=30) as source:
        content = source.read(item['bytes'] + 1)
    if len(content) != item['bytes'] or hashlib.sha256(content).hexdigest() != item['sha256']:
        raise ValueError('Beat This! resource length or SHA-256 mismatch: ' + item['file'])
    with TemporaryDirectory(dir=destination.parent) as tmp:
        pending = Path(tmp) / item['file']
        pending.write_bytes(content)
        pending.replace(destination)


def main():
    if sys.prefix == sys.base_prefix:
        raise RuntimeError('Run this installer using NeoNBS’s project-local audio Python.')
    manifest = json.loads(Path(__file__).with_name('smart-tempo-model.json').read_text(encoding='utf-8'))
    models = Path(sys.prefix) / 'models'
    models.mkdir(exist_ok=True)
    with TemporaryDirectory() as tmp:
        wheel = Path(tmp) / manifest['wheel']['file']
        verified_download(manifest['wheel'], wheel)
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-index', '--no-deps', '--force-reinstall', str(wheel)], check=True)
    subprocess.run([sys.executable, '-c',
                    'from beat_this.inference import split_predict_aggregate; from beat_this.preprocessing import LogMelSpect'], check=True)
    checkpoint = models / manifest['checkpoint']['file']
    verified_download(manifest['checkpoint'], checkpoint)
    print('Beat This! small0 is ready for offline Smart Tempo.')


if __name__ == '__main__':
    main()
