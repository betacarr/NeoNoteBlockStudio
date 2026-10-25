package studio.nbsx.research;

import java.io.*;
import java.lang.instrument.*;
import java.lang.reflect.*;
import java.nio.*;
import java.nio.file.*;
import java.security.ProtectionDomain;
import java.util.*;
import org.objectweb.asm.*;
import org.lwjgl.openal.*;
import paulscode.sound.Source;

/** Research instrumentation of the verified 1.13 client: real world and original Paulscode/LWJGL3 audio. */
public final class LegacyWorldCaptureAgent {
    private static final String SELF="studio/nbsx/research/LegacyWorldCaptureAgent";
    private static Properties config;
    private static volatile long device;
    private static volatile boolean audioReady,creating,prepared,pending,done;
    private static volatile int index,noteEvents;
    private static long readyAt,deadline;
    private static int[][][] scenes;
    private static final List<Properties> voices=new ArrayList<Properties>();
    private static String value(String key){return config.getProperty(key);}
    private static Class<?> type(String key)throws Exception{return Class.forName(value(key));}
    private static Field field(Class<?> owner,String name)throws Exception{
        for(Class<?> c=owner;c!=null;c=c.getSuperclass())try{Field f=c.getDeclaredField(name);f.setAccessible(true);return f;}catch(NoSuchFieldException ignored){}
        throw new NoSuchFieldException(owner.getName()+"."+name);
    }
    private static Object get(Object target,String key)throws Exception{return field(target.getClass(),value(key)).get(target);}
    private static Object constant(String owner,String key)throws Exception{return field(type(owner),value(key)).get(null);}
    private static Object invoke(Object target,String key,Object...args)throws Exception{
        Class<?> owner=target instanceof Class?(Class<?>)target:target.getClass();
        for(Class<?> c=owner;c!=null;c=c.getSuperclass())outer:for(Method m:c.getDeclaredMethods()){
            if(!m.getName().equals(value(key))||m.getParameterTypes().length!=args.length)continue;
            Class<?>[] parameters=m.getParameterTypes();
            for(int i=0;i<parameters.length;i++){
                Class<?> p=parameters[i];if(p==int.class)p=Integer.class;if(p==long.class)p=Long.class;if(p==double.class)p=Double.class;if(p==float.class)p=Float.class;if(p==boolean.class)p=Boolean.class;
                if(args[i]!=null&&!p.isInstance(args[i]))continue outer;
            }
            m.setAccessible(true);try{return m.invoke(target instanceof Class?null:target,args);}catch(InvocationTargetException error){throw new Exception(key,error.getCause());}
        }
        throw new NoSuchMethodException(owner.getName()+"."+key+" "+Arrays.toString(args));
    }
    private static void progress(String s){System.out.println("NBSX_LEGACY_CAPTURE "+s);}
    public static void premain(String arguments,Instrumentation instrumentation)throws Exception{
        config=new Properties();try(Reader r=new InputStreamReader(new FileInputStream(arguments),"UTF-8")){config.load(r);}
        scenes=new int[Integer.parseInt(value("caseLimit"))][][];
        for(int i=0;i<scenes.length;i++){String[] notes=value("scene."+i).split(";");scenes[i]=new int[notes.length][4];for(int n=0;n<notes.length;n++){String[] numbers=notes[n].split(",");for(int k=0;k<4;k++)scenes[i][n][k]=Integer.parseInt(numbers[k]);}}
        instrumentation.addTransformer(new ClassFileTransformer(){
            public byte[] transform(ClassLoader loader,String name,Class<?> redef,ProtectionDomain domain,byte[] bytes){
                if(!Arrays.asList(value("minecraft"),value("library"),value("channel"),value("noteBlock"),value("window")).contains(name.replace('/','.')))return null;
                ClassReader reader=new ClassReader(bytes);ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);
                reader.accept(new ClassVisitor(Opcodes.ASM9,writer){
                    public MethodVisitor visitMethod(int access,String method,String descriptor,String signature,String[] exceptions){
                        return new MethodVisitor(Opcodes.ASM9,super.visitMethod(access,method,descriptor,signature,exceptions)){
                            public void visitCode(){super.visitCode();
                                if(name.equals(value("minecraft"))&&method.equals(value("tick"))&&descriptor.equals("()V")){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"tick","(Ljava/lang/Object;)V",false);}
                                if(name.equals(value("noteBlock"))&&method.equals(value("noteEvent"))&&descriptor.equals("(Lbkt;Laxs;Lej;II)Z"))super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"noteEvent","()V",false);
                            }
                            public void visitMethodInsn(int opcode,String owner,String called,String desc,boolean itf){
                                if(name.equals(value("library"))&&owner.equals("org/lwjgl/openal/ALC10")&&called.equals("alcOpenDevice")&&desc.equals("(Ljava/nio/ByteBuffer;)J")){super.visitInsn(Opcodes.POP);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"openDevice","()J",false);return;}
                                if(name.equals(value("library"))&&owner.equals("org/lwjgl/openal/ALC10")&&called.equals("alcCreateContext")&&desc.equals("(JLjava/nio/IntBuffer;)J")){super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"createContext",desc,false);return;}
                                if(name.equals(value("window"))&&owner.equals("org/lwjgl/glfw/GLFW")&&called.equals("glfwCreateWindow")){super.visitLdcInsn(0x20004);super.visitInsn(Opcodes.ICONST_0);super.visitMethodInsn(Opcodes.INVOKESTATIC,"org/lwjgl/glfw/GLFW","glfwWindowHint","(II)V",false);}
                                super.visitMethodInsn(opcode,owner,called,desc,itf);
                            }
                            public void visitInsn(int opcode){
                                if(opcode==Opcodes.RETURN&&name.equals(value("library"))&&method.equals("init")&&descriptor.equals("()V"))super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"audioReady","()V",false);
                                if(opcode==Opcodes.RETURN&&name.equals(value("channel"))&&method.equals("play")&&descriptor.equals("()V")){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"channelPlayed","(Ljava/lang/Object;)V",false);}
                                super.visitInsn(opcode);
                            }
                        };
                    }
                },0);progress("transformed "+name);return writer.toByteArray();
            }
        });progress("agent-ready");
    }
    public static long openDevice(){device=SOFTLoopback.alcLoopbackOpenDeviceSOFT((ByteBuffer)null);if(device==0)throw new IllegalStateException("Original OpenAL library has no loopback device");progress("loopback-device "+device);return device;}
    public static long createContext(long original,IntBuffer ignored){return ALC10.alcCreateContext(original,new int[]{0x1990,0x1501,0x1991,0x1406,0x1007,48000,SOFTHRTF.ALC_HRTF_SOFT,Boolean.parseBoolean(value("hrtf"))?1:0,0});}
    public static void audioReady(){audioReady=true;progress("original-audio-ready "+AL10.alGetString(AL10.AL_VERSION));}
    public static synchronized void noteEvent(){if(pending)noteEvents++;}
    private static int expectedSources(){int count=0;for(int[] c:scenes[index]){double x=c[0],y=1.5+c[1],z=-2;if(x*x+y*y+z*z<48*48)count++;}return count;}
    public static void tick(Object minecraft){
        if(done)return;
        try{
            if(!creating){if(!audioReady)return;creating=true;progress("creating-isolated-world");
                Object settings=type("levelSettings").getConstructor(long.class,type("gameType"),boolean.class,boolean.class,type("worldType")).newInstance(0L,constant("gameType","creative"),false,false,constant("worldType","flat"));
                invoke(settings,"allowCommands");invoke(minecraft,"createLevel",value("worldName"),"NBSX 1.13 audio verification",settings);return;
            }
            Object player=get(minecraft,"player"),server=invoke(minecraft,"server");if(player==null||server==null)return;
            invoke(player,"noGravity",true);invoke(player,"moveTo",.5,80.0,2.5,180f,0f);
            if(!prepared){prepared=true;readyAt=System.nanoTime()+5000000000L;progress("world-ready");invoke(server,"execute",(Runnable)()->{try{Object level=invoke(server,"overworld",0);for(Object p:(List<?>)get(level,"players")){invoke(p,"noGravity",true);invoke(p,"moveTo",.5,80.0,2.5,180f,0f);}}catch(Exception e){fail(e);}});return;}
            if(index>=scenes.length){done=true;Files.write(Paths.get(value("output"),"complete.txt"),"actual-1.13-integrated-world-note-block-events".getBytes("UTF-8"));progress("complete");invoke(minecraft,"stop");return;}
            if(pending){if(System.nanoTime()>deadline)captureMissing();return;}
            if(System.nanoTime()<readyAt)return;
            synchronized(LegacyWorldCaptureAgent.class){voices.clear();noteEvents=0;pending=true;deadline=System.nanoTime()+8000000000L;}
            final int current=index;progress("trigger-case "+current+" voices="+scenes[current].length);
            invoke(server,"execute",(Runnable)()->{try{Object level=invoke(server,"overworld",0);for(int[] c:scenes[current]){
                Object note=constant("blocks","noteBlockConstant"),air=invoke(constant("blocks","air"),"defaultState"),base=invoke(constant("blocks","base."+c[3]),"defaultState");
                Object pos=type("blockPos").getConstructor(int.class,int.class,int.class).newInstance(c[0],81+c[1],0),above=type("blockPos").getConstructor(int.class,int.class,int.class).newInstance(c[0],82+c[1],0),below=type("blockPos").getConstructor(int.class,int.class,int.class).newInstance(c[0],80+c[1],0);
                invoke(level,"setBlock",above,air,3);invoke(level,"setBlock",below,base,3);Object state=invoke(note,"defaultState");
                state=invoke(state,"setValue",constant("noteBlock","noteProperty"),Integer.valueOf(c[2]));state=invoke(state,"setValue",constant("noteBlock","instrumentProperty"),invoke(type("instrumentType"),"instrumentByState",base));
                invoke(level,"setBlock",pos,state,3);invoke(level,"blockEvent",pos,note,0,0);
            }}catch(Exception e){fail(e);}});
        }catch(Exception e){fail(e);}
    }
    public static synchronized void channelPlayed(Object channel){
        if(!pending||done)return;
        try{
            if(noteEvents==0)throw new IllegalStateException("Source played without an original note-block event");
            int source=((IntBuffer)get(channel,"sourceId")).get(0);Properties record=new Properties();
            Source original=(Source)field(channel.getClass(),"attachedSource").get(channel);
            record.setProperty("soundFile",original.filenameURL.getFilename());record.setProperty("sourceVolume",Float.toString(original.sourceVolume));record.setProperty("attenuationRange",Float.toString(original.distOrRoll));record.setProperty("attenuationModel",Integer.toString(original.attModel));record.setProperty("paulscodeGain",Float.toString(original.gain));
            float[] pos=new float[3],listener=new float[3],orientation=new float[6];AL10.alGetSourcefv(source,0x1004,pos);AL10.alGetListenerfv(0x1004,listener);AL10.alGetListenerfv(0x100F,orientation);
            for(int k=0;k<3;k++){record.setProperty("source."+k,Float.toString(pos[k]));record.setProperty("listener."+k,Float.toString(listener[k]));}for(int k=0;k<6;k++)record.setProperty("orientation."+k,Float.toString(orientation[k]));
            record.setProperty("pitch",Float.toString(AL10.alGetSourcef(source,0x1003)));record.setProperty("gain",Float.toString(AL10.alGetSourcef(source,0x100A)));record.setProperty("range",Float.toString(AL10.alGetSourcef(source,0x1023)));record.setProperty("rolloff",Float.toString(AL10.alGetSourcef(source,0x1021)));record.setProperty("listenerGain",Float.toString(AL10.alGetListenerf(0x100A)));record.setProperty("sourceId",Integer.toString(source));
            boolean matched=false;for(int[] n:scenes[index])if(Math.abs(pos[0]-(n[0]+.5))<.0001&&Math.abs(pos[1]-(81.5+n[1]))<.0001&&Math.abs(pos[2]-.5)<.0001){record.setProperty("instrument",value("instrument."+n[3]));record.setProperty("note",Integer.toString(n[2]));matched=true;break;}
            if(!matched)throw new IllegalStateException("Unexpected original sound source "+Arrays.toString(pos));
            record.setProperty("backend",AL10.alGetString(AL10.AL_VERSION));voices.add(record);if(voices.size()<expectedSources())return;if(voices.size()!=expectedSources())throw new IllegalStateException("Too many original sources: "+voices.size());saveCapture();
        }catch(Exception e){fail(e);}
    }
    private static synchronized void captureMissing(){
        if(!pending||done)return;try{if(noteEvents==0)throw new IllegalStateException("No original note-block event before capture deadline");if(expectedSources()!=0||!voices.isEmpty())throw new IllegalStateException("Only "+voices.size()+" of "+expectedSources()+" expected original sources played");saveCapture();}catch(Exception e){fail(e);}
    }
    private static void saveCapture()throws Exception{
        Properties record=new Properties();if(!voices.isEmpty())record.putAll(voices.get(0));record.setProperty("delivery",voices.isEmpty()?"no-source-observed":"played");record.setProperty("noteEvents",Integer.toString(noteEvents));record.setProperty("voiceCount",Integer.toString(voices.size()));record.setProperty("expectedSources",Integer.toString(expectedSources()));record.setProperty("scene",value("sceneName."+index));record.setProperty("evidence","actual-1.13-integrated-world-note-block-event");
        int status=ALC10.alcGetInteger(device,SOFTHRTF.ALC_HRTF_STATUS_SOFT);record.setProperty("hrtfStatus",Integer.toString(status));if((status==SOFTHRTF.ALC_HRTF_ENABLED_SOFT)!=Boolean.parseBoolean(value("hrtf")))throw new IllegalStateException("Requested HRTF state was not applied: "+status);
        for(int k=0;k<voices.size();k++)for(String key:voices.get(k).stringPropertyNames())record.setProperty("voice."+k+"."+key,voices.get(k).getProperty(key));
        float[] samples=new float[288000];for(int cursor=0;cursor<144000;){int frames=Math.min(1024,144000-cursor);float[] block=new float[frames*2];SOFTLoopback.alcRenderSamplesSOFT(device,block,frames);System.arraycopy(block,0,samples,cursor*2,block.length);cursor+=frames;}
        Path out=Paths.get(value("output"));try(DataOutputStream file=new DataOutputStream(new BufferedOutputStream(new FileOutputStream(out.resolve("case-"+index+".pcm").toFile())))){for(float input:samples){double sample=Math.max(-1,Math.min(1,input));int pcm=(int)Math.round(sample*(sample<0?32768:32767));file.writeByte(pcm&255);file.writeByte((pcm>>>8)&255);}}
        try(Writer file=new OutputStreamWriter(new FileOutputStream(out.resolve("case-"+index+".properties").toFile()),"UTF-8")){record.store(file,"Original 1.13 game capture; source names are manually identified from checked bytecode");}
        progress("captured-case "+index+" noteEvents="+noteEvents);index++;pending=false;readyAt=System.nanoTime()+1500000000L;
    }
    private static void fail(Throwable e){done=true;e.printStackTrace();try{Files.write(Paths.get(value("output"),"failure.txt"),e.toString().getBytes("UTF-8"));}catch(Exception ignored){}System.exit(2);}
}
