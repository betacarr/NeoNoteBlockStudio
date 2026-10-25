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

/** No sound, no context replacement: observe the original AL.create() call at ALC10 method entry. */
public final class Lwjgl21710ContextAudit {
    private static final String SELF="studio/nbsx/research/Lwjgl21710ContextAudit";
    private static final Properties result=new Properties();
    public static void premain(String ignored, Instrumentation instrumentation) {
        instrumentation.addTransformer(new ClassFileTransformer() {
            public byte[] transform(ClassLoader loader,String name,Class<?> redef,ProtectionDomain domain,byte[] bytes) {
                if(!name.equals("org/lwjgl/openal/ALC10"))return null;
                ClassReader reader=new ClassReader(bytes);ClassWriter writer=new ClassWriter(ClassWriter.COMPUTE_MAXS);
                reader.accept(new ClassVisitor(Opcodes.ASM9,writer) {
                    public MethodVisitor visitMethod(int access,String method,String descriptor,String signature,String[] exceptions) {
                        MethodVisitor target=super.visitMethod(access,method,descriptor,signature,exceptions);
                        if(!method.equals("alcCreateContext")||!descriptor.equals("(Lorg/lwjgl/openal/ALCdevice;Ljava/nio/IntBuffer;)Lorg/lwjgl/openal/ALCcontext;"))return target;
                        return new MethodVisitor(Opcodes.ASM9,target) {
                            public void visitCode(){super.visitCode();super.visitVarInsn(Opcodes.ALOAD,1);super.visitMethodInsn(Opcodes.INVOKESTATIC,SELF,"observe","(Ljava/nio/IntBuffer;)V",false);}
                        };
                    }
                },0);return writer.toByteArray();
            }
        });
    }
    public static void observe(IntBuffer original) {
        if(original==null){result.setProperty("entry.null","true");return;}
        int position=original.position(),limit=original.limit();
        result.setProperty("entry.position",Integer.toString(position));result.setProperty("entry.limit",Integer.toString(limit));result.setProperty("entry.capacity",Integer.toString(original.capacity()));
        IntBuffer copy=original.duplicate();copy.clear();List<Integer> full=new ArrayList<Integer>();while(copy.hasRemaining())full.add(copy.get());result.setProperty("entry.fullBuffer",full.toString());
        long base=MemoryUtil.getAddress(original,0),address=MemoryUtil.getAddressSafe(original);result.setProperty("entry.nativeAddressOffsetBytes",Long.toString(address-base));
        // This is explicitly outside the declared Java buffer when position==capacity.
        // Read only the first word which the original native call itself will read.
        result.setProperty("entry.nativeFirstWord",Integer.toString(new Pointer(address).getInt(0)));
        result.setProperty("entry.nativeFirstWordInsideDeclaredBuffer",Boolean.toString(position<original.capacity()));
        if(original.position()!=position||original.limit()!=limit)throw new IllegalStateException("Observer mutated original bounds");
        result.setProperty("entry.observerMutatedOriginal","false");
    }
    public static void main(String[] args)throws Exception {
        try {
            AL.create();
            result.setProperty("actual.backend",AL10.alGetString(AL10.AL_VERSION));
            result.setProperty("actual.contextCreated",Boolean.toString(AL.isCreated()));
            IntBuffer count=ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1002,count);int size=count.get(0);
            IntBuffer attrs=ByteBuffer.allocateDirect(size*4).order(ByteOrder.nativeOrder()).asIntBuffer();ALC10.alcGetInteger(AL.getDevice(),0x1003,attrs);List<Integer> all=new ArrayList<Integer>();for(int i=0;i<size;i++)all.add(attrs.get(i));result.setProperty("actual.allAttributes",all.toString());
            result.setProperty("actual.hrtfSupported",Boolean.toString(ALC10.alcIsExtensionPresent(AL.getDevice(),"ALC_SOFT_HRTF")));
        } finally {
            if(AL.isCreated())AL.destroy();
            try(Writer file=new OutputStreamWriter(new FileOutputStream(args[0]),"UTF-8")){result.store(file,"Original regular device/context, no audio, no replacement");}
        }
    }
}
