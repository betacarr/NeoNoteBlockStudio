package studio.nbsx.research;

import java.io.File;
import java.lang.reflect.*;
import paulscode.sound.SoundSystem;

/** Executes the original 1.0 sound-manager entry against a no-audio sink.
 * The sink observes submitted values only; it does not emulate Paulscode/OpenAL. */
public class Legacy10SoundBoundary {
    static Field field(Class<?> type, String name) throws Exception { Field f=type.getDeclaredField(name);f.setAccessible(true);return f; }
    static String bits(float value) { return String.format("%08x",Float.floatToRawIntBits(value)); }
    public static void main(String[] args) throws Exception {
        Class<?> unsafeType=Class.forName("sun.misc.Unsafe");Field singleton=unsafeType.getDeclaredField("theUnsafe");singleton.setAccessible(true);Object unsafe=singleton.get(null);
        Class<?> engineType=Class.forName("ahm"),optionsType=Class.forName("ki");
        Object engine=engineType.getConstructor().newInstance(),options=unsafeType.getMethod("allocateInstance",Class.class).invoke(unsafe,optionsType);
        SoundSystem sink=new SoundSystem();field(engineType,"a").set(null,sink);field(engineType,"g").setBoolean(null,true);field(engineType,"f").set(engine,options);
        engineType.getMethod("a",String.class,File.class).invoke(engine,"note/harp.ogg",new File("not-read-harp.ogg"));
        Method play=engineType.getMethod("b",String.class,float.class,float.class,float.class,float.class,float.class);
        float[] volumes={-1f,-0f,0f,.01f,.25f,.5f,1f,1.0001f,3f,6f};
        float[] masters={0f,.1f,.7f,1f};
        float[] pitches={.25f,.5f,1f,2f,4f};
        System.out.println("sourceBits,settingBits,pitchBits,played,gainBits,submittedPitchBits,rangeBits");
        for(float volume:volumes)for(float master:masters)for(float pitch:pitches){
            field(optionsType,"b").setFloat(options,master);sink.reset();
            play.invoke(engine,"note.harp",2f,3f,-4f,volume,pitch);
            System.out.println(bits(volume)+","+bits(master)+","+bits(pitch)+","+sink.played+","+bits(sink.gain)+","+bits(sink.pitch)+","+bits(sink.range));
        }
    }
}
