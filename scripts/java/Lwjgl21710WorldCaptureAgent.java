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
import com.sun.jna.*;

/** Research instrumentation of the verified 1.7.10 client: real world and original Paulscode/LWJGL2 audio. */
public final class Lwjgl21710WorldCaptureAgent {
    private static final String SELF="studio/nbsx/research/Lwjgl21710WorldCaptureAgent";
    private static Properties config;
    private static volatile long device;
    private static NativeLibrary nativeLibrary;
    private static String originalContextAttributes="unobserved";
    private static boolean hrtfSupported;
    private static int requestedNormal,requestedStreaming,actualNormal,actualStreaming;
    private static String originalContextFull="unobserved",originalContextBuffer="unobserved";
    private static String originalNativeFirstWord="unobserved",actualContextAttributes="unobserved";
    private static long originalNativeOffset;
    private static volatile Object client;
    private static volatile Properties serverPose=new Properties();
    private static final java.util.concurrent.ConcurrentLinkedQueue<Runnable> serverTasks=new java.util.concurrent.ConcurrentLinkedQueue<Runnable>();
    private static int serverNoteEvents,clientNoteEvents;
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
    private static void progress(String s){System.out.println("NBSX_1710_CAPTURE "+s);}
    public static void premain(String arguments,Instrumentation instrumentation)throws Exception{
        config=new Properties();try(Reader r=new InputStreamReader(new FileInputStream(arguments),"UTF-8")){config.load(r);}
        scenes=new int[Integer.parseInt(value("caseLimit"))][][];
        for(int i=0;i<scenes.length;i++){String[] notes=value("scene."+i).split(";");scenes[i]=new int[notes.length][4];for(int n=0;n<notes.length;n++){String[] numbers=notes[n].split(",");for(int k=0;k<4;k++)scenes[i][n][k]=Integer.parseInt(numbers[k]);}}
        instrumentation.addTransformer(new ClassFileTransformer(){
            public byte[] transform(ClassLoader loader,String name,Class<?> redef,ProtectionDomain domain,byte[] bytes){
                if(!Arrays.asList(value("minecraft"),value("library"),value("channel"),value("noteBlock"),"org.lwjgl.openal.ALC10","net.minecraft.server.MinecraftServer").contains(name.replace('/','.')))return null;
                ClassReader reader=new ClassReader(bytes);ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);
                reader.accept(new ClassVisitor(Opcodes.ASM9,writer){
                    public MethodVisitor visitMethod(int access,String method,String descriptor,String signature,String[] exceptions){
                        return new MethodVisitor(Opcodes.ASM9,super.visitMethod(access,method,descriptor,signature,exceptions)){
                            public void visitCode(){super.visitCode();
                                if(name.equals(value("minecraft"))&&method.equals(value("tick"))&&descriptor.equals("()V")){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"tick","(Ljava/lang/Object;)V",false);}
                                if(name.equals("net/minecraft/server/MinecraftServer")&&method.equals("u")&&descriptor.equals("()V")){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"serverTick","(Ljava/lang/Object;)V",false);}
                                if(name.equals("org/lwjgl/openal/ALC10")&&method.equals("alcCreateContext")&&descriptor.equals("(Lorg/lwjgl/openal/ALCdevice;Ljava/nio/IntBuffer;)Lorg/lwjgl/openal/ALCcontext;")){super.visitVarInsn(Opcodes.ALOAD,1);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"contextAttributes","(Ljava/nio/IntBuffer;)Ljava/nio/IntBuffer;",false);super.visitVarInsn(Opcodes.ASTORE,1);}
                                if(name.equals(value("noteBlock"))&&method.equals(value("noteEvent"))&&descriptor.equals("(Lahb;IIIII)Z")){super.visitVarInsn(Opcodes.ALOAD,1);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"noteEvent","(Ljava/lang/Object;)V",false);}
                            }
                            public void visitMethodInsn(int opcode,String owner,String called,String desc,boolean itf){
                                if(name.equals("org/lwjgl/openal/ALC10")&&owner.equals("org/lwjgl/openal/ALC10")&&called.equals("nalcOpenDevice")&&desc.equals("(J)J")){super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"openDevice",desc,false);return;}
                                super.visitMethodInsn(opcode,owner,called,desc,itf);
                                if(name.equals(value("minecraft"))&&owner.equals("org/lwjgl/opengl/Display")&&called.equals("create"))super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"hideWindow","()V",false);
                            }
                            public void visitInsn(int opcode){
                                if(opcode==Opcodes.RETURN&&name.replace('/','.').equals(value("library"))&&method.equals("init")&&descriptor.equals("()V")){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"audioReady","(Ljava/lang/Object;)V",false);}
                                if(opcode==Opcodes.RETURN&&name.replace('/','.').equals(value("channel"))&&method.equals("play")&&descriptor.equals("()V")){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"channelPlayed","(Ljava/lang/Object;)V",false);}
                                super.visitInsn(opcode);
                            }
                        };
                    }
                },0);progress("transformed "+name);return writer.toByteArray();
            }
        });progress("agent-ready");
    }
    private static NativeLibrary openal(){if(nativeLibrary==null)nativeLibrary=NativeLibrary.getInstance(value("nativeDll"));return nativeLibrary;}
    private static Function extension(String name){Pointer p=(Pointer)openal().getFunction("alcGetProcAddress").invoke(Pointer.class,new Object[]{Pointer.NULL,name});if(p==null)throw new IllegalStateException("Original DLL extension missing: "+name);return Function.getFunction(p);}
    public static long openDevice(long ignored){Pointer p=(Pointer)extension("alcLoopbackOpenDeviceSOFT").invoke(Pointer.class,new Object[]{Pointer.NULL});if(p==null)throw new IllegalStateException("Original OpenAL loopback failed");device=Pointer.nativeValue(p);hrtfSupported=openal().getFunction("alcIsExtensionPresent").invokeInt(new Object[]{p,"ALC_SOFT_HRTF"})!=0;progress("original-loopback-device "+device+" hrtfSupported="+hrtfSupported);return device;}
    public static IntBuffer contextAttributes(IntBuffer original){
        List<Integer> before=new ArrayList<Integer>(),after=new ArrayList<Integer>();
        if(original!=null){int position=original.position(),limit=original.limit();originalContextBuffer="position="+position+",limit="+limit+",capacity="+original.capacity();List<Integer> all=new ArrayList<Integer>();IntBuffer full=original.duplicate();full.clear();while(full.hasRemaining())all.add(full.get());originalContextFull=all.toString();long address=org.lwjgl.MemoryUtil.getAddressSafe(original);originalNativeOffset=address-org.lwjgl.MemoryUtil.getAddress(original,0);originalNativeFirstWord=Integer.toString(new Pointer(address).getInt(0));if(position==original.capacity()&&!originalNativeFirstWord.equals("0"))throw new IllegalStateException("Original pointer outside declared buffer is not terminated: "+originalNativeFirstWord);if(original.position()!=position||original.limit()!=limit)throw new IllegalStateException("Context observer consumed original buffer");}
        if(original!=null){IntBuffer copy=original.duplicate();while(copy.hasRemaining()){int key=copy.get();if(key==0)break;if(!copy.hasRemaining())throw new IllegalStateException("Malformed original context attributes");int v=copy.get();before.add(key);before.add(v);if(key!=0x1990&&key!=0x1991&&key!=0x1007){after.add(key);after.add(v);}}}
        originalContextAttributes=before.toString();after.add(0x1990);after.add(0x1501);after.add(0x1991);after.add(0x1406);after.add(0x1007);after.add(48000);after.add(0);
        IntBuffer result=ByteBuffer.allocateDirect(after.size()*4).order(ByteOrder.nativeOrder()).asIntBuffer();for(int v:after)result.put(v);result.flip();progress("context-attributes original="+before+" loopback="+after);return result;
    }
    public static void hideWindow(){try{Class<?> display=Class.forName("org.lwjgl.opengl.Display");Field f=display.getDeclaredField("display_impl");f.setAccessible(true);Object impl=f.get(null);Field hwnd=field(impl.getClass(),"hwnd");NativeLibrary.getInstance("user32").getFunction("ShowWindow",Function.ALT_CONVENTION).invokeInt(new Object[]{new Pointer(hwnd.getLong(impl)),0});progress("isolated-window-hidden");}catch(Exception e){throw new RuntimeException(e);}}
    public static void audioReady(Object library){try{IntBuffer count=ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1002,count);int size=count.get(0);IntBuffer attrs=ByteBuffer.allocateDirect(size*4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1003,attrs);List<Integer> list=new ArrayList<Integer>();for(int i=0;i<size;i++)list.add(attrs.get(i));actualContextAttributes=list.toString();requestedNormal=paulscode.sound.SoundSystemConfig.getNumberNormalChannels();requestedStreaming=paulscode.sound.SoundSystemConfig.getNumberStreamingChannels();actualNormal=((List<?>)field(library.getClass(),"normalChannels").get(library)).size();actualStreaming=((List<?>)field(library.getClass(),"streamingChannels").get(library)).size();if(requestedNormal!=28||requestedStreaming!=4||actualNormal<=0||actualNormal>28)throw new IllegalStateException("Unexpected original pool "+requestedNormal+"/"+actualNormal);audioReady=true;progress("original-audio-ready "+AL10.alGetString(AL10.AL_VERSION)+" pools="+actualNormal+"+"+actualStreaming);}catch(Exception e){fail(e);}}
    public static synchronized void noteEvent(Object world){if(pending){noteEvents++;try{if(field(world.getClass(),"E").getBoolean(world))clientNoteEvents++;else serverNoteEvents++;}catch(Exception e){fail(e);}}}
    public static void serverTick(Object server){if(done)return;try{Object level=invoke(server,"overworld",0);if(level==null)return;List<?> players=(List<?>)get(level,"players");if(!players.isEmpty()){
        Object stone=constant("blocks","platform");for(int x=-1;x<=1;x++)for(int z=1;z<=3;z++)invoke(level,"setBlock",x,79,z,stone,0,3);
        for(Object player:players){Object connection=field(player.getClass(),"a").get(player);invoke(connection,"serverTeleport",.5,80.0,2.5,180f,0f);Properties p=new Properties();p.setProperty("serverThread",Thread.currentThread().getName());p.setProperty("serverEntityX",Double.toString(field(player.getClass(),"s").getDouble(player)));p.setProperty("serverEntityY",Double.toString(field(player.getClass(),"t").getDouble(player)));p.setProperty("serverEntityZ",Double.toString(field(player.getClass(),"u").getDouble(player)));p.setProperty("serverYOffset",Float.toString(field(player.getClass(),"L").getFloat(player)));serverPose=p;}
    }Runnable task;while((task=serverTasks.poll())!=null)task.run();}catch(Exception e){fail(e);}}
    private static int expectedSources(){int count=0;for(int[] c:scenes[index]){double x=c[0],y=1.5+c[1],z=-2;if(x*x+y*y+z*z<48*48)count++;}return count;}
    public static void tick(Object minecraft){
        client=minecraft;
        if(done)return;
        try{
            if(!creating){if(!audioReady)return;creating=true;progress("creating-isolated-world");
                Object settings=type("levelSettings").getConstructor(long.class,type("gameType"),boolean.class,boolean.class,type("worldType")).newInstance(0L,constant("gameType","creative"),false,false,constant("worldType","flat"));
                invoke(settings,"allowCommands");invoke(minecraft,"createLevel",value("worldName"),"NBSX 1.7.10 audio verification",settings);return;
            }
            Object player=get(minecraft,"player"),server=invoke(minecraft,"server");if(player==null||server==null)return;
            if(!prepared){prepared=true;readyAt=System.nanoTime()+7000000000L;progress("world-ready");return;}
            if(index>=scenes.length){done=true;Files.write(Paths.get(value("output"),"complete.txt"),"actual-1.7.10-integrated-world-note-block-events".getBytes("UTF-8"));progress("complete");invoke(minecraft,"stop");return;}
            if(pending){if(System.nanoTime()>deadline)captureMissing();return;}
            if(System.nanoTime()<readyAt)return;
            synchronized(Lwjgl21710WorldCaptureAgent.class){voices.clear();noteEvents=0;serverNoteEvents=0;clientNoteEvents=0;pending=true;deadline=System.nanoTime()+8000000000L;}
            final int current=index;progress("trigger-case "+current+" voices="+scenes[current].length);
            serverTasks.add((Runnable)()->{try{Object level=invoke(server,"overworld",0);for(int[] c:scenes[current]){
                Object note=constant("blocks","noteBlockConstant"),air=constant("blocks","air"),base=constant("blocks","base."+c[3]);int x=c[0],y=81+c[1];
                invoke(level,"setBlock",x,y+1,0,air,0,3);invoke(level,"setBlock",x,y-1,0,base,0,3);invoke(level,"setBlock",x,y,0,note,0,3);
                Object tile=invoke(level,"tileEntity",x,y,0);field(tile.getClass(),value("tileNote")).setByte(tile,(byte)c[2]);invoke(tile,"triggerNote",level,x,y,0);

            }}catch(Exception e){fail(e);}});
        }catch(Exception e){fail(e);}
    }
    public static synchronized void channelPlayed(Object channel){
        if(!pending||done)return;
        try{
            if(serverNoteEvents==0)throw new IllegalStateException("Source played without an original server note-block event");
            int source=((IntBuffer)get(channel,"sourceId")).get(0);Properties record=new Properties();
            Source original=(Source)field(channel.getClass(),"attachedSource").get(channel);
            record.setProperty("soundFile",original.filenameURL.getFilename());record.setProperty("sourceVolume",Float.toString(original.sourceVolume));record.setProperty("attenuationRange",Float.toString(original.distOrRoll));record.setProperty("attenuationModel",Integer.toString(original.attModel));record.setProperty("paulscodeGain",Float.toString(original.gain));
            float[] pos=new float[3],listener=new float[3],orientation=new float[6];FloatBuffer pb=ByteBuffer.allocateDirect(24).order(ByteOrder.nativeOrder()).asFloatBuffer();AL10.alGetSource(source,0x1004,pb);for(int k=0;k<3;k++)pos[k]=pb.get(k);pb.clear();AL10.alGetListener(0x1004,pb);for(int k=0;k<3;k++)listener[k]=pb.get(k);pb.clear();AL10.alGetListener(0x100F,pb);for(int k=0;k<6;k++)orientation[k]=pb.get(k);
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
        Properties record=new Properties();if(!voices.isEmpty())record.putAll(voices.get(0));record.setProperty("delivery",voices.isEmpty()?"no-source-observed":"played");record.setProperty("noteEvents",Integer.toString(noteEvents));record.setProperty("voiceCount",Integer.toString(voices.size()));record.setProperty("expectedSources",Integer.toString(expectedSources()));record.setProperty("scene",value("sceneName."+index));record.setProperty("evidence","actual-1.7.10-integrated-world-note-block-event");
        record.setProperty("hrtfSupported",Boolean.toString(hrtfSupported));record.setProperty("hrtfStatus","unsupported");record.setProperty("originalContextAttributes",originalContextAttributes);record.setProperty("contextAttributePolicy","retain-original-pairs-except-loopback-channel-format-rate");
        record.setProperty("originalContextFullBuffer",originalContextFull);record.setProperty("originalContextBufferBounds",originalContextBuffer);record.setProperty("requestedNormalPool",Integer.toString(requestedNormal));record.setProperty("requestedStreamingPool",Integer.toString(requestedStreaming));record.setProperty("actualNormalPool",Integer.toString(actualNormal));record.setProperty("actualStreamingPool",Integer.toString(actualStreaming));record.setProperty("serverNoteEvents",Integer.toString(serverNoteEvents));record.setProperty("clientNoteEvents",Integer.toString(clientNoteEvents));record.putAll(serverPose);
        record.setProperty("originalContextNativeAddressOffsetBytes",Long.toString(originalNativeOffset));record.setProperty("originalContextNativeFirstWord",originalNativeFirstWord);record.setProperty("originalContextNativeFirstWordInsideDeclaredBuffer","false");record.setProperty("actualContextAttributes",actualContextAttributes);record.setProperty("contextPointerScope","original pointer is outside declared buffer; first word observed zero in this process, not a cross-process guarantee");
        try{Object p=get(client,"player");record.setProperty("clientEntityX",Double.toString(field(p.getClass(),"s").getDouble(p)));record.setProperty("clientEntityY",Double.toString(field(p.getClass(),"t").getDouble(p)));record.setProperty("clientEntityZ",Double.toString(field(p.getClass(),"u").getDouble(p)));record.setProperty("clientYOffset",Float.toString(field(p.getClass(),"L").getFloat(p)));}catch(Exception e){throw new RuntimeException(e);}
        FloatBuffer start=ByteBuffer.allocateDirect(24).order(ByteOrder.nativeOrder()).asFloatBuffer();AL10.alGetListener(0x1004,start);for(int k=0;k<3;k++)record.setProperty("captureStart.listener."+k,Float.toString(start.get(k)));start.clear();AL10.alGetListener(0x100F,start);for(int k=0;k<6;k++)record.setProperty("captureStart.orientation."+k,Float.toString(start.get(k)));record.setProperty("captureStart.listenerGain",Float.toString(AL10.alGetListenerf(0x100A)));
        for(int k=0;k<voices.size();k++)for(String key:voices.get(k).stringPropertyNames())record.setProperty("voice."+k+"."+key,voices.get(k).getProperty(key));
        float[] samples=new float[288000];int blockIndex=0;for(int cursor=0;cursor<144000;){int frames=Math.min(1024,144000-cursor);FloatBuffer lp=ByteBuffer.allocateDirect(12).order(ByteOrder.nativeOrder()).asFloatBuffer();AL10.alGetListener(0x1004,lp);for(int k=0;k<3;k++)record.setProperty("renderBlock."+blockIndex+".listener."+k,Float.toString(lp.get(k)));record.setProperty("renderBlock."+blockIndex+".frames",Integer.toString(frames));Memory memory=new Memory(frames*8L);extension("alcRenderSamplesSOFT").invokeVoid(new Object[]{new Pointer(device),memory,frames});float[] block=memory.getFloatArray(0,frames*2);System.arraycopy(block,0,samples,cursor*2,block.length);cursor+=frames;blockIndex++;}record.setProperty("renderBlockCount",Integer.toString(blockIndex));
        Path out=Paths.get(value("output"));try(DataOutputStream file=new DataOutputStream(new BufferedOutputStream(new FileOutputStream(out.resolve("case-"+index+".pcm").toFile())))){for(float input:samples){double sample=Math.max(-1,Math.min(1,input));int pcm=(int)Math.round(sample*(sample<0?32768:32767));file.writeByte(pcm&255);file.writeByte((pcm>>>8)&255);}}
        try(Writer file=new OutputStreamWriter(new FileOutputStream(out.resolve("case-"+index+".properties").toFile()),"UTF-8")){record.store(file,"Original 1.7.10 game capture; source names are manually identified from checked bytecode");}
        progress("captured-case "+index+" noteEvents="+noteEvents);index++;pending=false;readyAt=System.nanoTime()+1500000000L;
    }
    private static void fail(Throwable e){done=true;e.printStackTrace();try{Files.write(Paths.get(value("output"),"failure.txt"),e.toString().getBytes("UTF-8"));}catch(Exception ignored){}System.exit(2);}
}
