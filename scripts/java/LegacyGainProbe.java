package studio.nbsx.research;
import java.io.*;
import java.nio.*;
import java.lang.reflect.*;
import java.util.*;
import javax.sound.sampled.AudioFormat;
import paulscode.sound.SoundSystemConfig;
import paulscode.sound.SoundSystemLogger;

/** Calls the original checked Paulscode source with no audio channel attached. */
public final class LegacyGainProbe {
    private static float field(Object object, String name) throws Exception {
        for (Class<?> type = object.getClass(); type != null; type = type.getSuperclass()) {
            try { Field field = type.getDeclaredField(name); field.setAccessible(true); return field.getFloat(object); }
            catch (NoSuchFieldException missing) { }
        }
        throw new NoSuchFieldException(name);
    }
    public static void main(String[] args) throws Exception {
        SoundSystemConfig.setLogger(new SoundSystemLogger());
        List<String> cases = java.nio.file.Files.readAllLines(java.nio.file.Paths.get(args[0]));
        try (DataOutputStream out = new DataOutputStream(new FileOutputStream(args[1]))) {
            out.writeBytes("NBLG"); out.writeInt(Integer.reverseBytes(cases.size()));
            for (String line : cases) {
                String[] parts = line.split("\t"); float x = Float.parseFloat(parts[0]), y = Float.parseFloat(parts[1]), z = Float.parseFloat(parts[2]), range = Float.parseFloat(parts[3]), volume = Float.parseFloat(parts[4]);
                FloatBuffer listener = ByteBuffer.allocateDirect(12).order(ByteOrder.nativeOrder()).asFloatBuffer();
                Class<?> sourceType=Class.forName(args.length>2?args[2]:"paulscode.sound.libraries.SourceLWJGLOpenAL");
                Object source=sourceType.getConstructor(FloatBuffer.class,AudioFormat.class,boolean.class,String.class,float.class,float.class,float.class,int.class,float.class).newInstance(listener,new AudioFormat(48000,16,1,true,false),false,"nbsx-gain-probe",x,y,z,2,range);
                float gain = field(source, "gain"), distance = field(source, "distanceFromListener");
                float effective = gain * volume * Math.abs(field(source, "fadeOutGain")) * field(source, "fadeInGain");
                out.writeInt(Integer.reverseBytes(Float.floatToRawIntBits(distance))); out.writeInt(Integer.reverseBytes(Float.floatToRawIntBits(gain))); out.writeInt(Integer.reverseBytes(Float.floatToRawIntBits(effective)));
            }
        }
    }
}
