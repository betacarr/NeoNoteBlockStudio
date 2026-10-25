package studio.nbsx.research;
import java.io.*;
import java.lang.instrument.*;
import java.nio.*;
import java.security.ProtectionDomain;
import java.util.*;
import org.objectweb.asm.*;
import org.lwjgl.MemoryUtil;
import org.lwjgl.openal.*;
import com.sun.jna.Pointer;

/** No sound or context replacement: retain original ALC10 instructions and observe the actual native pointer/result. */
public final class Lwjgl2122ContextAudit {
 private static final String SELF="studio/nbsx/research/Lwjgl2122ContextAudit";
 private static final Properties result=new Properties();private static String output;private static int count;private static long base;
 private static String prefix(){return "entry."+(count-1)+".";}
 private static void save(){try(Writer w=new OutputStreamWriter(new FileOutputStream(output),"UTF-8")){result.store(w,"Original regular default device; no sound, no replacement");}catch(IOException e){e.printStackTrace();}}
 public static void premain(String destination,Instrumentation instrumentation){output=destination;instrumentation.addTransformer(new ClassFileTransformer(){
  public byte[] transform(ClassLoader loader,String name,Class<?> redef,ProtectionDomain domain,byte[] bytes){
   if(!name.equals("org/lwjgl/openal/ALC10"))return null;
   ClassReader reader=new ClassReader(bytes);ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);
   reader.accept(new ClassVisitor(Opcodes.ASM9,writer){public MethodVisitor visitMethod(int access,String method,String descriptor,String signature,String[] exceptions){
    MethodVisitor target=super.visitMethod(access,method,descriptor,signature,exceptions);
    if(!method.equals("alcCreateContext")||!descriptor.equals("(Lorg/lwjgl/openal/ALCdevice;Ljava/nio/IntBuffer;)Lorg/lwjgl/openal/ALCcontext;"))return target;
    return new MethodVisitor(Opcodes.ASM9,target){
     public void visitCode(){super.visitCode();super.visitVarInsn(Opcodes.ALOAD,1);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"observe","(Ljava/nio/IntBuffer;)V",false);}
     public void visitMethodInsn(int opcode,String owner,String called,String desc,boolean itf){
      boolean nativeCall=owner.equals("org/lwjgl/openal/ALC10")&&called.equals("nalcCreateContext")&&desc.equals("(JJ)J");
      if(nativeCall){super.visitInsn(Opcodes.DUP2);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"beforeNative","(J)V",false);}
      super.visitMethodInsn(opcode,owner,called,desc,itf);
      if(nativeCall){super.visitInsn(Opcodes.DUP2);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"nativeResult","(J)V",false);}
     }
    };
   }},0);return writer.toByteArray();
  }
 });}
 public static void observe(IntBuffer original){count++;String p=prefix();result.setProperty("entryCount",Integer.toString(count));
  if(original==null){base=0;result.setProperty(p+"null","true");save();return;}
  int position=original.position(),limit=original.limit();result.setProperty(p+"position",Integer.toString(position));result.setProperty(p+"limit",Integer.toString(limit));result.setProperty(p+"capacity",Integer.toString(original.capacity()));
  List<Integer> full=new ArrayList<Integer>();IntBuffer copy=original.duplicate();copy.clear();while(copy.hasRemaining())full.add(copy.get());result.setProperty(p+"fullBuffer",full.toString());
  base=MemoryUtil.getAddress(original,0);long address=MemoryUtil.getAddressSafe(original);result.setProperty(p+"nativeAddressOffsetBytes",Long.toString(address-base));result.setProperty(p+"nativeFirstWord",Integer.toString(new Pointer(address).getInt(0)));result.setProperty(p+"nativeFirstWordInsideDeclaredBuffer",Boolean.toString(position<original.capacity()));result.setProperty(p+"remaining",Integer.toString(original.remaining()));
  result.setProperty(p+"observerMutatedOriginal",Boolean.toString(original.position()!=position||original.limit()!=limit));save();
 }
 public static void beforeNative(long address){String p=prefix();result.setProperty(p+"actualNativePointerOffsetBytes",Long.toString(address-base));result.setProperty(p+"actualNativeFirstWord",address==0?"null":Integer.toString(new Pointer(address).getInt(0)));result.setProperty(p+"originalNativeCallAboutToExecute","true");save();}
 public static void nativeResult(long context){result.setProperty(prefix()+"originalNativeResultNonzero",Boolean.toString(context!=0));save();}
 public static void main(String[]args)throws Exception{output=args[0];result.setProperty("phase","before-original-AL.create");save();Throwable failure=null;
  try{AL.create();result.setProperty("phase","original-AL.create-returned");result.setProperty("actual.contextCreated",Boolean.toString(AL.getContext()!=null));result.setProperty("actual.backend",AL10.alGetString(AL10.AL_VERSION));
   IntBuffer count=ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1002,count);int size=count.get(0);IntBuffer attrs=ByteBuffer.allocateDirect(size*4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1003,attrs);List<Integer> all=new ArrayList<Integer>();for(int i=0;i<size;i++)all.add(attrs.get(i));result.setProperty("actual.allAttributes",all.toString());result.setProperty("actual.hrtfSupported",Boolean.toString(ALC10.alcIsExtensionPresent(AL.getDevice(),"ALC_SOFT_HRTF")));
  }catch(Throwable e){failure=e;result.setProperty("phase","original-call-failed");result.setProperty("failure",e.toString());e.printStackTrace();}
  finally{if(AL.isCreated())AL.destroy();result.setProperty("closed","true");save();}
  if(failure!=null)System.exit(2);
 }
}
