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
import org.lwjgl.openal.*;

/** Research-only 1.14 adapter: manually audited obfuscated client, real isolated world/block events and captured mixer.
 * Changes the output device to deterministic loopback and hides its GLFW window, not the sound algorithm. */
public final class EarlyWorldCaptureAgent {
    private static Properties config;
    private static volatile long device;
    private static volatile boolean creating, prepared, pending, done;
    private static volatile int index, noteEvents;
    private static long readyAt;
    private static volatile long noteDeadline;
    private static int[][][] scenes;
    private static String originalContextAttributes="[]", captureContextAttributes="[]";
    private static final List<Properties> voices=new ArrayList<Properties>();
    private static final Properties placed=new Properties();
    private static final Properties actualOptions=new Properties();
    private static int expectedSources(){if(Double.parseDouble(value("master"))<=0||Double.parseDouble(value("records"))<=0)return 0;int count=0;for(int[] note:scenes[index]){double x=note[0],y=1.5+note[1],z=-2;if(x*x+y*y+z*z<48*48)count++;}return count;}
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
    private static Object baseBlock(int instrument) throws Exception {
        Object block=constant("blocks","base."+instrument);

        return block;
    }
    private static void readOptions(Object minecraft) throws Exception {
        Object options=get(minecraft,"options");
        for(String category:new String[]{"Master","Records","Blocks"}) {
            float actual=((Number)invoke(options,"optionVolume",constant("soundSource","source"+category))).floatValue();
            actualOptions.setProperty("options."+category.toLowerCase(Locale.ROOT),Float.toString(actual));
        }

        try(Writer out=new OutputStreamWriter(new FileOutputStream(Paths.get(value("output"),"actual-options.properties").toFile()),"UTF-8")){actualOptions.store(out,"Read from original client Options, not requested fixture labels");}
        for(String category:new String[]{"master","records"})if(Math.abs(Double.parseDouble(actualOptions.getProperty("options."+category))-Double.parseDouble(value(category)))>0.000001)throw new IllegalStateException("Original Options did not load requested "+category+": "+actualOptions);
        if(Double.parseDouble(actualOptions.getProperty("options.blocks"))!=0)throw new IllegalStateException("Background block category was not muted: "+actualOptions);
        progress("actual-options "+actualOptions);
    }
    private static void progress(String message) { System.out.println("NBSX_CAPTURE "+message); }
    public static void premain(String arguments, Instrumentation instrumentation) throws Exception {
        config=new Properties();try(Reader in=new InputStreamReader(new FileInputStream(arguments),"UTF-8")){config.load(in);}
        scenes=new int[Integer.parseInt(value("caseLimit"))][][];
        for(int i=0;i<scenes.length;i++){String[] notes=value("scene."+i).split(";");scenes[i]=new int[notes.length][4];for(int n=0;n<notes.length;n++){String[] numbers=notes[n].split(",");for(int j=0;j<4;j++)scenes[i][n][j]=Integer.parseInt(numbers[j]);}}
        instrumentation.addTransformer(new ClassFileTransformer(){
            public byte[] transform(ClassLoader loader,String internalName,Class<?> redef,ProtectionDomain domain,byte[] bytes){
                final String name=internalName.replace('/','.');
                if(!Arrays.asList(value("minecraft"),value("library"),value("channel"),value("noteBlock"),value("window")).contains(name.replace('/','.')))return null;
                ClassReader reader=new ClassReader(bytes);ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);
                reader.accept(new ClassVisitor(Opcodes.ASM9,writer){
                    public MethodVisitor visitMethod(int access,String method,String descriptor,String signature,String[] exceptions){
                        MethodVisitor delegate=super.visitMethod(access,method,descriptor,signature,exceptions);
                        if(name.equals(value("library"))&&method.equals(value("openDevice"))&&descriptor.equals("()J")){
                            delegate.visitCode();delegate.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/EarlyWorldCaptureAgent","openDevice","()J",false);delegate.visitInsn(Opcodes.LRETURN);delegate.visitMaxs(2,0);delegate.visitEnd();return null;
                        }
                        return new MethodVisitor(Opcodes.ASM9,delegate){
                            public void visitCode(){super.visitCode();if(name.equals(value("minecraft"))&&method.equals(value("tick"))&&descriptor.equals("(Z)V")){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/EarlyWorldCaptureAgent","tick","(Ljava/lang/Object;)V",false);}
                                if(name.equals(value("noteBlock"))&&method.equals(value("noteEvent"))&&descriptor.endsWith(";II)Z")){super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/EarlyWorldCaptureAgent","noteEvent","()V",false);}}
                            public void visitMethodInsn(int opcode,String owner,String called,String desc,boolean itf){
                                if(name.equals(value("library"))&&owner.equals("org/lwjgl/openal/ALC10")&&called.equals("alcOpenDevice")&&(desc.equals("(Ljava/lang/CharSequence;)J")||desc.equals("(Ljava/nio/ByteBuffer;)J"))){super.visitInsn(Opcodes.POP);super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/EarlyWorldCaptureAgent","openDevice","()J",false);return;}
                                if(name.equals(value("library"))&&owner.equals("org/lwjgl/openal/ALC10")&&called.equals("alcCreateContext")&&desc.equals("(JLjava/nio/IntBuffer;)J")){super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/EarlyWorldCaptureAgent","createContext",desc,false);return;}
                                if(name.equals(value("window"))&&owner.equals("org/lwjgl/glfw/GLFW")&&called.equals("glfwCreateWindow")){super.visitLdcInsn(0x20004);super.visitInsn(Opcodes.ICONST_0);super.visitMethodInsn(Opcodes.INVOKESTATIC,"org/lwjgl/glfw/GLFW","glfwWindowHint","(II)V",false);}
                                super.visitMethodInsn(opcode,owner,called,desc,itf);
                            }
                            public void visitInsn(int opcode){if(name.equals(value("channel"))&&method.equals(value("channelPlay"))&&descriptor.equals("()V")&&opcode==Opcodes.RETURN){super.visitVarInsn(Opcodes.ALOAD,0);super.visitMethodInsn(Opcodes.INVOKESTATIC,"studio/nbsx/research/EarlyWorldCaptureAgent","channelPlayed","(Ljava/lang/Object;)V",false);}super.visitInsn(opcode);}
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
        attributes.put(0x1990,0x1501);attributes.put(0x1991,0x1406);attributes.put(0x1007,48000);attributes.put(SOFTHRTF.ALC_HRTF_SOFT,Boolean.parseBoolean(value("hrtf"))?1:0);
        captureContextAttributes=attributes.toString();int[] values=new int[attributes.size()*2+1];int at=0;for(Map.Entry<Integer,Integer> entry:attributes.entrySet()){values[at++]=entry.getKey();values[at++]=entry.getValue();}
        return ALC10.alcCreateContext(originalDevice,values);
    }
    public static void noteEvent(){if(pending)noteEvents++;}
    public static void tick(Object minecraft){
        if(done)return;
        try{
            if(!creating){if(get(minecraft,"overlay")!=null||device==0)return;readOptions(minecraft);for(int instrument=0;instrument<16;instrument++)baseBlock(instrument);creating=true;progress("creating-isolated-world");
                Object settings=type("levelSettings").getConstructor(long.class,type("gameType"),boolean.class,boolean.class,type("worldType")).newInstance(1L,constant("gameType","creative"),false,false,constant("worldType","flat"));
                invoke(settings,"allowCommands");invoke(minecraft,"createLevel",value("worldName"),"NBSX early audio verification",settings);return;
            }
            Object player=get(minecraft,"player");Object server=invoke(minecraft,"server");if(player==null||server==null)return;
            invoke(player,"noGravity",true);invoke(player,"moveTo",.5,80.0,2.5,180f,0f);
            if(!prepared){prepared=true;readyAt=System.nanoTime()+5000000000L;progress("world-ready");invoke(server,"execute",(Runnable)()->{try{
                    List<?> players=(List<?>)invoke(invoke(server,"overworld",constant("dimensionType","overworldDimension")),"players");for(Object p:players){invoke(p,"noGravity",true);invoke(p,"moveTo",.5,80.0,2.5,180f,0f);}
                }catch(Exception error){fail(error);}});return;}
            if(index>=scenes.length){done=true;progress("complete");Files.write(Paths.get(value("output"),"complete.txt"),"real-client-world-note-events".getBytes("UTF-8"));invoke(minecraft,"stop");return;}
            if(pending){if(System.nanoTime()>noteDeadline)captureMissing();return;}
            if(System.nanoTime()<readyAt)return;
            voices.clear();placed.clear();noteEvents=0;noteDeadline=System.nanoTime()+8000000000L;pending=true;final int current=index;progress("trigger-case "+current+" voices="+scenes[current].length);
            invoke(server,"execute",(Runnable)()->{try{Object level=invoke(server,"overworld",constant("dimensionType","overworldDimension"));for(int[] c:scenes[current]){Object note=constant("blocks","noteBlockConstant");Object air=invoke(constant("blocks","air"),"defaultState");Object base=invoke(baseBlock(c[3]),"defaultState");
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
    private static float[] currentListener(){
        float[] position=new float[3],orientation=new float[6],result=new float[10];
        AL10.alGetListenerfv(0x1004,position);AL10.alGetListenerfv(0x100F,orientation);
        System.arraycopy(position,0,result,0,3);System.arraycopy(orientation,0,result,3,6);result[9]=AL10.alGetListenerf(0x100A);return result;
    }
    private static void saveCapture(Properties record)throws Exception{
            if(!voices.isEmpty())record.putAll(voices.get(0));
            record.putAll(placed);
            record.putAll(actualOptions);
            float[] captureListener=currentListener();
            for(int i=0;i<3;i++)record.setProperty("listener."+i,Float.toString(captureListener[i]));
            for(int i=0;i<6;i++)record.setProperty("orientation."+i,Float.toString(captureListener[3+i]));
            record.setProperty("listenerGain",Float.toString(captureListener[9]));record.setProperty("listenerObservation","capture-start-al-observation");
            record.setProperty("delivery",voices.isEmpty()?"no-source-observed":"played");record.setProperty("noteEvents",Integer.toString(noteEvents));record.setProperty("voiceCount",Integer.toString(voices.size()));record.setProperty("expectedSources",Integer.toString(expectedSources()));
            record.setProperty("scene",value("sceneName."+index));
            record.setProperty("originalContextAttributes",originalContextAttributes);record.setProperty("captureContextAttributes",captureContextAttributes);
            boolean limiterAvailable=ALC10.alcIsExtensionPresent(device,"ALC_SOFT_output_limiter");record.setProperty("outputLimiterAvailable",Boolean.toString(limiterAvailable));
            if(limiterAvailable)record.setProperty("outputLimiter",Integer.toString(ALC10.alcGetInteger(device,0x199A)));
            int hrtf=ALC10.alcGetInteger(device,SOFTHRTF.ALC_HRTF_STATUS_SOFT);record.setProperty("hrtfStatus",Integer.toString(hrtf));
            if((hrtf==SOFTHRTF.ALC_HRTF_ENABLED_SOFT)!=Boolean.parseBoolean(value("hrtf")))throw new IllegalStateException("Requested HRTF state was not applied: "+hrtf);
            for(int i=0;i<voices.size();i++)for(String key:voices.get(i).stringPropertyNames())record.setProperty("voice."+i+"."+key,voices.get(i).getProperty(key));
            int stabilityChecks=1;float[] samples=new float[288000];for(int cursor=0;cursor<144000;){int frames=Math.min(1024,144000-cursor);float[] block=new float[frames*2];SOFTLoopback.alcRenderSamplesSOFT(device,block,frames);if(!Arrays.equals(captureListener,currentListener()))throw new IllegalStateException("AL listener moved during recorded mixer blocks");stabilityChecks++;System.arraycopy(block,0,samples,cursor*2,block.length);cursor+=frames;}
            record.setProperty("listenerStableAcrossBlocks","true");record.setProperty("listenerStabilityChecks",Integer.toString(stabilityChecks));
            Path output=Paths.get(value("output"));Files.createDirectories(output);
            try(DataOutputStream out=new DataOutputStream(new BufferedOutputStream(new FileOutputStream(output.resolve("case-"+index+".pcm").toFile())))){for(float input:samples){double sample=Math.max(-1,Math.min(1,(double)input));int pcm=(int)Math.round(sample*(sample<0?32768:32767));out.writeByte(pcm&255);out.writeByte((pcm>>>8)&255);}}
            try(Writer out=new OutputStreamWriter(new FileOutputStream(output.resolve("case-"+index+".properties").toFile()),"UTF-8")){record.store(out,"Original real game capture");}
            progress("captured-case "+index+" noteEvents="+noteEvents);index++;pending=false;readyAt=System.nanoTime()+1500000000L;
    }
    private static void fail(Throwable error){done=true;error.printStackTrace();try{Files.write(Paths.get(value("output"),"failure.txt"),error.toString().getBytes("UTF-8"));}catch(Exception ignored){}Runtime.getRuntime().halt(2);}
}
