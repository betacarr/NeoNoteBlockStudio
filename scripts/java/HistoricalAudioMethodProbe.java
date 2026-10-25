package studio.nbsx.research;
import java.io.*;
import java.lang.reflect.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.Executor;
import javax.sound.sampled.AudioFormat;

/** Calls unmodified original methods. Synthetic state is explicit; no game/world coverage is claimed. */
public final class HistoricalAudioMethodProbe {
    private static Field field(Class<?> type,String name)throws Exception{for(Class<?> c=type;c!=null;c=c.getSuperclass())try{Field f=c.getDeclaredField(name);f.setAccessible(true);return f;}catch(NoSuchFieldException missing){}throw new NoSuchFieldException(name);}
    private static Object empty(Class<?> type)throws Exception{Class<?> u=Class.forName("sun.misc.Unsafe");Field f=u.getDeclaredField("theUnsafe");f.setAccessible(true);return u.getMethod("allocateInstance",Class.class).invoke(f.get(null),type);}
    private static void set(Object target,String name,Object value)throws Exception{field(target.getClass(),name).set(target,value);}
    private static Method method(Class<?> type,String name,Class<?>...args)throws Exception{Method m=type.getDeclaredMethod(name,args);m.setAccessible(true);return m;}
    private static void little(DataOutputStream out,int value)throws IOException{out.writeInt(Integer.reverseBytes(value));}
    private static Object sound(Class<?> type,Object category,final float[] state){return Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},(proxy,m,args)->{
        if(m.getName().equals("hashCode"))return System.identityHashCode(proxy);
        if(m.getName().equals("equals"))return proxy==args[0];
        if(m.getName().equals("toString"))return "isolated-original-method-input";
        if(m.getName().equals("c")&&m.getParameterCount()==0)return category;
        if(m.getName().equals("f")&&m.getReturnType()==float.class)return state[0];
        if(m.getName().equals("g")&&m.getReturnType()==float.class)return state[1];
        if(m.getReturnType()==boolean.class)return false;if(m.getReturnType()==int.class)return 0;if(m.getReturnType()==float.class)return 0f;if(m.getReturnType()==double.class)return 0d;return null;
    });}
    public static void main(String[]args)throws Exception{
        if(args[0].equals("legacy-codec")){
            Class<?> codecType=Class.forName("paulscode.sound.codecs.CodecJOrbis");
            try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[1]))){out.writeBytes("NBSJ");little(out,args.length-2);
                for(int i=2;i<args.length;i++){Object codec=codecType.getConstructor().newInstance();try{
                    codecType.getMethod("reverseByteOrder",boolean.class).invoke(codec,true);
                    if(!Boolean.TRUE.equals(codecType.getMethod("initialize",java.net.URL.class).invoke(codec,new File(args[i]).toURI().toURL())))throw new IOException("Original codec failed");
                    AudioFormat format=(AudioFormat)codecType.getMethod("getAudioFormat").invoke(codec);Object buffer=codecType.getMethod("readAll").invoke(codec);byte[] pcm=(byte[])buffer.getClass().getField("audioData").get(buffer);
                    if(format.isBigEndian())for(int at=0;at+1<pcm.length;at+=2){byte b=pcm[at];pcm[at]=pcm[at+1];pcm[at+1]=b;}
                    little(out,(int)format.getSampleRate());little(out,format.getChannels());little(out,pcm.length);out.write(pcm);
                }finally{codecType.getMethod("cleanup").invoke(codec);}}
            }return;
        }
        Class<?> engineType=Class.forName(args[1]),optionType=Class.forName(args[2]),instanceType=Class.forName(args[3]),categoryType=Class.forName(args[4]);
        Object category=field(categoryType,"c").get(null),options=empty(optionType);Map<Object,Float> volumes=new HashMap<Object,Float>();set(options,args[5],volumes);
        if(args[0].equals("math")){
            Object engine=empty(engineType);set(engine,"e",options);float[] state={1,1};Object instance=sound(instanceType,category,state);
            Method gain=method(engineType,"e",instanceType),pitch=method(engineType,"d",instanceType);
            List<String> cases=Files.readAllLines(Paths.get(args[6]));
            try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[7]))){out.writeBytes("NBSM");little(out,cases.size());for(String line:cases){String[] values=line.split("\t");state[0]=Float.parseFloat(values[0]);state[1]=Float.parseFloat(values[1]);volumes.put(category,Float.parseFloat(values[2]));little(out,Float.floatToRawIntBits(((Number)gain.invoke(engine,instance)).floatValue()));little(out,Float.floatToRawIntBits(((Number)pitch.invoke(engine,instance)).floatValue()));}}
            return;
        }
        if(!args[0].equals("lifecycle"))throw new IllegalArgumentException("Unknown probe mode");
        Class<?> accessType=Class.forName(args[6]),handleType=Class.forName(args[6]+"$a"),multimapType=Class.forName("com.google.common.collect.Multimap");
        Method put=multimapType.getMethod("put",Object.class,Object.class),size=multimapType.getMethod("size");
        for(boolean stopped:new boolean[]{false,true}){
            Object engine=empty(engineType);set(engine,"e",options);set(engine,"f",true);set(engine,"l",100);
            Object access=empty(accessType);final int[] queued={0};set(access,"c",(Executor)task->queued[0]++);
            Object handle=handleType.getConstructor(accessType).newInstance(access);set(handle,"c",stopped);
            Object instance=sound(instanceType,category,new float[]{1,1});Map<Object,Object> active=new HashMap<Object,Object>();active.put(instance,handle);Map<Object,Integer> expiry=new HashMap<Object,Integer>();expiry.put(instance,0);
            Object categories=Class.forName("com.google.common.collect.HashMultimap").getMethod("create").invoke(null);put.invoke(categories,category,instance);
            set(engine,"m",active);set(engine,"q",expiry);set(engine,"n",categories);set(engine,"o",new ArrayList<Object>());set(engine,"p",new HashMap<Object,Integer>());
            if(stopped)method(engineType,"h").invoke(engine);else method(engineType,"a",instanceType).invoke(engine,instance);
            System.out.println((stopped?"FINISHED":"STOP")+"\t"+active.size()+"\t"+expiry.size()+"\t"+size.invoke(categories)+"\t"+queued[0]);
        }
    }
}
