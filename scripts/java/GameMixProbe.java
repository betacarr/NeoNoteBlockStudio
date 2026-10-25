package studio.nbsx.research;
import java.io.*;
import java.lang.reflect.*;
import java.nio.*;
import java.util.*;
import javax.sound.sampled.AudioFormat;
import org.lwjgl.openal.*;

/** Research-only capture through original client codec, buffer, channel and listener classes. */
public final class GameMixProbe {
    private static Properties config;
    private static String key(String name) { return config.getProperty(name); }
    private static void littleInt(DataOutputStream out, int value) throws IOException { out.writeInt(Integer.reverseBytes(value)); }
    public static void main(String[] args) throws Exception {
        config = new Properties(); try (Reader in = new InputStreamReader(new FileInputStream(args[0]), "UTF-8")) { config.load(in); }
        List<String> cases = java.nio.file.Files.readAllLines(java.nio.file.Paths.get(args[1]));
        try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(args[2])))) {
            out.writeBytes("NBSM"); littleInt(out, cases.size());
            for (String line : cases) capture(line, out);
        }
    }
    private static void capture(String line, DataOutputStream out) throws Exception {
        String[] values = line.split("\t");
        float x = Float.parseFloat(values[0]), y = Float.parseFloat(values[1]), z = Float.parseFloat(values[2]);
        float pitch = Float.parseFloat(values[3]), gain = Float.parseFloat(values[4]);
        boolean hrtf = Boolean.parseBoolean(values[5]);
        int rate = 48000, frames = 96000;
        long device = SOFTLoopback.alcLoopbackOpenDeviceSOFT((ByteBuffer)null);
        if (device == 0) throw new IOException("No OpenAL loopback device");
        ALCCapabilities capabilities = ALC.createCapabilities(device);
        int[] attributes = capabilities.ALC_SOFT_HRTF ? new int[] {0x1990, 0x1501, 0x1991, 0x1406, 0x1007, rate, 0x1010, 4096, 0x1992, hrtf ? 1 : 0, 0} : new int[] {0x1990, 0x1501, 0x1991, 0x1406, 0x1007, rate, 0x1010, 4096, 0};
        long context = ALC10.alcCreateContext(device, attributes);
        if (context == 0 || !ALC10.alcMakeContextCurrent(context)) throw new IOException("No OpenAL context");
        AL.createCapabilities(capabilities); AL10.alEnable(0x200);
        Class<?> channelType = Class.forName(key("channel")), bufferType = Class.forName(key("buffer")), vectorType = Class.forName(key("vector"));
        Class<?> listenerType = Class.forName(key("listener")), codecType = Class.forName(key("codec"));
        Object listener = listenerType.getConstructor().newInstance(); listenerType.getMethod(key("resetListener")).invoke(listener);
        Object codec = codecType.getConstructor(InputStream.class).newInstance(new FileInputStream(key("sample")));
        Object channel = null, buffer = null;
        try {
            AudioFormat format = (AudioFormat)codecType.getMethod(key("format")).invoke(codec);
            ByteBuffer pcm = (ByteBuffer)codecType.getMethod(key("readAll")).invoke(codec);
            buffer = bufferType.getConstructor(ByteBuffer.class, AudioFormat.class).newInstance(pcm, format);
            Method create = channelType.getDeclaredMethod(key("createChannel")); create.setAccessible(true); channel = create.invoke(null);
            channelType.getMethod(key("attach"), bufferType).invoke(channel, buffer);
            channelType.getMethod(key("position"), vectorType).invoke(channel, vectorType.getConstructor(double.class, double.class, double.class).newInstance((double)x, (double)y, (double)z));
            channelType.getMethod(key("pitch"), float.class).invoke(channel, pitch);
            channelType.getMethod(key("gain"), float.class).invoke(channel, gain);
            channelType.getMethod(key("attenuation"), float.class).invoke(channel, 48f);
            channelType.getMethod(key("play")).invoke(channel);
            float[] samples = new float[frames * 2];
            int blockFrames = Integer.parseInt(config.getProperty("blockFrames", "96000"));
            for (int cursor = 0; cursor < frames;) {
                int count = Math.min(blockFrames, frames - cursor); float[] block = new float[count * 2];
                SOFTLoopback.alcRenderSamplesSOFT(device, block, count); System.arraycopy(block, 0, samples, cursor * 2, block.length); cursor += count;
            }
            int error = AL10.alGetError(); if (error != 0) throw new IOException("OpenAL error " + error);
            littleInt(out, rate); littleInt(out, samples.length * 2);
            for (float input : samples) {
                double value = Math.max(-1.0, Math.min(1.0, (double)input));
                int sample = (int)Math.round(value * (value < 0 ? 32768.0 : 32767.0));
                out.writeByte(sample & 255); out.writeByte((sample >>> 8) & 255);
            }
        } finally {
            codecType.getMethod("close").invoke(codec);
            if (channel != null) channelType.getMethod(key("destroyChannel")).invoke(channel);
            if (buffer != null) bufferType.getMethod(key("discardBuffer")).invoke(buffer);
            ALC10.alcMakeContextCurrent(0); ALC10.alcDestroyContext(context); ALC10.alcCloseDevice(device);
        }
    }
}
