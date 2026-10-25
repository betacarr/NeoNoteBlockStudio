package studio.nbsx.research;
import java.io.*;
import java.lang.reflect.*;
import java.net.URL;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import org.objectweb.asm.*;
import paulscode.sound.SoundSystem;

/** Original target-release calls with explicit inert audio-boundary/World input callbacks. No AL or world is started. */
public final class Lwjgl215MethodProbe {
  static Properties p;
  public static Object supportMaterial,airMaterial;
  public static int instrument=-1,note=-1;
  public static String event;
  public static float volume,pitch;
  public static double x,y,z;
  public static final class Sink extends SoundSystem {
    public boolean played; public float gain,submittedPitch,range;public float[] listener;
    public void reset(){played=false;gain=Float.NaN;submittedPitch=Float.NaN;range=Float.NaN;}
    @Override public void newSource(boolean priority,String name,URL url,String filename,boolean loop,float x,float y,float z,int attenuation,float distance){range=distance;}
    @Override public void setPitch(String name,float value){submittedPitch=value;}
    @Override public void setVolume(String name,float value){gain=value;}
    @Override public void play(String name){played=true;}
    @Override public void setListenerPosition(float x,float y,float z){listener=new float[]{x,y,z};}
    @Override public void setListenerOrientation(float a,float b,float c,float d,float e,float f){}
  }
  static Field field(Class<?> c,String name)throws Exception{while(c!=null){try{Field f=c.getDeclaredField(name);f.setAccessible(true);return f;}catch(NoSuchFieldException e){c=c.getSuperclass();}}throw new NoSuchFieldException(name);}
  static Object empty(Class<?> c)throws Exception{Class<?> u=Class.forName("sun.misc.Unsafe");Field f=u.getDeclaredField("theUnsafe");f.setAccessible(true);return u.getMethod("allocateInstance",Class.class).invoke(f.get(null),c);}
  static Class<?> c(String role)throws Exception{return Class.forName(p.getProperty(role).replace('/','.'));}
  static String bits(float f){return String.format("%08x",Float.floatToRawIntBits(f));}
  static String sha1(byte[] b)throws Exception{StringBuilder s=new StringBuilder();for(byte v:MessageDigest.getInstance("SHA-1").digest(b))s.append(String.format("%02x",v&255));return s.toString();}
  static byte[] bytes(URL u)throws Exception{try(InputStream in=u.openStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))>=0)out.write(b,0,n);return out.toByteArray();}}
  public static Object material(int y){return y>80?airMaterial:supportMaterial;}
  public static void queue(int i,int n){instrument=i;note=n;}
  public static void emit(String e,float v,float f,double a,double b,double c){event=e;volume=v;pitch=f;x=a;y=b;z=c;}
  static final class Loader extends ClassLoader {Class<?> define(byte[] bytes){return defineClass(null,bytes,0,bytes.length);}}
  static Class<?> concrete(String name,String parent){ClassWriter w=new ClassWriter(0);w.visit(Opcodes.V1_8,Opcodes.ACC_PUBLIC|Opcodes.ACC_SUPER,name,null,parent,null);w.visitEnd();return new Loader().define(w.toByteArray());}
  static Class<?> world(){
    String self="studio/nbsx/research/Lwjgl215MethodProbe";ClassWriter w=new ClassWriter(ClassWriter.COMPUTE_MAXS);w.visit(Opcodes.V1_8,Opcodes.ACC_PUBLIC|Opcodes.ACC_SUPER,"studio/nbsx/research/World215",null,p.getProperty("World"),null);
    MethodVisitor m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("materialMethod"),p.getProperty("materialDescriptor"),null,null);m.visitCode();m.visitVarInsn(Opcodes.ILOAD,2);m.visitMethodInsn(Opcodes.INVOKESTATIC,self,"material","(I)Ljava/lang/Object;",false);m.visitTypeInsn(Opcodes.CHECKCAST,p.getProperty("Material"));m.visitInsn(Opcodes.ARETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("queueMethod"),p.getProperty("queueDescriptor"),null,null);m.visitCode();m.visitVarInsn(Opcodes.ILOAD,5);m.visitVarInsn(Opcodes.ILOAD,6);m.visitMethodInsn(Opcodes.INVOKESTATIC,self,"queue","(II)V",false);m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("soundMethod"),p.getProperty("soundDescriptor"),null,null);m.visitCode();m.visitVarInsn(Opcodes.ALOAD,7);m.visitVarInsn(Opcodes.FLOAD,8);m.visitVarInsn(Opcodes.FLOAD,9);m.visitVarInsn(Opcodes.DLOAD,1);m.visitVarInsn(Opcodes.DLOAD,3);m.visitVarInsn(Opcodes.DLOAD,5);m.visitMethodInsn(Opcodes.INVOKESTATIC,self,"emit","(Ljava/lang/String;FFDDD)V",false);m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("particleMethod"),p.getProperty("particleDescriptor"),null,null);m.visitCode();m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();w.visitEnd();return new Loader().define(w.toByteArray());
  }
  static Object wire(Object packet)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();c("SoundPacket").getMethod("a",DataOutputStream.class).invoke(packet,new DataOutputStream(out));Object decoded=c("SoundPacket").getConstructor().newInstance();c("SoundPacket").getMethod("a",DataInputStream.class).invoke(decoded,new DataInputStream(new ByteArrayInputStream(out.toByteArray())));return decoded;}
  static Object packet(float f)throws Exception{return c("SoundPacket").getConstructor(String.class,double.class,double.class,double.class,float.class,float.class).newInstance(event==null?"note.harp":event,.5,80.5,.5,3f,f);}
  public static void main(String[]args)throws Exception{
    p=new Properties();try(InputStream in=new FileInputStream(args[0])){p.load(in);}
    Class<?> manager=c("SoundManager"),options=c("Options"),pool=c("SoundPool"),entry=c("SoundPoolEntry");Object engine=manager.getConstructor().newInstance(),setting=empty(options);Sink sink=(Sink)empty(Sink.class);field(manager,p.getProperty("managerSystem")).set(null,sink);field(manager,p.getProperty("readyField")).setBoolean(null,true);field(manager,p.getProperty("managerOptions")).set(engine,setting);
    manager.getMethod(p.getProperty("managerRegister"),String.class,File.class).invoke(engine,"note/harp.ogg",new File("unread-boundary-placeholder.ogg"));Method play=manager.getMethod(p.getProperty("managerPlay"),String.class,float.class,float.class,float.class,float.class,float.class);Object originalSource=empty(c("BaseSource"));Method setPitch=c("BaseSource").getMethod("setPitch",float.class),getPitch=c("BaseSource").getMethod("getPitch");
    for(String line:Files.readAllLines(Paths.get(args[1]))){String[] values=line.split("\t");float raw=Float.parseFloat(values[0]),master=Float.parseFloat(values[1]),inputPitch=Float.parseFloat(values[2]);field(options,p.getProperty("soundOption")).setFloat(setting,master);sink.reset();play.invoke(engine,"note.harp",.5f,80.5f,.5f,raw,inputPitch);setPitch.invoke(originalSource,inputPitch);float clamped=((Number)getPitch.invoke(originalSource)).floatValue();System.out.println("BOUNDARY\t"+bits(raw)+"\t"+bits(master)+"\t"+bits(inputPitch)+"\t"+sink.played+"\t"+bits(sink.gain)+"\t"+bits(sink.submittedPitch)+"\t"+bits(clamped)+"\t"+bits(sink.range));}
    for(String line:Files.readAllLines(Paths.get(args[2]))){float f=Float.parseFloat(line);Object sent=packet(f),received=wire(sent);float stored=((Number)c("SoundPacket").getMethod(p.getProperty("packetPitch")).invoke(sent)).floatValue(),decoded=((Number)c("SoundPacket").getMethod(p.getProperty("packetPitch")).invoke(received)).floatValue();setPitch.invoke(originalSource,decoded);System.out.println("PACKET\t"+bits(f)+"\t"+bits(stored)+"\t"+bits(decoded)+"\t"+bits(((Number)getPitch.invoke(originalSource)).floatValue()));}
    Method parser=options.getDeclaredMethod("a",String.class);parser.setAccessible(true);for(String value:new String[]{"-0","0","0.2","0.7","1","true","false","3"})System.out.println("OPTION\t"+value+"\t"+bits(((Number)parser.invoke(setting,value)).floatValue()));
    Object listener=empty(concrete("studio/nbsx/research/Listener215",p.getProperty("ListenerEntity")));String[] positions=p.getProperty("listenerFields").split(",");double[] values={100.1,101.4,80.2,82.6,-35.3,-39.1};for(int i=0;i<6;i++)field(c("ListenerEntity"),positions[i]).setDouble(listener,values[i]);field(options,p.getProperty("soundOption")).setFloat(setting,.7f);manager.getMethod("a",c("ListenerEntity"),float.class).invoke(engine,listener,.25f);System.out.println("LISTENER\t"+bits(sink.listener[0])+"\t"+bits(sink.listener[1])+"\t"+bits(sink.listener[2]));
    Object linear=empty(c("Source"));field(c("Source"),"attModel").setInt(linear,2);field(c("Source"),"distOrRoll").setFloat(linear,48f);Method calculate=c("Source").getDeclaredMethod("calculateGain");calculate.setAccessible(true);for(float distance:new float[]{0f,1f,16f,47.999f,48f,64f}){field(c("Source"),"distanceFromListener").setFloat(linear,distance);calculate.invoke(linear);System.out.println("ATTENUATION\t"+bits(distance)+"\t"+bits(field(c("Source"),"gain").getFloat(linear)));}
    Class<?> attributes=Class.forName("org.lwjgl.openal.ALCcontext");Method builder=attributes.getDeclaredMethod("createAttributeList",int.class,int.class,int.class);builder.setAccessible(true);java.nio.IntBuffer list=(java.nio.IntBuffer)builder.invoke(null,44100,60,0);String attr="";for(int i=0;i<list.position();i++){if(i>0)attr+=",";attr+=list.get(i);}System.out.println("ATTRIBUTES\t"+attr);
    Object originalWorld=empty(world()),tile=c("TileEntityNote").getConstructor().newInstance(),noteBlock=empty(c("NoteBlock"));airMaterial=field(c("Material"),"a").get(null);Method trigger=c("TileEntityNote").getMethod(p.getProperty("tileTrigger"),c("World"),int.class,int.class,int.class),receive=c("NoteBlock").getMethod(p.getProperty("noteEvent"),c("World"),int.class,int.class,int.class,int.class,int.class);int material=0;field(options,p.getProperty("soundOption")).setFloat(setting,.7f);
    for(String block:p.getProperty("supportFields").split(",")){supportMaterial=field(c("Block"),p.getProperty("materialField")).get(field(c("Block"),block).get(null));for(int n=0;n<25;n++){field(c("TileEntityNote"),p.getProperty("tileNote")).setByte(tile,(byte)n);instrument=-1;note=-1;trigger.invoke(tile,originalWorld,0,80,0);if(instrument!=material||note!=n)throw new AssertionError("material "+material+"/"+n+" produced "+instrument+"/"+note);receive.invoke(noteBlock,originalWorld,0,80,0,instrument,note);Object decoded=wire(packet(pitch));float transported=((Number)c("SoundPacket").getMethod(p.getProperty("packetPitch")).invoke(decoded)).floatValue();setPitch.invoke(originalSource,transported);sink.reset();play.invoke(engine,"note.harp",.5f,80.5f,.5f,volume,transported);System.out.println("NOTE\t"+material+"\t"+n+"\t"+event+"\t"+bits(pitch)+"\t"+bits(transported)+"\t"+bits(((Number)getPitch.invoke(originalSource)).floatValue())+"\t"+bits(volume)+"\t"+bits(sink.gain)+"\t"+x+"\t"+y+"\t"+z);}material++;}
    // Separately prove the original tile's non-air gate.
    airMaterial=supportMaterial;instrument=-1;trigger.invoke(tile,originalWorld,0,80,0);System.out.println("BLOCKED\t"+instrument);
    // Actual inherited World dispatch + actual client listener; this is the
    // block-event branch, not the named packet playback overload.
    Object rawWorld=empty(concrete("studio/nbsx/research/RawWorld215",p.getProperty("World"))),rawListener=empty(c("ClientWorldListener"));field(c("World"),"u").set(rawWorld,Arrays.asList(rawListener));sink.reset();c("World").getMethod(p.getProperty("soundMethod"),double.class,double.class,double.class,String.class,float.class,float.class).invoke(rawWorld,.5,80.5,.5,"note.harp",3f,1.0594631f);System.out.println("RAW_CLIENT_PATH\t"+sink.played);
    Object game=empty(concrete("studio/nbsx/research/Minecraft215",p.getProperty("Minecraft")));field(c("Minecraft"),p.getProperty("minecraftManager")).set(game,engine);Object resourceEngine=manager.getConstructor().newInstance();field(c("Minecraft"),p.getProperty("minecraftManager")).set(game,resourceEngine);Object walker=c("ResourceDownloader").getConstructor(File.class,c("Minecraft")).newInstance(new File(args[3]),game);c("ResourceDownloader").getMethod("a").invoke(walker);Object sounds=field(manager,p.getProperty("managerPool")).get(resourceEngine);System.out.println("TREE\t"+field(pool,p.getProperty("poolCount")).getInt(sounds));
    for(String name:new String[]{"harp","bassattack","bd","snare","hat","pling"}){Object selected=pool.getMethod("a",String.class).invoke(sounds,"note."+name);if(selected==null)throw new AssertionError("missing resource "+name);URL url=(URL)field(entry,p.getProperty("entryUrl")).get(selected);byte[] bytes=bytes(url);System.out.println("RESOURCE\t"+name+"\t"+field(entry,p.getProperty("entryName")).get(selected)+"\t"+url+"\t"+sha1(bytes)+"\t"+bytes.length);
      Class<?> codec=c("CodecJOrbis");Object decoder=codec.getConstructor().newInstance();if(!((Boolean)codec.getMethod("initialize",URL.class).invoke(decoder,url)))throw new AssertionError("Original decoder init failed: "+name);Object buffer=codec.getMethod("readAll").invoke(decoder);if(buffer==null)throw new AssertionError("Original decoder returned null: "+name);byte[] pcm=(byte[])field(buffer.getClass(),"audioData").get(buffer);Files.write(Paths.get(args[4],"decoded-"+name+".pcm"),pcm);javax.sound.sampled.AudioFormat format=(javax.sound.sampled.AudioFormat)field(buffer.getClass(),"audioFormat").get(buffer);System.out.println("DECODE\t"+name+"\t"+pcm.length+"\t"+sha1(pcm)+"\t"+format.getChannels()+"\t"+format.getSampleRate()+"\t"+format.getSampleSizeInBits()+"\t"+format.isBigEndian());codec.getMethod("cleanup").invoke(decoder);
    }
    for(String prefix:new String[]{"sound3","SOUND3","sound","newsound","streaming","music","newmusic","unknown"}){Object fresh=manager.getConstructor().newInstance();field(c("Minecraft"),p.getProperty("minecraftManager")).set(game,fresh);c("Minecraft").getMethod("a",String.class,File.class).invoke(game,prefix+"/note/harp.ogg",new File(args[3],"resources/sound3/note/harp.ogg"));String counts="";for(String member:new String[]{"b","c","d"}){if(!counts.isEmpty())counts+=",";counts+=field(pool,p.getProperty("poolCount")).getInt(field(manager,member).get(fresh));}System.out.println("DISPATCH\t"+prefix+"\t"+counts);}
    System.out.println("POOL\t"+Class.forName("paulscode.sound.SoundSystemConfig").getMethod("getNumberNormalChannels").invoke(null)+"\t"+Class.forName("paulscode.sound.SoundSystemConfig").getMethod("getNumberStreamingChannels").invoke(null));
  }
}
