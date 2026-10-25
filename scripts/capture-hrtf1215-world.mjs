import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { digest, verifiedArtifact } from './research-utils.mjs';
import assert from 'node:assert/strict';
// Independent mapped 1.21.5 HRTF transition capture; shared harness remains unchanged.
const version='1.21.5';

const legacy=version==='1.16.5',fixture=JSON.parse(await readFile(`.local/game-fixtures/${version}/fixture.json`,'utf8'));
const metadata=JSON.parse(await readFile(`.research/metadata/${version}.json`,'utf8'));
assert.equal(digest(await readFile(path.join(fixture.root,'versions',version,version+'.jar'))),metadata.downloads.client.sha1);
const indexBytes=await readFile(path.join(fixture.root,'assets/indexes',fixture.assetIndex.id+'.json'));assert.equal(digest(indexBytes),metadata.assetIndex.sha1);
const bootstrapAssets=Object.entries(JSON.parse(indexBytes).objects).filter(([name])=>!name.includes('/sounds/')&&(!name.includes('/lang/')||name.endsWith('/en_us.json')));
let assetCursor=0;await Promise.all(Array.from({length:3},async()=>{while(assetCursor<bootstrapAssets.length){const [,object]=bootstrapAssets[assetCursor++];await verifiedArtifact({url:`https://resources.download.minecraft.net/${object.hash.slice(0,2)}/${object.hash}`,sha1:object.hash,size:object.size},path.join(fixture.root,'assets/objects',object.hash.slice(0,2),object.hash));}}));
const java=metadata.javaVersion.majorVersion>16?JSON.parse(await readFile(`.local/runtimes/temurin-${Math.max(21,metadata.javaVersion.majorVersion)}/runtime.json`,'utf8')).executable:'java';
const master=process.argv.includes('--master')?Number(process.argv[process.argv.indexOf('--master')+1]):1;if(!Number.isFinite(master)||master<0||master>1)throw new Error('Invalid master volume');
const hrtf=process.argv.includes('--hrtf'),polyphony=process.argv.includes('--polyphony');
const mappings=await readFile(`.research/source-comparison/${version}/mappings.txt`,'utf8');
assert.equal(digest(Buffer.from(mappings)),metadata.downloads.client_mappings.sha1);
const block=name=>{const start=mappings.indexOf(name+' -> ');if(start<0)throw new Error(`Missing class ${name}`);return mappings.slice(start).split(/\n(?=\S[^\n]* -> )/)[0];};
const className=name=>block(name).split('\n')[0].split(' -> ')[1].slice(0,-1);
const method=(owner,signature)=>{const line=block(owner).split('\n').find(l=>l.includes(signature+' -> '));if(!line)throw new Error(`Missing ${owner}.${signature}`);return line.split(' -> ')[1];};
const field=(owner,name)=>{const line=block(owner).split('\n').find(l=>l.trim().split(' -> ')[0].endsWith(' '+name));if(!line)throw new Error(`Missing ${owner}.${name}`);return line.split(' -> ')[1];};
const runId=String(Date.now());
const target=path.resolve('.local/world-hrtf1215'),output=path.join(target,`capture-${runId}`),game=path.join(output,'game');await mkdir(game,{recursive:true});
const asmUrl='https://repo.maven.apache.org/maven2/org/ow2/asm/asm/9.7.1/asm-9.7.1.jar';
const sha=(await fetch(asmUrl+'.sha256').then(r=>r.text())).trim();
const asm=path.resolve('.research/tools/asm-9.7.1.jar');await verifiedArtifact({url:asmUrl,sha256:sha},asm,'sha256');
const mc='net.minecraft.client.Minecraft',library='com.mojang.blaze3d.audio.Library',channel='com.mojang.blaze3d.audio.Channel',note='net.minecraft.world.level.block.NoteBlock';
const instruments=['harp','bass','basedrum','snare','hat','guitar','flute','bell','chime','xylophone','iron_xylophone','cow_bell','didgeridoo','bit','banjo','pling'];
const bases=['DIRT','OAK_PLANKS','STONE','SAND','GLASS','WHITE_WOOL','CLAY','GOLD_BLOCK','PACKED_ICE','BONE_BLOCK','IRON_BLOCK','SOUL_SAND','PUMPKIN','EMERALD_BLOCK','HAY_BLOCK','GLOWSTONE'];
const instrumentType='net.minecraft.world.level.block.state.properties.NoteBlockInstrument';
const config={worldName:`nbsx-audio-verification-${runId}`,output:output.replaceAll('\\','/'),minecraft:className(mc),library:className(library),channel:className(channel),noteBlock:className(note),window:className('com.mojang.blaze3d.platform.Window'),
    hrtf:hrtf?'true':'false',
    openDevice:legacy?method(library,'long tryOpenDevice()'):'',tick:method(mc,'void runTick(boolean)'),channelPlay:method(channel,'void play()'),noteEvent:method(note,'boolean triggerEvent(net.minecraft.world.level.block.state.BlockState,net.minecraft.world.level.Level,net.minecraft.core.BlockPos,int,int)'),sourceId:field(channel,'source'),
    overlay:method(mc,'net.minecraft.client.gui.screens.Overlay getOverlay()'),server:method(mc,'net.minecraft.client.server.IntegratedServer getSingleplayerServer()'),player:field(mc,'player'),stop:method(mc,'void stop()'),
    levelSettings:className('net.minecraft.world.level.LevelSettings'),gameType:className('net.minecraft.world.level.GameType'),creative:field('net.minecraft.world.level.GameType','CREATIVE'),difficulty:className('net.minecraft.world.Difficulty'),peaceful:field('net.minecraft.world.Difficulty','PEACEFUL'),gameRules:className('net.minecraft.world.level.GameRules'),
    noGravity:method('net.minecraft.world.entity.Entity','void setNoGravity(boolean)'),moveTo:method('net.minecraft.world.entity.Entity','void absSnapTo(double,double,double,float,float)'),execute:'execute',
    playerList:method('net.minecraft.server.MinecraftServer','net.minecraft.server.players.PlayerList getPlayerList()'),players:method('net.minecraft.server.players.PlayerList','java.util.List getPlayers()'),connection:field('net.minecraft.server.level.ServerPlayer','connection'),teleport:method('net.minecraft.server.network.ServerGamePacketListenerImpl','void teleport(double,double,double,float,float)'),
    overworld:method('net.minecraft.server.MinecraftServer','net.minecraft.server.level.ServerLevel overworld()'),blocks:className('net.minecraft.world.level.block.Blocks'),noteBlockConstant:field('net.minecraft.world.level.block.Blocks','NOTE_BLOCK'),air:field('net.minecraft.world.level.block.Blocks','AIR'),dirt:field('net.minecraft.world.level.block.Blocks','DIRT'),defaultState:method('net.minecraft.world.level.block.Block','net.minecraft.world.level.block.state.BlockState defaultBlockState()'),
    blockPos:className('net.minecraft.core.BlockPos'),noteProperty:field(note,'NOTE'),setValue:method('net.minecraft.world.level.block.state.StateHolder','java.lang.Object setValue(net.minecraft.world.level.block.state.properties.Property,java.lang.Comparable)'),setBlock:method('net.minecraft.world.level.Level','boolean setBlock(net.minecraft.core.BlockPos,net.minecraft.world.level.block.state.BlockState,int)'),blockEvent:method('net.minecraft.world.level.Level','void blockEvent(net.minecraft.core.BlockPos,net.minecraft.world.level.block.Block,int,int)'),
    instrumentProperty:field(note,'INSTRUMENT'),instrumentType:className(instrumentType),
};
if(legacy)Object.assign(config,{
    registryAccess:className('net.minecraft.core.RegistryAccess'),builtin:method('net.minecraft.core.RegistryAccess','net.minecraft.core.RegistryAccess$RegistryHolder builtin()'),worldGen:className('net.minecraft.world.level.levelgen.WorldGenSettings'),demoGeneration:method('net.minecraft.world.level.levelgen.WorldGenSettings','net.minecraft.world.level.levelgen.WorldGenSettings demoSettings(net.minecraft.core.RegistryAccess)'),
    dataPackConfig:className('net.minecraft.world.level.DataPackConfig'),defaultDataPack:field('net.minecraft.world.level.DataPackConfig','DEFAULT'),createLevel:method(mc,'void createLevel(java.lang.String,net.minecraft.world.level.LevelSettings,net.minecraft.core.RegistryAccess$RegistryHolder,net.minecraft.world.level.levelgen.WorldGenSettings)'),
    instrumentByState:method(instrumentType,'net.minecraft.world.level.block.state.properties.NoteBlockInstrument byState(net.minecraft.world.level.block.state.BlockState)'),
});else if(version==='1.19.2')Object.assign(config,{
    registryAccess:className('net.minecraft.core.RegistryAccess'),builtin:method('net.minecraft.core.RegistryAccess','net.minecraft.core.RegistryAccess$Writable builtinCopy()'),worldGen:className('net.minecraft.world.level.levelgen.presets.WorldPresets'),demoGeneration:method('net.minecraft.world.level.levelgen.presets.WorldPresets','net.minecraft.world.level.levelgen.WorldGenSettings demoSettings(net.minecraft.core.RegistryAccess)'),
    dataPackConfig:className('net.minecraft.world.level.DataPackConfig'),defaultDataPack:field('net.minecraft.world.level.DataPackConfig','DEFAULT'),
    worldFlows:method(mc,'net.minecraft.client.gui.screens.worldselection.WorldOpenFlows createWorldOpenFlows()'),createFreshLevel:method('net.minecraft.client.gui.screens.worldselection.WorldOpenFlows','void createFreshLevel(java.lang.String,net.minecraft.world.level.LevelSettings,net.minecraft.core.RegistryAccess,net.minecraft.world.level.levelgen.WorldGenSettings)'),
    instrumentByState:method(instrumentType,'net.minecraft.world.level.block.state.properties.NoteBlockInstrument byState(net.minecraft.world.level.block.state.BlockState)'),
});else Object.assign(config,{
    dataPackConfig:className('net.minecraft.world.level.WorldDataConfiguration'),defaultDataPack:field('net.minecraft.world.level.WorldDataConfiguration','DEFAULT'),worldOptions:className('net.minecraft.world.level.levelgen.WorldOptions'),demoOptions:field('net.minecraft.world.level.levelgen.WorldOptions','DEMO_OPTIONS'),
    worldPresets:className('net.minecraft.world.level.levelgen.presets.WorldPresets'),normalDimensions:method('net.minecraft.world.level.levelgen.presets.WorldPresets','net.minecraft.world.level.levelgen.WorldDimensions createNormalWorldDimensions(net.minecraft.core.HolderLookup$Provider)'),
    worldFlows:method(mc,'net.minecraft.client.gui.screens.worldselection.WorldOpenFlows createWorldOpenFlows()'),createFreshLevel:method('net.minecraft.client.gui.screens.worldselection.WorldOpenFlows',version==='1.20.2'?'void createFreshLevel(java.lang.String,net.minecraft.world.level.LevelSettings,net.minecraft.world.level.levelgen.WorldOptions,java.util.function.Function)':'void createFreshLevel(java.lang.String,net.minecraft.world.level.LevelSettings,net.minecraft.world.level.levelgen.WorldOptions,java.util.function.Function,net.minecraft.client.gui.screens.Screen)'),
    setInstrument:method(note,'net.minecraft.world.level.block.state.BlockState setInstrument(net.minecraft.world.level.LevelReader,net.minecraft.core.BlockPos,net.minecraft.world.level.block.state.BlockState)'),
});
Object.assign(config,{
    master:String(master),records:'1',loaded:method(mc,'boolean isGameLoadFinished()'),
    featureFlagSet:className('net.minecraft.world.flag.FeatureFlagSet'),enabledFeatures:method('net.minecraft.world.level.WorldDataConfiguration','net.minecraft.world.flag.FeatureFlagSet enabledFeatures()'),
    getValue:method('net.minecraft.world.level.block.state.StateHolder','java.lang.Comparable getValue(net.minecraft.world.level.block.state.properties.Property)'),instrumentName:method(instrumentType,'java.lang.String getSerializedName()'),
    options:field(mc,'options'),soundSource:className('net.minecraft.sounds.SoundSource'),sourceMaster:field('net.minecraft.sounds.SoundSource','MASTER'),sourceRecords:field('net.minecraft.sounds.SoundSource','RECORDS'),sourceBlocks:field('net.minecraft.sounds.SoundSource','BLOCKS'),
    optionVolume:method('net.minecraft.client.Options','float getSoundSourceVolume(net.minecraft.sounds.SoundSource)'),optionDirectional:method('net.minecraft.client.Options','net.minecraft.client.OptionInstance directionalAudio()'),optionGet:method('net.minecraft.client.OptionInstance','java.lang.Object get()'),
});

for(let i=0;i<instruments.length;i++){config[`instrument.${i}`]=instruments[i];config[`base.${i}`]=field('net.minecraft.world.level.block.Blocks',bases[i]);}
const cases=[[0,0,12,0],[2,0,12,0],[-2,0,12,0],[0,12,12,0],[0,-12,12,0],[0,40,12,0],[0,48,12,0],[0,0,0,0],[0,0,24,0]];
for(let i=1;i<instruments.length;i++)for(const note of [0,12,24])cases.push([0,0,note,i]);
const grid=(count,mixed)=>Array.from({length:count},(_,i)=>[(i%8)*3-10,Math.floor(i/8)*3-10,mixed?[0,4,7,12,16,19,24][i%7]:12,mixed?i%16:0]);
const scenes=polyphony?[
 {name:'harp-triad',notes:[[-3,0,0,0],[0,0,12,0],[3,0,24,0]]},
 {name:'mixed-six',notes:Array.from({length:6},(_,i)=>[i*3-7,0,[0,7,12,16,19,24][i],[0,1,5,6,7,15][i]])},
 {name:'all-sixteen-instruments',notes:grid(16,true)},
 {name:'thirty-two-identical-harps',notes:grid(32,false)},
 {name:'sixty-four-mixed-notes',notes:grid(64,true)},
]:cases.slice(0,process.argv.includes('--quick')?9:54).map((note,i)=>({name:`single-${i}`,notes:[note]}));
config.caseLimit=String(scenes.length);
for(let i=0;i<scenes.length;i++){config[`scene.${i}`]=scenes[i].notes.map(note=>note.join(',')).join(';');config[`sceneName.${i}`]=scenes[i].name;}
await writeFile(path.join(output,'cases.json'),JSON.stringify(scenes));
const configFile=path.join(output,'agent.properties');await writeFile(configFile,Object.entries(config).map(([key,value])=>`${key}=${value}`).join('\n'));
const classes=path.join(output,'classes');await mkdir(classes,{recursive:true});
const compile=spawnSync('javac',['--release','8','-cp',[asm,...fixture.classpath].join(path.delimiter),'-d',classes,'scripts/java/WorldCapture1215Agent.java'],{windowsHide:true,encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);
const manifest=path.join(output,'MANIFEST.MF');await writeFile(manifest,'Manifest-Version: 1.0\nPremain-Class: studio.nbsx.research.WorldCapture1215Agent\n\n');
const agent=path.join(output,'world-capture-agent.jar');const jar=spawnSync('jar',['cfm',agent,manifest,'-C',classes,'.'],{windowsHide:true,encoding:'utf8'});assert.equal(jar.status,0,jar.stderr);
await copyFile('scripts/java/WorldCapture1215Agent.java',path.join(output,'WorldCapture1215Agent.java'));
await writeFile(path.join(game,'options.txt'),`renderDistance:2\nmaxFps:30\npauseOnLostFocus:false\ntutorialStep:none\ndirectionalAudio:${hrtf}\nsoundCategory_master:${master}\nsoundCategory_record:1.0\nsoundCategory_music:0.0\nsoundCategory_weather:0.0\nsoundCategory_hostile:0.0\nsoundCategory_neutral:0.0\nsoundCategory_player:0.0\nsoundCategory_ambient:0.0\nsoundCategory_block:0.0\n`);
const args=['-Xmx2G','-XX:ActiveProcessorCount=4',`-XX:ErrorFile=${path.join(output,'hs_err_pid%p.log')}`,`-Dorg.lwjgl.librarypath=${fixture.nativeDir}`,`-Djava.library.path=${fixture.nativeDir}`,`-javaagent:${agent}=${configFile}`,'-cp',[agent,asm,...fixture.classpath].join(path.delimiter),'net.minecraft.client.main.Main','--version',version,'--username','NBSX_Audio_Probe','--uuid','00000000000000000000000000000001','--accessToken','0','--userType','legacy','--gameDir',game,'--assetsDir',path.join(fixture.root,'assets'),'--assetIndex',fixture.assetIndex.id,'--width','640','--height','480'];
const provenance={schema:3,version,agentFile:'world-capture-agent.jar',agentSourceFile:'WorldCapture1215Agent.java',captureScriptFile:'capture-hrtf1215-world.mjs',captureScriptSha256:digest(await readFile('scripts/capture-hrtf1215-world.mjs'),'sha256'),mappingsSha1:digest(Buffer.from(mappings)),clientSha1:fixture.clientSha1,agentSha256:digest(await readFile(agent),'sha256'),agentSourceSha256:digest(await readFile('scripts/java/WorldCapture1215Agent.java'),'sha256'),asmSha256:sha,bootstrapAssets:bootstrapAssets.map(([name,object])=>({name,sha1:object.hash})),world:path.join(game,'saves',config.worldName),output,hrtf,polyphony,masterGain:master,recordCategoryVolume:1,javaExecutable:java,recordingMethod:'real integrated world, original NoteBlock/SoundEngine and material selection; original HRTF/profile/limiter context attributes preserved; only loopback format/rate added; original Options selects HRTF; window hidden by research agent'};
await writeFile(path.join(output,'provenance.json'),JSON.stringify(provenance,null,2));await writeFile(path.join(target,'latest.json'),JSON.stringify(provenance,null,2));
await copyFile('scripts/capture-hrtf1215-world.mjs',path.join(output,'capture-hrtf1215-world.mjs'));
const log=createWriteStream(path.join(output,'client.log'));const child=spawn(java,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],cwd:game});
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log.write(chunk);for(const line of String(chunk).split(/\r?\n/))if(line.includes('NBSX_CAPTURE'))console.log(line.slice(0,300));});
const timeout=setTimeout(()=>{console.error('World capture exceeded three minutes');child.kill();},180000);
const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearTimeout(timeout);log.end();
console.log(JSON.stringify({exit,output,log:path.join(output,'client.log')}));if(exit!==0)throw new Error('Original 1.21.5 client failed; retain log and provenance');
await readFile(path.join(output,'complete.txt'));
for(let i=0;i<scenes.length;i++){assert.equal((await readFile(path.join(output,`case-${i}.pcm`))).length,144000*4);await readFile(path.join(output,`case-${i}.properties`));}
provenance.status='capture-complete-not-compared';await writeFile(path.join(output,'provenance.json'),JSON.stringify(provenance,null,2));await writeFile(path.join(target,'latest.json'),JSON.stringify(provenance,null,2));
