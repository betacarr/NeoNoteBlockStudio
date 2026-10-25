package studio.nbsx.research;

import java.io.File;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.security.MessageDigest;
import java.util.Map;

/** Invoke the unmodified original ResourceIndex and DefaultResourcePack. No audio engine is started. */
public final class LegacyResourceProbe {
    public static void main(String[] args) throws Exception {
        Class<?> indexClass = Class.forName(args[2]);
        Object index = indexClass.getConstructor(File.class, String.class).newInstance(new File(args[0]), args[1]);
        Method getMap = null;
        for (Method method : indexClass.getMethods()) if (method.getParameterTypes().length == 0 && Map.class.isAssignableFrom(method.getReturnType())) getMap = method;
        if (getMap == null) throw new IllegalStateException("Original index map method missing");
        Map<?, ?> map = (Map<?, ?>) getMap.invoke(index);
        Class<?> packClass = Class.forName(args[3]);
        Object pack = packClass.getConstructor(Map.class).newInstance(map);
        Method open = null;
        for (Method method : packClass.getMethods()) if (method.getName().equals("a") && method.getParameterTypes().length == 1 && InputStream.class.isAssignableFrom(method.getReturnType())) open = method;
        if (open == null) throw new IllegalStateException("Original pack open method missing");
        Class<?> locationClass = open.getParameterTypes()[0];
        for (int n = 4; n < args.length; n++) {
            String logicalPath = "minecraft:" + args[n];
            Object location = locationClass.getConstructor(String.class).newInstance(logicalPath);
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            long length = 0;
            try (InputStream stream = (InputStream) open.invoke(pack, location)) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = stream.read(buffer)) != -1) { digest.update(buffer, 0, count); length += count; }
            }
            StringBuilder hex = new StringBuilder();
            for (byte value : digest.digest()) hex.append(String.format("%02x", value & 255));
            System.out.println("RESOURCE\t" + logicalPath + "\t" + hex + "\t" + length);
        }
    }
}
