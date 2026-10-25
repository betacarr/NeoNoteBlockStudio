package studio.nbsx.research;

import java.io.*;
import java.lang.reflect.*;
import java.net.URL;
import java.security.MessageDigest;
import java.util.*;

/** Runs hash-bound original directory/dispatch/pool bytecode, with no game/audio initialization. */
public final class Pre17Resources {
    static Properties config=new Properties();
    static String key(String name){String value=config.getProperty(name);if(value==null)throw new IllegalArgumentException(name);return value;}
    static Class<?> type(String name)throws Exception{return Class.forName(key(name).replace('/','.'));}
    static Field field(Class<?> type,String name)throws Exception{Field f=type.getDeclaredField(name);f.setAccessible(true);return f;}
    static Object allocate(Class<?> type)throws Exception{Class<?> u=Class.forName("sun.misc.Unsafe");Field f=u.getDeclaredField("theUnsafe");f.setAccessible(true);return u.getMethod("allocateInstance",Class.class).invoke(f.get(null),type);}
    static String sha1(byte[] bytes)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-1").digest(bytes))out.append(String.format("%02x",b&255));return out.toString();}
    static byte[] read(URL url)throws Exception{try(InputStream in=url.openStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}}
    public static void main(String[] args)throws Exception{
        try(InputStream in=new FileInputStream(args[0])){config.load(in);}
        Class<?> minecraft=type("Minecraft"),manager=type("SoundManager"),pool=type("SoundPool"),entry=type("SoundPoolEntry");
        Object game=allocate(type("ConcreteMinecraft")),engine=manager.getConstructor().newInstance();field(minecraft,key("managerField")).set(game,engine);
        Class<?> downloader=type("ResourceDownloader");Object walker=downloader.getConstructor(File.class,minecraft).newInstance(new File(args[1]),game);
        // The download thread is deliberately never started; this is its original local-tree path.
        downloader.getMethod(key("walkMethod")).invoke(walker);
        Object sounds=field(manager,key("soundPoolField")).get(engine);int registered=field(pool,key("poolCountField")).getInt(sounds);
        if(registered!=7)throw new AssertionError("Expected exactly seven files from the original accepted prefix, got "+registered);
        System.out.println("TREE\t"+registered);
        for(String name:new String[]{"harp","bassattack","bd","snare","hat","pling"}){
            String event="note."+name;Object selected=pool.getMethod(key("lookupMethod"),String.class).invoke(sounds,event);
            if(selected==null)throw new AssertionError("Missing event "+event);
            URL url=(URL)field(entry,key("entryUrlField")).get(selected);byte[] bytes=read(url);
            System.out.println("SAMPLE\t"+event+"\t"+field(entry,key("entryNameField")).get(selected)+"\t"+url.toExternalForm()+"\t"+sha1(bytes)+"\t"+bytes.length);
        }
        Method dispatch=minecraft.getMethod(key("dispatchMethod"),String.class,File.class);
        for(String prefix:new String[]{"newsound","sound","NEWSOUND","sound3","SOUND3","streaming","music","newmusic","unknown"}){
            Object fresh=manager.getConstructor().newInstance();field(minecraft,key("managerField")).set(game,fresh);
            dispatch.invoke(game,prefix+"/note/harp.ogg",new File(args[1],"resources/"+key("expectedPrefix")+"/note/harp.ogg"));
            StringBuilder counts=new StringBuilder();for(String member:key("poolFields").split(",")){if(counts.length()>0)counts.append(',');counts.append(field(pool,key("poolCountField")).getInt(field(manager,member).get(fresh)));}
            System.out.println("DISPATCH\t"+prefix+"\t"+counts);
        }
    }
}
