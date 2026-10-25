import koffi from 'koffi';
import type { PcmSample } from '../src/core/types';

// LWJGL 3.2 has CriticalNative exports; 3.3 uses JNI exports. Only the primitive
// pointer variants below are used. Their generated 3.3.1 C bodies explicitly
// ignore JNIEnv/jclass, so those two slots may be null on 64-bit platforms.
export function decodeGameVorbis(nativePath: string, encoded: { id: string; bytes: Uint8Array }[]): PcmSample[] {
  const library = koffi.load(nativePath);
  try {
    const bind = (returns: string, suffix: string, parameters: string) => {
      try { return library.func(`${returns} JavaCritical_org_lwjgl_stb_STBVorbis_nstb_1vorbis_1${suffix}(${parameters})`); }
      catch {
        if (!['x64', 'arm64'].includes(process.arch)) throw new Error('此 JNI 适配路径要求 64 位运行环境。');
        const method = library.func(`${returns} Java_org_lwjgl_stb_STBVorbis_nstb_1vorbis_1${suffix}(void *env, void *clazz, ${parameters})`);
        return (...args: unknown[]) => method(null, null, ...args);
      }
    };
    const open = bind('void *', 'open_1memory__JIJJ', 'const void *data, int length, _Out_ int *error, void *allocation');
    const info = bind('void', 'get_1info', 'void *decoder, _Out_ void *result');
    const length = bind('unsigned int', 'stream_1length_1in_1samples', 'void *decoder');
    const decode = bind('int', 'get_1samples_1float_1interleaved__JIJI', 'void *decoder, int channels, _Out_ float *output, int count');
    const close = bind('void', 'close', 'void *decoder');
    return encoded.map(sample => {
      if (sample.bytes.length > 64 * 1024 * 1024) throw new Error('单个压缩采样超过 64 MB。');
      const input = Buffer.from(sample.bytes), error = new Int32Array(1);
      const decoder = open(input, input.length, error, null);
      if (!decoder) throw new Error(`原版 Vorbis 解码器无法打开 ${sample.id}（${error[0]}）。`);
      try {
        const metadata = Buffer.alloc(24); info(decoder, metadata);
        const sampleRate = metadata.readUInt32LE(0), channels = metadata.readInt32LE(4), frames = length(decoder);
        if (![1, 2].includes(channels) || frames < 1 || frames > sampleRate * 600 || sampleRate < 8000 || sampleRate > 192000) throw new Error('采样通道、时长或频率无效。');
        const output = new Float32Array(frames * channels), actualFrames = decode(decoder, channels, output, output.length);
        const planar = Array.from({ length: channels }, () => new Float32Array(actualFrames));
        for (let frame = 0; frame < actualFrames; frame++) for (let ch = 0; ch < channels; ch++) planar[ch][frame] = output[frame * channels + ch];
        return { id: sample.id, channels, sampleRate, data: planar };
      } finally { close(decoder); }
    });
  } finally { library.unload(); }
}

// Decompiled Minecraft 1.16.5 OggAudioStream.OutputConcat quantisation. Explicit
// frounds preserve Java float arithmetic; integer conversion truncates to zero.
export const minecraftPcm16 = (sample: number): number => Math.max(-32768, Math.min(32767, Math.trunc(Math.fround(Math.fround(sample * 32767.5) - .5))));
