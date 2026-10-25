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

/** Observer only. Never replaces, flips, rejects, or retries the original context arguments. */
public final class Lwjgl2122NativeListObserver {
 private static final String SELF="studio/nbsx/research/Lwjgl2122NativeListObserver";
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
 private static void save() throws IOException {try(Writer writer=new OutputStreamWriter(new FileOutputStream(destination+"/actual.properties"),"UTF-8")){report.store(writer,"Fresh observer-only original regular context; no sound or argument substitution");}journal.force();}
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
  instrumentation.addTransformer(new ClassFileTransformer(){public byte[] transform(ClassLoader loader,String name,Class<?> type,ProtectionDomain domain,byte[] bytes){
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
  original=buffer;journal.putInt(0,journal.getInt(0)+1);journal.putInt(4,1);
  if(buffer==null){base=0;position=limit=capacity=-1;return;}
  position=buffer.position();limit=buffer.limit();capacity=buffer.capacity();base=MemoryUtil.getAddress(buffer,0);
  journal.putLong(16,base);journal.putInt(32,position);journal.putInt(36,limit);journal.putInt(40,capacity);
  // Absolute duplicate read observes backing capacity without consuming original position.
  IntBuffer duplicate=buffer.duplicate();duplicate.clear();for(int i=0;i<Math.min(capacity,32);i++)journal.putInt(64+i*4,duplicate.get(i));
 }
 public static void beforeNative(long pointer){passed=pointer;journal.putLong(24,pointer);journal.putInt(4,2);snapshot(pointer,PRE);journal.putInt(4,3);}
 public static void afterNative(long context){journal.putLong(48,context);journal.putInt(4,4);snapshot(passed,POST);journal.putInt(4,5);}

 public static void main(String[] args)throws Exception {
  destination=args[0];report.setProperty("phase","before-original-AL.create");save();Throwable failure=null;
  try {
   AL.create();report.setProperty("phase","original-AL.create-returned");report.setProperty("actual.contextCreated",Boolean.toString(AL.getContext()!=null));
   report.setProperty("actual.backend",AL10.alGetString(AL10.AL_VERSION));report.setProperty("actual.vendor",AL10.alGetString(AL10.AL_VENDOR));report.setProperty("actual.renderer",AL10.alGetString(AL10.AL_RENDERER));
   report.setProperty("actual.device",ALC10.alcGetString(AL.getDevice(),0x1005));report.setProperty("actual.defaultDevice",ALC10.alcGetString(null,0x1004));
   report.setProperty("actual.enumerateAllExtension",Boolean.toString(ALC10.alcIsExtensionPresent(null,"ALC_ENUMERATE_ALL_EXT")));if(ALC10.alcIsExtensionPresent(null,"ALC_ENUMERATE_ALL_EXT"))report.setProperty("actual.endpoint",ALC10.alcGetString(AL.getDevice(),0x1013));
   IntBuffer size=ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1002,size);int count=size.get(0);if(count<0||count>4096)throw new IllegalStateException("Invalid returned attribute count "+count);
   IntBuffer attributes=ByteBuffer.allocateDirect(count*4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1003,attributes);int[] all=new int[count];for(int i=0;i<count;i++)all[i]=attributes.get(i);report.setProperty("actual.allAttributes",Arrays.toString(all));
   report.setProperty("actual.hrtfExtension",Boolean.toString(ALC10.alcIsExtensionPresent(AL.getDevice(),"ALC_SOFT_HRTF")));report.setProperty("actual.loopbackExtension",Boolean.toString(ALC10.alcIsExtensionPresent(null,"ALC_SOFT_loopback")));
   report.setProperty("actual.alcError",Integer.toString(ALC10.alcGetError(AL.getDevice())));
  }catch(Throwable exception){failure=exception;report.setProperty("phase","original-call-failed");report.setProperty("failure",exception.toString());exception.printStackTrace();}
  finally {
   report.setProperty("actual.openalModule",module("OpenAL64.dll"));report.setProperty("actual.lwjglModule",module("lwjgl64.dll"));
   report.setProperty("actual.jvmModule",module("jvm.dll"));report.setProperty("java.exeSha256",fileHash(System.getProperty("java.home")+"/bin/java.exe"));report.setProperty("java.jvmSha256",fileHash(report.getProperty("actual.jvmModule")));
   report.setProperty("originalBufferUnchanged",Boolean.toString(original==null||original.position()==position&&original.limit()==limit&&original.capacity()==capacity));
   report.setProperty("entryCount",Integer.toString(journal.getInt(0)));report.setProperty("nativeJournalPhase",Integer.toString(journal.getInt(4)));report.setProperty("nativePointerOffset",Long.toString(passed-base));
   report.setProperty("pre.words",words(PRE));report.setProperty("post.words",words(POST));report.setProperty("pre.status",Integer.toString(journal.getInt(PRE+4)));report.setProperty("post.status",Integer.toString(journal.getInt(POST+4)));report.setProperty("prePostSame",Boolean.toString(words(PRE).equals(words(POST))&&journal.getInt(PRE+4)==journal.getInt(POST+4)));
   if(AL.isCreated())AL.destroy();report.setProperty("closed","true");save();
  }
  if(failure!=null)System.exit(2);
 }
}
