package studio.nbsx.research;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.objectweb.asm.*;

/** Executes original methods. Only explicit instance/Options state and isolated World callbacks are supplied. */
public final class Lwjgl219MethodProbe {
  private static Properties p;
  public static Object emittedEvent, airState, baseState, aboveState;
  public static float emittedVolume, emittedPitch;
  public static int queuedInstrument = -1, queuedNote = -1;
  public static void sound(Object event, float volume, float pitch) { emittedEvent=event; emittedVolume=volume; emittedPitch=pitch; }
  public static Object state(Object pos) throws Exception { return ((Number)pos.getClass().getMethod("q").invoke(pos)).intValue()>80?aboveState:baseState; }
  public static void queued(int instrument, int note) { queuedInstrument=instrument; queuedNote=note; }
  private static Class<?> c(String role) throws Exception { return Class.forName(p.getProperty(role)); }
  private static Object empty(Class<?> type) throws Exception { Class<?> u=Class.forName("sun.misc.Unsafe");Field f=u.getDeclaredField("theUnsafe");f.setAccessible(true);return u.getMethod("allocateInstance",Class.class).invoke(f.get(null),type); }
  private static void set(Object object, Class<?> type, String name, Object value) throws Exception { Field f=type.getDeclaredField(name);f.setAccessible(true);f.set(object,value); }
  private static Method method(Class<?> type,String name,Class<?>...args) throws Exception { Method m=type.getDeclaredMethod(name,args);m.setAccessible(true);return m; }
  private static void le(DataOutputStream out,int value) throws IOException { out.writeInt(Integer.reverseBytes(value)); }
  private static void fl(DataOutputStream out,float value) throws IOException { le(out,Float.floatToRawIntBits(value)); }
  private static class Loader extends ClassLoader { Class<?> define(byte[] bytes) { return defineClass(null,bytes,0,bytes.length); } }
  private static Class<?> isolatedWorld() {
    ClassWriter w=new ClassWriter(ClassWriter.COMPUTE_MAXS);w.visit(Opcodes.V1_8,Opcodes.ACC_PUBLIC|Opcodes.ACC_SUPER,"studio/nbsx/research/IsolatedWorld19",null,"aht",null);
    MethodVisitor m=w.visitMethod(Opcodes.ACC_PUBLIC,"a","(Lzj;Lcj;Lnf;Lnh;FF)V",null,null);m.visitCode();m.visitVarInsn(Opcodes.ALOAD,3);m.visitVarInsn(Opcodes.FLOAD,5);m.visitVarInsn(Opcodes.FLOAD,6);m.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/Lwjgl219MethodProbe","sound","(Ljava/lang/Object;FF)V",false);m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,"a","(Lcy;DDDDDD[I)V",null,null);m.visitCode();m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,"o","(Lcj;)Larc;",null,null);m.visitCode();m.visitVarInsn(Opcodes.ALOAD,1);m.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/Lwjgl219MethodProbe","state","(Ljava/lang/Object;)Ljava/lang/Object;",false);m.visitTypeInsn(Opcodes.CHECKCAST,"arc");m.visitInsn(Opcodes.ARETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,"c","(Lcj;Lajt;II)V",null,null);m.visitCode();m.visitVarInsn(Opcodes.ILOAD,3);m.visitVarInsn(Opcodes.ILOAD,4);m.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/Lwjgl219MethodProbe","queued","(II)V",false);m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();w.visitEnd();return new Loader().define(w.toByteArray());
  }
  private static Object wire(Object original,Class<?> packet) throws Exception {
    Class<?> buffer=c("PacketBuffer"),buf=Class.forName("io.netty.buffer.ByteBuf");Object raw=Class.forName("io.netty.buffer.Unpooled").getMethod("buffer").invoke(null),wrapped=buffer.getConstructor(buf).newInstance(raw);
    try { packet.getMethod("b",buffer).invoke(original,wrapped);Object received=packet.getConstructor().newInstance();packet.getMethod("a",buffer).invoke(received,wrapped);return received; } finally { buf.getMethod("release").invoke(raw); }
  }
  public static void main(String[] args) throws Exception {
    p=new Properties();try(InputStream in=new FileInputStream(args[0])){p.load(in);}
    Class<?> engineClass=c("SoundEngine"),instanceClass=c("SoundInstance"),abstractClass=c("AbstractSound"),definitionClass=c("SoundDefinition"),categoryClass=c("Category"),optionsClass=c("Options"),locationClass=c("ResourceLocation");
    Object engine=empty(engineClass),options=empty(optionsClass),category=categoryClass.getField(p.getProperty("recordField")).get(null),master=categoryClass.getField(p.getProperty("masterField")).get(null);
    Map<Object,Float> volumes=new HashMap<Object,Float>();set(options,optionsClass,p.getProperty("optionMapField"),volumes);set(engine,engineClass,p.getProperty("engineOptionsField"),options);
    Class<?> definitionType=Class.forName(p.getProperty("definitionType")),attenuation=Class.forName(p.getProperty("attenuationType"));
    Constructor<?> sampleCtor=definitionClass.getConstructor(String.class,float.class,float.class,int.class,definitionType,boolean.class),instanceCtor=c("PositionedSound").getConstructor(locationClass,categoryClass,float.class,float.class,boolean.class,int.class,attenuation,float.class,float.class,float.class);
    Object location=locationClass.getConstructor(String.class).newInstance("minecraft:block.note.harp"),sample=sampleCtor.newInstance("note/harp",1f,1f,1,definitionType.getEnumConstants()[0],false);
    Method gain=method(engineClass,p.getProperty("gainMethod"),instanceClass),pitch=method(engineClass,p.getProperty("pitchMethod"),instanceClass),volumeGetter=instanceClass.getMethod(p.getProperty("volumeGetter")),pitchGetter=instanceClass.getMethod(p.getProperty("pitchGetter"));
    List<String> rows=Files.readAllLines(Paths.get(args[1]));
    try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[2]))){out.writeBytes("NB19");le(out,rows.size());for(String line:rows){String[] v=line.split("\t");float raw=Float.parseFloat(v[0]),rawPitch=Float.parseFloat(v[1]),categoryGain=Float.parseFloat(v[2]),eventVolume=Float.parseFloat(v[3]),eventPitch=Float.parseFloat(v[4]);
      Object instance=instanceCtor.newInstance(location,category,raw,rawPitch,false,0,attenuation.getEnumConstants()[1],0f,0f,-2f);Object event=sampleCtor.newInstance("note/harp",eventVolume,eventPitch,1,definitionType.getEnumConstants()[0],false);set(instance,abstractClass,p.getProperty("sampleField"),event);volumes.put(category,categoryGain);
      fl(out,((Number)volumeGetter.invoke(instance)).floatValue());fl(out,((Number)pitchGetter.invoke(instance)).floatValue());fl(out,((Number)gain.invoke(engine,instance)).floatValue());fl(out,((Number)pitch.invoke(engine,instance)).floatValue());
    }}
    Method optionGetter=optionsClass.getMethod("a",categoryClass);for(float value:new float[]{-0f,0f,.2f,.7f,1f}){volumes.put(master,value);System.out.println("MASTER_OPTION\t"+Integer.toHexString(Float.floatToRawIntBits(value))+"\t"+Integer.toHexString(Float.floatToRawIntBits(((Number)optionGetter.invoke(options,master)).floatValue())));}
    if("1.9".equals(p.getProperty("version")))c("Bootstrap").getMethod("c").invoke(null);else{for(Method m:c("SoundEvent").getDeclaredMethods())if(Modifier.isStatic(m.getModifiers())&&m.getReturnType()==void.class&&m.getParameterTypes().length==0){m.setAccessible(true);m.invoke(null);break;}}
    Object registry=null;for(Field f:c("SoundEvent").getDeclaredFields())if(Modifier.isStatic(f.getModifiers())&&!f.getType().isPrimitive()){f.setAccessible(true);Object candidate=f.get(null);try{candidate.getClass().getMethod("c",Object.class);registry=candidate;break;}catch(Exception ignored){}}
    if(registry==null)throw new IllegalStateException("No original SoundEvent registry");Object originalEvent=registry.getClass().getMethod("c",Object.class).invoke(registry,location);if(originalEvent==null)throw new IllegalStateException("No original registered harp sound");
    List<String> packetRows=Files.readAllLines(Paths.get(args[3]));
    try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[4]))){out.writeBytes("NBP9");le(out,packetRows.size());for(String line:packetRows){float input=Float.parseFloat(line);for(String role:new String[]{"NamedSoundPacket","RegisteredSoundPacket"}){Class<?> packet=c(role);Object sent=role.equals("NamedSoundPacket")?packet.getConstructor(String.class,categoryClass,double.class,double.class,double.class,float.class,float.class).newInstance("block.note.harp",category,.5,80.5,.5,3f,input):packet.getConstructor(c("SoundEvent"),categoryClass,double.class,double.class,double.class,float.class,float.class).newInstance(originalEvent,category,.5,80.5,.5,3f,input);
      float stored=((Number)packet.getMethod("g").invoke(sent)).floatValue(),decoded=((Number)packet.getMethod("g").invoke(wire(sent,packet))).floatValue();Object actual=instanceCtor.newInstance(location,category,3f,decoded,false,0,attenuation.getEnumConstants()[1],.5f,80.5f,.5f);set(actual,abstractClass,p.getProperty("sampleField"),sample);fl(out,stored);fl(out,decoded);fl(out,((Number)pitch.invoke(engine,actual)).floatValue());
    }}}
    if("1.9".equals(p.getProperty("version"))){
      Class<?> blocks=c("Blocks"),block=c("Block"),stateClass=c("BlockState"),posClass=c("BlockPos"),worldClass=c("World");Object world=empty(isolatedWorld()),note=empty(c("NoteBlock")),tile=c("TileEntityNote").getConstructor().newInstance(),pos=posClass.getConstructor(int.class,int.class,int.class).newInstance(0,80,0);
      Method defaultState=block.getMethod(p.getProperty("defaultStateMethod"));airState=defaultState.invoke(blocks.getField(p.getProperty("airField")).get(null));aboveState=airState;c("TileEntityNote").getField("a").setByte(tile,(byte)12);
      for(String field:p.getProperty("supportFields").split(",")){baseState=defaultState.invoke(blocks.getField(field).get(null));queuedInstrument=-1;c("TileEntityNote").getMethod("a",worldClass,posClass).invoke(tile,world,pos);System.out.println("MATERIAL\t"+field+"\t"+queuedInstrument+"\t"+queuedNote);}
      aboveState=baseState;queuedInstrument=-1;c("TileEntityNote").getMethod("a",worldClass,posClass).invoke(tile,world,pos);System.out.println("BLOCKED\t"+queuedInstrument);aboveState=airState;
      Method event=c("NoteBlock").getMethod("a",worldClass,posClass,stateClass,int.class,int.class);volumes.put(category,.5f);
      try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[5]))){out.writeBytes("NBN9");le(out,125);for(int instrument=0;instrument<5;instrument++)for(int n=0;n<25;n++){event.invoke(note,world,pos,null,instrument,n);Object sent=c("RegisteredSoundPacket").getConstructor(c("SoundEvent"),categoryClass,double.class,double.class,double.class,float.class,float.class).newInstance(emittedEvent,category,.5,80.5,.5,emittedVolume,emittedPitch),received=wire(sent,c("RegisteredSoundPacket"));float decoded=((Number)c("RegisteredSoundPacket").getMethod("g").invoke(received)).floatValue();Object actual=instanceCtor.newInstance(location,category,emittedVolume,decoded,false,0,attenuation.getEnumConstants()[1],.5f,80.5f,.5f);set(actual,abstractClass,p.getProperty("sampleField"),sample);
        fl(out,emittedPitch);fl(out,decoded);fl(out,((Number)pitch.invoke(engine,actual)).floatValue());fl(out,emittedVolume);fl(out,((Number)gain.invoke(engine,actual)).floatValue());System.out.println("NOTE\t"+instrument+"\t"+n+"\t"+c("SoundEvent").getMethod("a").invoke(emittedEvent));
      }}
    }
    System.out.println("POOL\t"+Class.forName("paulscode.sound.SoundSystemConfig").getMethod("getNumberNormalChannels").invoke(null)+"\t"+Class.forName("paulscode.sound.SoundSystemConfig").getMethod("getNumberStreamingChannels").invoke(null));
  }
}
