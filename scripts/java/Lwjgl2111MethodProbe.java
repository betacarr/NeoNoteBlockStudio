package studio.nbsx.research;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.objectweb.asm.*;

/** Per-release original-class execution. Only explicit Options/instance state and isolated World callbacks are supplied. */
public final class Lwjgl2111MethodProbe {
  private static Properties p;
  public static Object emittedEvent, airState, baseState, aboveState;
  public static float emittedVolume, emittedPitch;
  public static int queuedInstrument=-1, queuedNote=-1;
  public static void sound(Object event,float volume,float pitch){emittedEvent=event;emittedVolume=volume;emittedPitch=pitch;}
  public static Object state(Object pos)throws Exception{return ((Number)pos.getClass().getMethod(p.getProperty("positionYGetter")).invoke(pos)).intValue()>80?aboveState:baseState;}
  public static void queued(int instrument,int note){queuedInstrument=instrument;queuedNote=note;}
  private static Class<?> c(String role)throws Exception{return Class.forName(p.getProperty(role));}
  private static Object empty(Class<?> type)throws Exception{Class<?> u=Class.forName("sun.misc.Unsafe");Field f=u.getDeclaredField("theUnsafe");f.setAccessible(true);return u.getMethod("allocateInstance",Class.class).invoke(f.get(null),type);}
  private static void set(Object object,Class<?> type,String name,Object value)throws Exception{Field f=type.getDeclaredField(name);f.setAccessible(true);f.set(object,value);}
  private static Method method(Class<?> type,String name,Class<?>...args)throws Exception{Method m=type.getDeclaredMethod(name,args);m.setAccessible(true);return m;}
  private static void le(DataOutputStream out,int value)throws IOException{out.writeInt(Integer.reverseBytes(value));}
  private static void fl(DataOutputStream out,float value)throws IOException{le(out,Float.floatToRawIntBits(value));}
  private static class Loader extends ClassLoader{Class<?> define(byte[] bytes){return defineClass(null,bytes,0,bytes.length);}}
  private static Class<?> isolatedWorld(){
    String self="studio/nbsx/research/Lwjgl2111MethodProbe";
    ClassWriter w=new ClassWriter(ClassWriter.COMPUTE_MAXS);w.visit(Opcodes.V1_8,Opcodes.ACC_PUBLIC|Opcodes.ACC_SUPER,"studio/nbsx/research/IsolatedWorld111",null,p.getProperty("World"),null);
    MethodVisitor m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("soundMethod"),p.getProperty("soundDescriptor"),null,null);m.visitCode();m.visitVarInsn(Opcodes.ALOAD,3);m.visitVarInsn(Opcodes.FLOAD,5);m.visitVarInsn(Opcodes.FLOAD,6);m.visitMethodInsn(Opcodes.INVOKESTATIC,self,"sound","(Ljava/lang/Object;FF)V",false);m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("particleMethod"),p.getProperty("particleDescriptor"),null,null);m.visitCode();m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("stateMethod"),p.getProperty("stateDescriptor"),null,null);m.visitCode();m.visitVarInsn(Opcodes.ALOAD,1);m.visitMethodInsn(Opcodes.INVOKESTATIC,self,"state","(Ljava/lang/Object;)Ljava/lang/Object;",false);m.visitTypeInsn(Opcodes.CHECKCAST,p.getProperty("BlockState"));m.visitInsn(Opcodes.ARETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("queueMethod"),p.getProperty("queueDescriptor"),null,null);m.visitCode();m.visitVarInsn(Opcodes.ILOAD,3);m.visitVarInsn(Opcodes.ILOAD,4);m.visitMethodInsn(Opcodes.INVOKESTATIC,self,"queued","(II)V",false);m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();w.visitEnd();return new Loader().define(w.toByteArray());
  }
  private static Object wire(Object original,Class<?> packet)throws Exception{
    Class<?> buffer=c("PacketBuffer"),buf=Class.forName("io.netty.buffer.ByteBuf");Object raw=Class.forName("io.netty.buffer.Unpooled").getMethod("buffer").invoke(null),wrapped=buffer.getConstructor(buf).newInstance(raw);
    try{packet.getMethod("b",buffer).invoke(original,wrapped);Object received=packet.getConstructor().newInstance();packet.getMethod("a",buffer).invoke(received,wrapped);return received;}finally{buf.getMethod("release").invoke(raw);}
  }
  public static void main(String[] args)throws Exception{
    p=new Properties();try(InputStream in=new FileInputStream(args[0])){p.load(in);}
    Class<?> engineClass=c("SoundEngine"),instanceClass=c("SoundInstance"),abstractClass=c("AbstractSound"),definitionClass=c("SoundDefinition"),categoryClass=c("Category"),optionsClass=c("Options"),locationClass=c("ResourceLocation");
    Object engine=empty(engineClass),options=empty(optionsClass),category=categoryClass.getField(p.getProperty("recordField")).get(null),master=categoryClass.getField(p.getProperty("masterField")).get(null);
    Map<Object,Float> volumes=new HashMap<Object,Float>();set(options,optionsClass,p.getProperty("optionMapField"),volumes);set(engine,engineClass,p.getProperty("engineOptionsField"),options);
    Class<?> definitionType=Class.forName(p.getProperty("definitionType")),attenuation=Class.forName(p.getProperty("attenuationType"));
    Constructor<?> sampleCtor=definitionClass.getConstructor(String.class,float.class,float.class,int.class,definitionType,boolean.class),instanceCtor=c("PositionedSound").getConstructor(locationClass,categoryClass,float.class,float.class,boolean.class,int.class,attenuation,float.class,float.class,float.class);
    Object location=locationClass.getConstructor(String.class).newInstance("minecraft:block.note.harp"),sample=sampleCtor.newInstance("note/harp",1f,1f,1,definitionType.getEnumConstants()[0],false);
    Method gain=method(engineClass,p.getProperty("gainMethod"),instanceClass),pitch=method(engineClass,p.getProperty("pitchMethod"),instanceClass),volumeGetter=instanceClass.getMethod(p.getProperty("volumeGetter")),pitchGetter=instanceClass.getMethod(p.getProperty("pitchGetter"));
    List<String> rows=Files.readAllLines(Paths.get(args[1]));
    try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[2]))){out.writeBytes("NBAP");le(out,rows.size());for(String line:rows){String[] v=line.split("\t");float raw=Float.parseFloat(v[0]),rawPitch=Float.parseFloat(v[1]),categoryGain=Float.parseFloat(v[2]),eventVolume=Float.parseFloat(v[3]),eventPitch=Float.parseFloat(v[4]);
      Object instance=instanceCtor.newInstance(location,category,raw,rawPitch,false,0,attenuation.getEnumConstants()[1],0f,0f,-2f),event=sampleCtor.newInstance("note/harp",eventVolume,eventPitch,1,definitionType.getEnumConstants()[0],false);set(instance,abstractClass,p.getProperty("sampleField"),event);volumes.put(category,categoryGain);
      fl(out,((Number)volumeGetter.invoke(instance)).floatValue());fl(out,((Number)pitchGetter.invoke(instance)).floatValue());fl(out,((Number)gain.invoke(engine,instance)).floatValue());fl(out,((Number)pitch.invoke(engine,instance)).floatValue());
    }}
    Method optionGetter=optionsClass.getMethod(p.getProperty("optionGetter"),categoryClass);for(float value:new float[]{-0f,0f,.2f,.7f,1f}){volumes.put(master,value);System.out.println("MASTER_OPTION\t"+Integer.toHexString(Float.floatToRawIntBits(value))+"\t"+Integer.toHexString(Float.floatToRawIntBits(((Number)optionGetter.invoke(options,master)).floatValue())));}
    c("Bootstrap").getMethod(p.getProperty("bootstrapMethod")).invoke(null);
    Object registry=null;for(Field field:c("SoundEvent").getDeclaredFields())if(Modifier.isStatic(field.getModifiers())&&!field.getType().isPrimitive()){field.setAccessible(true);Object candidate=field.get(null);try{candidate.getClass().getMethod("c",Object.class);registry=candidate;break;}catch(Exception ignored){}}
    if(registry==null)throw new IllegalStateException("No original SoundEvent registry");Object originalEvent=registry.getClass().getMethod("c",Object.class).invoke(registry,location);if(originalEvent==null)throw new IllegalStateException("No original registered harp sound");
    List<String> packetRows=Files.readAllLines(Paths.get(args[3]));
    try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[4]))){out.writeBytes("NAPP");le(out,packetRows.size());for(String line:packetRows){float input=Float.parseFloat(line);for(String role:new String[]{"NamedSoundPacket","RegisteredSoundPacket"}){Class<?> packet=c(role);Object sent=role.equals("NamedSoundPacket")?packet.getConstructor(String.class,categoryClass,double.class,double.class,double.class,float.class,float.class).newInstance("block.note.harp",category,.5,80.5,.5,3f,input):packet.getConstructor(c("SoundEvent"),categoryClass,double.class,double.class,double.class,float.class,float.class).newInstance(originalEvent,category,.5,80.5,.5,3f,input);
      float stored=((Number)packet.getMethod("g").invoke(sent)).floatValue(),decoded=((Number)packet.getMethod("g").invoke(wire(sent,packet))).floatValue();Object actual=instanceCtor.newInstance(location,category,3f,decoded,false,0,attenuation.getEnumConstants()[1],.5f,80.5f,.5f),direct=instanceCtor.newInstance(location,category,3f,input,false,0,attenuation.getEnumConstants()[1],.5f,80.5f,.5f);set(actual,abstractClass,p.getProperty("sampleField"),sample);set(direct,abstractClass,p.getProperty("sampleField"),sample);fl(out,stored);fl(out,decoded);fl(out,((Number)pitch.invoke(engine,actual)).floatValue());fl(out,((Number)pitch.invoke(engine,direct)).floatValue());
    }}}
    Constructor<?> noteInstanceCtor=c("PositionedSound").getConstructor(c("SoundEvent"),categoryClass,float.class,float.class,float.class,float.class,float.class);
    Class<?> blocks=c("Blocks"),block=c("Block"),stateClass=c("BlockState"),posClass=c("BlockPos"),worldClass=c("World");Object world=empty(isolatedWorld()),note=empty(c("NoteBlock")),tile=c("TileEntityNote").getConstructor().newInstance(),pos=posClass.getConstructor(int.class,int.class,int.class).newInstance(0,80,0);
    Method defaultState=block.getMethod(p.getProperty("defaultStateMethod"));airState=defaultState.invoke(blocks.getField(p.getProperty("airField")).get(null));aboveState=airState;boolean stateFirst=Boolean.parseBoolean(p.getProperty("noteStateFirst"));Method tileTrigger=c("TileEntityNote").getMethod(p.getProperty("tileTriggerMethod"),worldClass,posClass),event=stateFirst?c("NoteBlock").getMethod(p.getProperty("noteEventMethod"),stateClass,worldClass,posClass,int.class,int.class):c("NoteBlock").getMethod(p.getProperty("noteEventMethod"),worldClass,posClass,stateClass,int.class,int.class);volumes.put(category,.5f);
    try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[5]))){out.writeBytes("NANP");le(out,125);int material=0;for(String field:p.getProperty("supportFields").split(",")){baseState=defaultState.invoke(blocks.getField(field).get(null));for(int n=0;n<25;n++){
      c("TileEntityNote").getField(p.getProperty("tileNoteField")).setByte(tile,(byte)n);queuedInstrument=-1;queuedNote=-1;tileTrigger.invoke(tile,world,pos);if(queuedInstrument!=material||queuedNote!=n)throw new IllegalStateException("Unexpected material/note queue "+material+"/"+n+": "+queuedInstrument+"/"+queuedNote);
      if(stateFirst)event.invoke(note,null,world,pos,queuedInstrument,queuedNote);else event.invoke(note,world,pos,null,queuedInstrument,queuedNote);Class<?> packetClass=c("RegisteredSoundPacket");Object sent=packetClass.getConstructor(c("SoundEvent"),categoryClass,double.class,double.class,double.class,float.class,float.class).newInstance(emittedEvent,category,.5,80.5,.5,emittedVolume,emittedPitch),received=wire(sent,packetClass);
      Object decodedEvent=packetClass.getMethod(p.getProperty("packetEventGetter")).invoke(received),decodedCategory=packetClass.getMethod(p.getProperty("packetCategoryGetter")).invoke(received);float decoded=((Number)packetClass.getMethod("g").invoke(received)).floatValue(),decodedVolume=((Number)packetClass.getMethod(p.getProperty("packetVolumeGetter")).invoke(received)).floatValue();
      if(decodedEvent!=emittedEvent||decodedCategory!=category||Float.floatToRawIntBits(decodedVolume)!=Float.floatToRawIntBits(emittedVolume))throw new IllegalStateException("Original Netty changed event/category/volume");
      Object actual=noteInstanceCtor.newInstance(decodedEvent,decodedCategory,decodedVolume,decoded,.5f,80.5f,.5f),originalDefinition=sampleCtor.newInstance(p.getProperty("sampleNames").split(",")[material],1f,1f,1,definitionType.getEnumConstants()[0],false);set(actual,abstractClass,p.getProperty("sampleField"),originalDefinition);
      fl(out,emittedPitch);fl(out,decoded);fl(out,((Number)pitch.invoke(engine,actual)).floatValue());fl(out,decodedVolume);fl(out,((Number)gain.invoke(engine,actual)).floatValue());System.out.println("NOTE\t"+material+"\t"+n+"\t"+c("SoundEvent").getMethod("a").invoke(decodedEvent));
      if(n==12)System.out.println("MATERIAL\t"+field+"\t"+queuedInstrument+"\t"+queuedNote);
    }material++;}}
    aboveState=baseState;queuedInstrument=-1;tileTrigger.invoke(tile,world,pos);System.out.println("BLOCKED\t"+queuedInstrument);
    System.out.println("POOL\t"+Class.forName("paulscode.sound.SoundSystemConfig").getMethod("getNumberNormalChannels").invoke(null)+"\t"+Class.forName("paulscode.sound.SoundSystemConfig").getMethod("getNumberStreamingChannels").invoke(null));
  }
}
