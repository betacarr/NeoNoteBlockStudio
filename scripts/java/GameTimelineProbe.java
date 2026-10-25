package studio.nbsx.research;

import java.io.*;
import java.lang.reflect.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import javax.sound.sampled.AudioFormat;
import org.lwjgl.openal.*;

/** Controlled component timelines, not a game-world/tick/network recorder. */
public final class GameTimelineProbe {
    private static Properties config;
    private static String key(String name) { return config.getProperty(name); }
    private static void le(DataOutputStream out, int value) throws IOException { out.writeInt(Integer.reverseBytes(value)); }
    public static void main(String[] args) throws Exception {
        config = new Properties();
        try (Reader in = new InputStreamReader(new FileInputStream(args[0]), "UTF-8")) { config.load(in); }
        List<String> cases = Files.readAllLines(Paths.get(args[1]));
        try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(args[2])))) {
            out.writeBytes("NBST"); le(out, cases.size());
            for (String line : cases) capture(line, out);
        }
    }
    private static void capture(String line, DataOutputStream out) throws Exception {
        String[] parts = line.split("\\|", -1);
        boolean hrtf = Boolean.parseBoolean(parts[1]); int rate = 48000, frames = Integer.parseInt(parts[2]);
        float master = Float.parseFloat(parts[3]);
        String[] events = parts[4].isEmpty() ? new String[0] : parts[4].split(";");
        long device = SOFTLoopback.alcLoopbackOpenDeviceSOFT((ByteBuffer)null);
        if (device == 0) throw new IOException("No loopback device");
        long context = 0; List<Object> channels = new ArrayList<Object>(); Object codec = null, buffer = null;
        Class<?> channelType = Class.forName(key("channel")), bufferType = Class.forName(key("buffer")), vectorType = Class.forName(key("vector"));
        Class<?> listenerType = Class.forName(key("listener")), codecType = Class.forName(key("codec"));
        try {
            ALCCapabilities capabilities = ALC.createCapabilities(device);
            if (!capabilities.ALC_SOFT_HRTF || !ALC10.alcIsExtensionPresent(device, "ALC_SOFT_output_limiter")) throw new IOException("Missing controlled context extensions");
            context = ALC10.alcCreateContext(device, new int[]{0x1990,0x1501,0x1991,0x1406,0x1007,rate,0x1010,4096,0x1992,hrtf?1:0,0x199A,1,0});
            if (context == 0 || !ALC10.alcMakeContextCurrent(context)) throw new IOException("No controlled context");
            AL.createCapabilities(capabilities);
            if ((ALC10.alcGetInteger(device,0x1992)!=0)!=hrtf || ALC10.alcGetInteger(device,0x199A)!=1) throw new IOException("Context state differs");
            AL10.alEnable(0x200); AL10.alDopplerFactor(0);
            Object listener = listenerType.getConstructor().newInstance();
            listenerType.getMethod(key("resetListener")).invoke(listener);
            listenerType.getMethod(key("listenerGain"),float.class).invoke(listener,master);
            codec = codecType.getConstructor(InputStream.class).newInstance(new FileInputStream(key("sample")));
            AudioFormat format = (AudioFormat)codecType.getMethod(key("format")).invoke(codec);
            ByteBuffer pcm = (ByteBuffer)codecType.getMethod(key("readAll")).invoke(codec);
            buffer = bufferType.getConstructor(ByteBuffer.class,AudioFormat.class).newInstance(pcm,format);
            Method create = channelType.getDeclaredMethod(key("createChannel")); create.setAccessible(true);
            float[] samples = new float[frames*2]; int cursor=0, next=0, actualEvents=0;
            while(cursor<frames){
                while(next<events.length){
                    String[] values=events[next].split(","); int at=Integer.parseInt(values[0]);
                    if(at>cursor)break; if(at!=cursor)throw new IOException("Reference events must be sorted and on exact frame");
                    Object channel=create.invoke(null); if(channel==null)throw new IOException("Original Channel allocation failed"); channels.add(channel);
                    channelType.getMethod(key("attach"),bufferType).invoke(channel,buffer);
                    Object position=vectorType.getConstructor(double.class,double.class,double.class).newInstance((double)Float.parseFloat(values[1]),(double)Float.parseFloat(values[2]),(double)Float.parseFloat(values[3]));
                    channelType.getMethod(key("position"),vectorType).invoke(channel,position);
                    channelType.getMethod(key("pitch"),float.class).invoke(channel,Float.parseFloat(values[4]));
                    channelType.getMethod(key("gain"),float.class).invoke(channel,Float.parseFloat(values[5]));
                    channelType.getMethod(key("attenuation"),float.class).invoke(channel,48f);
                    channelType.getMethod(key("play")).invoke(channel); next++; actualEvents++;
                }
                int boundary=next<events.length?Integer.parseInt(events[next].split(",",2)[0]):frames;
                int count=Math.min(1024,Math.min(frames-cursor,boundary-cursor));
                if(count<=0)throw new IOException("Invalid reference frame boundary");
                float[] block=new float[count*2]; SOFTLoopback.alcRenderSamplesSOFT(device,block,count);
                System.arraycopy(block,0,samples,cursor*2,block.length); cursor+=count;
            }
            if(AL10.alGetError()!=0)throw new IOException("Original channel OpenAL error");
            le(out,rate);le(out,frames);le(out,actualEvents);le(out,ALC10.alcGetInteger(device,0x1993));le(out,ALC10.alcGetInteger(device,0x199A));
            for(float input:samples){double value=Math.max(-1,Math.min(1,(double)input));int value16=(int)Math.round(value*(value<0?32768.0:32767.0));out.writeByte(value16&255);out.writeByte((value16>>>8)&255);}
            System.out.println(parts[0]+" events="+actualEvents+" frames="+frames+" backend="+AL10.alGetString(AL10.AL_VERSION));
        } finally {
            if(codec!=null)codecType.getMethod("close").invoke(codec);
            for(Object channel:channels)channelType.getMethod(key("destroyChannel")).invoke(channel);
            if(buffer!=null)bufferType.getMethod(key("discardBuffer")).invoke(buffer);
            ALC10.alcMakeContextCurrent(0);if(context!=0)ALC10.alcDestroyContext(context);ALC10.alcCloseDevice(device);
        }
    }
}
