"""Bounded real-weight compute comparison; no network or implicit downloads."""
import argparse
import json
from pathlib import Path
import sys
import time

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'third_party'))
from audio_mega import separate_mega

parser=argparse.ArgumentParser()
parser.add_argument('--input',required=True)
parser.add_argument('--models',required=True)
parser.add_argument('--output',required=True)
parser.add_argument('--device',choices=['cpu','cuda'],default='cpu')
parser.add_argument('--threads',type=int,default=0)
parser.add_argument('--memory',choices=['balanced','low'],default='balanced')
args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=False)
started=time.perf_counter()
def emit(phase,progress,message):
    print(json.dumps(dict(phase=phase,progress=progress,message=message),ensure_ascii=False),flush=True)
try:
    files,stems=separate_mega(args.input,out,args.models,emit,device=args.device,threads=args.threads,memory_mode=args.memory)
    (out/'outputs.json').write_text(json.dumps(dict(files=files,stems=stems),ensure_ascii=False,indent=2),encoding='utf-8')
    report=dict(status='passed',input=str(Path(args.input).resolve()),deviceRequested=args.device,elapsedSeconds=time.perf_counter()-started,metrics=json.loads((out/'model-metrics.json').read_text(encoding='utf-8')))
except Exception as error:
    report=dict(status='failed',input=str(Path(args.input).resolve()),deviceRequested=args.device,elapsedSeconds=time.perf_counter()-started,error=repr(error))
    raise
finally:
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False),flush=True)
