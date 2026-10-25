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

/** Independent 1.21.8/1.21.9 volume-boundary mapped adapter: original options, context HRTF/profile/limiter, and world note-block events. */
public final class VolumeBoundaryWorldAgent {
    private static Properties config;
    private static volatile long device;
    private static volatile Object activeMinecraft;
    private static volatile boolean creating, prepared, pending, done;
    private static volatile int index, noteEvents;
    private static long readyAt;
    private static volatile long noteDeadline;
    private static int[][][] scenes;
    private static String originalContextAttributes="[]", captureContextAttributes="[]";
    private static final List<Properties> voices=new ArrayList<Properties>();
    private static final Properties actualOptions=new Properties(), placed=new Properties();
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
                            delegate.visitCode();delegate.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/VolumeBoundaryWorldAgent","openDevice","()J",false);delegate.visitInsn(Opcodes.LRETURN);delegate.visitMaxs(2,0);delegate.visitEnd();return null;
                        }
                        return new MethodVisitor(Opcodes.ASM9,delegate){
                            public void visitCode(){super.visitCode();if(name.equals(value("minecraft"))&&method.equals(value("tick"))&&descriptor.equals("(Z)V")){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/VolumeBoundaryWorldAgent","tick","(Ljava/lang/Object;)V",false);}
                                if(name.equals(value("noteBlock"))&&method.equals(value("noteEvent"))&&descriptor.endsWith(";II)Z")){super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/VolumeBoundaryWorldAgent","noteEvent","()V",false);}}
                            public void visitMethodInsn(int opcode,String owner,String called,String desc,boolean itf){
                                if(name.equals(value("library"))&&owner.equals("org/lwjgl/openal/ALC10")&&called.equals("alcOpenDevice")&&(desc.equals("(Ljava/lang/CharSequence;)J")||desc.equals("(Ljava/nio/ByteBuffer;)J"))){super.visitInsn(Opcodes.POP);super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/VolumeBoundaryWorldAgent","openDevice","()J",false);return;}
                                if(name.equals(value("library"))&&owner.equals("org/lwjgl/openal/ALC10")&&called.equals("alcCreateContext")&&desc.equals("(JLjava/nio/IntBuffer;)J")){super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/VolumeBoundaryWorldAgent","createContext",desc,false);return;}
                                if(name.equals(value("window"))&&owner.equals("org/lwjgl/glfw/GLFW")&&called.equals("glfwCreateWindow")){super.visitLdcInsn(0x20004);super.visitInsn(Opcodes.ICONST_0);super.visitMethodInsn(Opcodes.INVOKESTATIC,"org/lwjgl/glfw/GLFW","glfwWindowHint","(II)V",false);}
                                super.visitMethodInsn(opcode,owner,called,desc,itf);
                            }
                            public void visitInsn(int opcode){if(name.equals(value("channel"))&&method.equals(value("channelPlay"))&&descriptor.equals("()V")&&opcode==Opcodes.RETURN){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/VolumeBoundaryWorldAgent","channelPlayed","(Ljava/lang/Object;)V",false);}super.visitInsn(opcode);}
                        };
                    }
                },0);return writer.toByteArray();
            }
        });
        progress("agent-ready");
    }
    public static long openDevice(){device=SOFTLoopback.alcLoopbackOpenDeviceSOFT((ByteBuffer)null);progress("loopback-device "+device);return device;}
    public static long createContext(long originalDevice,IntBuffer original){
        LinkedHashMap<Integer,Integer> attributes=new LinkedHashMap<Integer,Integer>();
        if(original!=null){IntBuffer buffer=original.duplicate();while(buffer.hasRemaining()){int key=buffer.get();if(key==0)break;if(!buffer.hasRemaining())throw new IllegalStateException("Incomplete original context attribute");attributes.put(key,buffer.get());}}
        originalContextAttributes=attributes.toString();
        if(!Integer.valueOf(Boolean.parseBoolean(value("hrtf"))?1:0).equals(attributes.get(0x1992))||!Integer.valueOf(0).equals(attributes.get(0x1996))||!Integer.valueOf(1).equals(attributes.get(0x199A)))throw new IllegalStateException("Original 1.21.8/1.21.9 volume-boundary HRTF/profile/limiter request differs: "+attributes);
        attributes.put(0x1990,0x1501);attributes.put(0x1991,0x1406);attributes.put(0x1007,48000);
        captureContextAttributes=attributes.toString();int[] values=new int[attributes.size()*2+1];int at=0;for(Map.Entry<Integer,Integer> entry:attributes.entrySet()){values[at++]=entry.getKey();values[at++]=entry.getValue();}
        return ALC10.alcCreateContext(originalDevice,values);
    }
    private static void checkAlc(String operation){int error=ALC10.alcGetError(device);if(error!=0)throw new IllegalStateException(operation+" ALC error="+error);}
    private static void readOptions(Object minecraft)throws Exception{
        Object options=get(minecraft,"options");
        for(String category:new String[]{"Master","Records","Blocks"}){
            float actual=((Number)invoke(options,"optionVolume",constant("soundSource","source"+category))).floatValue();
            actualOptions.setProperty("options."+category.toLowerCase(Locale.ROOT),Float.toString(actual));
        }
        boolean directional=Boolean.TRUE.equals(invoke(invoke(options,"optionDirectional"),"optionGet"));
        actualOptions.setProperty("options.directionalAudio",Boolean.toString(directional));
        if(directional!=Boolean.parseBoolean(value("hrtf")))throw new IllegalStateException("Original directionalAudio option did not load");
        for(String category:new String[]{"master","records"})if(Math.abs(Double.parseDouble(actualOptions.getProperty("options."+category))-Double.parseDouble(value(category)))>0.000001)throw new IllegalStateException("Original option differs: "+category);
        if(Double.parseDouble(actualOptions.getProperty("options.blocks"))!=0)throw new IllegalStateException("Background block sounds not muted");
        try(Writer out=new OutputStreamWriter(new FileOutputStream(Paths.get(value("output"),"actual-options.properties").toFile()),"UTF-8")){actualOptions.store(out,"Actual original 1.21.8/1.21.9 volume-boundary options");}
    }
    public static void noteEvent(){if(pending)noteEvents++;}
    public static void tick(Object minecraft){
        activeMinecraft=minecraft;
        if(done)return;
        try{
            if(!creating){if(!Boolean.TRUE.equals(invoke(minecraft,"loaded"))||device==0)return;readOptions(minecraft);creating=true;progress("creating-isolated-world");
                Object dataConfig=constant("dataPackConfig","defaultDataPack");
                Object rules=type("gameRules").getConstructor(type("featureFlagSet")).newInstance(invoke(dataConfig,"enabledFeatures"));
                Object settings=type("levelSettings").getConstructors()[0].newInstance("NBSX audio verification",constant("gameType","creative"),false,constant("difficulty","peaceful"),true,rules,dataConfig);
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
            if(!prepared){prepared=true;readyAt=System.nanoTime()+5000000000L;progress("world-ready");invoke(server,"execute",(Runnable)()->{try{
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
                    state=value("setInstrument")!=null?invoke(note,"setInstrument",level,position,state):invoke(state,"setValue",constant("noteBlock","instrumentProperty"),invoke(type("instrumentType"),"instrumentByState",base));String selected=(String)invoke(invoke(state,"getValue",constant("noteBlock","instrumentProperty")),"instrumentName");if(!selected.equals(value("instrument."+c[3])))throw new IllegalStateException("Original material selected "+selected+" instead of "+value("instrument."+c[3]));placed.setProperty("placed."+c[0]+"."+c[1]+".instrument",selected);invoke(level,"setBlock",position,state,3);
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
    private static String cameraPose()throws Exception {
        Object camera=invoke(get(activeMinecraft,"gameRenderer"),"mainCamera"),position=invoke(camera,"cameraPosition");
        return field(position.getClass(),value("vecX")).getDouble(position)+","+field(position.getClass(),value("vecY")).getDouble(position)+","+field(position.getClass(),value("vecZ")).getDouble(position)+","+invoke(camera,"cameraYaw")+","+invoke(camera,"cameraPitch");
    }
    private static String listenerPose(){float[] pos=new float[3],orientation=new float[6];AL10.alGetListenerfv(0x1004,pos);AL10.alGetListenerfv(0x100F,orientation);return Arrays.toString(pos)+";"+Arrays.toString(orientation);}
    private static void saveCapture(Properties record)throws Exception{
            if(!voices.isEmpty())record.putAll(voices.get(0));
            record.setProperty("delivery",voices.isEmpty()?"no-source-observed":"played");record.setProperty("noteEvents",Integer.toString(noteEvents));record.setProperty("voiceCount",Integer.toString(voices.size()));record.setProperty("expectedSources",Integer.toString(expectedSources()));
            record.setProperty("scene",value("sceneName."+index));record.putAll(actualOptions);record.putAll(placed);
            record.setProperty("originalContextAttributes",originalContextAttributes);record.setProperty("captureContextAttributes",captureContextAttributes);
            boolean limiterAvailable=ALC10.alcIsExtensionPresent(device,"ALC_SOFT_output_limiter");record.setProperty("outputLimiterAvailable",Boolean.toString(limiterAvailable));
            if(limiterAvailable)record.setProperty("outputLimiter",Integer.toString(ALC10.alcGetInteger(device,0x199A)));
            checkAlc("limiter query");
            int hrtf=ALC10.alcGetInteger(device,SOFTHRTF.ALC_HRTF_STATUS_SOFT);checkAlc("HRTF status query");record.setProperty("hrtfStatus",Integer.toString(hrtf));
            int enabled=ALC10.alcGetInteger(device,SOFTHRTF.ALC_HRTF_SOFT);checkAlc("HRTF enabled query");record.setProperty("hrtfEnabled",Integer.toString(enabled));
            int count=ALC10.alcGetInteger(device,SOFTHRTF.ALC_NUM_HRTF_SPECIFIERS_SOFT);checkAlc("HRTF enumeration query");record.setProperty("hrtfProfileCount",Integer.toString(count));
            if(count<=0)throw new IllegalStateException("Expected original available HRTF profiles");
            String firstProfile=SOFTHRTF.alcGetStringiSOFT(device,SOFTHRTF.ALC_HRTF_SPECIFIER_SOFT,0);checkAlc("HRTF profile zero query");record.setProperty("hrtfProfileZero",firstProfile);
            String profile=ALC10.alcGetString(device,SOFTHRTF.ALC_HRTF_SPECIFIER_SOFT);checkAlc("Actual HRTF profile query");record.setProperty("hrtfProfile",profile==null?"":profile);
            if(enabled!=(Boolean.parseBoolean(value("hrtf"))?1:0))throw new IllegalStateException("Actual HRTF enabled state differs: "+enabled);
            if(enabled!=0&&!firstProfile.equals(profile))throw new IllegalStateException("Original profile zero was not applied: "+profile+" vs "+firstProfile);
            if(!"1".equals(record.getProperty("outputLimiter")))throw new IllegalStateException("Original explicit limiter was not applied");
            if((hrtf==SOFTHRTF.ALC_HRTF_ENABLED_SOFT)!=Boolean.parseBoolean(value("hrtf")))throw new IllegalStateException("Requested HRTF state was not applied: "+hrtf);
            for(int i=0;i<voices.size();i++)for(String key:voices.get(i).stringPropertyNames())record.setProperty("voice."+i+"."+key,voices.get(i).getProperty(key));
            String initialCamera=cameraPose(),initialListener=listenerPose();int cameraSamples=1;
            record.setProperty("cameraAtCapture",initialCamera);record.setProperty("listenerAtCapture",initialListener);
            int[] attributes=new int[ALC10.alcGetInteger(device,0x1002)];ALC10.alcGetIntegerv(device,0x1003,attributes);checkAlc("all context attributes");record.setProperty("actualContextAttributes",Arrays.toString(attributes));
            float[] samples=new float[288000];for(int cursor=0;cursor<144000;){
                if(!initialCamera.equals(cameraPose())||!initialListener.equals(listenerPose()))throw new IllegalStateException("Camera/listener moved during capture block "+cursor);cameraSamples++;int frames=Math.min(1024,144000-cursor);float[] block=new float[frames*2];SOFTLoopback.alcRenderSamplesSOFT(device,block,frames);System.arraycopy(block,0,samples,cursor*2,block.length);cursor+=frames;}
            if(!initialCamera.equals(cameraPose())||!initialListener.equals(listenerPose()))throw new IllegalStateException("Camera/listener moved at capture end");cameraSamples++;
            record.setProperty("cameraSamples",Integer.toString(cameraSamples));record.setProperty("cameraStable","true");
            Path output=Paths.get(value("output"));Files.createDirectories(output);
            try(DataOutputStream out=new DataOutputStream(new BufferedOutputStream(new FileOutputStream(output.resolve("case-"+index+".pcm").toFile())))){for(float input:samples){double sample=Math.max(-1,Math.min(1,(double)input));int pcm=(int)Math.round(sample*(sample<0?32768:32767));out.writeByte(pcm&255);out.writeByte((pcm>>>8)&255);}}
            try(Writer out=new OutputStreamWriter(new FileOutputStream(output.resolve("case-"+index+".properties").toFile()),"UTF-8")){record.store(out,"Original real game capture");}
            progress("captured-case "+index+" noteEvents="+noteEvents);index++;pending=false;readyAt=System.nanoTime()+1500000000L;
    }
    private static void fail(Throwable error){done=true;error.printStackTrace();try{Files.write(Paths.get(value("output"),"failure.txt"),error.toString().getBytes("UTF-8"));}catch(Exception ignored){}System.exit(2);}
}
