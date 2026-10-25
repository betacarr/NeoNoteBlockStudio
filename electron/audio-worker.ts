import koffi from 'koffi';
import { wavFromChannels } from '../src/audio/engine';
import type { NativeRenderRequest, NativeRenderResult } from '../src/core/types';
import { decodeGameVorbis, minecraftPcm16 } from './vorbis';
import { decodeJavaVorbis, type DecodedPcm } from './java-decoder';
import { legacySourceGain } from '../src/audio/legacy';
import { withinBroadcastRange } from '../src/audio/delivery';
const nativePrototypes = new Map<string, ReturnType<typeof koffi.proto>>();

// Isolate native calls from the window and main process. Only application-discovered
// library paths can reach this worker through the validated main-process handler.
export function render(request: NativeRenderRequest): NativeRenderResult {
  const library = koffi.load(request.nativeLibrary);
  const fn = (signature: string) => library.func(signature);
  const alcGetProcAddress = fn('void *alcGetProcAddress(void *device, const char *name)');
  const alcIsExtensionPresent = fn('char alcIsExtensionPresent(void *device, const char *name)');
  const alcGetIntegerv = fn('void alcGetIntegerv(void *device, int parameter, int size, _Out_ int *value)');
  const alcGetString = fn('const char *alcGetString(void *device, int parameter)');
  const alcGetError = fn('int alcGetError(void *device)');
  const extension = (name: string, signature: string, device: unknown = null) => {
    const pointer = alcGetProcAddress(device, name); if (!pointer) throw new Error(`音频库不支持 ${name}。`);
    let prototype = nativePrototypes.get(signature);
    if (!prototype) { prototype = koffi.proto(signature); nativePrototypes.set(signature, prototype); }
    return (...args: unknown[]) => koffi.call(pointer, prototype!, ...args);
  };
  const openLoopback = extension('alcLoopbackOpenDeviceSOFT', 'void *NbsxLoopback(const char *name)');
  const renderSamples = extension('alcRenderSamplesSOFT', 'void NbsxRender(void *device, void *buffer, int frames)');
  const createContext = fn('void *alcCreateContext(void *device, const int *attrs)');
  const openDevice = fn('void *alcOpenDevice(const char *name)');
  const makeCurrent = fn('char alcMakeContextCurrent(void *context)');
  const destroyContext = fn('void alcDestroyContext(void *context)');
  const closeDevice = fn('char alcCloseDevice(void *device)');
  const getString = fn('const char *alGetString(int param)');
  const genBuffers = fn('void alGenBuffers(int count, _Out_ unsigned int *buffers)');
  const bufferData = fn('void alBufferData(unsigned int buffer, int format, const void *data, int bytes, int rate)');
  const genSources = fn('void alGenSources(int count, _Out_ unsigned int *sources)');
  const deleteSources = fn('void alDeleteSources(int count, const unsigned int *sources)');
  const deleteBuffers = fn('void alDeleteBuffers(int count, const unsigned int *buffers)');
  const sourcef = fn('void alSourcef(unsigned int source, int param, float value)');
  const sourcei = fn('void alSourcei(unsigned int source, int param, int value)');
  const source3f = fn('void alSource3f(unsigned int source, int param, float x, float y, float z)');
  const getSourcei = fn('void alGetSourcei(unsigned int source, int param, _Out_ int *value)');
  const sourcePlay = fn('void alSourcePlay(unsigned int source)');
  const distanceModel = fn('void alDistanceModel(int model)');
  const doppler = fn('void alDopplerFactor(float value)');
  const getError = fn('int alGetError()');
  const isExtensionPresent = fn('char alIsExtensionPresent(const char *name)');
  const enable = fn('void alEnable(int capability)');
  const listener3f = fn('void alListener3f(int parameter, float x, float y, float z)');
  const listenerfv = fn('void alListenerfv(int parameter, const float *values)');
  const listenerf = fn('void alListenerf(int parameter, float value)');
  const device = openLoopback(null); if (!device) throw new Error('无法打开 OpenAL 离线渲染设备。');
  let context: unknown;
  const buffers: number[] = [], sources: number[] = [];
  try {
    const attributes = [0x1990, 0x1501, 0x1991, 0x1406, 0x1007, request.sampleRate, 0x1010, 4096];
    // ALC_SOFT_HRTF is optional on legacy backends.
    const hrtfAvailable = !!alcIsExtensionPresent(device, 'ALC_SOFT_HRTF');
    const gamePolicy = request.hrtf !== undefined && request.hrtf !== 'first-profile';
    if (request.hrtf === 'device-default' && request.directional) throw new Error('方向音频设置无效。');
    if (request.directional && !hrtfAvailable && !gamePolicy) throw new Error('所选版本的音频库不支持 HRTF，请关闭方向音频后重试。');
    let expectedHrtfProfile: string | undefined, requestedHrtfProfile: string | undefined, effectiveDirectional = request.directional;
    let hrtfGameDevice: NativeRenderResult['hrtfGameDevice'];
    if (gamePolicy && (hrtfAvailable || request.hrtf !== 'device-default')) {
      // Loopback ignores playback configuration on several original libraries.
      // Observe the original game's reset/context sequence without playing any
      // source, then match its actual state/profile in the offline device.
      const originalDevice = openDevice(null);
      if (!originalDevice) throw new Error('无法读取原版音频设备设置。请连接输出设备，或切换完整试听模式。');
      let originalContext: unknown;
      try {
        const originalHrtf = !!alcIsExtensionPresent(originalDevice, 'ALC_SOFT_HRTF');
        const contextAttributes: number[] = [];
        let resetAttributes: number[] | undefined, resetSucceeded: boolean | undefined, resetError: number | undefined;
        const shouldSelect = request.hrtf === 'explicit-reset' || request.hrtf === 'context-attributes' || request.hrtf === 'enable-only-reset' && request.directional;
        if (shouldSelect && originalHrtf) {
          const count = new Int32Array(1); alcGetIntegerv(originalDevice, 0x1994, 1, count);
          if (count[0] > 0) {
            const getStringi = extension('alcGetStringiSOFT', 'const char *NbsxHrtfName(void *device, int parameter, int index)', originalDevice);
            requestedHrtfProfile = getStringi(originalDevice, 0x1995, 0) as string;
            const selection = [0x1992, request.directional ? 1 : 0, 0x1996, 0];
            if (request.hrtf === 'context-attributes') contextAttributes.push(...selection);
            else {
              resetAttributes = [...selection, 0];
              const reset = extension('alcResetDeviceSOFT', 'char NbsxResetDevice(void *device, const int *attrs)', originalDevice);
              resetSucceeded = !!reset(originalDevice, resetAttributes);
              if (!resetSucceeded) resetError = alcGetError(originalDevice);
            }
          }
        }
        if (request.outputLimiter !== undefined) contextAttributes.push(0x199A, request.outputLimiter ? 1 : 0);
        originalContext = createContext(originalDevice, contextAttributes.length ? [...contextAttributes, 0] : null);
        if (!originalContext) throw new Error('无法读取原版音频设备设置。请连接输出设备，或切换完整试听模式。');
        const state = new Int32Array(1), originalStatus = new Int32Array(1), originalRate = new Int32Array(1);
        if (originalHrtf) { alcGetIntegerv(originalDevice, 0x1992, 1, state); alcGetIntegerv(originalDevice, 0x1993, 1, originalStatus); }
        effectiveDirectional = !!state[0];
        expectedHrtfProfile = effectiveDirectional ? alcGetString(originalDevice, 0x1995) as string : undefined;
        alcGetIntegerv(originalDevice, 0x1007, 1, originalRate);
        const nameParameter = alcIsExtensionPresent(originalDevice, 'ALC_ENUMERATE_ALL_EXT') ? 0x1013 : 0x1005;
        hrtfGameDevice = { name: alcGetString(originalDevice, nameParameter) as string, directional: effectiveDirectional, profile: expectedHrtfProfile, status: originalStatus[0], sampleRate: originalRate[0], control: request.hrtf as NonNullable<NativeRenderResult['hrtfGameDevice']>['control'], option: request.directional, requestedProfile: requestedHrtfProfile, contextAttributes, resetAttributes, resetSucceeded, resetError };
      } finally {
        if (originalContext) destroyContext(originalContext);
        closeDevice(originalDevice);
      }
      if (hrtfAvailable) attributes.push(0x1992, effectiveDirectional ? 1 : 0);
      else if (effectiveDirectional) throw new Error('离线渲染设备无法应用原版设备的方向音频状态。');
      if (effectiveDirectional) {
        const count = new Int32Array(1); alcGetIntegerv(device, 0x1994, 1, count);
        const getStringi = extension('alcGetStringiSOFT', 'const char *NbsxHrtfName(void *device, int parameter, int index)');
        let index = -1;
        for (let i = 0; i < count[0]; i++) if (getStringi(device, 0x1995, i) === expectedHrtfProfile) { index = i; break; }
        if (index < 0 || !expectedHrtfProfile) throw new Error('离线渲染设备无法匹配原版设备的方向音频配置。');
        attributes.push(0x1996, index);
      }
    } else if (hrtfAvailable) {
      if (request.hrtf === 'first-profile') {
        const count = new Int32Array(1); alcGetIntegerv(device, 0x1994, 1, count);
        if (count[0] > 0) {
          const getStringi = extension('alcGetStringiSOFT', 'const char *NbsxHrtfName(void *device, int parameter, int index)');
          expectedHrtfProfile = getStringi(device, 0x1995, 0) as string;
          requestedHrtfProfile = expectedHrtfProfile;
          if (!expectedHrtfProfile) throw new Error('无法读取目标版本的第一个 HRTF 配置。');
          // The original game chooses profile zero, including when requesting off.
          attributes.push(0x1992, request.directional ? 1 : 0, 0x1996, 0);
        } else if (request.directional) throw new Error('所选版本的音频库没有可用的 HRTF 配置。');
      } else attributes.push(0x1992, request.directional ? 1 : 0);
    }
    const limiterAvailable = !!alcIsExtensionPresent(device, 'ALC_SOFT_output_limiter');
    if (request.outputLimiter !== undefined) {
      if (!limiterAvailable) throw new Error('所选版本的音频库不支持请求的输出限幅设置。');
      attributes.push(0x199A, request.outputLimiter ? 1 : 0);
    }
    attributes.push(0);
    context = createContext(device, attributes);
    if (!context || !makeCurrent(context)) throw new Error('无法创建 OpenAL 离线渲染上下文。');
    const hrtfState = new Int32Array(1);
    if (hrtfAvailable) alcGetIntegerv(device, 0x1992, 1, hrtfState);
    const directional = !!hrtfState[0];
    if (directional !== effectiveDirectional) throw new Error('音频设备未能应用所选的 HRTF 设置，已停止渲染。');
    const hrtfProfile = hrtfAvailable && directional ? alcGetString(device, 0x1995) as string : undefined;
    const hrtfStatusValue = new Int32Array(1);
    if (hrtfAvailable) alcGetIntegerv(device, 0x1993, 1, hrtfStatusValue);
    const hrtfStatus = hrtfAvailable ? hrtfStatusValue[0] : undefined;
    // A profile ID is a preference in ALC_SOFT_HRTF, not a guaranteed selection.
    // The original game also permits the driver's rate-dependent fallback.
    if (hrtfGameDevice && directional && expectedHrtfProfile !== hrtfProfile) throw new Error('当前导出采样率无法保留原版设备的方向音频配置。');
    const limiterState = new Int32Array(1);
    if (limiterAvailable) alcGetIntegerv(device, 0x199A, 1, limiterState);
    const outputLimiter = limiterAvailable ? !!limiterState[0] : undefined;
    if (request.outputLimiter !== undefined && outputLimiter !== request.outputLimiter) throw new Error('音频设备未能应用目标版本的输出限幅设置，已停止渲染。');
    distanceModel(0xD003); doppler(0);
    const perSourceDistance = !!isExtensionPresent('AL_EXT_source_distance_model');
    if (perSourceDistance) enable(0x200);
    if (request.listener) {
      listener3f(0x1004, ...request.listener.position);
      listenerfv(0x100F, Float32Array.from(request.listener.orientation));
      listenerf(0x100A, request.listener.gain ?? 1);
    }
    const backend = `${getString(0xB002)} · ${getString(0xB003)}`;
    const sampleIds = new Map<string, number>();
    const rawSamples: DecodedPcm[] = request.encodedSamples?.length ? request.javaDecoder ? decodeJavaVorbis(request.javaDecoder, request.encodedSamples) : request.nativeDecoder ? decodeGameVorbis(request.nativeDecoder, request.encodedSamples) : [] : [];
    const nativeIds = new Set(rawSamples.map(s => s.id));
    const samples = [...rawSamples, ...request.samples.filter(s => !nativeIds.has(s.id))];
    for (const sample of samples) {
      const id = new Uint32Array(1); genBuffers(1, id); buffers.push(id[0]);
      const frames = sample.data[0].length, channels = Math.min(sample.channels, 2);
      const pcm = (sample as DecodedPcm).pcm16 ?? new Int16Array(frames * channels);
      if (!(sample as DecodedPcm).pcm16) for (let i = 0; i < frames; i++) for (let ch = 0; ch < channels; ch++) pcm[i * channels + ch] = minecraftPcm16(sample.data[ch][i]);
      bufferData(id[0], channels === 1 ? 0x1101 : 0x1103, pcm, pcm.byteLength, sample.sampleRate);
      sampleIds.set(sample.id, id[0]);
    }
    if (getError()) throw new Error('OpenAL 采样加载失败。');
    const total = Math.ceil(request.duration * request.sampleRate), left = new Float32Array(total), right = new Float32Array(total);
    let cursor = 0, eventIndex = 0, maxVoices = 0;
    // Musical ticks carry an already quantized frame. Legacy/research requests
    // without it retain their original seconds-based scheduling contract.
    const eventFrame = (event: NativeRenderRequest['events'][number]) => event.frame ?? Math.round(event.time * request.sampleRate);
    const events = [...request.events].sort((a, b) => eventFrame(a) - eventFrame(b) || a.time - b.time);
    const active = new Set<number>(), available: number[] = [];
    while (cursor < total) {
      while (eventIndex < events.length && eventFrame(events[eventIndex]) <= cursor) {
        const event = events[eventIndex++], buffer = sampleIds.get(event.instrument);
        if (!withinBroadcastRange(event.x, event.y, event.z, request.broadcast)) continue;
        if (!buffer) throw new Error(`渲染缺少采样：${event.instrument}`);
        let id = available.pop();
        if (!id) { const result = new Uint32Array(1); genSources(1, result); id = result[0]; if (!id) throw new Error('此原生音频库无法分配足够声源，已停止导出，避免丢失音符。'); sources.push(id); }
        const legacy = request.attenuationModel === 'paulscode-linear';
        sourcei(id, 0x1009, buffer); sourcef(id, 0x1003, event.pitch);
        const listener = request.listener?.position ?? [0, 0, 0];
        sourcef(id, 0x100A, legacy ? legacySourceGain(event.gain,
          Math.fround(Math.fround(event.x) - Math.fround(listener[0])),
          Math.fround(Math.fround(event.y) - Math.fround(listener[1])),
          Math.fround(Math.fround(event.z) - Math.fround(listener[2])), event.maxDistance) : event.gain);
        if (perSourceDistance) sourcei(id, 0xD000, legacy ? 0xD002 : 0xD003);
        sourcef(id, 0x1020, legacy ? 1 : 0); sourcef(id, 0x1021, legacy ? 0 : 1); sourcef(id, 0x1023, legacy ? 3.4028234663852886e38 : event.maxDistance);
        source3f(id, 0x1004, event.x, event.y, event.z); sourcePlay(id); active.add(id);
      }
      const nextFrame = eventIndex < events.length ? eventFrame(events[eventIndex]) : total;
      const count = Math.min(1024, total - cursor, Math.max(1, nextFrame - cursor));
      const interleaved = new Float32Array(count * 2); renderSamples(device, interleaved, count);
      for (let i = 0; i < count; i++) { left[cursor + i] = interleaved[i * 2]; right[cursor + i] = interleaved[i * 2 + 1]; }
      cursor += count; maxVoices = Math.max(maxVoices, active.size);
      for (const id of active) { const state = new Int32Array(1); getSourcei(id, 0x1010, state); if (state[0] === 0x1014) { active.delete(id); sourcei(id, 0x1009, 0); available.push(id); } }
    }
    if (getError()) throw new Error('原生音频渲染发生 OpenAL 错误。');
    const hrtfDefaultDevice = request.hrtf === 'device-default' ? hrtfGameDevice : undefined;
    const profileRequest = requestedHrtfProfile ?? expectedHrtfProfile;
    return { wav: wavFromChannels([left, right], request.sampleRate), backend, directional, hrtfProfile, hrtfRequestedProfile: profileRequest, hrtfStatus, hrtfGameDevice, hrtfDefaultDevice, outputLimiter,
      warnings: [`原生混音使用本机 OpenAL；${rawSamples.length ? `${rawSamples.length} 个采样通过本机 ${request.javaDecoder ? request.javaDecoder.kind === 'jorbis' ? 'JOrbis' : 'Paulscode JOrbis' : 'STB Vorbis'} 原始采样率解码` : '输入采样经浏览器解码'}。`, ...(hrtfDefaultDevice ? [`沿用原版默认设备的方向音频：${directional ? `开启（${hrtfProfile}）` : '关闭'}。`] : []), ...(hrtfGameDevice && !hrtfDefaultDevice && request.directional !== directional ? [`原版设备设置将方向音频覆盖为${directional ? '开启' : '关闭'}。`] : []), ...(directional && profileRequest && profileRequest !== hrtfProfile ? [`原版音频库将方向音频配置从 ${profileRequest} 调整为 ${hrtfProfile}。`] : []), ...(samples.length > rawSamples.length ? ['部分非 Ogg 自定义采样经过浏览器解码。'] : []), ...(maxVoices > 128 ? [`最多 ${maxVoices} 个同时活动声源，游戏中可能存在声音压力。`] : [])] };
  } finally {
    if (context) { if (sources.length) deleteSources(sources.length, Uint32Array.from(sources)); if (buffers.length) deleteBuffers(buffers.length, Uint32Array.from(buffers)); makeCurrent(null); destroyContext(context); }
    closeDevice(device); library.unload();
  }
}
const parentPort = (process as unknown as { parentPort: { on: (event: string, callback: (message: { data: NativeRenderRequest }) => void) => void; postMessage: (value: unknown) => void } }).parentPort;
parentPort?.on('message', message => {
  try { parentPort.postMessage({ result: render(message.data) }); }
  catch (error) { parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
});
