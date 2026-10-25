package studio.nbsx.research;
import java.io.*;
import java.lang.instrument.*;
import java.lang.reflect.*;
import java.nio.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import org.objectweb.asm.*;
import org.lwjgl.openal.*;

/** Original Library invocation only: regular devices never create/play a source. */
public final class HrtfOverrideProbe {
    private static Properties config,record=new Properties();
    private static long device;
    private static int resets,contexts;
    private static final LinkedHashMap<Integer,Integer> resetRequest=new LinkedHashMap<Integer,Integer>();
    private static String hash(byte[] bytes)throws Exception{StringBuilder text=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))text.append(String.format("%02x",b&255));return text.toString();}
    private static boolean loopback(){return config.getProperty("deviceMode").equals("request-loopback");}
    public static void premain(String file,Instrumentation instrumentation)throws Exception{
        config=new Properties();try(Reader input=new InputStreamReader(new FileInputStream(file),"UTF-8")){config.load(input);}
        instrumentation.addTransformer(new ClassFileTransformer(){public byte[] transform(ClassLoader loader,String name,Class<?> redef,ProtectionDomain domain,byte[] bytes){
            if(!name.equals(config.getProperty("library")))return null;
            try{if(!hash(bytes).equals(config.getProperty("librarySha256")))throw new IllegalStateException("Original Library class differs from official client");}catch(Exception error){throw new RuntimeException(error);}
            ClassReader reader=new ClassReader(bytes);ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);
            reader.accept(new ClassVisitor(Opcodes.ASM9,writer){public MethodVisitor visitMethod(int access,String method,String descriptor,String signature,String[] exceptions){
                MethodVisitor delegate=super.visitMethod(access,method,descriptor,signature,exceptions);
                return new MethodVisitor(Opcodes.ASM9,delegate){
                    public void visitCode(){super.visitCode();if(method.equals(config.getProperty("init"))&&descriptor.equals("(Ljava/lang/String;Z)V")){super.visitVarInsn(Opcodes.ILOAD,2);super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/HrtfOverrideProbe","requested","(Z)V",false);}}
                    public void visitMethodInsn(int opcode,String owner,String called,String desc,boolean itf){
                        if(owner.equals("org/lwjgl/openal/SOFTHRTF")&&called.equals("alcResetDeviceSOFT")&&desc.equals("(JLjava/nio/IntBuffer;)Z")){super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/HrtfOverrideProbe","reset",desc,false);return;}
                        if(owner.equals("org/lwjgl/openal/ALC10")&&called.equals("alcCreateContext")&&desc.equals("(JLjava/nio/IntBuffer;)J")){super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/HrtfOverrideProbe","context",desc,false);return;}
                        if(owner.equals("org/lwjgl/openal/ALC10")&&called.equals("alcOpenDevice")&&desc.equals("(Ljava/lang/CharSequence;)J")){super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/HrtfOverrideProbe","open",desc,false);return;}
                        super.visitMethodInsn(opcode,owner,called,desc,itf);
                    }
                };
            }},0);return writer.toByteArray();
        }});
    }
    public static void requested(boolean value){record.setProperty("originalLibraryBoolean",Boolean.toString(value));}
    private static LinkedHashMap<Integer,Integer> attrs(IntBuffer values){LinkedHashMap<Integer,Integer> result=new LinkedHashMap<Integer,Integer>();if(values!=null){IntBuffer copy=values.duplicate();while(copy.hasRemaining()){int key=copy.get();if(key==0)break;result.put(key,copy.get());}}return result;}
    private static int[] adapted(LinkedHashMap<Integer,Integer> attributes){attributes.put(0x1990,0x1501);attributes.put(0x1991,0x1406);attributes.put(0x1007,48000);int[] result=new int[attributes.size()*2+1];int at=0;for(Map.Entry<Integer,Integer> entry:attributes.entrySet()){result[at++]=entry.getKey();result[at++]=entry.getValue();}return result;}
    public static long open(CharSequence name){record.setProperty("originalDeviceRequest",name==null?"default":name.toString());device=loopback()?SOFTLoopback.alcLoopbackOpenDeviceSOFT((ByteBuffer)null):ALC10.alcOpenDevice(name);return device;}
    public static boolean reset(long handle,IntBuffer values){int index=resets++;LinkedHashMap<Integer,Integer> attributes=attrs(values);resetRequest.clear();resetRequest.putAll(attributes);record.setProperty("reset."+index+".originalAttributes",attributes.toString());boolean result;
        if(loopback()){int[] merged=adapted(attributes);record.setProperty("reset."+index+".captureAttributes",attributes.toString());result=SOFTHRTF.alcResetDeviceSOFT(handle,merged);}else{record.setProperty("reset."+index+".captureAttributes",attributes.toString());result=SOFTHRTF.alcResetDeviceSOFT(handle,values);}
        record.setProperty("reset."+index+".result",Boolean.toString(result));record.setProperty("reset."+index+".actualStatus",Integer.toString(ALC10.alcGetInteger(handle,0x1993)));return result;
    }
    public static long context(long handle,IntBuffer values){int index=contexts++;LinkedHashMap<Integer,Integer> attributes=attrs(values);record.setProperty("context."+index+".originalAttributes",attributes.toString());record.setProperty("context."+index+".originalNull",Boolean.toString(values==null));
        if(loopback()){for(Map.Entry<Integer,Integer> entry:resetRequest.entrySet())if(!attributes.containsKey(entry.getKey()))attributes.put(entry.getKey(),entry.getValue());int[] merged=adapted(attributes);record.setProperty("context."+index+".captureAttributes",attributes.toString());return ALC10.alcCreateContext(handle,merged);}
        record.setProperty("context."+index+".captureAttributes",attributes.toString());return ALC10.alcCreateContext(handle,values);
    }
    private static Object invoke(Object target,String name,Object... args)throws Exception{for(Method method:target.getClass().getDeclaredMethods())if(method.getName().equals(name)&&method.getParameterTypes().length==args.length){method.setAccessible(true);return method.invoke(target,args);}throw new NoSuchMethodException(name);}
    public static void main(String[] args)throws Exception{
        Object library=Class.forName(config.getProperty("library")).getConstructor().newInstance();boolean initialized=false;
        try{
            library.getClass().getMethod(config.getProperty("init"),String.class,boolean.class).invoke(library,null,Boolean.valueOf(config.getProperty("hrtf")));
            initialized=true;
            record.setProperty("deviceMode",config.getProperty("deviceMode"));record.setProperty("backend",String.valueOf(AL10.alGetString(AL10.AL_VERSION)));record.setProperty("actualDeviceName",String.valueOf(invoke(library,config.getProperty("deviceName"))));record.setProperty("resetCalls",Integer.toString(resets));record.setProperty("contextCalls",Integer.toString(contexts));record.setProperty("frequency",Integer.toString(ALC10.alcGetInteger(device,0x1007)));
            int count=ALC10.alcGetInteger(device,0x1994),enabled=ALC10.alcGetInteger(device,0x1992);record.setProperty("hrtfEnabled",Integer.toString(enabled));record.setProperty("hrtfStatus",Integer.toString(ALC10.alcGetInteger(device,0x1993)));record.setProperty("profileCount",Integer.toString(count));for(int i=0;i<count;i++)record.setProperty("profile."+i,String.valueOf(SOFTHRTF.alcGetStringiSOFT(device,0x1995,i)));if(enabled!=0)record.setProperty("selectedProfile",String.valueOf(ALC10.alcGetString(device,0x1995)));
            boolean limiter=ALC10.alcIsExtensionPresent(device,"ALC_SOFT_output_limiter");record.setProperty("limiterAvailable",Boolean.toString(limiter));if(limiter)record.setProperty("limiterEnabled",Integer.toString(ALC10.alcGetInteger(device,0x199A)));record.setProperty("sourcesCreated","0");record.setProperty("sourcesPlayed","0");
            try(Writer output=new OutputStreamWriter(new FileOutputStream(config.getProperty("output")),"UTF-8")){record.store(output,"Actual original Library; regular arguments forwarded unchanged; optional request-loopback adapter is separate");}
            System.out.println("NBSX_PROBE "+record);
        }finally{if(initialized)invoke(library,config.getProperty("cleanup"));}
    }
}
