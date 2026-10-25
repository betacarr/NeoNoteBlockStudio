package studio.nbsx.research;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;

/** Executes original Camera/Entity/Listener math with explicit synthetic entity state.
 * AL10 is a recording sink and GlStateManager.rotatef is a no-op; no audio or UI is tested. */
public final class CameraBoundaryNumericProbe {
 private static Properties config,result=new Properties();
 private static String c(String key){return config.getProperty(key);}
 private static Class<?> type(String key)throws Exception{return Class.forName(c(key));}
 private static Field field(Class<?> type,String name)throws Exception{for(Class<?> k=type;k!=null;k=k.getSuperclass())try{Field f=k.getDeclaredField(name);f.setAccessible(true);return f;}catch(NoSuchFieldException ignored){}throw new NoSuchFieldException(name);}
 private static void set(Object object,String key,Object value)throws Exception{field(object.getClass(),c(key)).set(object,value);}
 private static Method method(Class<?> owner,String name,Class<?>...parameters)throws Exception{Method m=owner.getDeclaredMethod(name,parameters);m.setAccessible(true);return m;}
 private static Object call(Object object,String key,Class<?>[]parameters,Object...arguments)throws Exception{return method(object.getClass(),c(key),parameters).invoke(object,arguments);}
 private static Object empty(Class<?> type)throws Exception{Class<?> u=Class.forName("sun.misc.Unsafe");Field f=u.getDeclaredField("theUnsafe");f.setAccessible(true);return u.getMethod("allocateInstance",Class.class).invoke(f.get(null),type);}
 private static Class<?> fixture(Class<?> entity)throws Exception{
  ByteArrayOutputStream bytes=new ByteArrayOutputStream();DataOutputStream out=new DataOutputStream(bytes);out.writeInt(0xcafebabe);out.writeShort(0);out.writeShort(52);out.writeShort(5);out.writeByte(1);out.writeUTF("CameraBoundaryEntityFixture");out.writeByte(7);out.writeShort(1);out.writeByte(1);out.writeUTF(entity.getName().replace('.','/'));out.writeByte(7);out.writeShort(3);out.writeShort(0x21);out.writeShort(2);out.writeShort(4);for(int n=0;n<4;n++)out.writeShort(0);final byte[]code=bytes.toByteArray();return new ClassLoader(entity.getClassLoader()){Class<?> define(){return defineClass("CameraBoundaryEntityFixture",code,0,code.length);}}.define();
 }
 private static void scalar(String prefix,Number value){result.setProperty(prefix,value.toString());if(value instanceof Float)result.setProperty(prefix+".floatBits",Integer.toUnsignedString(Float.floatToRawIntBits(value.floatValue())));if(value instanceof Double)result.setProperty(prefix+".doubleBits",Long.toUnsignedString(Double.doubleToRawLongBits(value.doubleValue())));}
 public static void main(String[]args)throws Exception{
  config=new Properties();try(Reader in=Files.newBufferedReader(Paths.get(args[0]))){config.load(in);}
  for(String role:new String[]{"camera","entity","listener","vec3","mth"}){Class<?> original=type(role);try(InputStream in=original.getResourceAsStream('/'+original.getName().replace('.','/')+".class")){MessageDigest sha=MessageDigest.getInstance("SHA-256");byte[]buffer=new byte[8192];for(int n;(n=in.read(buffer))>0;)sha.update(buffer,0,n);StringBuilder hex=new StringBuilder();for(byte b:sha.digest())hex.append(String.format("%02x",b&255));if(!hex.toString().equals(c(role+"Sha256")))throw new IllegalStateException("Original class identity mismatch "+role);result.setProperty(role+".loadedClassSha256",hex.toString());}}
  Class<?> camera=type("camera"),entity=type("entity"),vec=type("vec3"),listener=type("listener"),fixture=fixture(entity);Class<?> sink=Class.forName("org.lwjgl.openal.AL10");
  int number=0;for(float yaw:new float[]{0f,37f,180f})for(float partial:new float[]{0f,.25f,.5f,1f}){
   String prefix="case."+(number++);Object input=empty(fixture),view=camera.getDeclaredConstructor().newInstance();
   set(input,"entityEye",1.62f);set(input,"entityYaw",yaw);set(input,"entityYawOld",yaw);set(input,"entityPitch",0f);set(input,"entityPitchOld",0f);
   double[] old={.5,80.0,2.5},current={3.5,80.125,2.5};for(int i=0;i<3;i++)set(input,"entityOld."+i,old[i]);
   if(c("entityPosition")!=null)set(input,"entityPosition",vec.getConstructor(double.class,double.class,double.class).newInstance(current[0],current[1],current[2]));else for(int i=0;i<3;i++)set(input,"entityCurrent."+i,current[i]);
   set(view,"cameraEntity",input);for(int tick=0;tick<128;tick++){call(view,"cameraTick",new Class<?>[0]);if(tick<4||tick==9||tick==31||tick==127){scalar(prefix+".tick."+tick+".old",(Float)field(camera,c("cameraEyeOld")).get(view));scalar(prefix+".tick."+tick+".current",(Float)field(camera,c("cameraEye")).get(view));}}
   method(camera,c("cameraSetup"),type("blockGetter"),entity,boolean.class,boolean.class,float.class).invoke(view,null,input,false,false,partial);
   Object position=call(view,"cameraPosition",new Class<?>[0]),output=listener.getDeclaredConstructor().newInstance();method(listener,c("listenerPosition"),vec).invoke(output,position);
   Object forward=call(view,"cameraForward",new Class<?>[0]),up=call(view,"cameraUp",new Class<?>[0]);method(listener,c("listenerOrientation"),forward.getClass(),up.getClass()).invoke(output,forward,up);
   scalar(prefix+".yaw",yaw);scalar(prefix+".partial",partial);for(int i=0;i<3;i++){scalar(prefix+".position."+i,(Double)field(vec,c("vec."+i)).get(position));scalar(prefix+".listener."+i,((float[])sink.getField("position").get(null))[i]);}for(int i=0;i<6;i++)scalar(prefix+".orientation."+i,((float[])sink.getField("orientation").get(null))[i]);
  }
  result.setProperty("cases",Integer.toString(number));try(Writer out=Files.newBufferedWriter(Paths.get(args[1]))){result.store(out,"Unmodified original Camera/Entity/Listener numeric methods; synthetic input and explicit nonnumeric sinks; no game/audio coverage");}
 }
}
