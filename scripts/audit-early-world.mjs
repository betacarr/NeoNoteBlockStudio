import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest, verifiedArtifact } from './research-utils.mjs';
import { fileURLToPath } from 'node:url';

export function methodCodeHashes(input) {
  const bytes=Buffer.from(input); let at=8; const u1=()=>bytes.readUInt8(at++),u2=()=>{const v=bytes.readUInt16BE(at);at+=2;return v;},u4=()=>{const v=bytes.readUInt32BE(at);at+=4;return v;};
  const pool=new Array(u2());
  for(let i=1;i<pool.length;i++){const tag=u1();if(tag===1){const n=u2();pool[i]=bytes.toString('utf8',at,at+n);at+=n;}else if([3,4,9,10,11,12,17,18].includes(tag))at+=4;else if([5,6].includes(tag)){at+=8;i++;}else if([7,8,16,19,20].includes(tag))at+=2;else if(tag===15)at+=3;else throw Error(`Unknown constant pool tag ${tag}`);}
  at+=6;const interfaces=u2();at+=interfaces*2;
  const skipAttributes=()=>{for(let n=u2();n>0;n--){at+=2;const length=u4();at+=length;}};
  for(let n=u2();n>0;n--){at+=6;skipAttributes();}
  const methods={};
  for(let n=u2();n>0;n--){at+=2;const name=pool[u2()],descriptor=pool[u2()];for(let attrs=u2();attrs>0;attrs--){const attr=pool[u2()],length=u4(),end=at+length;if(attr==='Code'){at+=4;const size=u4();methods[name+descriptor]=digest(bytes.subarray(at,at+size),'sha256');}at=end;}}
  return methods;
}

// These semantic labels describe reviewed 1.14 bytecode, not official mappings.
export const earlyConfig = {
  minecraft:'cvi', library:'ctd', channel:'ctc', noteBlock:'bqb', window:'cub',
  openDevice:'f', tick:'d', channelPlay:'c', noteEvent:'a', sourceId:'b', overlay:'p', server:'B', player:'j', stop:'k',
  levelSettings:'bhl', gameType:'bhe', creative:'c', worldType:'bho', flat:'c', allowCommands:'b', createLevel:'a',
  noGravity:'d', moveTo:'b', execute:'execute', overworld:'a', dimensionType:'byd', overworldDimension:'a', players:'A',
  blocks:'bmm', noteBlockConstant:'av', air:'a', defaultState:'o', blockPos:'ev', noteProperty:'c', setValue:'a', getValue:'c', setBlock:'a', blockEvent:'a',
  instrumentProperty:'a', instrumentType:'bwk', instrumentName:'m', instrumentByState:'a',
  options:'w', soundSource:'yl', sourceMaster:'a', sourceRecords:'c', sourceBlocks:'e', optionVolume:'a',
};

const bindings = [
  ['cvi','d','(Z)V','frame loop; sound/camera updates and world tick dispatch'],
  ['cvi','a','(Ljava/lang/String;Ljava/lang/String;Lbhl;)V','constructs original integrated server dxh'],
  ['cvi','B','()Ldxh;','integrated server getter'],
  ['cvi','k','()V','sets original running flag false'],
  ['ctd','f','()J','ALC10.alcOpenDevice; original device opener'],
  ['ctd','a','()V','alcCreateContext(device,null); original context setup, no HRTF setting'],
  ['ctc','c','()V','AL10.alSourcePlay(source field b)'],
  ['ctc','c','(F)V','linear clamped per-source attenuation; max/reference distance and rolloff'],
  ['cte','a','(F)V','AL10.alListenerf(AL_GAIN,value)'],
  ['dxr','e','(Ldwu;)F','clamp(instance volume * category,0,1)'],
  ['dxr','d','(Ldwu;)F','clamp original instance pitch to .5..2'],
  ['ctf','b','()Ljava/nio/ByteBuffer;','STB push-data decoder read-all'],
  ['ctf$a','a','(F)V','Java float PCM16 conversion and signed-short clamp'],
  ['bqb','a','(Lbvj;Lbhh;Lev;II)Z','note event; pow(2,(note-12)/12), category record, volume 3'],
  ['bwk','a','(Lbvj;)Lbwk;','instrument determined by original supporting block/material'],
  ['bwk','m','()Ljava/lang/String;','serialized original instrument name'],
  ['bml','o','()Lbvj;','default block state'],
  ['bvi','a','(Lbwm;Ljava/lang/Comparable;)Ljava/lang/Object;','state property setter'],
  ['bhh','a','(Lev;Lbvj;I)Z','original world placement'],
  ['vg','a','(Lev;Lbml;II)V','queues original server block event'],
  ['vg','a','(Lavx;DDDLyj;Lyl;FF)V','volume>1 ? volume*16 :16 player-position broadcast'],
  ['xq','a','(Lavx;DDDDLbyd;Lka;)V','strict squared-distance comparison from player entity position'],
  ['aif','d','(Z)V','NoGravity persisted data flag'],
  ['aif','b','(DDDFF)V','sets current/previous position, yaw and pitch'],
  ['cvm','a','(Lyl;)F','effective original category option lookup'],
];

export async function auditEarlyWorld({output}) {
  const localMetadata=JSON.parse(await readFile('.research/metadata/1.14.json','utf8'));
  const manifestUrl='https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
  const manifest=await fetch(manifestUrl,{signal:AbortSignal.timeout(30000)}).then(response=>{assert(response.ok);return response.json();});
  const release=manifest.versions.find(item=>item.id==='1.14');assert.equal(release.type,'release');
  await mkdir(output,{recursive:true});const metadataFile=path.join(output,'official-metadata.json');await verifiedArtifact(release,metadataFile);
  const metadataBytes=await readFile(metadataFile),metadata=JSON.parse(metadataBytes);assert.deepEqual(localMetadata,metadata,'Parsed fixture metadata differs from the verified official release');
  assert.equal(metadata.id,'1.14');assert(!metadata.downloads.client_mappings);
  const client=path.resolve('.research/clients/1.14.jar'), bytes=await readFile(client);
  assert.equal(digest(bytes),metadata.downloads.client.sha1);
  const entries=unzipSync(bytes), target=path.join(output,'bytecode-audit'); await mkdir(target,{recursive:true});
  const names=[...new Set([...bindings.map(item=>item[0]),'dxq','ctf$a','yl','bmm','bhl','bhe','bho','byd','cub','net.minecraft.server.MinecraftServer'])];
  const classes=[], disassembly={}, methodHashes={};
  for(const name of names) {
    const code=entries[`${name.replaceAll('.','/')}.class`]; assert(code,`Missing original class ${name}`);
    const result=spawnSync('javap',['-p','-s','-c','-classpath',client,name],{windowsHide:true,encoding:'utf8',maxBuffer:8e6}); assert.equal(result.status,0,result.stderr);
    const basename=name.replaceAll('.','_'); await writeFile(path.join(target,`${basename}.class`),code); await writeFile(path.join(target,`${basename}.javap.txt`),result.stdout);
    classes.push({originalName:name,bytecodeSha1:digest(code),bytecodeSha256:digest(code,'sha256'),disassemblySha256:digest(Buffer.from(result.stdout),'sha256'),rawClass:path.relative(process.cwd(),path.join(target,`${basename}.class`)).replaceAll('\\','/'),rawDisassembly:path.relative(process.cwd(),path.join(target,`${basename}.javap.txt`)).replaceAll('\\','/')}); disassembly[name]=result.stdout;methodHashes[name]=methodCodeHashes(code);
  }
  const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  for(const [owner,member,descriptor] of bindings) assert(new RegExp(`\\b${member}\\([^\\n]*\\)[^\\n]*;\\s+descriptor: ${escape(descriptor)}`).test(disassembly[owner]),`Unverified original binding ${owner}.${member}${descriptor}`);
  for(const [owner,tokens] of Object.entries({
    ctd:['ALC10.alcOpenDevice','ALC10.alcCreateContext','aconst_null'],
    ctc:['AL10.alSourcePlay','int 53251',' 4128',' 4129'],
    ctf:['STBVorbis.stb_vorbis_open_pushdata','STBVorbis.stb_vorbis_decode_frame_pushdata'],
    'ctf$a':['float 32767.5f','float 0.5f'], dxq:['ctf.','dxn.b:()Ljava/nio/ByteBuffer;'],
    dxr:['cte.a:(F)V','float 0.5f','fconst_2'], bqb:['Math.pow','float 3.0f','Field yl.c'],
    vg:['float 16.0f','xq.a:(Lavx;DDDDLbyd;Lka;)V'], xq:['Field vh.p:D','Field vh.q:D','Field vh.r:D','dcmpg'],
    yl:['String record','String block'], aif:['String NoGravity'],
  }))for(const token of tokens)assert(disassembly[owner].includes(token),`Missing reviewed instruction ${owner}: ${token}`);
  const report={schema:1,version:'1.14',clientSha1:digest(bytes),metadataSha1:digest(metadataBytes),officialSources:{manifestUrl,metadataUrl:release.url,metadataSha1:release.sha1,clientUrl:metadata.downloads.client.url,clientSha1:metadata.downloads.client.sha1},mappings:{kind:'manual-bytecode-role-audit',officialClientMappingsAvailable:false,limitation:'Semantic labels are manual; verified against original class bytes, descriptors and instruction bodies. No adjacent-release mapping is treated as official 1.14 metadata.'},bindings:bindings.map(([owner,member,descriptor,evidence])=>{const codeSha256=methodHashes[owner][member+descriptor];assert(codeSha256,`No original Code attribute for ${owner}.${member}${descriptor}`);return{owner,member,descriptor,codeSha256,evidence};}),classes,findings:{decoder:'original ctf STB push-data -> read-all PCM16; dxq call sites checked in raw bytecode because CFR lambda decompilation fails',pcm:'float * 32767.5f - .5f, Java truncation then signed-short clamp',sourceGain:'clamp(instance * category,0,1)',pitch:'clamp(instance pitch,.5,2); note event pow(2,(note-12)/12)',attenuation:'AL_LINEAR_DISTANCE_CLAMPED; reference distance 0, rolloff 1; range=max(raw volume,1)*sample attenuation_distance (16 default)',master:'OpenAL listener gain',context:'original ctd.a invokes alcCreateContext(device,null); no original explicit attributes, no explicit output limiter setting',hrtf:'no game HRTF control in reviewed context/options; any capture HRTF request is controlled research backend state',delivery:'original vg volume3 -> 48 radius; xq compares strict squared distance against player entity, not camera',standingEyeHeight:1.62,materials:'original bwk support-block selection; 16 instruments; registry identifiers from original bmm strings'},scopeLimitations:['Manual semantic labels; original instructions and descriptors retained, no official mappings exist','Source audit does not replace real integrated-world recording','Standing pose only; backend HRTF is a controlled research condition, not a game setting','CFR fails for dxq static-buffer lambda; original call instructions independently checked in raw javap']};
  report.facts={decoder:'stb',attenuationModel:'openal-linear',distanceModel:'linear',referenceDistance:0,rolloff:1,attenuationDistance:16,noteBlockVolume:3,minPitch:.5,maxPitch:2,hrtfControl:false,outputLimiter:'device-default',volumeRule:'category-before-clamp',masterVolumePlacement:'listener',broadcastRange:48,broadcastOrigin:'player-entity-position',comparison:'strict-distance-squared-less-than-range-squared',standingEyeHeight:1.62};
  report.factEvidence={decoder:['ctf.b()Ljava/nio/ByteBuffer;','dxq raw static-buffer lambda'],pcm:['ctf$a.a(F)V'],attenuation:['ctc.c(F)V'],volume:['dxr.e(Ldwu;)F','cte.a(F)V'],pitch:['dxr.d(Ldwu;)F','bqb.a(Lbvj;Lbhh;Lev;II)Z'],context:['ctd.a()V'],delivery:['vg.a(Lavx;DDDLyj;Lyl;FF)V','xq.a(Lavx;DDDDLbyd;Lka;)V'],materials:['bwk.a(Lbvj;)Lbwk;','bmm original registration strings']};
  await writeFile(path.join(output,'adapter-evidence.json'),JSON.stringify(report,null,2));return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await auditEarlyWorld({output:path.resolve('.research/early-world/1.14/audit')});
  await mkdir('docs/evidence',{recursive:true});await writeFile('docs/evidence/java-1.14-audio-source.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({version:report.version,classes:report.classes.length,methods:report.bindings.length,sourceEvidence:'docs/evidence/java-1.14-audio-source.json'}));
}
