import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, existsSync, createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile, rename, rm, stat, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { stemSourceRoles, stemOutputRoles, validateAudioWorkspace, validateStemSelection, type AudioAssistRequest, type AudioAssistResult, type AudioAssistStatus, type AudioWorkspace } from '../src/core/audio-assist';
import type { AudioFileAsset } from '../src/core/types';
import smartTempoModel from '../scripts/smart-tempo-model.json';

const ALGORITHM = 'neonbs-audio-assist-2';
const MAX_INPUT = 64 * 1024 * 1024;
const MISSING_FFMPEG = '此音频格式需要本地 FFmpeg 解码器；请改用 WAV、FLAC 或 OGG。';

async function findLocalFfmpeg(): Promise<string | undefined> {
  const windows = process.platform === 'win32';
  const program = windows ? 'ffmpeg.exe' : 'ffmpeg';
  const directories = (process.env.PATH ?? '').split(path.delimiter).map(entry => entry.replace(/^"(.*)"$/, '$1'));
  if (windows) directories.push(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'ffmpeg', 'bin'));
  // Finder launches apps without a shell profile, so Homebrew may not be on PATH.
  if (process.platform === 'darwin') directories.push('/opt/homebrew/bin', '/usr/local/bin');
  for (const directory of new Set(directories.filter(entry => path.isAbsolute(entry)))) {
    const candidate = path.join(directory, program);
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* Try the next installed location. */ }
  }
}
type WorkerResult = { algorithm: string; workspace: AudioWorkspace; files: { id: string; name: string; mime: string; file: string }[] };
interface Job { id: string; owner: number; process?: ChildProcess; cancelled: boolean; abort: AbortController }
type AudioMeta = { sampleRate: number; frames: number; channels: number };
export interface AudioAssistOptions {
  /** Packaged workers run outside ASAR; the optional venv lives in user data. */
  runtimeBase?: string;
  workerRoot?: string;
  resolveAsset?: (owner:number, descriptor:AudioFileAsset)=>Promise<string>;
  researchModel?: boolean;
  modelStatus?: () => Promise<{ state: string }>;
  modelDirectory?: string;
  resolveInput?: (owner: number, handle: string) => Promise<{ path: string; name: string; size: number }>;
  publishAsset?: (owner: number, absolutePath: string, meta: AudioMeta) => Promise<AudioFileAsset>;
}

/** The renderer can provide audio bytes, never filesystem paths or executable arguments. */
export function registerAudioAssist(ipc: IpcMain, appRoot: string, userData: string,
  allowedSender: (event: IpcMainInvokeEvent) => boolean, options: AudioAssistOptions = {}): () => void {
  const runtimeBase = options.runtimeBase ?? path.join(appRoot, '.local');
  const workerRoot = options.workerRoot ?? path.join(appRoot, 'dist-electron');
  const workerCwd = options.workerRoot ?? appRoot;
  const runtimeRoot = path.join(runtimeBase, 'audio-runtime');
  const runtime = path.join(runtimeRoot, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const tempoCheckpoint = path.join(runtimeRoot, 'models', smartTempoModel.checkpoint.file);
  const fastRoot = path.join(runtimeBase, 'audio-runtime-fast');
  const fastRuntime = path.join(fastRoot, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const fastReady = !options.researchModel && existsSync(fastRuntime) && existsSync(path.join(fastRoot, 'neonbs-mega-ready.json'));
  const modernCpuReady = fastReady || existsSync(path.join(runtimeRoot,'neonbs-torch28-ready.json'));
  const cudaRoot = path.join(runtimeBase,'audio-runtime-cuda');
  const cudaRuntime = path.join(cudaRoot,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const cudaReady = ()=>!options.researchModel && existsSync(cudaRuntime) && existsSync(path.join(cudaRoot,'neonbs-cuda-ready.json'));
  const mpsReady = ()=>!options.researchModel && process.platform==='darwin' && existsSync(runtime) && existsSync(path.join(runtimeRoot,'neonbs-mps-ready.json'));
  const worker = path.join(workerRoot, 'audio-assist-worker.py');
  const models = options.researchModel ? path.join(appRoot, '.local', 'audio-models') : options.modelDirectory ?? path.join(userData, 'audio-models');
  const cache = path.join(userData, 'audio-assist');
  let active: Job | undefined;
  const guard = (event: IpcMainInvokeEvent) => { if (!allowedSender(event)) throw new Error('音频分析请求来源无效。'); };
  const status = async (checkModel = true): Promise<AudioAssistStatus> => {
    const research = checkModel && !!options.researchModel;
    const megaReady = checkModel && !research && (await options.modelStatus?.())?.state === 'ready' && existsSync(path.join(workerRoot, 'audio_mega.py'));
    return { available: existsSync(runtime) && existsSync(worker), canSeparate: research || megaReady, canSplitDrums: megaReady, optionalCudaAvailable:checkModel && cudaReady(), optionalMpsAvailable:checkModel && mpsReady(),
    modelReady: megaReady || research && existsSync(path.join(models, 'checkpoints', '5c90dfd2-34c22ccb.th')),
    message: !existsSync(runtime) ? options.runtimeBase ? '尚未安装可选的本地音频组件。请先按安装指南配置音频组件，再导入或分析音频。' : '本地音频分析运行环境尚未安装。' : options.researchModel
      ? '本地分析可用；六轨模型仅限个人／研究用途，首次分析按需下载官方权重。'
      : megaReady ? 'Mega 试用可用：五类预测＋其他残余，不是原生六轨；需试听确认声部效果。'
      : '本地 BPM、拍点与和弦分析可用。Mega 模型首次使用按需下载，完整校验后可试用。' };
  };
  ipc.handle('audio-assist:status', (event, mode?: 'split' | 'chords') => { guard(event); return status(mode !== 'chords'); });
  ipc.handle('audio-assist:cancel', (event, id: unknown) => {
    guard(event);
    if (active && active.owner === event.sender.id && active.id === id) {
      active.cancelled = true; active.abort.abort(); active.process?.kill(); return true;
    }
    return false;
  });
  ipc.handle('audio-assist:start', async (event, input: AudioAssistRequest & { separation?: boolean }): Promise<AudioAssistResult> => {
    guard(event);
    if (active) throw new Error('已有音频分析正在执行，请等待完成或取消。');
    if (!input || typeof input.id !== 'string' || !/^[\w-]{1,100}$/.test(input.id) || typeof input.name !== 'string' || !input.name || input.name.length > 200 || input.separation !== undefined && typeof input.separation !== 'boolean') throw new Error('音频请求无效。');
    if (input.mode !== undefined && !['split','chords'].includes(input.mode) || input.mode && input.separation !== undefined && input.separation !== (input.mode === 'split') || input.mode && input.decodeOnly) throw new Error('音频任务模式无效。');
    const selection = input.stemSelection;
    if (selection !== undefined) {
      if (input.mode !== 'split') throw new Error('声部设置仅用于分轨任务。');
      validateStemSelection(selection);
    }
    if (input.acceleration!==undefined && !['cpu','cuda','mps'].includes(input.acceleration) || input.cpuThreads!==undefined && (!Number.isInteger(input.cpuThreads) || input.cpuThreads<0 || input.cpuThreads>16) || input.memoryProfile!==undefined && !['balanced','low'].includes(input.memoryProfile)) throw new Error('音频计算设置无效。');
    if (input.decodeOnly!==undefined && typeof input.decodeOnly!=='boolean' || input.decodeOnly && input.separation) throw new Error('音频导入模式无效。');
    if (input.detectTempo !== undefined && (typeof input.detectTempo !== 'boolean' || input.detectTempo && (!input.decodeOnly || input.separation || input.mode))) throw new Error('音频曲速检测模式无效。');
    if(input.sourceRange && (!Number.isFinite(input.sourceRange.offsetSeconds)||input.sourceRange.offsetSeconds<0||!Number.isFinite(input.sourceRange.durationSeconds)||input.sourceRange.durationSeconds<=0||input.sourceRange.durationSeconds>7200)) throw new Error('音频片段分析范围无效。');
    const hasAsset=!!input.sourceAsset && typeof input.sourceAsset==='object';
    const hasHandle = typeof input.sourceHandle === 'string' && /^[\w-]{1,200}$/.test(input.sourceHandle);
    const hasBytes = input.bytes instanceof Uint8Array && input.bytes.length >= 44 && input.bytes.length <= MAX_INPUT;
    if (!hasAsset && !hasHandle && !hasBytes || input.sourceHandle !== undefined && !hasHandle) throw new Error('音频请求无效，请通过文件选择器导入音频。');
    const separation = input.mode ? input.mode === 'split' : input.separation ?? !!options.researchModel;
    const backend = await status(separation);
    if (separation && !backend.canSeparate) throw new Error('六轨模型未就绪，请先下载并完整校验模型资源；可先运行 BPM 与和弦分析。');
    if (selection?.drumPieces && !backend.canSplitDrums) throw new Error('当前分轨模型不支持单个鼓件。');
    if (!backend.available) throw new Error(backend.message);
    if (!options.publishAsset) throw new Error('持久音频资源存储尚未连接，不能开始分析。');
    if (active) throw new Error('已有音频分析正在执行，请等待完成或取消。');
    const requestedCuda=separation && !options.researchModel && input.acceleration==='cuda';
    const useCuda=requestedCuda && cudaReady();
    const requestedMps=separation && !options.researchModel && input.acceleration==='mps';
    const useMps=requestedMps && mpsReady();
    let executionDevice:'cpu'|'cuda'|'mps'=useCuda?'cuda':useMps?'mps':'cpu';
    let fallbackNote=(requestedCuda && !useCuda || requestedMps && !useMps)?'可选 GPU 环境未安装，本次使用 CPU。':'';
    const job: Job = { id: input.id, owner: event.sender.id, cancelled: false, abort: new AbortController() };
    active = job;
    const cancelDestroyed = () => { job.cancelled = true; job.abort.abort(); job.process?.kill(); };
    event.sender.once('destroyed', cancelDestroyed);
    const send = (phase: string, progress: number, message: string) => {
      if (!event.sender.isDestroyed()) event.sender.send('audio-assist:progress', { id: job.id, phase, progress: Math.min(1, Math.max(0, progress)), message });
    };
    const pending = path.join(cache, 'pending-' + randomUUID());
    try {
      await mkdir(pending, { recursive: true });
      const source = path.join(pending, 'input.audio');
      if (hasAsset) {
        if (!options.resolveAsset) throw new Error('音频素材读取接口不可用。');
        const filename=await options.resolveAsset(job.owner,input.sourceAsset!);
        await pipeline(createReadStream(filename),createWriteStream(source),{signal:job.abort.signal});
      } else if (hasHandle) {
        if (!options.resolveInput) throw new Error('音频文件访问接口尚未连接。');
        const selected = await options.resolveInput(job.owner, input.sourceHandle!);
        if (!path.isAbsolute(selected.path) || selected.size < 44 || selected.size > 32 * 1024 ** 3) throw new Error('音频源文件无效或超过 32 GB。');
        // Snapshot a user-selected source without holding its bytes in Electron.
        // The original is never moved/deleted and a concurrent user edit cannot
        // make the cache key describe a different file from the analyzed one.
        await pipeline(createReadStream(selected.path), createWriteStream(source), { signal: job.abort.signal });
      } else await writeFile(source, input.bytes!);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(source)) {
        if (job.cancelled) throw new Error('音频分析已取消。');
        hash.update(chunk);
      }
      const sourceRangeKey = input.sourceRange ? `/source-edges-v2/${JSON.stringify(input.sourceRange)}` : 'null';
      const modelStat = input.detectTempo ? await stat(tempoCheckpoint).catch(() => undefined) : undefined;
      const tempoModel = modelStat?.isFile() && modelStat.size === smartTempoModel.checkpoint.bytes ? tempoCheckpoint : undefined;
      const destinationFor=(device:'cpu'|'cuda'|'mps', neural = !!tempoModel)=>path.join(cache,hash.copy().update(sourceRangeKey).update(ALGORITHM+(input.mode ? '/task-'+input.mode+'-v1' : '')+(input.decodeOnly?(input.detectTempo?(neural ? '/decode-tempo-v2/' + smartTempoModel.id + '/' + smartTempoModel.packageVersion + '/' + smartTempoModel.checkpoint.sha256 : '/decode-tempo-v2/spectral'):'/decode-only-v1'):separation?options.researchModel?'/demucs4.0.1/htdemucs_6s':'/mega-v1-c6282089-five-residual-v5/'+(device==='cuda'?'torch28cuda-mathfp32':device==='mps'?'torch28mps-fp32-v1':modernCpuReady?'torch28cpu':'torch20tile')+'/'+(input.memoryProfile??'balanced'):'/librosa0.11.0')).digest('hex'));
      const splitDestination = (device: 'cpu' | 'cuda' | 'mps', neural?: boolean) => destinationFor(device, neural) + (selection?.drumPieces ? '-drum-pieces-v1' : '');
      let destination = splitDestination(executionDevice);
      let attempt = path.join(pending,'attempt-'+executionDevice);
      const publish = async (filename: string, meta: AudioMeta) => {
        if (job.cancelled) throw new Error('音频分析已取消。');
        const descriptor = await options.publishAsset!(job.owner, filename, meta);
        if (job.cancelled) throw new Error('音频分析已取消。');
        return descriptor;
      };
      const loadOutput = async (): Promise<AudioAssistResult> => {
        const result = await readResult(destination, publish);
        const { workspace, assets } = result;
        workspace.name = input.name;
        if (fallbackNote) workspace.model.fallbackNote = fallbackNote;
        if (!selection) return result;
        if (workspace.analysisPerformed !== false) throw new Error('分轨结果包含意外的分析数据。');
        if (selection.submix.length) {
          const roles = stemSourceRoles(selection.drumPieces).filter(role => selection.submix.includes(role));
          const sources = roles.map(role => {
            const stem = workspace.stems.find(stem => stem.role === role);
            if (!stem) throw new Error('子混音缺少所选声部。');
            return path.join(destination, stem.assetId + '.wav');
          });
          const id = createHash('sha256').update('submix-v1/' + path.basename(destination) + '/' + roles.join(',')).digest('hex');
          const mixed = path.join(destination, id + '.wav');
          if (!existsSync(mixed)) {
            const temporary = path.join(pending, id + '.wav');
            send('submix', .97, '正在创建子混音');
            await new Promise<void>((resolve, reject) => {
              if (job.cancelled) { reject(new Error('音频分析已取消。')); return; }
              const child = spawn(runtime, ['-B', '-u', worker, '--mix-stems', temporary, ...sources], { windowsHide: true, cwd: workerCwd });
              job.process = child;
              let error = '';
              child.stdout?.resume();
              child.stderr?.on('data', chunk => { error = (error + String(chunk)).slice(-1000); });
              child.once('error', reject);
              child.once('close', code => code === 0 && !job.cancelled ? resolve() : reject(new Error('创建子混音失败。' + error)));
            });
            if (job.cancelled) throw new Error('音频分析已取消。');
            // Registered assets must outlive the pending directory so they
            // can play immediately and be copied into a saved project.
            await rename(temporary, mixed);
          }
          const audioFile = await publish(mixed, { sampleRate: workspace.sampleRate, frames: workspace.frames, channels: 2 });
          assets.push({ id, name: '子混音.wav', mime: 'audio/wav', audioFile });
          workspace.stems.push({ id: randomUUID(), role: 'submix', name: '子混音', assetId: id, gain: 1, muted: false, solo: false });
        }
        workspace.stems = stemOutputRoles(selection).map(role => {
          const stem = workspace.stems.find(stem => stem.role === role);
          if (!stem) throw new Error('分轨结果缺少所选声部。');
          return stem;
        });
        const used = new Set([workspace.sourceAssetId, ...workspace.stems.map(stem => stem.assetId)]);
        result.assets = assets.filter(asset => used.has(asset.id));
        validateAudioWorkspace(workspace, result.assets);
        return result;
      };
      const cachedResult = async (): Promise<AudioAssistResult | undefined> => {
        if (!existsSync(path.join(destination, 'result.json'))) return;
        send('cache', .95, '读取已有本地分析缓存');
        const result = await loadOutput();
        if (job.cancelled) throw new Error('音频分析已取消。');
        send('complete', 1, input.mode === 'split' ? '分轨完成' : '分析完成');
        return result;
      };
      if(fallbackNote)send('gpu-fallback',.02,fallbackNote);
      const cached=await cachedResult();if(cached)return cached;
      if (job.cancelled) throw new Error('音频分析已取消。');
      const runWorker = async (source: string) => {
        await mkdir(attempt,{recursive:true});
        if(job.cancelled)throw new Error('音频分析已取消。');
        return new Promise<void>((resolve, reject) => {
        const child = spawn(executionDevice==='cuda'?cudaRuntime:executionDevice==='mps'?runtime:separation && fastReady ? fastRuntime : runtime, ['-B', '-u', worker, '--input', source, '--output', attempt, '--models', models, '--name', input.name, ...(input.sourceRange?['--start-seconds',String(input.sourceRange.offsetSeconds),'--duration-seconds',String(input.sourceRange.durationSeconds)]:[]), ...(input.decodeOnly ? ['--decode-only'] : []), ...(input.detectTempo ? ['--detect-tempo'] : []), ...(tempoModel ? ['--tempo-model', tempoModel] : []), ...(input.mode ? ['--mode',input.mode] : []), ...(selection?.drumPieces ? ['--drum-pieces'] : []), ...(separation ? options.researchModel ? ['--research-model'] : ['--mega-model','--device',executionDevice,'--cpu-threads',String(input.cpuThreads??0),'--memory-mode',input.memoryProfile??'balanced'] : [])],
          { windowsHide: true, shell: false, cwd: workerCwd, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
        job.process = child;
        let lines = '', error = '', workerError = '';
        child.stdout?.on('data', chunk => {
          lines += String(chunk);
          const records = lines.split(/\r?\n/); lines = records.pop()!.slice(-16384);
          for (const record of records) {
            try { const p = JSON.parse(record); if (typeof p.phase === 'string' && typeof p.message === 'string' && Number.isFinite(p.progress)) { if (p.phase !== 'complete') send(p.phase, p.progress, p.message.slice(0, 1000)); if (p.phase === 'error' || p.phase==='gpu-fallback') workerError = p.message; } } catch { /* Dependency informational stdout is not an IPC command. */ }
          }
        });
        child.stderr?.on('data', chunk => {
          const text = String(chunk); error = (error + text).slice(-4000);
          const percentages = [...text.matchAll(/(\d{1,3})%/g)];
          if (percentages.length) send('separating', .12 + Math.min(100, Number(percentages.at(-1)![1])) / 100 * .65, '本地六轨分离中');
        });
        child.once('error', reject);
        child.once('close', code => job.cancelled ? reject(new Error('音频分析已取消。')) : code === 0 ? resolve() : reject(new Error('本地音频分析失败：' + (workerError || error.slice(-1000) || `退出码 ${code}`))));
      });};
      let fallbackCached:AudioAssistResult|undefined;
      const execute = async(source:string)=>{
        try{await runWorker(source);}
        catch(error){
          if(job.cancelled || executionDevice==='cpu' || error instanceof Error && /Format not recognised|Unknown format/i.test(error.message))throw error;
          fallbackNote='GPU 尝试未完成，已转回 CPU：'+String(error instanceof Error?error.message:error).slice(0,220);
          send('gpu-fallback',.04,fallbackNote);executionDevice='cpu';destination=splitDestination('cpu');attempt=path.join(pending,'attempt-cpu');
          fallbackCached=await cachedResult();if(!fallbackCached)await runWorker(source);
        }
      };
      try { await execute(source); }
      catch (error) {
        if (job.cancelled || !(error instanceof Error) || !/Format not recognised|Unknown format/i.test(error.message)) throw error;
        // AAC/M4A may not be supported by libsndfile. Own the decoder directly,
        // so cancellation terminates exactly our decoder rather than a process tree.
        const ffmpeg = await findLocalFfmpeg();
        if (job.cancelled) throw new Error('音频分析已取消。');
        if (!ffmpeg) throw new Error(MISSING_FFMPEG);
        const converted = path.join(pending, 'decoded.wav');
        send('decoding', .03, '使用本地解码器读取音频');
        await new Promise<void>((resolve, reject) => {
          const child = spawn(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', source, '-t', '7201', '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_f32le', converted], { windowsHide: true, shell: false });
          job.process = child;
          let details = '', timedOut = false;
          const timer = setTimeout(() => { timedOut = true; child.kill(); }, 300000);
          child.stderr?.on('data', chunk => { details = (details + String(chunk)).slice(-1000); });
          child.once('error', (error: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            reject(error.code === 'ENOENT' ? new Error(MISSING_FFMPEG) : error);
          });
          child.once('close', code => { clearTimeout(timer); job.cancelled ? reject(new Error('音频分析已取消。')) : timedOut ? reject(new Error('本地音频解码超时，请使用 WAV 或截取较短片段。')) : code === 0 ? resolve() : reject(new Error('本地音频格式无法解码：' + details)); });
        });
        if (job.cancelled) throw new Error('音频分析已取消。');
        // The extra second is a sentinel. The worker rejects an over-duration
        // decode explicitly; a truncated clip is never presented as full audio.
        await execute(converted);
        await rm(converted, { force: true });
      }
      if(fallbackCached)return fallbackCached;
      const checked = await readResult(attempt, undefined);
      if (tempoModel && checked.workspace.tempoDetection !== 'beat-this') {
        // Do not let a temporary runtime failure poison the neural cache.
        destination = splitDestination(executionDevice, false);
        const previous = await cachedResult();
        if (previous) return previous;
      }
      if (job.cancelled) throw new Error('音频分析已取消。');
      // Only a complete, validated result is cached. The input is already represented by a WAV asset.
      await rm(source, { force: true });
      await rename(attempt, destination);
      if (job.cancelled) throw new Error('音频分析已取消。');
      const result = await loadOutput();
      if (job.cancelled) throw new Error('音频分析已取消。');
      send('complete', 1, input.mode === 'split' ? '分轨完成' : '分析完成，请预览后应用');
      return result;
    } catch (error) {
      if (job.cancelled) throw new Error('音频分析已取消。');
      throw error;
    } finally {
      event.sender.removeListener('destroyed', cancelDestroyed);
      await rm(pending, { recursive: true, force: true }).catch(() => {});
      if (active === job) active = undefined;
    }
  });
  return () => { if (active) { active.cancelled = true; active.abort.abort(); active.process?.kill(); } for (const channel of ['audio-assist:status', 'audio-assist:start', 'audio-assist:cancel']) ipc.removeHandler(channel); };
}

export async function readResult(directory: string, publish?: (filename: string, meta: AudioMeta) => Promise<AudioFileAsset>): Promise<AudioAssistResult> {
  const manifest = path.join(directory, 'result.json');
  if ((await stat(manifest)).size > 16 * 1024 * 1024) throw new Error('音频分析结果清单过大。');
  const result = JSON.parse(await readFile(manifest, 'utf8')) as WorkerResult;
  if (result.algorithm !== ALGORITHM || !Array.isArray(result.files) || !result.files.length || result.files.length > 65) throw new Error('音频分析缓存无效。');
  const assets: AudioAssistResult['assets'] = [];
  for (const file of result.files) {
    if (!file || typeof file.id !== 'string' || !/^[\w-]+$/.test(file.id) || file.file !== `${file.id}.wav` || file.mime !== 'audio/wav' || typeof file.name !== 'string' || file.name.length > 512 || assets.some(a => a.id === file.id)) throw new Error('音频缓存资源路径无效。');
    const filename = path.join(directory, file.file);
    const info = await stat(filename);
    if (!info.isFile() || info.size < 44 || info.size > 4 * 1024 ** 3) throw new Error('音频分轨文件无效或超过 WAV 单文件限制。');
    const handle = await open(filename, 'r');
    let rate = 0, blockAlign = 0, dataSize = -1, channels = 0;
    try {
      const header = Buffer.alloc(12); await handle.read(header, 0, 12, 0);
      if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') throw new Error('音频分轨不是有效 WAV。');
      for (let offset = 12; offset + 8 <= info.size;) {
        const chunk = Buffer.alloc(8); await handle.read(chunk, 0, 8, offset);
        const kind = chunk.toString('ascii', 0, 4), size = chunk.readUInt32LE(4), start = offset + 8;
        if (start + size > info.size) throw new Error('音频缓存 WAV 数据不完整。');
        if (kind === 'fmt ' && size >= 16) {
          const format = Buffer.alloc(16); await handle.read(format, 0, 16, start);
          channels = format.readUInt16LE(2); rate = format.readUInt32LE(4); blockAlign = format.readUInt16LE(12);
          if (channels !== 2 || ![1, 3].includes(format.readUInt16LE(0))) throw new Error('音频分轨编码无效。');
        }
        if (kind === 'data') dataSize = size;
        offset = start + size + (size % 2);
      }
    } finally { await handle.close(); }
    if (!blockAlign || rate !== result.workspace?.sampleRate || dataSize !== result.workspace?.frames * blockAlign) throw new Error('音频分轨长度或采样率不一致。');
    assets.push({ id: file.id, name: file.name, mime: file.mime, ...(publish ? { audioFile: await publish(filename, { sampleRate: rate, frames: result.workspace.frames, channels }) } : {}) });
  }
  validateAudioWorkspace(result.workspace, assets);
  return { workspace: result.workspace, assets };
}
