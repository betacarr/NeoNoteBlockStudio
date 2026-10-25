package studio.nbsx.research;

import com.sun.jna.*;

/** Probe only the exact officially referenced native DLL supplied by the caller. */
public final class Lwjgl2NativeProbe {
    public static void main(String[] args) {
        NativeLibrary library = NativeLibrary.getInstance(args[0]);
        Pointer open = (Pointer)library.getFunction("alcGetProcAddress").invoke(Pointer.class, new Object[]{Pointer.NULL, "alcLoopbackOpenDeviceSOFT"});
        if (open == null) throw new IllegalStateException("Original DLL has no ALC_SOFT_loopback");
        Pointer device = (Pointer)Function.getFunction(open).invoke(Pointer.class, new Object[]{Pointer.NULL});
        if (device == null) throw new IllegalStateException("Original DLL could not open loopback");
        Pointer context = null;
        try {
            boolean hrtf = library.getFunction("alcIsExtensionPresent").invokeInt(new Object[]{device, "ALC_SOFT_HRTF"}) != 0;
            boolean limiter = library.getFunction("alcIsExtensionPresent").invokeInt(new Object[]{device, "ALC_SOFT_output_limiter"}) != 0;
            String extensions = ((Pointer)library.getFunction("alcGetString").invoke(Pointer.class, new Object[]{device, 0x1006})).getString(0);
            context = (Pointer)library.getFunction("alcCreateContext").invoke(Pointer.class, new Object[]{device, new int[]{0x1990, 0x1501, 0x1991, 0x1406, 0x1007, 48000, 0}});
            if (context == null || library.getFunction("alcMakeContextCurrent").invokeInt(new Object[]{context}) == 0) throw new IllegalStateException("Original context failed");
            String version = ((Pointer)library.getFunction("alGetString").invoke(Pointer.class, new Object[]{0xB002})).getString(0);
            System.out.println("{\"backend\":\"" + version + "\",\"loopback\":true,\"hrtf\":" + hrtf + ",\"outputLimiter\":" + limiter + ",\"extensions\":\"" + extensions + "\"}");
        } finally {
            library.getFunction("alcMakeContextCurrent").invokeInt(new Object[]{Pointer.NULL});
            if (context != null) library.getFunction("alcDestroyContext").invokeVoid(new Object[]{context});
            library.getFunction("alcCloseDevice").invokeInt(new Object[]{device});
        }
    }
}
