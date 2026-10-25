package studio.nbsx.research;
import java.io.*;
import java.lang.instrument.*;
import java.lang.reflect.*;
import java.nio.*;
import java.nio.file.*;
import java.security.ProtectionDomain;
import java.util.*;
import java.util.function.Function;
import org.objectweb.asm.*;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.openal.*;

/** Research-only agent: a separate real client/world, with its audio device captured offline. */
public final class WorldCapture119 {
    private static volatile boolean gameHrtfRequested;
    private static volatile int resetCalls;
    private static volatile String originalResetAttributes="not-called",captureResetAttributes="not-called",resetResult="not-called";
    private static volatile int resetStatusBeforeContext=-1;
    private static Properties config;
    private static final Properties actualOptions=new Properties(), placed=new Properties();
    private static volatile long device;
    private static volatile boolean creating, prepared, pending, done;
    private static volatile int index, noteEvents;
    private static long readyAt;
    private static volatile long noteDeadline;
    private static int[][][] scenes;
    private static String originalContextAttributes="[]", captureContextAttributes="[]";
    private static final List<Properties> voices=new ArrayList<Properties>();
    private static int expectedSources(){int count=0;for(int[] note:scenes[index]){double x=note[0],y=1.5+note[1],z=-2;if(x*x+y*y+z*z<48*48)count++;}return count;}
    private static String value(String key) { return config.getProperty(key); }
    private static Class<?> type(String key) throws Exception { return Class.forName(value(key)); }
    private static Field field(Class<?> type, String name) throws Exception {
        for (Class<?> c=type;c!=null;c=c.getSuperclass()) try { Field f=c.getDeclaredField(name); f.setAccessible(true); return f; } catch (NoSuchFieldException missing) { }
        throw new NoSuchFieldException(type.getName()+"."+name);
    }
    private static Object get(Object object, String alias) throws Exception { return field(object.getClass(),value(alias)).get(object); }
    private static Object constant(String classAlias, String fieldAlias) throws Exception { return field(type(classAlias),value(fieldAlias)).get(null); }
    private static Object invoke(Object target, String alias, Object... arguments) throws Exception {
        Class<?> owner = target instanceof Class ? (Class<?>)target : target.getClass();
        for (Class<?> c=owner;c!=null;c=c.getSuperclass()) outer: for (Method method:c.getDeclaredMethods()) {
            if (!method.getName().equals(value(alias)) || method.getParameterTypes().length!=arguments.length) continue;
            Class<?>[] parameters=method.getParameterTypes();
            for(int i=0;i<parameters.length;i++) {
                Class<?> p=parameters[i]; if(p==int.class)p=Integer.class; if(p==double.class)p=Double.class; if(p==float.class)p=Float.class; if(p==boolean.class)p=Boolean.class;
                if(arguments[i]!=null&&!p.isInstance(arguments[i]))continue outer;
            }
            method.setAccessible(true);
            try { return method.invoke(target instanceof Class?null:target,arguments); }
            catch(InvocationTargetException error) { throw new Exception(alias,error.getCause()); }
        }
        throw new NoSuchMethodException(owner.getName()+"."+alias);
    }
    private static void progress(String message) { System.out.println("NBSX_CAPTURE "+message); }
    public static void premain(String arguments, Instrumentation instrumentation) throws Exception {
        config=new Properties();try(Reader in=new InputStreamReader(new FileInputStream(arguments),"UTF-8")){config.load(in);}
        scenes=new int[Integer.parseInt(value("caseLimit"))][][];
        for(int i=0;i<scenes.length;i++){String[] notes=value("scene."+i).split(";");scenes[i]=new int[notes.length][4];for(int n=0;n<notes.length;n++){String[] numbers=notes[n].split(",");for(int j=0;j<4;j++)scenes[i][n][j]=Integer.parseInt(numbers[j]);}}
        instrumentation.addTransformer(new ClassFileTransformer(){
            public byte[] transform(ClassLoader loader,String name,Class<?> redef,ProtectionDomain domain,byte[] bytes){
                if(!Arrays.asList(value("minecraft"),value("library"),value("channel"),value("noteBlock"),value("window")).contains(name.replace('/','.')))return null;
                ClassReader reader=new ClassReader(bytes);ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);
                reader.accept(new ClassVisitor(Opcodes.ASM9,writer){
                    public MethodVisitor visitMethod(int access,String method,String descriptor,String signature,String[] exceptions){
                        MethodVisitor delegate=super.visitMethod(access,method,descriptor,signature,exceptions);
                        if(name.equals(value("library"))&&method.equals(value("openDevice"))&&descriptor.equals("()J")){
                            delegate.visitCode();delegate.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/WorldCapture119","openDevice","()J",false);delegate.visitInsn(Opcodes.LRETURN);delegate.visitMaxs(2,0);delegate.visitEnd();return null;
                        }
                        return new MethodVisitor(Opcodes.ASM9,delegate){
                            public void visitCode(){super.visitCode();if(name.equals(value("library"))&&method.equals(value("libraryInit"))&&descriptor.equals("(Ljava/lang/String;Z)V")){super.visitVarInsn(Opcodes.ILOAD,2);super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/WorldCapture119","libraryRequested","(Z)V",false);}if(name.equals(value("minecraft"))&&method.equals(value("tick"))&&descriptor.equals("(Z)V")){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/WorldCapture119","tick","(Ljava/lang/Object;)V",false);}
                                if(name.equals(value("noteBlock"))&&method.equals(value("noteEvent"))&&descriptor.endsWith(";II)Z")){super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/WorldCapture119","noteEvent","()V",false);}}
                            public void visitMethodInsn(int opcode,String owner,String called,String desc,boolean itf){
                                if(name.equals(value("library"))&&owner.equals("org/lwjgl/openal/SOFTHRTF")&&called.equals("alcResetDeviceSOFT")&&desc.equals("(JLjava/nio/IntBuffer;)Z")){super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/WorldCapture119","resetDevice",desc,false);return;}
                                if(name.equals(value("library"))&&owner.equals("org/lwjgl/openal/ALC10")&&called.equals("alcOpenDevice")&&(desc.equals("(Ljava/lang/CharSequence;)J")||desc.equals("(Ljava/nio/ByteBuffer;)J"))){if(Boolean.parseBoolean(value("regularDevice"))&&desc.equals("(Ljava/lang/CharSequence;)J"))super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/WorldCapture119","openRegularDevice",desc,false);else{super.visitInsn(Opcodes.POP);super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/WorldCapture119","openDevice","()J",false);}return;}
                                if(name.equals(value("library"))&&owner.equals("org/lwjgl/openal/ALC10")&&called.equals("alcCreateContext")&&desc.equals("(JLjava/nio/IntBuffer;)J")){super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/WorldCapture119","createContext",desc,false);return;}
                                if(name.equals(value("window"))&&owner.equals("org/lwjgl/glfw/GLFW")&&called.equals("glfwCreateWindow")){super.visitLdcInsn(0x20004);super.visitInsn(Opcodes.ICONST_0);super.visitMethodInsn(Opcodes.INVOKESTATIC,"org/lwjgl/glfw/GLFW","glfwWindowHint","(II)V",false);}
                                super.visitMethodInsn(opcode,owner,called,desc,itf);
                            }
                            public void visitInsn(int opcode){if(name.equals(value("channel"))&&method.equals(value("channelPlay"))&&descriptor.equals("()V")&&opcode==Opcodes.RETURN){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/WorldCapture119","channelPlayed","(Ljava/lang/Object;)V",false);}super.visitInsn(opcode);}
                        };
                    }
                },0);return writer.toByteArray();
            }
        });
        progress("agent-ready");
    }
    public static long openDevice(){device=SOFTLoopback.alcLoopbackOpenDeviceSOFT((ByteBuffer)null);progress("loopback-device "+device);return device;}
    public static long openRegularDevice(CharSequence name){device=ALC10.alcOpenDevice(name);progress("regular-device-no-audio "+device);return device;}
    public static void libraryRequested(boolean requested){gameHrtfRequested=requested;progress("original-library-request "+requested);}
    private static LinkedHashMap<Integer,Integer> readAttributes(IntBuffer original){LinkedHashMap<Integer,Integer> result=new LinkedHashMap<Integer,Integer>();if(original!=null){IntBuffer buffer=original.duplicate();while(buffer.hasRemaining()){int key=buffer.get();if(key==0)break;if(!buffer.hasRemaining())throw new IllegalStateException("Incomplete original attributes");result.put(key,buffer.get());}}return result;}
    private static int[] loopbackAttributes(LinkedHashMap<Integer,Integer> attributes){attributes.put(0x1990,0x1501);attributes.put(0x1991,0x1406);attributes.put(0x1007,48000);int[] values=new int[attributes.size()*2+1];int at=0;for(Map.Entry<Integer,Integer> entry:attributes.entrySet()){values[at++]=entry.getKey();values[at++]=entry.getValue();}return values;}
    public static boolean resetDevice(long originalDevice,IntBuffer original){
        resetCalls++;LinkedHashMap<Integer,Integer> attributes=readAttributes(original);originalResetAttributes=attributes.toString();
        boolean result;if(Boolean.parseBoolean(value("regularDevice"))){captureResetAttributes=attributes.toString();result=SOFTHRTF.alcResetDeviceSOFT(originalDevice,original);}else{int[] merged=loopbackAttributes(attributes);captureResetAttributes=attributes.toString();result=SOFTHRTF.alcResetDeviceSOFT(originalDevice,merged);}
        resetStatusBeforeContext=ALC10.alcGetInteger(originalDevice,SOFTHRTF.ALC_HRTF_STATUS_SOFT);resetResult=Boolean.toString(result);progress("original-reset "+originalResetAttributes+" actual="+result);return result;
    }
    public static long createContext(long originalDevice,IntBuffer original){
        LinkedHashMap<Integer,Integer> attributes=readAttributes(original);
        originalContextAttributes=attributes.toString();
        if(Boolean.parseBoolean(value("regularDevice"))){captureContextAttributes=originalContextAttributes;return ALC10.alcCreateContext(originalDevice,original);}
        // Original regular-device reset survives null context. Loopback format changes
        // reset that state, so replay only the actually observed original enable/profile request.
        if(Boolean.parseBoolean(value("replayHrtfReset"))&&resetCalls>0&&gameHrtfRequested&&Boolean.parseBoolean(resetResult)){attributes.put(6546,1);attributes.put(6550,0);}
        attributes.put(0x1990,0x1501);attributes.put(0x1991,0x1406);attributes.put(0x1007,48000);
        captureContextAttributes=attributes.toString();int[] values=new int[attributes.size()*2+1];int at=0;for(Map.Entry<Integer,Integer> entry:attributes.entrySet()){values[at++]=entry.getKey();values[at++]=entry.getValue();}
        return ALC10.alcCreateContext(originalDevice,values);
    }
    private static void contextFacts(Properties record){
        record.setProperty("contextHrtfAdaptation",Boolean.parseBoolean(value("replayHrtfReset"))&&gameHrtfRequested?"original-reset-request-replayed-at-loopback-context-creation":"none");record.setProperty("gameHrtfRequested",Boolean.toString(gameHrtfRequested));record.setProperty("originalResetCalls",Integer.toString(resetCalls));record.setProperty("originalResetAttributes",originalResetAttributes);record.setProperty("captureResetAttributes",captureResetAttributes);record.setProperty("originalResetResult",resetResult);
        record.setProperty("resetHrtfStatusBeforeContext",Integer.toString(resetStatusBeforeContext));record.setProperty("deviceKind",Boolean.parseBoolean(value("regularDevice"))?"original-regular-device-no-audio-played":"loopback-original-reset-replay-adapter");record.setProperty("backend",String.valueOf(AL10.alGetString(AL10.AL_VERSION)));record.setProperty("contextSampleRate",Integer.toString(ALC10.alcGetInteger(device,0x1007)));record.setProperty("requestedHrtfProfileIndex",gameHrtfRequested?"0":"device-default");
        record.setProperty("originalContextAttributes",originalContextAttributes);record.setProperty("captureContextAttributes",captureContextAttributes);
        int count=ALC10.alcGetInteger(device,SOFTHRTF.ALC_NUM_HRTF_SPECIFIERS_SOFT),status=ALC10.alcGetInteger(device,SOFTHRTF.ALC_HRTF_STATUS_SOFT);record.setProperty("hrtfProfileCount",Integer.toString(count));record.setProperty("hrtfStatus",Integer.toString(status));record.setProperty("hrtfEnabled",Integer.toString(ALC10.alcGetInteger(device,SOFTHRTF.ALC_HRTF_SOFT)));
        for(int i=0;i<count;i++)record.setProperty("hrtfProfile."+i,String.valueOf(SOFTHRTF.alcGetStringiSOFT(device,SOFTHRTF.ALC_HRTF_SPECIFIER_SOFT,i)));
        if(ALC10.alcGetInteger(device,SOFTHRTF.ALC_HRTF_SOFT)!=0)record.setProperty("selectedHrtfProfile",String.valueOf(ALC10.alcGetString(device,SOFTHRTF.ALC_HRTF_SPECIFIER_SOFT)));
        record.setProperty("outputLimiterAvailable",Boolean.toString(ALC10.alcIsExtensionPresent(device,"ALC_SOFT_output_limiter")));if(ALC10.alcIsExtensionPresent(device,"ALC_SOFT_output_limiter"))record.setProperty("outputLimiter",Integer.toString(ALC10.alcGetInteger(device,0x199A)));
        if(!gameHrtfRequested&&resetCalls!=0)throw new IllegalStateException("Original off path unexpectedly reset HRTF");
        if(gameHrtfRequested&&count>0&&(resetCalls!=1||!originalResetAttributes.equals("{6546=1, 6550=0}")))throw new IllegalStateException("Original on path did not request HRTF profile 0");
        // The backend may substitute a profile at a different device rate. Keep
        // the original request and actual selection as separate observations.
    }
    public static void main(String[] args)throws Exception{
        Object original=type("library").getConstructor().newInstance();invoke(original,"libraryInit",null,Boolean.valueOf(value("hrtf")));Properties record=new Properties();contextFacts(record);record.setProperty("actualDeviceName",String.valueOf(invoke(original,"libraryDeviceName")));record.setProperty("evidence","actual-original-Library-invocation; not a world recording");
        try(Writer out=new OutputStreamWriter(new FileOutputStream(Paths.get(value("output"),"context-probe.properties").toFile()),"UTF-8")){record.store(out,"Original Java 1.19 Library context semantics");}
        progress("context-probe "+record);invoke(original,"libraryCleanup");
    }
    public static void noteEvent(){if(pending)noteEvents++;}
    public static void tick(Object minecraft){
        if(done)return;
        try{
            if(!creating){if(invoke(minecraft,"overlay")!=null||device==0)return;creating=true;progress("creating-isolated-world");
                Object settings=type("levelSettings").getConstructors()[0].newInstance("NBSX audio verification",constant("gameType","creative"),false,constant("difficulty","peaceful"),true,type("gameRules").getConstructor().newInstance(),constant("dataPackConfig","defaultDataPack"));
                if(value("worldOptions")!=null){
                    Function<Object,Object> dimensions=registry->{try{return invoke(type("worldPresets"),"normalDimensions",registry);}catch(Exception error){throw new RuntimeException(error);}};
                    if(value("freshLevelWithoutScreen")!=null)invoke(invoke(minecraft,"worldFlows"),"createFreshLevel",value("worldName"),settings,constant("worldOptions","demoOptions"),dimensions);
                    else invoke(invoke(minecraft,"worldFlows"),"createFreshLevel",value("worldName"),settings,constant("worldOptions","demoOptions"),dimensions,null);
                }else{
                    Object registry=invoke(type("registryAccess"),"builtin");Object generation=invoke(type("worldGen"),"demoGeneration",registry);
                    if(value("worldFlows")!=null)invoke(invoke(minecraft,"worldFlows"),"createFreshLevel",value("worldName"),settings,registry,generation);
                    else invoke(minecraft,"createLevel",value("worldName"),settings,registry,generation);
                }return;
            }
            Object player=get(minecraft,"player");Object server=invoke(minecraft,"server");if(player==null||server==null)return;
            invoke(player,"noGravity",true);invoke(player,"moveTo",.5,80.0,2.5,180f,0f);
            if(!prepared){readActualOptions(minecraft);prepared=true;readyAt=System.nanoTime()+5000000000L;progress("world-ready");invoke(server,"execute",(Runnable)()->{try{
                    List<?> players=(List<?>)invoke(invoke(server,"playerList"),"players");for(Object p:players){invoke(p,"noGravity",true);invoke(get(p,"connection"),"teleport",.5,80.0,2.5,180f,0f);}
                }catch(Exception error){fail(error);}});return;}
            if(index>=scenes.length){done=true;progress("complete");Files.write(Paths.get(value("output"),"complete.txt"),"real-client-world-note-events".getBytes("UTF-8"));invoke(minecraft,"stop");return;}
            if(pending){if(System.nanoTime()>noteDeadline)captureMissing();return;}
            if(System.nanoTime()<readyAt)return;
            voices.clear();placed.clear();noteEvents=0;noteDeadline=System.nanoTime()+8000000000L;pending=true;final int current=index;progress("trigger-case "+current+" voices="+scenes[current].length);
            invoke(server,"execute",(Runnable)()->{try{Object level=invoke(server,"overworld");for(int[] c:scenes[current]){Object note=constant("blocks","noteBlockConstant");Object air=invoke(constant("blocks","air"),"defaultState");Object base=invoke(constant("blocks","base."+c[3]),"defaultState");
                    Object position=type("blockPos").getConstructor(int.class,int.class,int.class).newInstance(c[0],81+c[1],0);
                    Object above=type("blockPos").getConstructor(int.class,int.class,int.class).newInstance(c[0],82+c[1],0);Object below=type("blockPos").getConstructor(int.class,int.class,int.class).newInstance(c[0],80+c[1],0);
                    invoke(level,"setBlock",above,air,3);invoke(level,"setBlock",below,base,3);Object state=invoke(note,"defaultState");state=invoke(state,"setValue",constant("noteBlock","noteProperty"),Integer.valueOf(c[2]));
                    state=value("setInstrument")!=null?invoke(note,"setInstrument",level,position,state):invoke(state,"setValue",constant("noteBlock","instrumentProperty"),invoke(type("instrumentType"),"instrumentByState",base));String selected=(String)invoke(invoke(state,"getValue",constant("noteBlock","instrumentProperty")),"instrumentName");if(!selected.equals(value("instrument."+c[3])))throw new IllegalStateException("Original material selected "+selected+" instead of "+value("instrument."+c[3]));placed.setProperty("placed."+placed.size()+".instrument",selected);invoke(level,"setBlock",position,state,3);
                    invoke(level,"blockEvent",position,note,0,0);
                }}catch(Exception error){fail(error);}});
        }catch(Exception error){fail(error);}
    }
    public static synchronized void channelPlayed(Object channel){
        if(!pending||done)return;
        try{
            if(noteEvents==0)throw new IllegalStateException("Sound played without a note-block event");
            int source=field(channel.getClass(),value("sourceId")).getInt(channel);Properties record=new Properties();
            float[] position=new float[3],listener=new float[3],orientation=new float[6];AL10.alGetSourcefv(source,0x1004,position);AL10.alGetListenerfv(0x1004,listener);AL10.alGetListenerfv(0x100F,orientation);
            for(int i=0;i<3;i++){record.setProperty("source."+i,Float.toString(position[i]));record.setProperty("listener."+i,Float.toString(listener[i]));}
            for(int i=0;i<6;i++)record.setProperty("orientation."+i,Float.toString(orientation[i]));
            record.setProperty("pitch",Float.toString(AL10.alGetSourcef(source,0x1003)));record.setProperty("gain",Float.toString(AL10.alGetSourcef(source,0x100A)));record.setProperty("range",Float.toString(AL10.alGetSourcef(source,0x1023)));record.setProperty("noteEvents",Integer.toString(noteEvents));
            record.setProperty("listenerGain",Float.toString(AL10.alGetListenerf(0x100A)));
            record.setProperty("sourceId",Integer.toString(source));
            boolean matched=false;for(int[] note:scenes[index])if(Math.abs(position[0]-(note[0]+.5))<.0001&&Math.abs(position[1]-(81.5+note[1]))<.0001&&Math.abs(position[2]-.5)<.0001){record.setProperty("instrument",value("instrument."+note[3]));record.setProperty("note",Integer.toString(note[2]));matched=true;break;}
            if(!matched)throw new IllegalStateException("Unexpected sound source in isolated note-block scene");
            record.setProperty("backend",AL10.alGetString(AL10.AL_VERSION));record.setProperty("evidence","actual-integrated-world-note-block-event");
            voices.add(record);if(voices.size()<expectedSources())return;
            if(voices.size()!=expectedSources())throw new IllegalStateException("Too many original sound sources");
            record=new Properties();record.setProperty("delivery","played");saveCapture(record);
        }catch(Exception error){fail(error);}
    }
    private static synchronized void captureMissing(){
        if(!pending||done)return;
        try{
            if(noteEvents==0)throw new IllegalStateException("No real note-block event before capture deadline");
            if(expectedSources()!=0||!voices.isEmpty())throw new IllegalStateException("Only "+voices.size()+" of "+expectedSources()+" expected original sources played");
            Properties record=new Properties();record.setProperty("delivery","no-source-observed");record.setProperty("noteEvents",Integer.toString(noteEvents));record.setProperty("evidence","actual-integrated-world-note-block-event");
            int[] current=scenes[index][0];record.setProperty("block.x",Integer.toString(current[0]));record.setProperty("block.y",Integer.toString(81+current[1]));record.setProperty("block.z","0");saveCapture(record);
        }catch(Exception error){fail(error);}
    }
    private static void readActualOptions(Object minecraft)throws Exception{
        Object options=get(minecraft,"options");boolean directional=(Boolean)invoke(invoke(options,"directionalOption"),"optionGet");actualOptions.setProperty("options.directionalAudio",Boolean.toString(directional));if(directional!=gameHrtfRequested)throw new IllegalStateException("Original Options/library HRTF request disagrees");
        for(String category:new String[]{"Master","Records","Blocks"})actualOptions.setProperty("options."+category.toLowerCase(Locale.ROOT),String.valueOf(invoke(options,"optionVolume",constant("soundSource","source"+category))));
        for(String category:new String[]{"master","records"})if(Math.abs(Double.parseDouble(actualOptions.getProperty("options."+category))-Double.parseDouble(value(category)))>0.000001)throw new IllegalStateException("Original Options did not load requested "+category+": "+actualOptions);
        if(Double.parseDouble(actualOptions.getProperty("options.blocks"))!=0)throw new IllegalStateException("Background block category was not muted");
        try(Writer out=new OutputStreamWriter(new FileOutputStream(Paths.get(value("output"),"actual-options.properties").toFile()),"UTF-8")){actualOptions.store(out,"Read from original client Options");}progress("actual-options "+actualOptions);
    }
    private static float[] currentListener(){float[] position=new float[3],orientation=new float[6],result=new float[10];AL10.alGetListenerfv(0x1004,position);AL10.alGetListenerfv(0x100F,orientation);System.arraycopy(position,0,result,0,3);System.arraycopy(orientation,0,result,3,6);result[9]=AL10.alGetListenerf(0x100A);return result;}
    private static void saveCapture(Properties record)throws Exception{
            if(!voices.isEmpty())record.putAll(voices.get(0));record.putAll(actualOptions);record.putAll(placed);float[] captureListener=currentListener();for(int i=0;i<3;i++)record.setProperty("listener."+i,Float.toString(captureListener[i]));for(int i=0;i<6;i++)record.setProperty("orientation."+i,Float.toString(captureListener[3+i]));record.setProperty("listenerGain",Float.toString(captureListener[9]));record.setProperty("listenerObservation","capture-start-al-observation");
            record.setProperty("delivery",voices.isEmpty()?"no-source-observed":"played");record.setProperty("noteEvents",Integer.toString(noteEvents));record.setProperty("voiceCount",Integer.toString(voices.size()));record.setProperty("expectedSources",Integer.toString(expectedSources()));
            record.setProperty("scene",value("sceneName."+index));
            record.setProperty("originalContextAttributes",originalContextAttributes);record.setProperty("captureContextAttributes",captureContextAttributes);
            boolean limiterAvailable=ALC10.alcIsExtensionPresent(device,"ALC_SOFT_output_limiter");record.setProperty("outputLimiterAvailable",Boolean.toString(limiterAvailable));
            if(limiterAvailable)record.setProperty("outputLimiter",Integer.toString(ALC10.alcGetInteger(device,0x199A)));
            contextFacts(record);
            for(int i=0;i<voices.size();i++)for(String key:voices.get(i).stringPropertyNames())record.setProperty("voice."+i+"."+key,voices.get(i).getProperty(key));
            int stabilityChecks=1;float[] samples=new float[288000];for(int cursor=0;cursor<144000;){int frames=Math.min(1024,144000-cursor);float[] block=new float[frames*2];SOFTLoopback.alcRenderSamplesSOFT(device,block,frames);if(!Arrays.equals(captureListener,currentListener()))throw new IllegalStateException("AL listener moved during recorded mixer blocks");stabilityChecks++;System.arraycopy(block,0,samples,cursor*2,block.length);cursor+=frames;}
            record.setProperty("listenerStableAcrossBlocks","true");record.setProperty("listenerStabilityChecks",Integer.toString(stabilityChecks));Path output=Paths.get(value("output"));Files.createDirectories(output);
            try(DataOutputStream out=new DataOutputStream(new BufferedOutputStream(new FileOutputStream(output.resolve("case-"+index+".pcm").toFile())))){for(float input:samples){double sample=Math.max(-1,Math.min(1,(double)input));int pcm=(int)Math.round(sample*(sample<0?32768:32767));out.writeByte(pcm&255);out.writeByte((pcm>>>8)&255);}}
            try(Writer out=new OutputStreamWriter(new FileOutputStream(output.resolve("case-"+index+".properties").toFile()),"UTF-8")){record.store(out,"Original real game capture");}
            progress("captured-case "+index+" noteEvents="+noteEvents);index++;pending=false;readyAt=System.nanoTime()+1500000000L;
    }
    private static void fail(Throwable error){done=true;error.printStackTrace();try{Files.write(Paths.get(value("output"),"failure.txt"),error.toString().getBytes("UTF-8"));}catch(Exception ignored){}Runtime.getRuntime().halt(2);}
}
