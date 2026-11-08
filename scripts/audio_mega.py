"""Pinned MVSEP Mega inference adapter. No network or implicit checkpoint downloads."""
import ctypes
import hashlib
import json
import os
import sys
import time
import uuid
import subprocess
import shutil
from contextlib import contextmanager
from threading import Event, Thread
from pathlib import Path

CONFIG = 'mvsep_mega_model_bs_roformer_53_stems.yaml'
WEIGHTS = 'mvsep_mega_model_bs_roformer_53_stems_v1.ckpt'
CONFIG_SHA = '7e198062a251587088adb91215a4f44ab59e67bd62fcc805cf54d6e7dfc51103'
WEIGHTS_SHA = 'c62820893bbf86d4e734f966bd142d9157cfc8bb8e79e9d8f9ea553f3ff3519f'
MODEL_ID = 'mvsep-mega-53-five-heads-residual'
MODEL_VERSION = 'v1.0.21/c6282089/five-residual-v5'
TARGETS = ['vocal', 'drums', 'bass', 'guitar', 'piano']
ROLES = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']
NAMES = ['人声', '鼓', '贝斯', '吉他', '钢琴', '其他（残余）']
DRUM_TARGETS = ['kick', 'snare', 'hh', 'toms']
DRUM_ROLES = ['kick', 'snare', 'hi-hat', 'toms', 'other-drums']
DRUM_NAMES = ['底鼓', '军鼓', '踩镲', '通鼓', '其他鼓和打击乐（含镲片残余）']

class CudaFallback(RuntimeError):
    """One optional CUDA attempt may fall back to the complete CPU path."""


def available_memory():
    if os.name == 'nt':
        class Status(ctypes.Structure):
            _fields_ = [('length',ctypes.c_ulong),('load',ctypes.c_ulong)] + [(name,ctypes.c_ulonglong) for name in ['total','available','page','page_available','virtual','virtual_available','extended']]
        status=Status();status.length=ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.available)
    return None


def memory_profile(requested, available):
    if requested not in ('balanced','low'):raise ValueError('无效的 CPU 内存模式。')
    return 'low' if requested=='low' or available is not None and available<5*1024**3 else 'balanced'


@contextmanager
def progress_pulse(emit, phase, progress, message):
    stopped=Event();started=time.perf_counter()
    def pulse():
        while not stopped.wait(5):
            emit(phase,progress,message+' · 当前步骤已用 %d 秒，可取消' % (time.perf_counter()-started))
    thread=Thread(target=pulse,daemon=True);thread.start()
    try:yield
    finally:stopped.set();thread.join(timeout=1)


def chunk_plan(frames, window, num_overlap):
    if frames < 1 or window < 10 or num_overlap < 1 or window // num_overlap < 1:
        raise ValueError('无效的 Mega 分块范围。')
    step = window // num_overlap
    border = window - step
    padding = border if border > 0 and frames > 2 * border else 0
    # Reference demix also evaluates tail windows wholly outside the region
    # retained after border cropping. Those cannot contribute to any output.
    starts = [start for start in range(0, frames + 2 * padding, step)
              if start < padding + frames and start + window > padding]
    return starts, padding, step


def read_chunk(source, start, length, padding):
    """Read a window of the upstream reflect-padded mix without loading a song."""
    import numpy as np
    indices = np.arange(start - padding, start - padding + length)
    if padding:
        period = 2 * (len(source) - 1)
        indices %= period
        indices = np.minimum(indices, period - indices)
    first, last = int(indices.min()), int(indices.max())
    source.seek(first)
    return source.read(last - first + 1, dtype='float32', always_2d=True)[indices - first]


def chunk_envelope(window, start, total, step):
    import torch
    # Match utils/model_utils.py at the pinned upstream commit: 10% fades,
    # first/last edge exceptions, and one shared counter for every output.
    fade = window // 10
    envelope = torch.ones(window)
    envelope[:fade] = torch.linspace(0, 1, fade)
    envelope[-fade:] = torch.linspace(1, 0, fade)
    if start == 0:
        envelope[:fade] = 1
    elif start + step >= total:
        envelope[-fade:] = 1
    return envelope.numpy()


def peak_memory():
    if os.name == 'nt':
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('faults', wintypes.DWORD)] + [(name, ctypes.c_size_t) for name in ['peak', 'working', 'pagepeak', 'page', 'nonpagepeak', 'nonpage', 'pagefile', 'pagefilepeak']]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        kernel, api = ctypes.windll.kernel32, ctypes.windll.psapi
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        api.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        if api.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            return int(counters.peak)
        return None
    import resource
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == 'darwin' else 1024))


def verify(filename, expected):
    digest = hashlib.sha256()
    with open(filename, 'rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != expected:
        raise ValueError('Mega 模型资源校验失败，请在模型管理中重新下载。')


def load_model(models, emit, active_targets=TARGETS, device='cpu', threads=0, memory_mode='balanced'):
    import torch
    import yaml
    from mega_roformer import BSRoformer
    from packaging.version import Version
    modern=Version(torch.__version__.split('+')[0])>=Version('2.8')
    if device not in ('cpu','cuda','mps') or not isinstance(threads,int) or not 0<=threads<=16:
        raise ValueError('无效的计算设备或 CPU 线程数。')
    free_memory=available_memory();profile=memory_profile(memory_mode,free_memory)
    required_memory=(3 if modern else 5)*1024**3
    if free_memory is not None and free_memory<required_memory:
        hint='释放内存后可重试低内存分轨。' if modern else '新版 CPU 环境可降低加载占用，无需 GPU。'
        raise MemoryError('当前可用内存不足约 %d GiB，已保留原音频与预览。可先使用节拍／和弦分析；%s' % (3 if modern else 5,hint))
    gpu_free=None
    cuda_api_free,smi_free,gpu_budget=None,None,None
    if device=='cuda':
        if not torch.cuda.is_available():raise CudaFallback('可选 CUDA 设备不可用，将转回 CPU。')
        torch.cuda.init();cuda_api_free,gpu_total=torch.cuda.mem_get_info();gpu_free=cuda_api_free
        # WDDM CUDA budgets can exceed current physical free VRAM. When the
        # installed driver tool is available, use its more conservative reading.
        smi=Path(os.environ.get('SystemRoot',r'C:\Windows'))/'System32/nvidia-smi.exe' if os.name=='nt' else shutil.which('nvidia-smi')
        try:
            if smi:
                value=subprocess.run([str(smi),'--query-gpu=memory.free','--format=csv,noheader,nounits','--id=0'],capture_output=True,text=True,timeout=3,check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)).stdout.strip()
                smi_free=int(value)*1024**2
                if 0<=smi_free<=gpu_total:gpu_free=min(gpu_free,smi_free)
        except (OSError,ValueError,subprocess.SubprocessError):pass
        if gpu_free<1536*1024**2:raise CudaFallback('GPU 空闲显存不足约 1.5 GiB，将转回 CPU；其他程序保持不变。')
        gpu_budget=min(3*1024**3,.75*gpu_total,gpu_free-384*1024**2)
        torch.cuda.set_per_process_memory_fraction(gpu_budget/gpu_total)
        torch.backends.cuda.matmul.allow_tf32=False;torch.backends.cudnn.allow_tf32=False
        torch.set_float32_matmul_precision('highest')
        torch.backends.cudnn.deterministic=True;torch.cuda.reset_peak_memory_stats()
    if device=='mps':
        if not torch.backends.mps.is_available():raise RuntimeError('Apple MPS 不可用，请使用 CPU。')
        # Keep a conservative allocator budget on shared-memory Macs.
        torch.mps.set_per_process_memory_fraction(.65)
    directory = Path(models) / 'mvsep-mega-53'
    emit('model', .05, '校验已下载的 Mega 官方模型资源；不联网')
    verify(directory / CONFIG, CONFIG_SHA)
    verify(directory / WEIGHTS, WEIGHTS_SHA)
    class ConfigLoader(yaml.SafeLoader):
        pass
    # The pinned YAML uses tuples. Support that one container tag only; never
    # allow arbitrary python objects/functions via yaml.FullLoader/unsafe_load.
    ConfigLoader.add_constructor('tag:yaml.org,2002:python/tuple', lambda loader, node: tuple(loader.construct_sequence(node)))
    config = yaml.load((directory / CONFIG).read_text(encoding='utf-8'), Loader=ConfigLoader)
    labels = config['training']['instruments']
    if len(labels) != 53 or len(set(labels)) != 53 or config['model']['num_stems'] != 53:
        raise ValueError('Mega 目标定义与已审核的 53 类配置不一致。')
    indices = [labels.index(name) for name in active_targets] if active_targets is not None else list(range(53))
    torch.set_num_threads(max(1,min(threads or 8,os.cpu_count() or 1)))
    started = time.perf_counter()
    emit('model', .07, '准备 Mega FP32 权重；%s，%s内存模式' % ('CUDA 实验加速' if device=='cuda' else 'Apple MPS 实验加速' if device=='mps' else 'CPU %d 线程' % torch.get_num_threads(),'低占用' if profile=='low' else '均衡'))
    if modern:
        with torch.device('meta'):model=BSRoformer(**config['model'])
    else:model=BSRoformer(**config['model'])
    checkpoint = torch.load(directory / WEIGHTS, map_location='cpu', weights_only=True, **({'mmap':True} if modern else {}))
    state = checkpoint.get('state_dict', checkpoint) if isinstance(checkpoint, dict) else checkpoint
    if not isinstance(state, dict) or not state or not all(isinstance(value, torch.Tensor) for value in state.values()):
        raise ValueError('Mega 权重不是预期的安全 Tensor 状态字典，已停止。')
    if all(key.startswith('module.') for key in state):
        state = {key[7:]: value for key, value in state.items()}
    model.load_state_dict(state, strict=True, **({'assign':True} if modern else {}))
    del checkpoint, state
    # Strictly validate all 53 heads before releasing unused tensor storage.
    # Keep their positions/modules on meta; never rename or sum categories.
    for index,head in enumerate(model.mask_estimators):
        head.to(device=device,dtype=torch.float32) if index in indices else head.to('meta')
    for name,module in model.named_children():
        if name!='mask_estimators':module.to(device=device,dtype=torch.float32)
    model.eval();model.requires_grad_(False)
    for block in model.layers:
        block[-2].inference_batch_limit=1 if device in ('cuda','mps') else 8 if profile=='low' else 0
        block[-1].inference_batch_limit=32 if device in ('cuda','mps') else 64 if profile=='low' else 0
    if Version(torch.__version__.split('+')[0]) < Version('2.2'):
        from mega_roformer.attend import Attend
        for module in model.modules():
            if isinstance(module, Attend):
                module.cpu_query_chunk_size = 256
    if device=='cuda':
        from mega_roformer.attend import Attend
        for module in model.modules():
            if isinstance(module,Attend):module.cuda_math_only=True
    model._neonbs_device=device;model._neonbs_memory_profile=profile
    model._neonbs_available_memory=free_memory;model._neonbs_gpu_free=gpu_free
    model._neonbs_gpu_api_free=cuda_api_free;model._neonbs_gpu_smi_free=smi_free;model._neonbs_gpu_budget=gpu_budget
    model._neonbs_loader='meta-mmap-selected-fp32' if modern else 'compatible-selected-fp32'
    return model, config, indices, time.perf_counter() - started


def separate_mega(source_path, out, models, emit, device='cpu', threads=0, memory_mode='balanced', drum_pieces=False):
    import numpy as np
    import soundfile as sf
    import torch
    started = time.perf_counter()
    targets = TARGETS + DRUM_TARGETS if drum_pieces else TARGETS
    roles = ROLES + DRUM_ROLES if drum_pieces else ROLES
    names = NAMES + DRUM_NAMES if drum_pieces else NAMES
    target_options = {'active_targets': targets} if drum_pieces else {}
    with progress_pulse(emit,'model',.07,'加载本地模型'):
        model, config, indices, loading = load_model(models, emit,device=device,threads=threads,memory_mode=memory_mode,**target_options)
    actual_device=getattr(model,'_neonbs_device','cpu')
    info = sf.info(source_path)
    rate, frames = info.samplerate, info.frames
    if rate != config['audio']['sample_rate'] or info.channels != 2:
        raise ValueError('Mega 输入必须为完整对齐的 44.1 kHz 立体声。')
    window = int(config['inference']['chunk_size'])
    if config['inference'].get('normalize', False):
        raise ValueError('当前已审核的 Mega 配置要求 normalize=false。')
    starts, padding, step = chunk_plan(frames, window, int(config['inference']['num_overlap']))
    total = frames + 2 * padding
    accumulator_path, weight_path = out / 'mega-accumulator.tmp', out / 'mega-envelope.tmp'
    accumulator = np.memmap(accumulator_path, dtype='float32', mode='w+', shape=(len(targets), frames, 2))
    weights = np.memmap(weight_path, dtype='float32', mode='w+', shape=(frames,))
    accumulator[:] = 0
    weights[:] = 0
    inference_started = time.perf_counter()
    with sf.SoundFile(source_path) as source, torch.inference_mode():
        for index, start in enumerate(starts):
            block = read_chunk(source, start, min(window, total - start), padding)
            if not np.isfinite(block).all():
                raise ValueError('Mega 输入包含无效采样。')
            # Official forward supports target selection after its shared encoder.
            # Keep the broad heads and drum-kit predictions on separate paths.
            input_tensor = torch.from_numpy(block.T.copy())[None].to(actual_device)
            # The reference always evaluates a full configured window. Attention
            # context changes if a short tail is instead evaluated unpadded.
            pad_mode = 'reflect' if len(block) > window // 2 else 'constant'
            input_tensor = torch.nn.functional.pad(input_tensor, (0, window - len(block)), mode=pad_mode)
            fraction=.12+.65*index/len(starts)
            message='Mega %s 分块 %d/%d（完整 20 秒窗口）' % (actual_device.upper(),index+1,len(starts))
            emit('separating',fraction,message)
            try:
                with progress_pulse(emit,'separating',fraction,message):
                    result = model(input_tensor, active_stem_ids=indices)[0, :, :, :len(block)].cpu()
            except torch.cuda.OutOfMemoryError as error:
                raise CudaFallback('本次 GPU 显存不足，将释放本次 GPU 工作进程并转回 CPU。') from error
            if tuple(result.shape) != (len(targets), 2, len(block)) or not bool(torch.isfinite(result).all()):
                raise ValueError('Mega 返回的时间轴、声道或数值无效。')
            envelope = chunk_envelope(window, start, total, step)
            begin, end = max(start, padding), min(start + len(block), padding + frames)
            if end > begin:
                left, right = begin - start, end - start
                target = slice(begin - padding, end - padding)
                accumulator[:, target] += result[:, :, left:right].permute(0, 2, 1).numpy() * envelope[None, left:right, None]
                weights[target] += envelope[left:right]
            emit('separating', .12 + .65 * (index + 1) / len(starts), 'Mega 试用分轨 %d/%d：五类预测＋残余' % (index + 1, len(starts)))
            del result
    inference_seconds = time.perf_counter() - inference_started
    ids = [str(uuid.uuid4()) for _ in roles]
    handles = [sf.SoundFile(out / (asset_id + '.wav'), 'w', samplerate=rate, channels=2, subtype='FLOAT') for asset_id in ids]
    energies, peaks, cross = np.zeros(len(roles)), np.zeros(len(roles)), np.zeros((len(roles), len(roles)))
    closure_peak = 0.0
    try:
        with sf.SoundFile(source_path) as source:
            for start in range(0, frames, 262144):
                end = min(frames, start + 262144)
                original = source.read(end - start, dtype='float32', always_2d=True)
                predictions = accumulator[:, start:end] / np.maximum(weights[start:end, None], 1e-8)
                broad = predictions[:len(TARGETS)]
                residual = original - broad.sum(axis=0)
                all_stems = np.concatenate([broad, residual[None]], axis=0)
                if drum_pieces:
                    pieces = predictions[len(TARGETS):]
                    drum_residual = broad[TARGETS.index('drums')] - pieces.sum(axis=0)
                    all_stems = np.concatenate([all_stems, pieces, drum_residual[None]], axis=0)
                closure_peak = max(closure_peak, float(np.max(np.abs(all_stems[:len(ROLES)].sum(axis=0) - original))))
                for index, handle in enumerate(handles):
                    handle.write(all_stems[index])
                flat = all_stems.reshape(len(roles), -1).astype('float64')
                energies += np.sum(flat ** 2, axis=1)
                peaks = np.maximum(peaks, np.max(np.abs(flat), axis=1))
                cross += flat @ flat.T
    finally:
        for handle in handles:
            handle.close()
    query_chunk = max((getattr(module, 'cpu_query_chunk_size', 0) for module in model.modules()), default=0) if hasattr(model, 'modules') else None
    execution=dict(device=actual_device,attentionBackend='math-fp32' if actual_device=='cuda' else 'native-mps' if actual_device=='mps' else 'native-cpu',memoryProfile=getattr(model,'_neonbs_memory_profile','balanced'),availableMemoryBeforeBytes=getattr(model,'_neonbs_available_memory',None),loader=getattr(model,'_neonbs_loader','test'),gpuFreeBeforeBytes=getattr(model,'_neonbs_gpu_free',None),gpuCudaApiFreeBeforeBytes=getattr(model,'_neonbs_gpu_api_free',None),gpuPhysicalFreeBeforeBytes=getattr(model,'_neonbs_gpu_smi_free',None),gpuAllocatorBudgetBytes=getattr(model,'_neonbs_gpu_budget',None),gpuPeakAllocatedBytes=torch.cuda.max_memory_allocated() if actual_device=='cuda' else None,gpuPeakReservedBytes=torch.cuda.max_memory_reserved() if actual_device=='cuda' else None)
    del accumulator, weights, model
    accumulator_path.unlink()
    weight_path.unlink()
    metrics = dict(model=MODEL_ID, version=MODEL_VERSION, configSha256=CONFIG_SHA, checkpointSha256=WEIGHTS_SHA,
        torchVersion=torch.__version__, **execution, threads=torch.get_num_threads(), sampleRate=rate, frames=frames,
        targetNames=targets, targetIndices=indices, windowFrames=window, overlapFrames=window-step, chunks=len(starts),
        stepFrames=step, fadeFrames=window//10, borderPaddingFrames=padding, inputNormalization=False,
        upstreamChunks=(total+step-1)//step, skippedPaddingOnlyChunks=(total+step-1)//step-len(starts),
        cpuQueryChunkFrames=query_chunk,
        recipe='pinned-upstream-generic-batch1-float32-'+actual_device,
        modelLoadSeconds=loading, inferenceSeconds=inference_seconds, totalSeconds=time.perf_counter() - started,
        peakWorkingSetBytes=peak_memory(), reconstructionPeakError=closure_peak,
        stemRms=np.sqrt(energies / (frames * 2)).tolist(), stemPeak=peaks.tolist(),
        normalizedCrossEnergy=(cross / np.maximum(np.sqrt(energies[:, None] * energies[None, :]), 1e-20)).tolist(),
        nativeSixStem=False, semanticExclusivityVerified=False,
        warning='其他为原混音减五类预测的残余；代数重构不证明声部互斥，残余可能含抵消与泄漏。')
    (out / 'model-metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding='utf-8')
    files = [dict(id=asset_id, name=name + '.wav', file=asset_id + '.wav', mime='audio/wav') for asset_id, name in zip(ids, names)]
    stems = [dict(id=str(uuid.uuid4()), role=role, name=name, assetId=asset_id, gain=1, muted=False, solo=False) for asset_id, role, name in zip(ids, roles, names)]
    return files, stems
