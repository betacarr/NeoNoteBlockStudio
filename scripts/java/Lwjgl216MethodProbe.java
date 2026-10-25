package studio.nbsx.research;

import java.io.*;
import java.lang.reflect.*;
import java.net.URL;
import java.nio.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import org.objectweb.asm.*;
import paulscode.sound.*;

/** Original 1.6 code executes. The only audio replacement is an explicit command-boundary recorder; no device opens. */
public final class Lwjgl216MethodProbe {
  private static Properties p;
  public static Object air, support, above;
  public static int queuedInstrument,queuedNote;
  public static String emittedName;
  public static float emittedVolume,emittedPitch;
  public static double[] emittedPosition;
  private static Class<?> c(String role)throws Exception{return Class.forName(p.getProperty(role).replace('/','.'));}
  private static Object empty(Class<?> type)throws Exception{Class<?> u=Class.forName("sun.misc.Unsafe");Field f=u.getDeclaredField("theUnsafe");f.setAccessible(true);return u.getMethod("allocateInstance",Class.class).invoke(f.get(null),type);}
  private static Field field(Class<?> type,String name)throws Exception{for(Class<?> t=type;t!=null;t=t.getSuperclass())try{Field f=t.getDeclaredField(name);f.setAccessible(true);return f;}catch(NoSuchFieldException ignored){}throw new NoSuchFieldException(type+"."+name);}
  private static void set(Object o,String n,Object v)throws Exception{field(o.getClass(),n).set(o,v);}
  private static Method method(Class<?> t,String n,Class<?>...args)throws Exception{Method m=t.getDeclaredMethod(n,args);m.setAccessible(true);return m;}
  private static void le(DataOutputStream o,int v)throws Exception{o.writeInt(Integer.reverseBytes(v));}
  private static void fl(DataOutputStream o,float v)throws Exception{le(o,Float.floatToRawIntBits(v));}
  private static float f(String v){return v.startsWith("bits:")?Float.intBitsToFloat((int)Long.parseLong(v.substring(5),16)):Float.parseFloat(v);}
  public static class Recorder extends SoundSystem {
    public boolean played,priority; public int model; public float volume,pitch,range; public String name,url; public float[] position,orientation;
    private Recorder(){super();} // Never invoked: allocated without a SoundSystem constructor or command thread.
    public void newSource(boolean pri,String id,URL u,String file,boolean loop,float x,float y,float z,int att,float distance){priority=pri;name=file;url=u.toString();range=distance;model=att;}
    public void setPitch(String id,float value){pitch=value;}
    public void setVolume(String id,float value){volume=value;}
    public void play(String id){played=true;}
    public void setListenerPosition(float x,float y,float z){position=new float[]{x,y,z};}
    public void setListenerOrientation(float a,float b,float c,float d,float e,float f){orientation=new float[]{a,b,c,d,e,f};}
    public void reset(){played=false;priority=false;volume=pitch=range=Float.intBitsToFloat(0x7fc00000);model=-1;}
  }
  private static Object wire(Object sent)throws Exception{ByteArrayOutputStream b=new ByteArrayOutputStream();DataOutputStream o=new DataOutputStream(b);c("SoundPacket").getMethod("a",DataOutput.class).invoke(sent,o);o.flush();Object received=c("SoundPacket").getConstructor().newInstance();c("SoundPacket").getMethod("a",DataInput.class).invoke(received,new DataInputStream(new ByteArrayInputStream(b.toByteArray())));return received;}
  private static Object packet(float volume,float pitch)throws Exception{return c("SoundPacket").getConstructor(String.class,double.class,double.class,double.class,float.class,float.class).newInstance("note.harp",.5,80.5,.5,volume,pitch);}
  public static Object material(int x,int y,int z){return y>80?above:support;}
  public static void queued(int x,int y,int z,int block,int instrument,int note){queuedInstrument=instrument;queuedNote=note;}
  public static void sound(double x,double y,double z,String name,float volume,float pitch){emittedName=name;emittedPosition=new double[]{x,y,z};emittedVolume=volume;emittedPitch=pitch;}
  private static class Loader extends ClassLoader{Class<?> define(byte[] b){return defineClass(null,b,0,b.length);}}
  private static Class<?> world(){String self="studio/nbsx/research/Lwjgl216MethodProbe";ClassWriter w=new ClassWriter(ClassWriter.COMPUTE_MAXS);w.visit(Opcodes.V1_8,Opcodes.ACC_PUBLIC|Opcodes.ACC_SUPER,"studio/nbsx/research/IsolatedWorld216",null,p.getProperty("World"),null);MethodVisitor m;
    m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("materialMethod"),"(III)L"+p.getProperty("Material")+";",null,null);m.visitCode();for(int i=1;i<=3;i++)m.visitVarInsn(Opcodes.ILOAD,i);m.visitMethodInsn(Opcodes.INVOKESTATIC,self,"material","(III)Ljava/lang/Object;",false);m.visitTypeInsn(Opcodes.CHECKCAST,p.getProperty("Material"));m.visitInsn(Opcodes.ARETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("queueMethod"),"(IIIIII)V",null,null);m.visitCode();for(int i=1;i<=6;i++)m.visitVarInsn(Opcodes.ILOAD,i);m.visitMethodInsn(Opcodes.INVOKESTATIC,self,"queued","(IIIIII)V",false);m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("soundMethod"),"(DDDLjava/lang/String;FF)V",null,null);m.visitCode();for(int i:new int[]{1,3,5})m.visitVarInsn(Opcodes.DLOAD,i);m.visitVarInsn(Opcodes.ALOAD,7);m.visitVarInsn(Opcodes.FLOAD,8);m.visitVarInsn(Opcodes.FLOAD,9);m.visitMethodInsn(Opcodes.INVOKESTATIC,self,"sound","(DDDLjava/lang/String;FF)V",false);m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();
    m=w.visitMethod(Opcodes.ACC_PUBLIC,p.getProperty("particleMethod"),"(Ljava/lang/String;DDDDDD)V",null,null);m.visitCode();m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();w.visitEnd();return new Loader().define(w.toByteArray());
  }
  private static String hash(byte[] bytes)throws Exception{StringBuilder b=new StringBuilder();for(byte v:MessageDigest.getInstance("SHA-1").digest(bytes))b.append(String.format("%02x",v&255));return b.toString();}
  private static byte[] bytes(InputStream in)throws Exception{try(InputStream s=in;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=s.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}}
  public static void main(String[] args)throws Exception{
    p=new Properties();try(InputStream in=new FileInputStream(args[0])){p.load(in);}String out=args[1];
    // ResourcePathHelper captures Minecraft.getMinecraft().getLogAgent() at class initialization.
    // Supply only the original singleton identity; no constructor, window, game or device is started.
    Object minecraft=empty(c("Minecraft"));field(c("Minecraft"),p.getProperty("minecraftSingleton")).set(null,minecraft);
    // Real DefaultResourcePack(File), real reloadable ResourceManager, real pool and original custom URL handler/connection.
    Object pack=c("DefaultResourcePack").getConstructor(File.class).newInstance(new File(args[2])),serializer=c("MetadataSerializer").getConstructor().newInstance(),resources=c("ReloadableResourceManager").getConstructor(c("MetadataSerializer")).newInstance(serializer);c("ReloadableResourceManager").getMethod("a",c("ResourcePack")).invoke(resources,pack);
    Object pool=c("SoundPool").getConstructor(c("ResourceManager"),String.class,boolean.class).newInstance(resources,"sound",true);Method add=c("SoundPool").getMethod(p.getProperty("poolAdd"),String.class),select=c("SoundPool").getMethod(p.getProperty("poolSelect"),String.class);String[] sampleNames={"harp","bd","snare","hat","bassattack","pling","bass"};
    for(String sample:sampleNames){add.invoke(pool,"note/"+sample+".ogg");Object entry=select.invoke(pool,"note."+sample);URL u=(URL)c("SoundEntry").getMethod("b").invoke(entry);byte[] data=bytes(u.openStream());System.out.println("RESOURCE\t"+sample+"\t"+u+"\t"+data.length+"\t"+hash(data));}
    add.invoke(pool,"note/harp1.ogg");Map<?,?> groups=(Map<?,?>)field(c("SoundPool"),p.getProperty("poolMap")).get(pool);System.out.println("GROUP\tnote.harp\t"+((List<?>)groups.get("note.harp")).size());
    Recorder recorder=(Recorder)empty(Recorder.class);Object manager=empty(c("SoundManager")),options=empty(c("Options"));set(manager,p.getProperty("ready"),true);set(manager,p.getProperty("options"),options);set(manager,p.getProperty("soundSystem"),recorder);set(manager,p.getProperty("poolField"),pool);
    Method play=c("SoundManager").getMethod(p.getProperty("play"),String.class,float.class,float.class,float.class,float.class,float.class);Library lib=(Library)empty(Library.class);Source source=(Source)empty(Source.class);HashMap<String,Source> map=new HashMap<String,Source>();map.put("probe",source);set(lib,"sourceMap",map);
    List<String> rows=Files.readAllLines(Paths.get(args[3]));try(DataOutputStream o=new DataOutputStream(new FileOutputStream(out+"/math.bin"))){o.writeBytes("N16M");le(o,rows.size());for(String row:rows){String[] v=row.split("\t");float raw=f(v[0]),pitch=f(v[1]),setting=f(v[2]);set(options,p.getProperty("soundSetting"),setting);recorder.reset();play.invoke(manager,"note.harp",.5f,80.5f,.5f,raw,pitch);le(o,recorder.played?1:0);fl(o,recorder.volume);fl(o,recorder.pitch);fl(o,recorder.range);if(recorder.played){lib.setVolume("probe",recorder.volume);lib.setPitch("probe",recorder.pitch);fl(o,source.sourceVolume);fl(o,source.getPitch());}else{fl(o,Float.NaN);fl(o,Float.NaN);}le(o,recorder.priority?1:0);le(o,recorder.model);}}
    rows=Files.readAllLines(Paths.get(args[4]));try(DataOutputStream o=new DataOutputStream(new FileOutputStream(out+"/packet.bin"))){o.writeBytes("N16P");le(o,rows.size());for(String row:rows){float pitch=f(row);Object sent=packet(3f,pitch),received=wire(sent);float stored=((Number)c("SoundPacket").getMethod(p.getProperty("packetPitch")).invoke(sent)).floatValue(),decoded=((Number)c("SoundPacket").getMethod(p.getProperty("packetPitch")).invoke(received)).floatValue();source.setPitch(decoded);fl(o,pitch);fl(o,stored);fl(o,decoded);fl(o,source.getPitch());}}
    Object living=empty(c("ServerPlayer")),clientWorld=empty(c("ClientWorld")),handler=empty(c("ClientPacketHandler"));set(minecraft,p.getProperty("clientManagerField"),manager);set(minecraft,p.getProperty("clientWorldField"),clientWorld);set(minecraft,p.getProperty("clientViewField"),living);set(clientWorld,p.getProperty("worldMinecraftField"),minecraft);set(handler,p.getProperty("handlerMinecraftField"),minecraft);String[] xyz=p.getProperty("listenerPositionFields").split(",");set(living,xyz[1],.5);set(living,xyz[3],80.5);set(living,xyz[5],.5);
    Object isolated=empty(world()),tile=c("TileEntityNote").getConstructor().newInstance(),note=empty(c("NoteBlock"));air=field(c("Material"),p.getProperty("airMaterial")).get(null);above=air;Method trigger=c("TileEntityNote").getMethod(p.getProperty("tileTrigger"),c("World"),int.class,int.class,int.class),event=c("NoteBlock").getMethod(p.getProperty("noteEvent"),c("World"),int.class,int.class,int.class,int.class,int.class);int material=0;
    try(DataOutputStream o=new DataOutputStream(new FileOutputStream(out+"/notes.bin"))){o.writeBytes("N16N");le(o,125);for(String block:p.getProperty("supportFields").split(",")){support=field(c("Block"),p.getProperty("blockMaterial")).get(field(c("Block"),block).get(null));for(int n=0;n<25;n++){set(tile,p.getProperty("tileNote"),(byte)n);queuedInstrument=queuedNote=-1;trigger.invoke(tile,isolated,0,80,0);if(queuedInstrument!=material||queuedNote!=n)throw new AssertionError("material queue "+material+"/"+n+" actual "+queuedInstrument+"/"+queuedNote);event.invoke(note,isolated,0,80,0,queuedInstrument,queuedNote);Object received=wire(c("SoundPacket").getConstructor(String.class,double.class,double.class,double.class,float.class,float.class).newInstance(emittedName,emittedPosition[0],emittedPosition[1],emittedPosition[2],emittedVolume,emittedPitch));float pitch=((Number)c("SoundPacket").getMethod(p.getProperty("packetPitch")).invoke(received)).floatValue();set(options,p.getProperty("soundSetting"),.5f);recorder.reset();c("ClientPacketHandler").getMethod(p.getProperty("packetReceiver"),c("SoundPacket")).invoke(handler,received);if(!recorder.played)throw new AssertionError("No original client handler sound at "+emittedName);lib.setVolume("probe",recorder.volume);lib.setPitch("probe",recorder.pitch);fl(o,emittedPitch);fl(o,pitch);fl(o,source.getPitch());fl(o,emittedVolume);fl(o,recorder.volume);fl(o,source.sourceVolume);System.out.println("NOTE\t"+material+"\t"+n+"\t"+emittedName);}material++;}}
    above=support;queuedInstrument=-1;trigger.invoke(tile,isolated,0,80,0);if(queuedInstrument!=-1)throw new AssertionError("Blocked note queued");System.out.println("BLOCKED\t"+queuedInstrument);
    recorder.reset();c("ClientWorldListener").getMethod("a",String.class,double.class,double.class,double.class,float.class,float.class).invoke(empty(c("ClientWorldListener")),"note.harp",.5,80.5,.5,3f,1f);if(recorder.played)throw new AssertionError("Client block listener played unexpectedly");System.out.println("CLIENT_BLOCK_LISTENER_SILENT\ttrue");String[] angles=p.getProperty("listenerAngleFields").split(",");double[] position={10.123456789,14.987654321,81.123456789,83.987654321,-7.123456789,-1.987654321};float[] angle={17.25f,83.75f,-20.5f,31.5f};for(int i=0;i<6;i++)set(living,xyz[i],position[i]);for(int i=0;i<4;i++)set(living,angles[i],angle[i]);set(options,p.getProperty("soundSetting"),1f);
    try(DataOutputStream o=new DataOutputStream(new FileOutputStream(out+"/listener.bin"))){o.writeBytes("N16L");le(o,5);for(float partial:new float[]{0,.25f,.5f,.75f,1}){c("SoundManager").getMethod(p.getProperty("listener"),c("LivingEntity"),float.class).invoke(manager,living,partial);fl(o,partial);for(float v:recorder.position)fl(o,v);for(float v:recorder.orientation)fl(o,v);}}
    Object openal=empty(c("OpenALSource"));set(openal,"attModel",2);set(openal,"distOrRoll",48f);Method distance=method(c("OpenALSource"),"calculateDistance"),gain=method(c("OpenALSource"),"calculateGain");float[] distances={0,1,12,24,36,47.999996f,48,48.000004f,64};try(DataOutputStream o=new DataOutputStream(new FileOutputStream(out+"/attenuation.bin"))){o.writeBytes("N16A");le(o,distances.length);for(float d:distances){set(openal,"position",new Vector3D(.5f,80.5f,.5f+d));set(openal,"listenerPosition",FloatBuffer.wrap(new float[]{.5f,80.5f,.5f}));distance.invoke(openal);gain.invoke(openal);fl(o,d);fl(o,field(c("OpenALSource"),"distanceFromListener").getFloat(openal));fl(o,field(c("OpenALSource"),"gain").getFloat(openal));}}
    System.out.println("POOL\t"+SoundSystemConfig.getNumberNormalChannels()+"\t"+SoundSystemConfig.getNumberStreamingChannels());System.out.println("LIBRARY_MASTER\t"+Integer.toHexString(Float.floatToRawIntBits(SoundSystemConfig.getMasterGain())));System.out.println("NO_NATIVE_CONTEXT\ttrue");
  }
}
