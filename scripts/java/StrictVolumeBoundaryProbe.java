package studio.nbsx.research;

import java.io.*;
import java.lang.reflect.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import org.lwjgl.openal.*;

/** Invokes original methods on explicit synthetic state; this is not a running SoundEngine. */
public final class StrictVolumeBoundaryProbe {
    private static Properties cfg;
    private static String name(String key) { return cfg.getProperty(key); }
    private static Class<?> type(String key) throws Exception { return Class.forName(name(key)); }
    private static Field field(Class<?> c, String name) throws Exception {
        for (Class<?> owner = c; owner != null; owner = owner.getSuperclass()) {
            try { Field result = owner.getDeclaredField(name); result.setAccessible(true); return result; }
            catch (NoSuchFieldException ignored) { }
        }
        throw new NoSuchFieldException(name);
    }
    private static Method method(Class<?> c, String name, Class<?>... args) throws Exception {
        Method result = c.getDeclaredMethod(name, args); result.setAccessible(true); return result;
    }
    private static Object empty(Class<?> c) throws Exception {
        Class<?> unsafe = Class.forName("sun.misc.Unsafe");
        Field instance = unsafe.getDeclaredField("theUnsafe"); instance.setAccessible(true);
        return unsafe.getMethod("allocateInstance", Class.class).invoke(instance.get(null), c);
    }
    private static String bits(float value) { return String.format("%08x", Float.floatToRawIntBits(value)); }
    private static boolean accepts(Method validator, Object values, double value) throws Exception {
        return ((Optional<?>) validator.invoke(values, value)).isPresent();
    }
    public static void main(String[] args) throws Exception {
        cfg = new Properties();
        try (Reader input = new InputStreamReader(new FileInputStream(args[0]), "UTF-8")) { cfg.load(input); }
        Class<?> categoryType = type("category"), optionsType = type("options"), optionType = type("option");
        Object options = empty(optionsType), engine = empty(type("engine"));
        Object master = field(categoryType, name("master")).get(null), records = field(categoryType, name("records")).get(null);
        Method factory = method(optionsType, name("createSlider"), String.class, categoryType);
        Object masterOption = factory.invoke(options, "research.master", master), recordsOption = factory.invoke(options, "research.records", records);
        Map<Object, Object> volumes = new HashMap<Object, Object>(); volumes.put(master, masterOption); volumes.put(records, recordsOption);
        field(optionsType, name("volumeMap")).set(options, volumes); field(type("engine"), name("engineOptions")).set(engine, options);
        Method get = method(optionType, name("optionGet"));
        Object validValues = field(optionType, name("optionValues")).get(recordsOption);
        Method validate = method(validValues.getClass(), name("validate"), Double.class);
        Method rawVolume = method(optionsType, name("getVolume"), categoryType);
        Method finalVolume = method(optionsType, name("getFinalVolume"), categoryType);
        Method calculate = method(type("engine"), name("calculate"), float.class, categoryType);
        Method clamp = method(type("mth"), name("clamp"), float.class, float.class, float.class);
        Properties evidence = new Properties();
        evidence.setProperty("default.master", get.invoke(masterOption).toString());
        evidence.setProperty("default.records", get.invoke(recordsOption).toString());
        evidence.setProperty("java.version", System.getProperty("java.version"));
        evidence.setProperty("java.vm.name", System.getProperty("java.vm.name"));
        evidence.setProperty("scope", "Original methods on Unsafe-allocated explicit state, not a running engine; invalid Options are explicitly injected only for synthetic robustness rows.");

        long device = SOFTLoopback.alcLoopbackOpenDeviceSOFT((ByteBuffer) null);
        if (device == 0) throw new IllegalStateException("No original DLL loopback");
        ALCCapabilities alc = ALC.createCapabilities(device);
        long context = ALC10.alcCreateContext(device, new int[] { 0x1990, 0x1501, 0x1991, 0x1406, 0x1007, 48000, 0x1992, 0, 0x1996, 0, 0x199A, 1, 0 });
        if (context == 0 || !ALC10.alcMakeContextCurrent(context)) throw new IllegalStateException("No original DLL context");
        AL.createCapabilities(alc);
        Object listener = type("listener").getConstructor().newInstance();
        method(type("listener"), name("resetListener")).invoke(listener);
        Object channel = method(type("channel"), name("createChannel")).invoke(null);
        int source = field(type("channel"), name("source")).getInt(channel);
        Method setChannel = method(type("channel"), name("setVolume"), float.class);
        Method setListener = name("setGain") == null ? null : method(type("listener"), name("setGain"), float.class);
        evidence.setProperty("backend", AL10.alGetString(AL10.AL_VERSION));
        evidence.setProperty("initialListenerGainBits", bits(AL10.alGetListenerf(AL10.AL_GAIN)));
        evidence.setProperty("listenerSetterExists", Boolean.toString(setListener != null));
        try (PrintWriter output = new PrintWriter(new OutputStreamWriter(new FileOutputStream(args[2]), "UTF-8"))) {
            output.println("case\trawInputBits\tcategoryBits\tmasterBits\tfinalVolumeBits\tclampRawBits\tmathMinRawBits\tengineGainBits\texpectedListenerBits\tsourceGainBits\tlistenerGainBits\talError\tcategoryAccepted\tmasterAccepted");
            List<String> rows = Files.readAllLines(Paths.get(args[1]));
            for (int index = 0; index < rows.size(); index++) {
                String[] values = rows.get(index).split("\t");
                float raw = Float.intBitsToFloat((int) Long.parseLong(values[0], 16));
                double category = Double.parseDouble(values[1]), masterValue = Double.parseDouble(values[2]);
                boolean categoryAccepted = accepts(validate, validValues, category), masterAccepted = accepts(validate, validValues, masterValue);
                field(optionType, name("optionValue")).set(recordsOption, category);
                field(optionType, name("optionValue")).set(masterOption, masterValue);
                float categoryGain = ((Number) rawVolume.invoke(options, records)).floatValue();
                float masterGain = ((Number) rawVolume.invoke(options, master)).floatValue();
                float combined = ((Number) finalVolume.invoke(options, records)).floatValue();
                float clamped = ((Number) clamp.invoke(null, raw, 0.0f, 1.0f)).floatValue();
                float minimum = Math.min(raw, 1.0f);
                float gain = ((Number) calculate.invoke(engine, raw, records)).floatValue();
                float expectedListener = setListener == null ? 1.0f : masterGain;
                String sourceResult = "not-applied", listenerResult = "not-applied"; int error = 0;
                if (Float.isFinite(gain) && gain >= 0 && Float.isFinite(expectedListener) && expectedListener >= 0 && expectedListener <= 1) {
                    if (setListener != null) setListener.invoke(listener, masterGain);
                    setChannel.invoke(channel, gain); error = AL10.alGetError();
                    sourceResult = bits(AL10.alGetSourcef(source, AL10.AL_GAIN));
                    listenerResult = bits(AL10.alGetListenerf(AL10.AL_GAIN));
                }
                output.println(index + "\t" + bits(raw) + "\t" + bits(categoryGain) + "\t" + bits(masterGain) + "\t" + bits(combined) + "\t" + bits(clamped) + "\t" + bits(minimum) + "\t" + bits(gain) + "\t" + bits(expectedListener) + "\t" + sourceResult + "\t" + listenerResult + "\t" + error + "\t" + categoryAccepted + "\t" + masterAccepted);
            }
        } finally {
            method(type("channel"), name("destroyChannel")).invoke(channel);
            ALC10.alcMakeContextCurrent(0); ALC10.alcDestroyContext(context); ALC10.alcCloseDevice(device);
        }
        try (Writer output = new OutputStreamWriter(new FileOutputStream(args[3]), "UTF-8")) { evidence.store(output, "Original strict float gain and Math.min probe; no NaN bit waiver"); }
    }
}
