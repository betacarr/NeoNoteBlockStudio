package paulscode.sound;

import java.net.URL;

/** Deliberately incomplete no-audio boundary recorder used only by research.
 * This is not the original SoundSystem, decoder or mixer. */
public class SoundSystem {
    public boolean played;
    public float gain,pitch,range;
    public void reset(){played=false;gain=pitch=range=Float.NaN;}
    public void newSource(boolean priority,String name,URL url,String file,boolean loop,float x,float y,float z,int model,float distance){range=distance;}
    public void setPitch(String name,float value){pitch=value;}
    public void setVolume(String name,float value){gain=value;}
    public void play(String name){played=true;}
}
