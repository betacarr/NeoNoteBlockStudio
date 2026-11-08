"""Compare identical FP32 compute inputs and both full/overlapping references."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import soundfile as sf

ROLES=['vocals','drums','bass','guitar','piano','other']
def load(directory):
    result=json.loads((directory/'outputs.json').read_text(encoding='utf-8'))
    files={file['id']:directory/file['file'] for file in result['files']}
    return {stem['role']:sf.read(files[stem['assetId']],dtype='float32',always_2d=True)[0] for stem in result['stems']}
def si_sdr(estimate,reference):
    a,b=estimate.astype('float64').ravel(),reference.astype('float64').ravel()
    projected=b*(a@b/max(b@b,1e-30))
    return 10*float(np.log10(max(projected@projected,1e-30)/max((a-projected)@(a-projected),1e-30)))
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--baseline',required=True);parser.add_argument('--candidate',required=True);parser.add_argument('--references',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    base,candidate=Path(args.baseline),Path(args.candidate)
    before=json.loads((base/'report.json').read_text(encoding='utf-8'));after=json.loads((candidate/'report.json').read_text(encoding='utf-8'))
    assert before['status']=='passed' and after['status']=='passed'
    digest=lambda file:hashlib.sha256(Path(file).read_bytes()).hexdigest()
    assert digest(before['input'])==digest(after['input'])
    first,second=load(base),load(candidate)
    reference={role:sf.read(Path(args.references)/('reference-'+role+'.wav'),dtype='float32',always_2d=True)[0] for role in ROLES}
    stack=np.stack([reference[role] for role in ROLES]);hop=441
    envelope=np.mean(stack[:,:stack.shape[1]//hop*hop].reshape(6,-1,hop,2).astype('float64')**2,axis=(2,3))
    all_six=(envelope>envelope.max(axis=1)[:,None]*.001).all(axis=0);mask=np.repeat(all_six,hop)
    rows=[]
    for role in ROLES:
        a,b=first[role],second[role];assert a.shape==b.shape==reference[role].shape and np.isfinite(b).all()
        error=b.astype('float64')-a;rms=float(np.sqrt(np.mean(error**2)));relative=rms/max(float(np.sqrt(np.mean(a.astype('float64')**2))),1e-20)
        full_before,full_after=si_sdr(a,reference[role]),si_sdr(b,reference[role])
        overlap_before,overlap_after=si_sdr(a[mask],reference[role][mask]),si_sdr(b[mask],reference[role][mask])
        rows.append(dict(role=role,maxAbsoluteDifference=float(np.abs(error).max()),differenceRms=rms,relativeRmsError=relative,fullReferenceSiSdrDb=[full_before,full_after],allSixActiveSiSdrDb=[overlap_before,overlap_after],passed=float(np.abs(error).max())<=1e-4 and relative<=.001 and full_after>=full_before-.1 and overlap_after>=overlap_before-.1))
    report=dict(status='passed' if all(row['passed'] for row in rows) else 'failed',inputSha256=digest(before['input']),baseline=str(base.resolve()),candidate=str(candidate.resolve()),baselineMetrics=before['metrics'],candidateMetrics=after['metrics'],allSixActiveSeconds=float(all_six.sum())*.01,activityDefinition='10ms windows exceeding -30 dB of each independent reference peak RMS',roles=rows)
    Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(dict(status=report['status'],roles=rows),ensure_ascii=False))
    if report['status']!='passed':raise SystemExit(1)
if __name__=='__main__':main()
