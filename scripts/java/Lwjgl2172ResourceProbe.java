package studio.nbsx.research;

import java.io.File;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.security.MessageDigest;

/** The original 1.7.2 File-root pack, without a ResourceIndex substitute. */
public final class Lwjgl2172ResourceProbe {
    public static void main(String[] args) throws Exception {
        Class<?> packClass = Class.forName(args[1]);
        Class<?> locationClass = Class.forName(args[2]);
        Object pack = packClass.getConstructor(File.class).newInstance(new File(args[0]));
        Method open = packClass.getMethod(args[3], locationClass);
        for (int index = 4; index < args.length; index++) {
            String logical = "minecraft:" + args[index];
            Object location = locationClass.getConstructor(String.class).newInstance(logical);
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            long length = 0;
            try (InputStream stream = (InputStream) open.invoke(pack, location)) {
                byte[] bytes = new byte[8192];
                int count;
                while ((count = stream.read(bytes)) != -1) { digest.update(bytes, 0, count); length += count; }
            }
            StringBuilder hex = new StringBuilder();
            for (byte value : digest.digest()) hex.append(String.format("%02x", value & 255));
            System.out.println("RESOURCE\t" + logical + "\t" + hex + "\t" + length);
        }
    }
}
