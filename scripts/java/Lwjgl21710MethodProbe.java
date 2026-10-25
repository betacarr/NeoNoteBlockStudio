package studio.nbsx.research;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.objectweb.asm.*;

/** Calls original 1.7.10 methods; the isolated World receiver only captures sound output. */
public final class Lwjgl21710MethodProbe {
    public static float emittedPitch;
    public static float emittedVolume;
    public static void sound(double x,double y,double z,String name,float volume,float pitch){emittedVolume=volume;emittedPitch=pitch;}
    private static Object empty(Class<?> type)throws Exception{Class<?> u=Class.forName("sun.misc.Unsafe");Field f=u.getDeclaredField("theUnsafe");f.setAccessible(true);return u.getMethod("allocateInstance",Class.class).invoke(f.get(null),type);}
    private static void set(Object target,String name,Object value)throws Exception{Field f=target.getClass().getDeclaredField(name);f.setAccessible(true);f.set(target,value);}
    private static Method method(Class<?> c,String name,Class<?>...types)throws Exception{Method m=c.getDeclaredMethod(name,types);m.setAccessible(true);return m;}
    private static void little(DataOutputStream out,int value)throws IOException{out.writeInt(Integer.reverseBytes(value));}
    private static void fl(DataOutputStream out,float value)throws IOException{little(out,Float.floatToRawIntBits(value));}
    private static final class Loader extends ClassLoader{Loader(){super(Lwjgl21710MethodProbe.class.getClassLoader());}Class<?> define(byte[] code){return defineClass(null,code,0,code.length);}}
    private static Class<?> world()throws Exception{
        ClassWriter cw=new ClassWriter(ClassWriter.COMPUTE_MAXS);String generated="studio/nbsx/research/IsolatedWorld1710";
        cw.visit(Opcodes.V1_8,Opcodes.ACC_PUBLIC|Opcodes.ACC_SUPER,generated,null,"ahb",null);
        MethodVisitor m=cw.visitMethod(Opcodes.ACC_PUBLIC,"a","(DDDLjava/lang/String;FF)V",null,null);m.visitCode();m.visitVarInsn(Opcodes.DLOAD,1);m.visitVarInsn(Opcodes.DLOAD,3);m.visitVarInsn(Opcodes.DLOAD,5);m.visitVarInsn(Opcodes.ALOAD,7);m.visitVarInsn(Opcodes.FLOAD,8);m.visitVarInsn(Opcodes.FLOAD,9);m.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/Lwjgl21710MethodProbe","sound","(DDDLjava/lang/String;FF)V",false);m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();
        m=cw.visitMethod(Opcodes.ACC_PUBLIC,"a","(Ljava/lang/String;DDDDDD)V",null,null);m.visitCode();m.visitInsn(Opcodes.RETURN);m.visitMaxs(0,0);m.visitEnd();cw.visitEnd();return new Loader().define(cw.toByteArray());
    }
    public static void main(String[]args)throws Exception{
        Class<?> engineClass=Class.forName("btj"),optionsClass=Class.forName("bbj"),instanceClass=Class.forName("bst"),definitionClass=Class.forName("bti"),categoryClass=Class.forName("w"),locationClass=Class.forName("bqx");
        Object engine=empty(engineClass),options=empty(optionsClass),category=categoryClass.getField("c").get(null);Map<Object,Float> volume=new HashMap<Object,Float>();set(options,"aW",volume);set(engine,"d",options);
        final float[] input={1,1};Object instance=Proxy.newProxyInstance(instanceClass.getClassLoader(),new Class<?>[]{instanceClass},(p,m,a)->{if(m.getName().equals("e")&&m.getReturnType()==float.class)return input[0];if(m.getName().equals("f")&&m.getReturnType()==float.class)return input[1];if(m.getReturnType()==float.class)return 0f;if(m.getReturnType()==boolean.class)return false;if(m.getReturnType()==int.class)return 0;return null;});
        Constructor<?> definition=definitionClass.getConstructor(locationClass,double.class,double.class,boolean.class);Object location=locationClass.getConstructor(String.class).newInstance("minecraft:note.harp");Method gain=method(engineClass,"a",instanceClass,definitionClass,categoryClass),pitch=method(engineClass,"a",instanceClass,definitionClass);
        List<String> cases=Files.readAllLines(Paths.get(args[0]));try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[1]))){out.writeBytes("NB17");little(out,cases.size());for(String line:cases){String[] row=line.split("\t");input[0]=Float.parseFloat(row[0]);input[1]=Float.parseFloat(row[1]);volume.put(category,Float.parseFloat(row[2]));Object sample=definition.newInstance(location,Double.parseDouble(row[4]),Double.parseDouble(row[3]),false);fl(out,((Number)gain.invoke(engine,instance,sample,category)).floatValue());fl(out,((Number)pitch.invoke(engine,instance,sample)).floatValue());}}
        Object world=empty(world()),note=empty(Class.forName("amj")),sample=definition.newInstance(location,1d,1d,false);Method event=Class.forName("amj").getMethod("a",Class.forName("ahb"),int.class,int.class,int.class,int.class,int.class);Constructor<?> packet=Class.forName("hc").getConstructor(String.class,double.class,double.class,double.class,float.class,float.class);Method packetPitch=Class.forName("hc").getMethod("h");
        try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[2]))){out.writeBytes("NBN7");little(out,25);for(int n=0;n<=24;n++){event.invoke(note,world,0,80,0,0,n);Object transported=packet.newInstance("note.harp",.5,80.5,.5,emittedVolume,emittedPitch);input[1]=((Number)packetPitch.invoke(transported)).floatValue();fl(out,emittedPitch);fl(out,input[1]);fl(out,((Number)pitch.invoke(engine,instance,sample)).floatValue());fl(out,emittedVolume);}}
        List<String> packetCases=Files.readAllLines(Paths.get(args[3]));try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[4]))){out.writeBytes("NBP7");little(out,packetCases.size());for(String text:packetCases){float raw=Float.parseFloat(text);Object transported=packet.newInstance("note.harp",.5,80.5,.5,3f,raw);input[1]=((Number)packetPitch.invoke(transported)).floatValue();fl(out,input[1]);fl(out,((Number)pitch.invoke(engine,instance,sample)).floatValue());}}
        System.out.println("POOL\t"+Class.forName("paulscode.sound.SoundSystemConfig").getMethod("getNumberNormalChannels").invoke(null)+"\t"+Class.forName("paulscode.sound.SoundSystemConfig").getMethod("getNumberStreamingChannels").invoke(null));
    }
}
