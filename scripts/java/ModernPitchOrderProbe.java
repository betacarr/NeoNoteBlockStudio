package studio.nbsx.research;

import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;

/** Original pitch-method calls on explicit synthetic state; no audio engine or world is run. */
public final class ModernPitchOrderProbe {
    private static Properties names;
    private static Class<?> type(String key) throws Exception { return Class.forName(names.getProperty(key)); }
    private static Method method(String owner, String key, Class<?>... args) throws Exception {
        Method result = type(owner).getDeclaredMethod(names.getProperty(key), args); result.setAccessible(true); return result;
    }
    private static Field field(Class<?> owner, String key) throws Exception {
        Field result = owner.getDeclaredField(names.getProperty(key)); result.setAccessible(true); return result;
    }
    private static Object empty(Class<?> owner) throws Exception {
        Class<?> unsafe = Class.forName("sun.misc.Unsafe"); Field instance = unsafe.getDeclaredField("theUnsafe"); instance.setAccessible(true);
        return unsafe.getMethod("allocateInstance", Class.class).invoke(instance.get(null), owner);
    }
    private static String bits(float value) { return String.format("%08x", Float.floatToRawIntBits(value)); }
    public static void main(String[] args) throws Exception {
        names = new Properties(); try (Reader input = new InputStreamReader(new FileInputStream(args[0]), "UTF-8")) { names.load(input); }
        method("shared", "detectVersion").invoke(null); method("bootstrap", "bootStrap").invoke(null);
        Object location = method("location", "parse", String.class).invoke(null, "minecraft:block.note_block.harp");
        Object source = field(type("source"), "records").get(null), soundType = field(type("soundType"), "fileType").get(null);
        Object random = method("random", "createRandom", long.class).invoke(null, 0L), engine = empty(type("engine"));
        Method pitch = method("noteBlock", "notePitch", int.class), constant = method("constant", "constantOf", float.class);
        Method getPitch = method("abstract", "getPitch"), calculate = method("engine", "calculate", type("instance"));
        Constructor<?> instanceConstructor = type("simple").getDeclaredConstructor(type("location"), type("source"), float.class, float.class, type("random"), boolean.class, int.class, type("attenuation"), double.class, double.class, double.class, boolean.class);
        Constructor<?> soundConstructor = type("sound").getDeclaredConstructor(type("location"), type("sampled"), type("sampled"), int.class, type("soundType"), boolean.class, boolean.class, int.class);
        instanceConstructor.setAccessible(true); soundConstructor.setAccessible(true);
        Object attenuation = field(type("attenuation"), "linear").get(null);
        try (PrintWriter output = new PrintWriter(new OutputStreamWriter(new FileOutputStream(args[2]), "UTF-8"))) {
            output.println("case\tnote\teventPitch\tinstancePitchBits\teventPitchBits\tstoredInstanceBits\tcombinedPitchBits\tenginePitchBits");
            List<String> rows = Files.readAllLines(Paths.get(args[1]));
            for (int index = 0; index < rows.size(); index++) {
                String[] row = rows.get(index).split("\t"); int note = Integer.parseInt(row[0]); float eventPitch = Float.parseFloat(row[1]);
                float notePitch = ((Number) pitch.invoke(null, note)).floatValue();
                Object instance = instanceConstructor.newInstance(location, source, 1.0f, notePitch, random, false, 0, attenuation, 0.0, 0.0, 0.0, false);
                Object resolvedSound = soundConstructor.newInstance(location, constant.invoke(null, 1.0f), constant.invoke(null, eventPitch), 1, soundType, false, false, 16);
                field(type("abstract"), "soundField").set(instance, resolvedSound);
                float stored = field(type("abstract"), "pitchField").getFloat(instance);
                float combined = ((Number) getPitch.invoke(instance)).floatValue(), result = ((Number) calculate.invoke(engine, instance)).floatValue();
                output.println(index + "\t" + note + "\t" + eventPitch + "\t" + bits(notePitch) + "\t" + bits(eventPitch) + "\t" + bits(stored) + "\t" + bits(combined) + "\t" + bits(result));
            }
        }
    }
}
