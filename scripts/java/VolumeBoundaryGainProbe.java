package studio.nbsx.research;
import java.io.*;import java.lang.reflect.*;import java.nio.*;import java.nio.file.*;import java.util.*;import org.lwjgl.openal.*;
/** Isolated original-method/state probe, not a running SoundEngine. Original world is tested separately. */
public final class VolumeBoundaryGainProbe {
 private static Properties cfg;
 private static String v(String key){return cfg.getProperty(key);}
 private static Class<?> type(String key)throws Exception{return Class.forName(v(key));}
 private static Field field(Class<?> type,String name)throws Exception{for(Class<?> c=type;c!=null;c=c.getSuperclass())try{Field f=c.getDeclaredField(name);f.setAccessible(true);return f;}catch(NoSuchFieldException e){}throw new NoSuchFieldException(name);}
 private static Object empty(Class<?> c)throws Exception{Class<?> u=Class.forName("sun.misc.Unsafe");Field f=u.getDeclaredField("theUnsafe");f.setAccessible(true);return u.getMethod("allocateInstance",Class.class).invoke(f.get(null),c);}
 private static Method method(Class<?> c,String name,Class<?>...args)throws Exception{Method m=c.getDeclaredMethod(name,args);m.setAccessible(true);return m;}
 private static String bits(float x){return Integer.toHexString(Float.floatToRawIntBits(x));}
 public static void main(String[]args)throws Exception{
  cfg=new Properties();try(Reader in=new InputStreamReader(new FileInputStream(args[0]),"UTF-8")){cfg.load(in);}
  Class<?> categoryType=type("category"),optionsType=type("options"),optionType=type("option"),engineType=type("engine");
  Object options=empty(optionsType),engine=empty(engineType),master=field(categoryType,v("master")).get(null),records=field(categoryType,v("records")).get(null);
  Method factory=method(optionsType,v("createSlider"),String.class,categoryType),get=method(optionType,v("optionGet"));
  Object masterOption=factory.invoke(options,"research.master",master),recordOption=factory.invoke(options,"research.records",records);
  Map<Object,Object> volumes=new HashMap<Object,Object>();volumes.put(master,masterOption);volumes.put(records,recordOption);field(optionsType,v("volumeMap")).set(options,volumes);field(engineType,v("engineOptions")).set(engine,options);
  Properties evidence=new Properties();evidence.setProperty("default.master",get.invoke(masterOption).toString());evidence.setProperty("default.records",get.invoke(recordOption).toString());
  Object set=field(optionType,v("optionValues")).get(recordOption);Method validate=method(set.getClass(),v("validate"),Double.class);
  for(double value:new double[]{-.0000001,-0.0,0,.5,1,1.0000001,Double.NaN,Double.POSITIVE_INFINITY})evidence.setProperty("validate."+value,validate.invoke(set,value).toString());
  Method rawVolume=method(optionsType,v("getVolume"),categoryType),finalVolume=method(optionsType,v("getFinalVolume"),categoryType),calculate=method(engineType,v("calculate"),float.class,categoryType);
  long device=SOFTLoopback.alcLoopbackOpenDeviceSOFT((ByteBuffer)null);if(device==0)throw new IllegalStateException("No original DLL loopback");ALCCapabilities alc=ALC.createCapabilities(device);
  long context=ALC10.alcCreateContext(device,new int[]{0x1990,0x1501,0x1991,0x1406,0x1007,48000,0x1992,0,0x1996,0,0x199A,1,0});if(context==0||!ALC10.alcMakeContextCurrent(context))throw new IllegalStateException("No original DLL context");AL.createCapabilities(alc);
  Object listener=type("listener").getConstructor().newInstance();method(type("listener"),v("resetListener")).invoke(listener);Object channel=method(type("channel"),v("createChannel")).invoke(null);int source=field(type("channel"),v("source")).getInt(channel);
  Method setChannel=method(type("channel"),v("setVolume"),float.class),setListener=v("setGain")==null?null:method(type("listener"),v("setGain"),float.class);
  evidence.setProperty("backend",AL10.alGetString(AL10.AL_VERSION));evidence.setProperty("initialListenerGain",Float.toString(AL10.alGetListenerf(AL10.AL_GAIN)));evidence.setProperty("listenerSetterExists",Boolean.toString(setListener!=null));
  List<String> rows=Files.readAllLines(Paths.get(args[1]));
  try(PrintWriter out=new PrintWriter(new OutputStreamWriter(new FileOutputStream(args[2]),"UTF-8"))){
   out.println("case\trawInput\tcategoryInput\tmasterInput\tcategory\tmaster\tfinalVolume\tengineGain\tengineGainBits\tlistenerGain\tsourceGain\talError");
   for(int i=0;i<rows.size();i++){String[] values=rows.get(i).split("\t");float input=Float.parseFloat(values[0]);double cat=Double.parseDouble(values[1]),mas=Double.parseDouble(values[2]);field(optionType,v("optionValue")).set(recordOption,cat);field(optionType,v("optionValue")).set(masterOption,mas);
    float category=((Number)rawVolume.invoke(options,records)).floatValue(),masterGain=((Number)rawVolume.invoke(options,master)).floatValue(),finalGain=((Number)finalVolume.invoke(options,records)).floatValue(),gain=((Number)calculate.invoke(engine,input,records)).floatValue();
    String sourceResult="not-applied-invalid-input",listenerResult="not-applied-invalid-input";int error=0;
    if(Float.isFinite(gain)&&gain>=0&&Float.isFinite(masterGain)&&masterGain>=0&&masterGain<=1){if(setListener!=null)setListener.invoke(listener,masterGain);setChannel.invoke(channel,gain);error=AL10.alGetError();sourceResult=Float.toString(AL10.alGetSourcef(source,AL10.AL_GAIN));listenerResult=Float.toString(AL10.alGetListenerf(AL10.AL_GAIN));}
    out.println(i+"\t"+input+"\t"+cat+"\t"+mas+"\t"+category+"\t"+masterGain+"\t"+finalGain+"\t"+gain+"\t"+bits(gain)+"\t"+listenerResult+"\t"+sourceResult+"\t"+error);
   }
  }finally{method(type("channel"),v("destroyChannel")).invoke(channel);ALC10.alcMakeContextCurrent(0);ALC10.alcDestroyContext(context);ALC10.alcCloseDevice(device);}
  try(Writer out=new OutputStreamWriter(new FileOutputStream(args[3]),"UTF-8")){evidence.store(out,"Original options factory and original source/listener methods; synthetic isolated engine state");}
 }
}
