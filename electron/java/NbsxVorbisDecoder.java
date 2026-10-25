package studio.nbsx.audio;

import java.io.*;
import java.lang.reflect.*;
import javax.sound.sampled.AudioFormat;

/** First-party adapter. Codec classes are loaded from the user's checked game libraries. */
public final class NbsxVorbisDecoder {
    private static Object make(String name) throws Exception { return Class.forName(name).getConstructor().newInstance(); }
    private static Object call(Object target, String name, Object... args) throws Exception {
        outer: for (Method method : target.getClass().getMethods()) {
            if (!method.getName().equals(name) || method.getParameterTypes().length != args.length) continue;
            Class<?>[] types = method.getParameterTypes();
            for (int i = 0; i < types.length; i++) {
                Class<?> type = types[i];
                if (type == int.class) type = Integer.class;
                if (type == long.class) type = Long.class;
                if (args[i] != null && !type.isInstance(args[i])) continue outer;
            }
            try { return method.invoke(target, args); }
            catch (InvocationTargetException error) { throw new IOException("Codec method failed: " + name, error.getCause()); }
        }
        throw new NoSuchMethodException(target.getClass().getName() + "." + name);
    }
    private static int number(Object value) { return ((Number)value).intValue(); }
    private static Object field(Object object, String name) throws Exception { return object.getClass().getField(name).get(object); }
    private static void littleInt(DataOutputStream out, int value) throws IOException { out.writeInt(Integer.reverseBytes(value)); }
    private static final class Audio {
        int rate, channels; byte[] pcm;
        Audio(int rate, int channels, byte[] pcm) { this.rate = rate; this.channels = channels; this.pcm = pcm; }
    }
    private static Audio legacy(File file) throws Exception {
        Object codec = make("paulscode.sound.codecs.CodecJOrbis");
        try {
            if (!Boolean.TRUE.equals(call(codec, "initialize", file.toURI().toURL()))) throw new IOException("JOrbis initialization failed");
            AudioFormat format = (AudioFormat)call(codec, "getAudioFormat");
            Object buffer = call(codec, "readAll");
            if (buffer == null) throw new IOException("JOrbis returned no PCM");
            byte[] pcm = (byte[])field(buffer, "audioData");
            if (format.getSampleSizeInBits() != 16 || !format.getEncoding().equals(AudioFormat.Encoding.PCM_SIGNED)) throw new IOException("Unsupported legacy PCM format");
            if (format.isBigEndian()) for (int i = 0; i + 1 < pcm.length; i += 2) { byte b = pcm[i]; pcm[i] = pcm[i + 1]; pcm[i + 1] = b; }
            return new Audio((int)format.getSampleRate(), format.getChannels(), pcm);
        } finally { call(codec, "cleanup"); }
    }
    private static final class Modern implements Closeable {
        final InputStream input;
        final Object sync = make("com.jcraft.jogg.SyncState"), page = make("com.jcraft.jogg.Page");
        final Object stream = make("com.jcraft.jogg.StreamState"), packet = make("com.jcraft.jogg.Packet");
        final Object info = make("com.jcraft.jorbis.Info"), comment = make("com.jcraft.jorbis.Comment");
        final Object dsp = make("com.jcraft.jorbis.DspState"), block;
        long total = Long.MAX_VALUE, written;
        Modern(File file) throws Exception {
            input = new BufferedInputStream(new FileInputStream(file));
            block = Class.forName("com.jcraft.jorbis.Block").getConstructor(dsp.getClass()).newInstance(dsp);
        }
        boolean page() throws Exception {
            for (;;) {
                int result = number(call(sync, "pageout", page));
                if (result == 1) {
                    if (number(call(page, "eos")) != 0) total = ((Number)call(page, "granulepos")).longValue();
                    return true;
                }
                if (result != 0) throw new IOException("Corrupt Ogg page");
                int offset = number(call(sync, "buffer", 8192));
                byte[] buffer = (byte[])field(sync, "data");
                int size = input.read(buffer, offset, 8192);
                if (size < 0) return false;
                call(sync, "wrote", size);
            }
        }
        boolean packet() throws Exception {
            for (;;) {
                int result = number(call(stream, "packetout", packet));
                if (result == 1) return true;
                if (result != 0) throw new IOException("Corrupt Ogg packet");
                if (!page()) return false;
                if (number(call(stream, "pagein", page)) < 0) throw new IOException("Invalid Ogg page");
            }
        }
        Audio decode() throws Exception {
            if (!page()) throw new IOException("Missing Ogg identification page");
            call(stream, "init", number(call(page, "serialno")));
            if (number(call(stream, "pagein", page)) < 0) throw new IOException("Invalid identification page");
            for (int header = 0; header < 3; header++) {
                if (!packet() || number(call(info, "synthesis_headerin", comment, packet)) < 0) throw new IOException("Invalid Vorbis header");
            }
            call(dsp, "synthesis_init", info); call(block, "init", dsp);
            int rate = number(field(info, "rate")), channels = number(field(info, "channels"));
            if (channels < 1 || channels > 2 || rate < 8000 || rate > 192000) throw new IOException("Unsupported Vorbis format");
            float[][][] data = new float[1][][]; int[] offsets = new int[channels];
            ByteArrayOutputStream pcm = new ByteArrayOutputStream();
            while (packet()) {
                if (number(call(block, "synthesis", packet)) < 0) throw new IOException("Invalid Vorbis audio packet");
                call(dsp, "synthesis_blockin", block);
                int frames;
                while ((frames = number(call(dsp, "synthesis_pcmout", data, offsets))) > 0) {
                    long count = Math.max(0, Math.min(frames, total - written));
                    for (int frame = 0; frame < count; frame++) for (int channel = 0; channel < channels; channel++) {
                        float value = data[0][channel][offsets[channel] + frame];
                        int sample = Math.max(-32768, Math.min(32767, (int)(value * 32767.5f - .5f)));
                        pcm.write(sample & 255); pcm.write((sample >>> 8) & 255);
                    }
                    written += count; call(dsp, "synthesis_read", frames);
                    if (written > (long)rate * 600) throw new IOException("Sample exceeds ten minutes");
                }
            }
            return new Audio(rate, channels, pcm.toByteArray());
        }
        public void close() throws IOException { input.close(); }
    }
    public static void main(String[] args) throws Exception {
        if (args.length < 3) throw new IllegalArgumentException("kind output sample...");
        try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(args[1])))) {
            out.writeBytes("NBSJ"); littleInt(out, args.length - 2);
            for (int i = 2; i < args.length; i++) {
                File file = new File(args[i]); Audio audio;
                if (args[0].equals("legacy-jorbis")) audio = legacy(file);
                else try (Modern decoder = new Modern(file)) { audio = decoder.decode(); }
                littleInt(out, audio.rate); littleInt(out, audio.channels); littleInt(out, audio.pcm.length); out.write(audio.pcm);
            }
        }
    }
}
