package studio.nbsx.research;

import java.io.*;
import java.lang.reflect.*;
import java.net.URL;
import java.security.MessageDigest;
import java.util.*;

/** Calls unchanged original resource traversal/dispatch/pool bytecode; no audio system is constructed. */
public class Legacy10Resources {
    static Field field(Class<?> type,String name)throws Exception{Field f=type.getDeclaredField(name);f.setAccessible(true);return f;}
    static Object allocate(Class<?> type)throws Exception{
        Class<?> u=Class.forName("sun.misc.Unsafe");Field singleton=u.getDeclaredField("theUnsafe");singleton.setAccessible(true);
        return u.getMethod("allocateInstance",Class.class).invoke(singleton.get(null),type);
    }
    static String sha1(byte[] bytes)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-1").digest(bytes))s.append(String.format("%02x",b&255));return s.toString();}
    static byte[] read(URL url)throws Exception{try(InputStream in=url.openStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))>=0)out.write(b,0,n);return out.toByteArray();}}
    public static void main(String[] args)throws Exception{
        Class<?> minecraft=Class.forName("net.minecraft.client.Minecraft"),manager=Class.forName("ahm"),pool=Class.forName("cf"),entry=Class.forName("lr");
        // Original concrete desktop subclass; its constructor and Frame are never invoked.
        Object game=allocate(Class.forName("ahy")),engine=manager.getConstructor().newInstance();field(minecraft,"C").set(game,engine);
        Class<?> downloader=Class.forName("ng");Object walker=downloader.getConstructor(File.class,minecraft).newInstance(new File(args[0]),game);
        downloader.getMethod("a").invoke(walker);
        Object sounds=field(manager,"b").get(engine);int registered=field(pool,"a").getInt(sounds);
        if(registered!=7)throw new AssertionError("Expected seven newsound files and zero sound3 registrations: "+registered);
        System.out.println("TREE\t"+registered);
        for(String name:new String[]{"harp","bassattack","bd","snare","hat","pling"}){
            String event="note."+name;Object selected=pool.getMethod("a",String.class).invoke(sounds,event);
            if(selected==null)throw new AssertionError("Missing original event "+event);
            URL url=(URL)field(entry,"b").get(selected);byte[] bytes=read(url);
            System.out.println("SAMPLE\t"+event+"\t"+field(entry,"a").get(selected)+"\t"+url.toExternalForm()+"\t"+sha1(bytes)+"\t"+bytes.length);
        }
        for(String prefix:new String[]{"newsound","sound","NEWSOUND","sound3","streaming","music","newmusic","unknown"}){
            Object fresh=manager.getConstructor().newInstance();field(minecraft,"C").set(game,fresh);
            minecraft.getMethod("a",String.class,File.class).invoke(game,prefix+"/note/harp.ogg",new File(args[0],"resources/newsound/note/harp.ogg"));
            StringBuilder counts=new StringBuilder();
            for(String member:new String[]{"b","c","d"}){if(counts.length()>0)counts.append(',');counts.append(field(pool,"a").getInt(field(manager,member).get(fresh)));}
            System.out.println("DISPATCH\t"+prefix+"\t"+counts);
        }
    }
}
