#!/bin/bash
# Project-local macOS runtime, including the small Beat This! model.
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
runtime_dir="${1:-$script_dir/../.local/audio-runtime}"
if [[ "$(uname -s)" != Darwin ]]; then echo 'This setup is for macOS.' >&2; exit 1; fi
PYTHON="${NEONBS_PYTHON:-}"
if [[ -z "$PYTHON" ]]; then
  for candidate in /opt/homebrew/bin/python3.11 /usr/local/bin/python3.11 python3.11; do
    if command -v "$candidate" >/dev/null 2>&1; then PYTHON="$candidate"; break; fi
  done
fi
if [[ -z "$PYTHON" ]]; then echo 'Python 3.11 is required. Set NEONBS_PYTHON to an existing interpreter.' >&2; exit 1; fi
"$PYTHON" -c 'import sys; assert sys.version_info[:2] == (3,11), "Use Python 3.11"'
case "$("$PYTHON" -c 'import platform; print(platform.machine())')" in
  arm64) torch_version=2.8.0 ;;
  x86_64) torch_version=2.2.2 ;;
  *) echo 'Unsupported macOS Python architecture.' >&2; exit 1 ;;
esac
runtime_python="$runtime_dir/bin/python"
if [[ ! -x "$runtime_python" ]]; then "$PYTHON" -m venv "$runtime_dir"; fi
"$runtime_python" -m pip install --index-url https://pypi.org/simple "torch==$torch_version" "torchaudio==$torch_version" -r "$script_dir/audio-assist-requirements.txt"
"$runtime_python" - "$torch_version" <<'PY'
import json, sys, torch, librosa, soundfile, soxr, yaml, beartype, rotary_embedding_torch
from pathlib import Path
assert torch.__version__.split('+')[0] == sys.argv[1]
runtime = Path(sys.prefix)
modern = runtime / 'neonbs-torch28-ready.json'
if sys.argv[1] == '2.8.0':
    modern.write_text(json.dumps(dict(schema=1,torch=torch.__version__)),encoding='utf-8')
else:
    modern.unlink(missing_ok=True)
marker=runtime / 'neonbs-mps-ready.json'
if sys.argv[1] == '2.8.0' and torch.backends.mps.is_available():
    assert torch.ones(2,device='mps').sum().item() == 2
    marker.write_text(json.dumps(dict(schema=1,torch=torch.__version__,scope='optional-mps-experimental')),encoding='utf-8')
    print('CPU runtime and optional Apple MPS available. CPU remains the default.')
else:
    marker.unlink(missing_ok=True)
    print('CPU runtime ready.')
PY
"$runtime_python" "$script_dir/setup-smart-tempo.py"
