package studio.nbsx.research;

import java.io.*;
import java.lang.instrument.*;
import java.nio.*;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.security.ProtectionDomain;
import java.security.MessageDigest;
import java.util.*;
import org.objectweb.asm.*;
import org.lwjgl.MemoryUtil;
import org.lwjgl.openal.*;
import com.sun.jna.*;

/** Independent silent bridge candidate. Original regular JNI call/arguments are never replaced. */
public final class Lwjgl2122SilentBridge {
 private static final String SELF="studio/nbsx/research/Lwjgl2122SilentBridge";
 private static final int WORD_LIMIT=257, PRE=256, POST=1408;
 private static final Properties report=new Properties();
 private static MappedByteBuffer journal;
 private static String destination;
 private static IntBuffer original;
 private static long base, passed;
 private static int position,limit,capacity;
 private static final Memory scratch=new Memory(8), transferred=new Memory(8);
 private static final long scratchAddress=Pointer.nativeValue(scratch), transferredAddress=Pointer.nativeValue(transferred);
 private static long process;
 private static volatile int sdkSourceCalls,sdkBufferCalls,sdkRenderCalls;
 private static Throwable entryFault,beforeFault,afterFault;

 /** Win64 only: HANDLE/LPCVOID/LPVOID/SIZE_T are 64-bit; BOOL is 32-bit. */
 public static final class Kernel {
  // Use normal Function invocation; the old JNA direct-register path failed before original AL initialization.
  private static final NativeLibrary library=NativeLibrary.getInstance("kernel32",Collections.singletonMap(Library.OPTION_CALLING_CONVENTION,Function.C_CONVENTION));
  private static final Function current=library.getFunction("GetCurrentProcess",Function.C_CONVENTION),read=library.getFunction("ReadProcessMemory",Function.C_CONVENTION),error=library.getFunction("GetLastError",Function.C_CONVENTION),handle=library.getFunction("GetModuleHandleW",Function.C_CONVENTION),filename=library.getFunction("GetModuleFileNameW",Function.C_CONVENTION);
  public static long GetCurrentProcess(){return Pointer.nativeValue(current.invokePointer(new Object[0]));}
  public static int ReadProcessMemory(long process,long address,long target,long size,long count){return read.invokeInt(new Object[]{new Pointer(process),new Pointer(address),new Pointer(target),size,new Pointer(count)});}
  public static int GetLastError(){return error.invokeInt(new Object[0]);}
  public static long GetModuleHandleW(WString name){return Pointer.nativeValue(handle.invokePointer(new Object[]{name}));}
  public static int GetModuleFileNameW(long module,char[] name,int size){return filename.invokeInt(new Object[]{new Pointer(module),name,size});}
 }

 private static boolean readWord(long address){
  transferred.setLong(0,0);
  return Kernel.ReadProcessMemory(process,address,scratchAddress,4,transferredAddress)!=0&&transferred.getLong(0)==4;
 }
 /** Journal section: count,status,failed-index,last-error,then words. Status1=terminated,2=bound,3=unreadable,4=null. */
 private static void snapshot(long address,int section){
  journal.putInt(section,0);journal.putInt(section+4,0);journal.putInt(section+8,-1);journal.putInt(section+12,0);
  if(address==0){journal.putInt(section+4,4);return;}
  for(int i=0;i<WORD_LIMIT;i++){
   if(!readWord(address+4L*i)){journal.putInt(section+8,i);journal.putInt(section+12,Kernel.GetLastError());journal.putInt(section+4,3);return;}
   int word=scratch.getInt(0);journal.putInt(section+16+i*4,word);journal.putInt(section,i+1);
   if((i&1)==0&&word==0){journal.putInt(section+4,1);return;}
  }
  journal.putInt(section+4,2);
 }
 private static void save() throws IOException {try(Writer writer=new OutputStreamWriter(new FileOutputStream(destination+"/actual.properties"),"UTF-8")){report.store(writer,"Independent silent bridge candidate; original regular call unchanged; zero sources");}journal.force();}
 private static String module(String name){long module=Kernel.GetModuleHandleW(new WString(name));if(module==0)return "NOT_LOADED";char[] chars=new char[32768];int length=Kernel.GetModuleFileNameW(module,chars,chars.length);return new String(chars,0,length);}
 private static String fileHash(String file)throws Exception {byte[] hash=MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(Paths.get(file)));StringBuilder result=new StringBuilder();for(byte value:hash)result.append(String.format("%02x",value&255));return result.toString();}
 private static String words(int section){int count=journal.getInt(section);int[] values=new int[count];for(int i=0;i<count;i++)values[i]=journal.getInt(section+16+4*i);return Arrays.toString(values);}

 public static void premain(String output,Instrumentation instrumentation)throws Exception {
  destination=output;Files.createDirectories(Paths.get(output));
  if(Native.POINTER_SIZE!=8||Native.LONG_SIZE!=4||!System.getProperty("os.name").startsWith("Windows"))throw new IllegalStateException("Observer ABI is explicitly Windows x64 only");
  process=Kernel.GetCurrentProcess();
  try(RandomAccessFile file=new RandomAccessFile(output+"/native-journal.bin","rw")){file.setLength(4096);journal=file.getChannel().map(FileChannel.MapMode.READ_WRITE,0,4096);journal.order(ByteOrder.LITTLE_ENDIAN);}
  report.setProperty("abi.pointerSize",Integer.toString(Native.POINTER_SIZE));report.setProperty("abi.cLongSize",Integer.toString(Native.LONG_SIZE));report.setProperty("abi.byteOrder",ByteOrder.nativeOrder().toString());
  report.setProperty("java.home",System.getProperty("java.home"));report.setProperty("java.version",System.getProperty("java.version"));report.setProperty("java.arch",System.getProperty("os.arch"));report.setProperty("os.version",System.getProperty("os.version"));
  report.setProperty("jna.origin",Native.class.getProtectionDomain().getCodeSource().getLocation().toString());report.setProperty("jna.dispatchPath",System.getProperty("jnidispatch.path","NOT_EXPOSED"));
  report.setProperty("jna.dispatchSha256",fileHash(System.getProperty("jnidispatch.path")));
  // Warm and verify the exact native read path before original buffer allocation.
  Memory check=new Memory(WORD_LIMIT*4L);for(int i=0;i<WORD_LIMIT;i++)check.setInt(i*4L,12345);check.setInt(4,0);check.setInt(8,0);
  snapshot(Pointer.nativeValue(check),PRE);if(journal.getInt(PRE)!=3||journal.getInt(PRE+4)!=1)throw new AssertionError("Zero value must not terminate; zero key must terminate");
  report.setProperty("readSelfTest.zeroValueThenZeroKey","true");
  check.setInt(8,12345);snapshot(Pointer.nativeValue(check),PRE);if(journal.getInt(PRE)!=WORD_LIMIT||journal.getInt(PRE+4)!=2)throw new AssertionError("Bound must be explicit");report.setProperty("readSelfTest.bound","true");
  if(readWord(0))throw new AssertionError("Null memory unexpectedly readable");report.setProperty("readSelfTest.unreadable","true");
  snapshot(0,PRE);snapshot(0,POST);report.setProperty("kernel32.path",module("kernel32.dll"));
  memoryTests();
  instrumentation.addTransformer(new ClassFileTransformer(){public byte[] transform(ClassLoader loader,String name,Class<?> type,ProtectionDomain domain,byte[] bytes){
   if(name.equals("org/lwjgl/openal/AL10")||name.equals("org/lwjgl/openal/AL11")){
    try{String base=name.substring(name.lastIndexOf('/')+1);Files.write(Paths.get(destination,base+".original.class"),bytes);ClassWriter out=new ClassWriter(ClassWriter.COMPUTE_MAXS);new ClassReader(bytes).accept(new ClassVisitor(Opcodes.ASM9,out){public MethodVisitor visitMethod(int access,String member,String desc,String signature,String[] exceptions){MethodVisitor target=super.visitMethod(access,member,desc,signature,exceptions);final String lower=member.toLowerCase(Locale.ROOT);final int kind=lower.contains("source")?1:lower.contains("buffer")?2:lower.contains("rendersamples")?3:0;if(kind==0||(access&Opcodes.ACC_NATIVE)!=0)return target;return new MethodVisitor(Opcodes.ASM9,target){public void visitCode(){super.visitCode();super.visitLdcInsn(kind);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"sdkCall","(I)V",false);}};}},0);byte[] observed=out.toByteArray();Files.write(Paths.get(destination,base+".counted.class"),observed);report.setProperty("sdkCounter."+base,"instrumented");return observed;}catch(IOException failure){throw new IllegalStateException(failure);}
   }
   if(!name.equals("org/lwjgl/openal/ALC10"))return null;
   try{
    Files.write(Paths.get(destination,"ALC10.original.class"),bytes);
    ClassReader reader=new ClassReader(bytes);ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);
    reader.accept(new ClassVisitor(Opcodes.ASM9,writer){public MethodVisitor visitMethod(int access,String method,String descriptor,String signature,String[] exceptions){
     MethodVisitor target=super.visitMethod(access,method,descriptor,signature,exceptions);
     if(!method.equals("alcCreateContext")||!descriptor.equals("(Lorg/lwjgl/openal/ALCdevice;Ljava/nio/IntBuffer;)Lorg/lwjgl/openal/ALCcontext;"))return target;
     return new MethodVisitor(Opcodes.ASM9,target){
      public void visitCode(){super.visitCode();super.visitVarInsn(Opcodes.ALOAD,1);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"entry","(Ljava/nio/IntBuffer;)V",false);}
      public void visitMethodInsn(int opcode,String owner,String called,String desc,boolean itf){
       boolean nativeCall=owner.equals("org/lwjgl/openal/ALC10")&&called.equals("nalcCreateContext")&&desc.equals("(JJ)J");
       if(nativeCall){super.visitInsn(Opcodes.DUP2);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"beforeNative","(J)V",false);}
       super.visitMethodInsn(opcode,owner,called,desc,itf);
       if(nativeCall){super.visitInsn(Opcodes.DUP2);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"afterNative","(J)V",false);}
      }
     };
    }},0);
    byte[] transformed=writer.toByteArray();Files.write(Paths.get(destination,"ALC10.observed.class"),transformed);return transformed;
   }catch(IOException exception){throw new IllegalStateException(exception);}
  }});
 }

 public static void entry(IntBuffer buffer){
  try{
  original=buffer;journal.putInt(0,journal.getInt(0)+1);journal.putInt(4,1);
  if(buffer==null){base=0;position=limit=capacity=-1;return;}
  position=buffer.position();limit=buffer.limit();capacity=buffer.capacity();base=MemoryUtil.getAddress(buffer,0);
  journal.putLong(16,base);journal.putInt(32,position);journal.putInt(36,limit);journal.putInt(40,capacity);
  // Absolute duplicate read observes backing capacity without consuming original position.
  IntBuffer duplicate=buffer.duplicate();duplicate.clear();for(int i=0;i<Math.min(capacity,32);i++)journal.putInt(64+i*4,duplicate.get(i));
  }catch(Throwable failure){entryFault=failure;}
 }
 public static void beforeNative(long pointer){passed=pointer;try{journal.putLong(24,pointer);journal.putInt(4,2);snapshot(pointer,PRE);journal.putInt(4,3);}catch(Throwable failure){beforeFault=failure;}}
 public static void afterNative(long context){try{journal.putLong(48,context);journal.putInt(4,4);snapshot(passed,POST);journal.putInt(4,5);}catch(Throwable failure){afterFault=failure;}}
 public static void sdkCall(int kind){if(kind==1)sdkSourceCalls++;else if(kind==2)sdkBufferCalls++;else if(kind==3)sdkRenderCalls++;}

 /** Pure memory policy: preserve all pairs/order; only overwrite the three recording keys and append missing ones. */
 public static int[] recordingAttributes(int[] source){
  if(source==null||source.length==0||source.length>WORD_LIMIT||(source.length&1)==0||source[source.length-1]!=0)throw new IllegalArgumentException("Complete observed terminated list required");
  ArrayList<Integer> out=new ArrayList<Integer>();boolean channels=false,type=false,rate=false;
  for(int i=0;i<source.length-1;i+=2){int key=source[i],value=source[i+1];if(key==0)throw new IllegalArgumentException("Early zero key");if(key==0x1990){value=0x1501;channels=true;}else if(key==0x1991){value=0x1406;type=true;}else if(key==0x1007){value=48000;rate=true;}out.add(key);out.add(value);}
  if(!channels){out.add(0x1990);out.add(0x1501);}if(!type){out.add(0x1991);out.add(0x1406);}if(!rate){out.add(0x1007);out.add(48000);}out.add(0);int[] values=new int[out.size()];for(int i=0;i<values.length;i++)values[i]=out.get(i);return values;
 }
 private static void memoryCase(String name,int[] source,int[] expected){int[] before=source==null?null:source.clone();boolean rejected=false;int[] actual=null;try{actual=recordingAttributes(source);}catch(IllegalArgumentException error){rejected=true;}if(expected==null&&!rejected||expected!=null&&(rejected||!Arrays.equals(actual,expected))||!Arrays.equals(source,before))throw new AssertionError("Pure memory test "+name);report.setProperty("memory."+name+".input",Arrays.toString(source));report.setProperty("memory."+name+".result",rejected?"rejected":Arrays.toString(actual));}
 private static void memoryTests(){
  memoryCase("null",null,null);memoryCase("empty",new int[0],null);memoryCase("missing-terminator",new int[]{777,0},null);memoryCase("early-zero-key",new int[]{0,1,0},null);memoryCase("nonzero-last-key",new int[]{777,0,1},null);
  memoryCase("observed-zero-key",new int[]{0},new int[]{6544,5377,6545,5126,4103,48000,0});
  memoryCase("unknown-zero-value",new int[]{777,0,0},new int[]{777,0,6544,5377,6545,5126,4103,48000,0});
  memoryCase("duplicates-all-recording-values",new int[]{999,0,999,2,4103,44100,4103,22050,6544,1,6545,2,0},new int[]{999,0,999,2,4103,48000,4103,48000,6544,5377,6545,5126,0});
  memoryCase("duplicate-channel-keys",new int[]{6544,1,6544,2,0},new int[]{6544,5377,6544,5377,6545,5126,4103,48000,0});report.setProperty("memory.tests","9");
 }
 private static int[] sectionWords(int section){int[] values=new int[journal.getInt(section)];for(int i=0;i<values.length;i++)values[i]=journal.getInt(section+16+4*i);return values;}
 private static void stage(String name)throws IOException {report.setProperty("bridge.lastStage",name);save();System.err.println("NBSX_BRIDGE_STAGE "+name);System.err.flush();}
 private static final class Api {
  private final NativeLibrary library;
  private final HashMap<String,Function> functions=new HashMap<String,Function>();
  private final Set<String> allowed=new HashSet<String>(Arrays.asList("alcOpenDevice","alcCreateContext","alcCloseDevice","alcDestroyContext","alcGetContextsDevice","alcGetCurrentContext","alcIsExtensionPresent","alcGetProcAddress","alcGetIntegerv","alcGetError","alcGetString","alcLoopbackOpenDeviceSOFT","alcIsRenderFormatSupportedSOFT"));
  Api(String file){library=NativeLibrary.getInstance(file,Collections.singletonMap(Library.OPTION_CALLING_CONVENTION,Function.C_CONVENTION));report.setProperty("bridge.jnaLibraryFile",library.getFile().getAbsolutePath());report.setProperty("bridge.moduleBase",Long.toUnsignedString(Kernel.GetModuleHandleW(new WString("OpenAL64.dll"))));}
  Function function(String name){if(!allowed.contains(name))throw new IllegalArgumentException("Not a silent ALC API: "+name);Function value=functions.get(name);if(value==null){value=library.getFunction(name,Function.C_CONVENTION);functions.put(name,value);report.setProperty("function."+name+".address",Long.toUnsignedString(Pointer.nativeValue(value)));}return value;}
  Object call(String name,Class<?> type,Object...args){int count=Integer.parseInt(report.getProperty("calls."+name,"0"));report.setProperty("calls."+name,Integer.toString(count+1));return function(name).invoke(type,args);}
  Pointer pointer(String name,Object...args){return(Pointer)call(name,Pointer.class,args);}
  int integer(String name,Object...args){return((Integer)call(name,Integer.TYPE,args)).intValue();}
  boolean bool(String name,Object...args){return((Byte)call(name,Byte.TYPE,args)).byteValue()!=0;}
  void nothing(String name,Object...args){call(name,Void.TYPE,args);}
  boolean extension(Pointer device,String name){return bool("alcIsExtensionPresent",device,name);}
  void bindExtension(String name){Pointer address=pointer("alcGetProcAddress",null,name);if(address==null)throw new IllegalStateException("Missing original driver function "+name);Function function=Function.getFunction(address,Function.C_CONVENTION);functions.put(name,function);report.setProperty("function."+name+".address",Long.toUnsignedString(Pointer.nativeValue(function)));}
  void state(String prefix,Pointer device){int[] size=new int[1];nothing("alcGetIntegerv",device,0x1002,1,size);if(size[0]<1||size[0]>4096)throw new IllegalStateException("Invalid actual attribute count");int[] values=new int[size[0]];nothing("alcGetIntegerv",device,0x1003,values.length,values);report.setProperty(prefix+".allAttributes",Arrays.toString(values));Pointer name=pointer("alcGetString",device,0x1005);report.setProperty(prefix+".device",name==null?"NULL":name.getString(0,"UTF-8"));report.setProperty(prefix+".hrtfExtension",Boolean.toString(extension(device,"ALC_SOFT_HRTF")));report.setProperty(prefix+".alcError",Integer.toString(integer("alcGetError",device)));}
  long current(){return Pointer.nativeValue(pointer("alcGetCurrentContext"));}
  void dispose(){library.dispose();}
 }
 private static Memory attributes(int[] values){Memory memory=new Memory(values.length*4L);for(int i=0;i<values.length;i++)memory.setInt(i*4L,values[i]);return memory;}
 private static void expectCurrent(Api api,long expected,String label){long actual=api.current();report.setProperty("current."+label,Long.toUnsignedString(actual));if(actual!=expected)throw new IllegalStateException("Original current context changed at "+label);}
 private static void bridges(Api api)throws Exception {
  int[] before=sectionWords(PRE),after=sectionWords(POST);boolean available=entryFault==null&&beforeFault==null&&afterFault==null&&journal.getInt(PRE+4)==1&&journal.getInt(POST+4)==1&&Arrays.equals(before,after);report.setProperty("bridge.eligible",Boolean.toString(available));
  if(!available){report.setProperty("bridge.outcome","unavailable-original-list-not-complete-stable");return;}
  long context=journal.getLong(48);expectCurrent(api,context,"before-bridge");Pointer originalDevice=api.pointer("alcGetContextsDevice",new Pointer(context));report.setProperty("original.devicePointer",Long.toUnsignedString(Pointer.nativeValue(originalDevice)));api.state("original-before",originalDevice);
  int[] loopbackValues=recordingAttributes(before);report.setProperty("mirror.inputAttributes",Arrays.toString(before));report.setProperty("loopback.inputAttributes",Arrays.toString(loopbackValues));Memory regularAttrs=attributes(before),loopbackAttrs=attributes(loopbackValues);report.setProperty("mirror.legalAllocationBytes",Long.toString(regularAttrs.size()));report.setProperty("loopback.legalAllocationBytes",Long.toString(loopbackAttrs.size()));
  Pointer regularDevice=null,regularContext=null,loopbackDevice=null,loopbackContext=null;
  try{
   stage("mirror-create");regularDevice=api.pointer("alcOpenDevice",(Object)null);if(regularDevice==null)throw new IllegalStateException("Regular mirror device open failed");report.setProperty("mirror.devicePointer",Long.toUnsignedString(Pointer.nativeValue(regularDevice)));regularContext=api.pointer("alcCreateContext",regularDevice,regularAttrs);report.setProperty("mirror.contextPointer",Long.toUnsignedString(Pointer.nativeValue(regularContext)));if(regularContext==null){report.setProperty("mirror.createError",Integer.toString(api.integer("alcGetError",regularDevice)));throw new IllegalStateException("Regular mirror context creation failed");}api.state("mirror",regularDevice);expectCurrent(api,context,"after-mirror");
   stage("loopback-create");if(!api.extension(null,"ALC_SOFT_loopback"))throw new IllegalStateException("Original DLL has no loopback extension");api.bindExtension("alcLoopbackOpenDeviceSOFT");api.bindExtension("alcIsRenderFormatSupportedSOFT");loopbackDevice=api.pointer("alcLoopbackOpenDeviceSOFT",(Object)null);if(loopbackDevice==null)throw new IllegalStateException("Loopback device open failed");report.setProperty("loopback.devicePointer",Long.toUnsignedString(Pointer.nativeValue(loopbackDevice)));report.setProperty("loopback.formatSupported",Boolean.toString(api.bool("alcIsRenderFormatSupportedSOFT",loopbackDevice,48000,0x1501,0x1406)));loopbackContext=api.pointer("alcCreateContext",loopbackDevice,loopbackAttrs);report.setProperty("loopback.contextPointer",Long.toUnsignedString(Pointer.nativeValue(loopbackContext)));if(loopbackContext==null){report.setProperty("loopback.createError",Integer.toString(api.integer("alcGetError",loopbackDevice)));throw new IllegalStateException("Loopback context creation failed");}api.state("loopback",loopbackDevice);expectCurrent(api,context,"after-loopback");
   stage("original-query-after");api.state("original-after",originalDevice);expectCurrent(api,context,"before-bridge-cleanup");report.setProperty("bridge.outcome","candidate-contexts-observed-no-equivalence-claim");
  }finally{
   stage("bridge-cleanup");if(loopbackContext!=null){api.nothing("alcDestroyContext",loopbackContext);report.setProperty("loopback.contextDestroyed","true");}if(loopbackDevice!=null)report.setProperty("loopback.deviceClosed",Boolean.toString(api.bool("alcCloseDevice",loopbackDevice)));if(regularContext!=null){api.nothing("alcDestroyContext",regularContext);report.setProperty("mirror.contextDestroyed","true");}if(regularDevice!=null)report.setProperty("mirror.deviceClosed",Boolean.toString(api.bool("alcCloseDevice",regularDevice)));expectCurrent(api,context,"after-bridge-cleanup");
  }
 }

 public static void main(String[] args)throws Exception {
  destination=args[0];report.setProperty("phase","before-original-AL.create");save();Throwable failure=null;Api api=null;
  try {
   stage("original-create");
   AL.create();report.setProperty("phase","original-AL.create-returned");report.setProperty("actual.contextCreated",Boolean.toString(AL.getContext()!=null));
   report.setProperty("actual.backend",AL10.alGetString(AL10.AL_VERSION));report.setProperty("actual.vendor",AL10.alGetString(AL10.AL_VENDOR));report.setProperty("actual.renderer",AL10.alGetString(AL10.AL_RENDERER));
   report.setProperty("actual.device",ALC10.alcGetString(AL.getDevice(),0x1005));report.setProperty("actual.defaultDevice",ALC10.alcGetString(null,0x1004));
   report.setProperty("actual.enumerateAllExtension",Boolean.toString(ALC10.alcIsExtensionPresent(null,"ALC_ENUMERATE_ALL_EXT")));if(ALC10.alcIsExtensionPresent(null,"ALC_ENUMERATE_ALL_EXT"))report.setProperty("actual.endpoint",ALC10.alcGetString(AL.getDevice(),0x1013));
   IntBuffer size=ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1002,size);int count=size.get(0);if(count<0||count>4096)throw new IllegalStateException("Invalid returned attribute count "+count);
   IntBuffer attributes=ByteBuffer.allocateDirect(count*4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1003,attributes);int[] all=new int[count];for(int i=0;i<count;i++)all[i]=attributes.get(i);report.setProperty("actual.allAttributes",Arrays.toString(all));
   report.setProperty("actual.hrtfExtension",Boolean.toString(ALC10.alcIsExtensionPresent(AL.getDevice(),"ALC_SOFT_HRTF")));report.setProperty("actual.loopbackExtension",Boolean.toString(ALC10.alcIsExtensionPresent(null,"ALC_SOFT_loopback")));
   report.setProperty("actual.alcError",Integer.toString(ALC10.alcGetError(AL.getDevice())));
   stage("original-returned");api=new Api(module("OpenAL64.dll"));bridges(api);
  }catch(Throwable exception){failure=exception;report.setProperty("phase","true".equals(report.getProperty("actual.contextCreated"))?"bridge-failed-after-original-returned":"original-call-failed");report.setProperty("failure",exception.toString());exception.printStackTrace();}
  finally {
   report.setProperty("actual.openalModule",module("OpenAL64.dll"));report.setProperty("actual.lwjglModule",module("lwjgl64.dll"));
   report.setProperty("actual.jvmModule",module("jvm.dll"));report.setProperty("java.exeSha256",fileHash(System.getProperty("java.home")+"/bin/java.exe"));report.setProperty("java.jvmSha256",fileHash(report.getProperty("actual.jvmModule")));
   report.setProperty("originalBufferUnchanged",Boolean.toString(original==null||original.position()==position&&original.limit()==limit&&original.capacity()==capacity));
   report.setProperty("entryCount",Integer.toString(journal.getInt(0)));report.setProperty("nativeJournalPhase",Integer.toString(journal.getInt(4)));report.setProperty("nativePointerOffset",Long.toString(passed-base));
   report.setProperty("pre.words",words(PRE));report.setProperty("post.words",words(POST));report.setProperty("pre.status",Integer.toString(journal.getInt(PRE+4)));report.setProperty("post.status",Integer.toString(journal.getInt(POST+4)));report.setProperty("prePostSame",Boolean.toString(words(PRE).equals(words(POST))&&journal.getInt(PRE+4)==journal.getInt(POST+4)));
   report.setProperty("observer.entryFault",entryFault==null?"none":entryFault.toString());report.setProperty("observer.beforeFault",beforeFault==null?"none":beforeFault.toString());report.setProperty("observer.afterFault",afterFault==null?"none":afterFault.toString());
   report.setProperty("calls.sdkSource",Integer.toString(sdkSourceCalls));report.setProperty("calls.sdkBuffer",Integer.toString(sdkBufferCalls));report.setProperty("calls.sdkRenderSamples",Integer.toString(sdkRenderCalls));report.setProperty("calls.jnaSource","0");report.setProperty("calls.jnaBuffer","0");report.setProperty("calls.jnaRenderSamples","0");
   stage("original-cleanup");if(AL.isCreated())AL.destroy();report.setProperty("closed","true");if(api!=null){report.setProperty("current.after-original-cleanup",Long.toUnsignedString(api.current()));api.dispose();report.setProperty("bridge.jnaLibraryDisposed","true");}report.setProperty("bridge.moduleBaseAfterDispose",Long.toUnsignedString(Kernel.GetModuleHandleW(new WString("OpenAL64.dll"))));report.setProperty("calls.sdkSource",Integer.toString(sdkSourceCalls));report.setProperty("calls.sdkBuffer",Integer.toString(sdkBufferCalls));report.setProperty("calls.sdkRenderSamples",Integer.toString(sdkRenderCalls));stage("complete");save();
  }
  if(failure!=null)System.exit(2);
 }
}
