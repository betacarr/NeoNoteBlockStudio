package studio.nbsx.research;
import java.lang.reflect.*;
import java.nio.*;
/** Only executes the original attribute-list builder; never opens an AL device or context. */
public final class Lwjgl2111ContextAttributeProbe {
  public static void main(String[]args)throws Exception{
    Method m=Class.forName("org.lwjgl.openal.ALCcontext").getDeclaredMethod("createAttributeList",int.class,int.class,int.class);m.setAccessible(true);
    IntBuffer b=(IntBuffer)m.invoke(null,44100,60,0);System.out.print("[");for(int i=0;i<b.position();i++){if(i>0)System.out.print(",");System.out.print(b.get(i));}System.out.println("]");
  }
}
