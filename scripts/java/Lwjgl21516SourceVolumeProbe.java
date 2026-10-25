package studio.nbsx.research;

import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import paulscode.sound.*;

/** Original base classes only. No constructors for Library, Source or SoundSystem; no thread or device. */
public final class Lwjgl21516SourceVolumeProbe {
  private static Object empty(Class<?> type) throws Exception {
    Class<?> u=Class.forName("sun.misc.Unsafe"); Field f=u.getDeclaredField("theUnsafe"); f.setAccessible(true);
    return u.getMethod("allocateInstance",Class.class).invoke(f.get(null),type);
  }
  private static Field field(Class<?> type,String name) throws Exception {
    Field f=type.getDeclaredField(name);f.setAccessible(true);return f;
  }
  private static String bits(float value) {return String.format(Locale.ROOT,"%08x",Float.floatToRawIntBits(value));}
  private static float value(String bits) {return Float.intBitsToFloat((int)Long.parseLong(bits,16));}
  public static void main(String[] args) throws Exception {
    Library library=(Library)empty(Library.class); Source source=(Source)empty(Source.class);
    if(library.getClass()!=Library.class||source.getClass()!=Source.class)throw new AssertionError("Base classes required");
    HashMap<String,Source> sources=new HashMap<String,Source>();sources.put("probe",source);
    field(Library.class,"sourceMap").set(library,sources);
    SoundSystem system=(SoundSystem)empty(SoundSystem.class);
    field(SoundSystem.class,"soundLibrary").set(system,library);
    List<CommandObject> commands=new LinkedList<CommandObject>();
    field(SoundSystem.class,"commandQueue").set(system,commands);
    field(SoundSystem.class,"sourcePlayList").set(system,new LinkedList<CommandObject>());
    Method direct=SoundSystem.class.getDeclaredMethod("CommandSetVolume",String.class,float.class);direct.setAccessible(true);
    int count=0;
    for(String line:Files.readAllLines(Paths.get(args[0]))) {
      String[] columns=line.split("\t");float input=value(columns[1]);
      source.sourceVolume=-7f;library.setVolume("probe",input);String base=bits(source.sourceVolume);
      source.sourceVolume=-7f;direct.invoke(system,"probe",input);String command=bits(source.sourceVolume);
      source.sourceVolume=-7f;CommandObject object=new CommandObject(14,"probe",input);
      if(object.Command!=14||!"probe".equals(object.stringArgs[0])||Float.floatToRawIntBits(object.floatArgs[0])!=Float.floatToRawIntBits(input))throw new AssertionError("Command constructor changed arguments");
      if(!system.CommandQueue(object)||commands.size()!=1||commands.get(0)!=object)throw new AssertionError("Original enqueue");
      if(system.CommandQueue(null)||!commands.isEmpty())throw new AssertionError("Original drain");
      String queued=bits(source.sourceVolume);
      System.out.println("ROW\t"+columns[0]+"\t"+bits(input)+"\t"+base+"\t"+command+"\t"+queued);count++;
    }
    source.sourceVolume=.375f;library.setVolume("absent",2f);library.setVolume(null,2f);
    if(Float.floatToRawIntBits(source.sourceVolume)!=Float.floatToRawIntBits(.375f))throw new AssertionError("Missing source changed existing source");
    if(field(Library.class,"midiChannel").get(library)!=null||field(SoundSystem.class,"commandThread").get(system)!=null)throw new AssertionError("Unexpected device/thread state");
    if(SoundSystemConfig.getMasterGain()!=1f)throw new AssertionError("Original default master");
    System.out.println("SUMMARY\t"+count+"\t"+bits(SoundSystemConfig.getMasterGain()));
    System.out.println("BOUNDARY\tbase-classes-only\tno-constructors-no-thread-no-device-no-worker");
  }
}
