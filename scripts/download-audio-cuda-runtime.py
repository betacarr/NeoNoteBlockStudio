"""Explicit optional CUDA runtime download. Never invoked by normal CPU usage."""
import hashlib
import json
from pathlib import Path
import time
import ssl
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from threading import Event

ROOT = Path(__file__).resolve().parent.parent
URL = 'https://download-r2.pytorch.org/whl/cu126/torch-2.8.0%2Bcu126-cp310-cp310-win_amd64.whl'
SHA = '3b43acaa40ac87495d858bb1dbe574aaaff4e60e9da6221825ece694fd1d2b80'
SIZE = 2915462477
NAME = 'torch-2.8.0+cu126-cp310-cp310-win_amd64.whl'

def hash_file(path):
    digest=hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda:file.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        from urllib.parse import urlsplit
        target = urlsplit(newurl)
        if target.scheme != 'https' or target.hostname not in {'download.pytorch.org', 'download-r2.pytorch.org'}:
            raise ValueError('CUDA runtime redirected outside the official HTTPS source')
        return super().redirect_request(request, fp, code, message, headers, newurl)


def download():
    directory = ROOT/'.local/runtime-downloads'
    directory.mkdir(parents=True, exist_ok=True)
    target = directory/NAME
    partial = directory/(NAME+'.part')
    progress = ROOT/'.local/audio-cuda-install-progress.json'
    started = time.monotonic()
    last_print = 0.
    def publish(state, offset, **extra):
        nonlocal last_print
        data = dict(state=state, source=URL, expectedSha256=SHA, downloadedBytes=offset, totalBytes=SIZE, elapsedSeconds=time.monotonic()-started, **extra)
        progress.write_text(json.dumps(data,indent=2),encoding='utf-8')
        if state != 'downloading' or time.monotonic()-last_print > 10:
            print(json.dumps(data),flush=True);last_print=time.monotonic()
    if target.is_file():
        if target.stat().st_size == SIZE and hash_file(target) == SHA:
            publish('verified-cache',SIZE);return target
        raise ValueError('Existing runtime archive failed validation; preserved without overwrite')
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > SIZE:raise ValueError('Invalid optional runtime partial file size; preserved')
    digest=hashlib.sha256()
    if offset:
        with partial.open('rb') as file:
            for block in iter(lambda:file.read(1024*1024),b''):digest.update(block)
    stopped=Event()
    def fetch_segment(start,end):
        opener=urllib.request.build_opener(OfficialRedirect())
        try:
            for attempt in range(4):
                if stopped.is_set():raise RuntimeError('Another segment stopped the optional runtime transfer')
                try:
                    request=urllib.request.Request(URL,headers={'Range':'bytes=%d-%d'%(start,end),'Accept-Encoding':'identity'})
                    with opener.open(request,timeout=45) as response:
                        if response.status != 206 or response.headers.get('Content-Range') != 'bytes %d-%d/%d'%(start,end,SIZE):
                            raise ValueError('Official runtime range/size mismatch; response was not appended')
                        block=response.read(end-start+2)
                        if len(block)!=end-start+1:raise OSError('Runtime segment was interrupted')
                    return block
                except urllib.error.HTTPError as error:
                    if error.code not in [429,500,502,503,504] or attempt==3:raise
                    print(json.dumps(dict(state='segment-retry',start=start,attempt=attempt+1,reason='HTTP '+str(error.code))),flush=True);stopped.wait(2**attempt)
                except urllib.error.URLError as error:
                    reason=error.reason
                    if isinstance(reason,ssl.SSLError) or isinstance(reason,PermissionError) or attempt==3:raise
                    print(json.dumps(dict(state='segment-retry',start=start,attempt=attempt+1,reason=str(reason)[:200])),flush=True);stopped.wait(2**attempt)
                except (OSError,TimeoutError) as error:
                    if isinstance(error,(PermissionError,ssl.SSLError)) or attempt==3:raise
                    print(json.dumps(dict(state='segment-retry',start=start,attempt=attempt+1,reason=str(error)[:200])),flush=True);stopped.wait(2**attempt)
        except Exception:
            stopped.set();raise
    publish('downloading',offset,parallelSegments=4)
    with partial.open('ab') as file, ThreadPoolExecutor(max_workers=4) as pool:
        while offset < SIZE:
            starts=list(range(offset,min(offset+4*16*1024*1024,SIZE),16*1024*1024))
            futures=[pool.submit(fetch_segment,start,min(start+16*1024*1024,SIZE)-1) for start in starts]
            for future in futures:
                block=future.result()
                file.write(block);file.flush();digest.update(block);offset+=len(block);publish('downloading',offset,parallelSegments=4)
    if digest.hexdigest()!=SHA:raise ValueError('Official CUDA wheel SHA256 mismatch; partial preserved and not installed')
    partial.rename(target);publish('verified',SIZE);return target


if __name__=='__main__':
    try:print(str(download()),flush=True)
    except Exception as error:
        status=ROOT/'.local/audio-cuda-install-progress.json'
        try:
            data=json.loads(status.read_text(encoding='utf-8'));data.update(state='failed',error=str(error));status.write_text(json.dumps(data,indent=2),encoding='utf-8')
        except (OSError,ValueError):pass
        print(json.dumps(dict(state='failed',error=str(error))),flush=True);raise
