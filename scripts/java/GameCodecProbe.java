package studio.nbsx.research;
import java.io.*;
import java.nio.ByteBuffer;
import javax.sound.sampled.AudioFormat;

/** Research-only invocation of the actual checked client class, without copying its code. */
public final class GameCodecProbe {
    public static void main(String[] args) throws Exception {
        Class<?> type = Class.forName(args[0]);
        try (DataOutputStream out = new DataOutputStream(new FileOutputStream(args[4]))) {
            out.writeBytes("NBSJ"); out.writeInt(Integer.reverseBytes(args.length - 4));
            for (int i = 0; i < args.length - 4; i++) {
                String input = args[i == 0 ? 3 : i + 4];
                Object stream = type.getConstructor(InputStream.class).newInstance(new FileInputStream(input));
                try {
                AudioFormat format = (AudioFormat)type.getMethod(args[1]).invoke(stream);
                ByteBuffer pcm = (ByteBuffer)type.getMethod(args[2]).invoke(stream);
                byte[] bytes = new byte[pcm.remaining()]; pcm.get(bytes);
                out.writeInt(Integer.reverseBytes((int)format.getSampleRate()));
                out.writeInt(Integer.reverseBytes(format.getChannels()));
                out.writeInt(Integer.reverseBytes(bytes.length)); out.write(bytes);
                } finally { type.getMethod("close").invoke(stream); }
            }
        }
    }
}
