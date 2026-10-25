package studio.nbsx.research;

import java.io.*;
import java.lang.instrument.*;
import java.nio.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import org.objectweb.asm.*;
import org.lwjgl.MemoryUtil;
import org.lwjgl.openal.*;

/** Future explicitly authorized silent pilot only. --transform-only never loads a native library. */
public final class Lwjgl2122MixerRuntime {
 private static final String SELF="studio/nbsx/research/Lwjgl2122MixerRuntime";
 private static final Properties properties=new Properties(),config=new Properties();
 private static String root;private static int sourceCalls,bufferCalls,renderCalls,currentCalls;private static Throwable evidenceFailure;
 private static IntBuffer original;private static int originalPosition,originalLimit,originalCapacity;
 private static final String[] NAMES={"failureCode","windowsError","installationEntered","originalModule","originalFileHashVerified","originalModulePinned","controllerPinned","wholeTextBaselineVerified","preContextCurrentNull","dynamicCodePolicy","control","slab","capacity","stride","reservedMaxFrames","guardsPrepared","observerModule","observerFunction","observerBound","site","siteAligned8SamePage","island","islandRxFlushedReadback","original8","patched8","originalProtection","casInstalled","fullPatchedTextVerified","contextEntryCount","bufferBase","bufferPosition","bufferLimit","originalNativeContext","device","frequency","updateSize","numUpdates","formatChannels","formatType","backendData","workerObject","workerFunction","workerArgument","workerHandle","duplicateWorkerHandle","workerProcessId","workerThreadId","workerPreWait","workerPreExitCode","actualMaxFrames","armedOnce","workerPostWait","postCleanupInflight","postCleanupCurrentNull","slotCanariesIntact","restorePreviousProtection","casRestored","fullOriginalTextRestored","actualNativeAttributePointer","nativeBeforeComplete","nativeAfterObserved","allocationsReleased","reserved62","reserved63"};
 private static native void configure(byte[] expectedText,String observerPath,byte[] observerHash);
 private static native void bufferEntry(long address,int position,int limit,int capacity,int[] declaredWords);
 public static native void beforeNative(long address);
 public static native void afterNative(long context);
 private static native boolean arm(long context);
 private static native void disarm();
 private static native boolean finish();
 private static native long[] state();
 private static native byte[] slot(int index);
 private static native byte[] text(boolean mapped);
 private static native boolean release();
 private static native String modulePath(String name);

 private static String hash(byte[] bytes)throws Exception{StringBuilder h=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))h.append(String.format(Locale.ROOT,"%02x",b&255));return h.toString();}
 private static byte[] unhex(String h){if(h==null||h.length()!=64)throw new IllegalArgumentException("SHA-256 required");byte[] b=new byte[32];for(int i=0;i<32;i++)b[i]=(byte)Integer.parseInt(h.substring(i*2,i*2+2),16);return b;}
 private static byte[] checked(String path,String expected)throws Exception{byte[] b=Files.readAllBytes(Paths.get(path));if(!hash(b).equals(expected))throw new IllegalStateException("Input hash differs: "+path);return b;}
 private static void save(String phase)throws Exception{
  properties.setProperty("phase",phase);properties.setProperty("sdk.sourceCalls",Integer.toString(sourceCalls));properties.setProperty("sdk.bufferCalls",Integer.toString(bufferCalls));properties.setProperty("sdk.renderSamplesCalls",Integer.toString(renderCalls));properties.setProperty("sdk.originalMakeCurrentCalls",Integer.toString(currentCalls));properties.setProperty("sdk.extraMakeCurrentCalls","0");
  long[] s=state();for(int i=0;i<64;i++)properties.setProperty("native."+NAMES[i],Long.toUnsignedString(s[i]));String[] counters={"bufferBase","attributePointer","installed","restored","released","armed","inflight","calls","attempted","committed","dropped","invalid","processId"};for(int i=0;i<counters.length;i++)properties.setProperty("recorder."+counters[i],Long.toUnsignedString(s[64+i]));
  for(int j=0;j<4;j++){int at=77+j*261,count=(int)s[at];properties.setProperty("nativeList."+j+".status",Long.toString(s[at+1]));properties.setProperty("nativeList."+j+".failedIndex",Long.toString(s[at+2]));properties.setProperty("nativeList."+j+".error",Long.toString(s[at+3]));long[] words=new long[count];for(int i=0;i<count;i++)words[i]=s[at+4+i];properties.setProperty("nativeList."+j+".words",Arrays.toString(words));}
  ByteBuffer raw=ByteBuffer.allocate(s.length*8).order(ByteOrder.LITTLE_ENDIAN);for(long value:s)raw.putLong(value);Files.write(Paths.get(root,"state-"+phase+".bin"),raw.array());try(Writer out=new OutputStreamWriter(new FileOutputStream(root+"/actual.properties"),"UTF-8")){properties.store(out,"Own-process zero-source regular mixer candidate; no equivalence or world acceptance");}System.err.println("NBSX_MIXER_STAGE "+phase);System.err.flush();
 }
 private static void checkpoint(String phase){try{save(phase);}catch(Throwable e){if(evidenceFailure==null)evidenceFailure=e;properties.setProperty("evidence.failure",e.toString());e.printStackTrace();}}
 public static void entry(IntBuffer buffer){
  original=buffer;if(buffer==null)throw new IllegalStateException("This exact first-context pilot requires its original non-null7-int buffer");originalPosition=buffer.position();originalLimit=buffer.limit();originalCapacity=buffer.capacity();if(originalPosition!=7||originalLimit!=7||originalCapacity!=7)throw new IllegalStateException("Unsupported original buffer shape; context creation not executed");IntBuffer duplicate=buffer.duplicate();duplicate.clear();int[] words=new int[originalCapacity];for(int i=0;i<words.length;i++)words[i]=duplicate.get(i);bufferEntry(MemoryUtil.getAddress(buffer,0),originalPosition,originalLimit,originalCapacity,words);
 }
 public static void sdkCall(int kind){if(kind==4){currentCalls++;return;}if(kind==1)sourceCalls++;else if(kind==2)bufferCalls++;else renderCalls++;throw new IllegalStateException("Silent scope forbids this SDK source/buffer/render call");}
 private static byte[] observed(final String name,byte[] bytes){
  ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);new ClassReader(bytes).accept(new ClassVisitor(Opcodes.ASM9,writer){public MethodVisitor visitMethod(int access,String member,String descriptor,String signature,String[] exceptions){
   MethodVisitor target=super.visitMethod(access,member,descriptor,signature,exceptions);
   if(name.equals("org/lwjgl/openal/ALC10")&&member.equals("alcCreateContext")&&descriptor.equals("(Lorg/lwjgl/openal/ALCdevice;Ljava/nio/IntBuffer;)Lorg/lwjgl/openal/ALCcontext;"))return new MethodVisitor(Opcodes.ASM9,target){
    public void visitCode(){super.visitCode();super.visitVarInsn(Opcodes.ALOAD,1);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"entry","(Ljava/nio/IntBuffer;)V",false);}
    public void visitMethodInsn(int opcode,String owner,String called,String desc,boolean itf){boolean nativeCall=owner.equals("org/lwjgl/openal/ALC10")&&called.equals("nalcCreateContext")&&desc.equals("(JJ)J");if(nativeCall){super.visitInsn(Opcodes.DUP2);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"beforeNative","(J)V",false);}super.visitMethodInsn(opcode,owner,called,desc,itf);if(nativeCall){super.visitInsn(Opcodes.DUP2);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"afterNative","(J)V",false);}}
   };
   final String lower=member.toLowerCase(Locale.ROOT);final int kind=name.endsWith("ALC10")&&member.equals("alcMakeContextCurrent")?4:lower.contains("source")?1:lower.contains("buffer")?2:lower.contains("rendersamples")?3:0;
   if(kind==0||(access&Opcodes.ACC_NATIVE)!=0)return target;return new MethodVisitor(Opcodes.ASM9,target){public void visitCode(){super.visitCode();super.visitLdcInsn(kind);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"sdkCall","(I)V",false);}};
  }},0);return writer.toByteArray();
 }
 public static void premain(String output,Instrumentation instrumentation)throws Exception{
  root=output;try(InputStream in=new FileInputStream(root+"/runtime.properties")){config.load(in);}if(!System.getProperty("os.name").startsWith("Windows")||!System.getProperty("os.arch").equals("amd64"))throw new IllegalStateException("Windows AMD64 only");
  checked(config.getProperty("controller"),config.getProperty("controller.sha256"));checked(config.getProperty("observer"),config.getProperty("observer.sha256"));byte[] expected=checked(config.getProperty("expectedText"),config.getProperty("expectedText.sha256"));
  System.load(config.getProperty("controller"));configure(expected,config.getProperty("observer"),unhex(config.getProperty("observer.sha256")));properties.setProperty("controller.loaded","true");properties.setProperty("java.version",System.getProperty("java.version"));properties.setProperty("java.home",System.getProperty("java.home"));properties.setProperty("pointerScope","Original MemoryUtil actual pointer remains base+28 outside7-int allocation; no normalization");
  instrumentation.addTransformer(new ClassFileTransformer(){public byte[] transform(ClassLoader loader,String name,Class<?> type,ProtectionDomain domain,byte[] bytes){if(!Arrays.asList("org/lwjgl/openal/ALC10","org/lwjgl/openal/AL10","org/lwjgl/openal/AL11").contains(name))return null;try{String shortName=name.substring(name.lastIndexOf('/')+1);if(!hash(bytes).equals(config.getProperty(shortName+".sha256")))throw new IllegalStateException("Original SDK class differs: "+name);Files.write(Paths.get(root,shortName+".original.class"),bytes);byte[] out=observed(name,bytes);Files.write(Paths.get(root,shortName+".observed.class"),out);properties.setProperty("transformed."+shortName,"true");return out;}catch(Exception e){properties.setProperty("transform.failure",e.toString());e.printStackTrace();return new byte[]{0};/* Invalid class deliberately blocks definition; transformer exceptions alone can be ignored by the JVM. */}}});
  save("configured-before-original-create");
 }
 private static void modules()throws Exception{for(String name:new String[]{"OpenAL64.dll","lwjgl64.dll","jvm.dll","kernel32.dll","mixer-runtime.dll","observer.dll"}){String path=modulePath(name);properties.setProperty("module."+name,path==null?"NOT_LOADED":path);if(path!=null)properties.setProperty("module."+name+".sha256",hash(Files.readAllBytes(Paths.get(path))));}}
 public static void main(String[] args)throws Exception{
  if(args.length==3&&args[0].equals("--transform-only")){Path source=Paths.get(args[1]),destination=Paths.get(args[2]);Files.createDirectories(destination);for(String name:new String[]{"ALC10","AL10","AL11"}){byte[] b=Files.readAllBytes(source.resolve(name+".class"));Files.write(destination.resolve(name+".original.class"),b);Files.write(destination.resolve(name+".observed.class"),observed("org/lwjgl/openal/"+name,b));}System.out.println("TRANSFORM_ONLY_NO_NATIVE");return;}
  if(args.length!=1||root==null)throw new IllegalStateException("Reviewed javaagent and explicit isolated root required");
  Throwable failure=null;boolean originalCleanupReturned=false,finished=false;try{
   save("before-original-create");AL.create();save("original-create-returned");if(AL.getContext()==null)throw new IllegalStateException("Original AL.create returned no context");long[] initial=state();if(initial[0]!=0||initial[28]!=1||initial[59]!=1||initial[60]!=1)throw new IllegalStateException("Original context observed, but observer gates unavailable");
   properties.setProperty("actual.version",AL10.alGetString(AL10.AL_VERSION));properties.setProperty("actual.vendor",AL10.alGetString(AL10.AL_VENDOR));properties.setProperty("actual.renderer",AL10.alGetString(AL10.AL_RENDERER));properties.setProperty("actual.device",ALC10.alcGetString(AL.getDevice(),0x1005));
   IntBuffer count=ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1002,count);if(count.get(0)<1||count.get(0)>4096)throw new IllegalStateException("Invalid effective attribute size");IntBuffer attributes=ByteBuffer.allocateDirect(count.get(0)*4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1003,attributes);int[] words=new int[attributes.capacity()];for(int i=0;i<words.length;i++)words[i]=attributes.get(i);properties.setProperty("actual.effectiveAttributes",Arrays.toString(words));modules();Files.write(Paths.get(root,"original-mapped-text-baseline.bin"),text(false));Files.write(Paths.get(root,"installed-mapped-text.bin"),text(true));
   if(!arm(initial[32]))throw new IllegalStateException("Actual format/worker/handle gate unavailable");save("armed");long start=System.nanoTime();Thread.sleep(1000);properties.setProperty("capture.elapsedNanos",Long.toString(System.nanoTime()-start));disarm();save("disarmed");
  }catch(Throwable e){failure=e;properties.setProperty("failure",e.toString());e.printStackTrace();}
  finally{
   disarm();checkpoint("before-original-cleanup");try{boolean created=AL.isCreated();properties.setProperty("original.cleanupInvoked",Boolean.toString(created));if(created)AL.destroy();originalCleanupReturned=true;properties.setProperty("original.cleanupReturned","true");}catch(Throwable cleanup){if(failure==null)failure=cleanup;properties.setProperty("cleanup.failure",cleanup.toString());cleanup.printStackTrace();}
   properties.setProperty("original.bufferUnchanged",Boolean.toString(original==null||original.position()==originalPosition&&original.limit()==originalLimit&&original.capacity()==originalCapacity));try{modules();}catch(Throwable e){if(failure==null)failure=e;e.printStackTrace();}checkpoint("after-original-cleanup");if(failure==null&&evidenceFailure!=null)failure=evidenceFailure;
   if(originalCleanupReturned&&failure==null){finished=finish();checkpoint("restoration-gates");if(!finished)failure=new IllegalStateException("Join/inflight/restore/full-text gate unavailable; retain all allocations and pinned modules");}
   if(finished&&failure==null)try{Files.write(Paths.get(root,"restored-mapped-text.bin"),text(true));long[] s=state();Path packets=Paths.get(root,"packets");Files.createDirectories(packets);long frames=0,nonzero=0;for(int i=0;i<s[73];i++){byte[] packet=slot(i);if(packet==null)throw new IllegalStateException("Published private slot invalid; leave allocations pinned");Files.write(packets.resolve(String.format(Locale.ROOT,"packet-%04d.bin",i)),packet);ByteBuffer b=ByteBuffer.wrap(packet).order(ByteOrder.LITTLE_ENDIAN);frames+=Integer.toUnsignedLong(b.getInt(32));for(int at=64;at<packet.length;at+=4)if((b.getInt(at)&0x7fffffff)!=0)nonzero++;}properties.setProperty("capture.frames",Long.toString(frames));properties.setProperty("capture.nonzeroFloatWords",Long.toString(nonzero));properties.setProperty("capture.packetCount",Long.toString(s[73]));checkpoint("private-packets-saved");if(evidenceFailure==null){if(!release())failure=new IllegalStateException("Successful-join allocation release incomplete");}else failure=evidenceFailure;}catch(Throwable e){failure=e;properties.setProperty("serialization.failure",e.toString());e.printStackTrace();}
   checkpoint(failure==null&&finished?"complete-silent-candidate":"unavailable-pinned-until-terminal");if(failure==null&&evidenceFailure!=null)failure=evidenceFailure;
  }
  if(sourceCalls!=0||bufferCalls!=0||renderCalls!=0)throw new IllegalStateException("Silent source/buffer/render scope violated");if(failure!=null)throw new IllegalStateException("Silent mixer pilot unavailable; original failure and observer gate failure are distinct",failure);
 }
}
