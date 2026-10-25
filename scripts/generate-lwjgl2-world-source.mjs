import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';

// Manual semantic labels over verified original bytecode, not official mappings.
// Raw disassembly remains an ignored local research artifact.
const version = '1.12.2', manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const manifest = await fetch(manifestUrl).then(r => { assert(r.ok); return r.json(); });
const release = manifest.versions.find(item => item.id === version); assert(release);
const metadataBytes = Buffer.from(await fetch(release.url).then(r => { assert(r.ok); return r.arrayBuffer(); }));
assert.equal(digest(metadataBytes), release.sha1);
const metadata = JSON.parse(metadataBytes), fixture = JSON.parse(await readFile('.local/game-fixtures/1.12.2/fixture.json', 'utf8'));
assert.equal(metadata.downloads.client_mappings, undefined);
const client = path.join(fixture.root, 'versions/1.12.2/1.12.2.jar'), clientBytes = await readFile(client), clientClasses = unzipSync(clientBytes);
assert.equal(digest(clientBytes), metadata.downloads.client.sha1); assert.equal(digest(clientBytes), '0f275bc1547d01fa5f56ba34bdc87d981ee12daf');
const rawRoot = path.resolve('.research/lwjgl2-world-source/1.12.2'); await mkdir(rawRoot, { recursive: true });
const namedClasses = { NoteBlock: 'ask', TileEntityNote: 'avz', Blocks: 'aox', SoundEvents: 'qf', World: 'amu', ServerWorld: 'oo', ServerWorldEventHandler: 'op', PlayerList: 'pl', Player: 'aed', SoundManager: 'chm', IntegratedServer: 'chd', Library: 'paulscode/sound/libraries/LibraryLWJGLOpenAL', Source: 'paulscode/sound/libraries/SourceLWJGLOpenAL', Channel: 'paulscode/sound/libraries/ChannelLWJGLOpenAL', CodecJOrbis: 'paulscode/sound/codecs/CodecJOrbis', LwjglAL: 'org/lwjgl/openal/AL', LwjglALC: 'org/lwjgl/openal/ALC10' };
const verifiedLibraries = [];
for (const filename of new Set(fixture.classpath.slice(1))) {
  const relative = filename.slice(path.join(fixture.root, 'libraries').length + 1).replaceAll('\\', '/');
  const artifact = metadata.libraries.flatMap(item => [item.downloads?.artifact, ...Object.values(item.downloads?.classifiers ?? {})]).find(item => item?.path === relative); assert(artifact);
  const bytes = await readFile(filename); assert.equal(digest(bytes), artifact.sha1); verifiedLibraries.push({ filename, artifact, bytes });
}
const classes = {};
for (const [label, name] of Object.entries(namedClasses)) {
  const library = name.includes('/') ? verifiedLibraries.find(item => unzipSync(item.bytes)[name + '.class']) : undefined;
  const bytes = library ? unzipSync(library.bytes)[name + '.class'] : clientClasses[name + '.class']; assert(bytes, name);
  const disassembly = spawnSync('javap', ['-p', '-c', '-s', '-classpath', library?.filename ?? client, name.replaceAll('/', '.')], { windowsHide: true, encoding: 'utf8' }); assert.equal(disassembly.status, 0, disassembly.stderr);
  await writeFile(path.join(rawRoot, name.replaceAll('/', '_') + '.javap.txt'), disassembly.stdout);
  classes[label] = { originalClass: name, classSha1: digest(bytes), javapSha256: digest(Buffer.from(disassembly.stdout), 'sha256'), artifact: library?.artifact ?? metadata.downloads.client, text: disassembly.stdout };
}
function method(label, name, descriptor) {
  const lines = classes[label].text.split(/\r?\n/);
  const at = lines.findIndex((line, i) => line.trim() === `descriptor: ${descriptor}` && new RegExp(`\\b${name}\\(`).test(lines[i - 1])); assert(at >= 0, label + '.' + name + descriptor);
  let end = at + 1; while (end < lines.length && !/^  (?:public|protected|private|static)/.test(lines[end]) && lines[end] !== '}') end++;
  return { originalClass: classes[label].originalClass, originalMethod: name, descriptor, bytecode: lines.slice(at - 1, end).join('\n').trimEnd() };
}
const methods = {
  originalCodecRegistration: method('SoundManager', 'chm', '(Lcho;Lbid;)V'), libraryConstructor: method('Library', 'LibraryLWJGLOpenAL', '()V'), originalJOrbisDecode: method('CodecJOrbis', 'readAll', '()Lpaulscode/sound/SoundBuffer;'),
  noteBlockEvent: method('NoteBlock', 'a', '(Lawt;Lamu;Let;II)Z'), materialSelectionAndQueuedEvent: method('TileEntityNote', 'a', '(Lamu;Let;)V'),
  sourceBlockCenter: method('World', 'a', '(Laed;Let;Lqe;Lqg;FF)V'), worldSoundDispatch: method('World', 'a', '(Laed;DDDLqe;Lqg;FF)V'),
  soundRadiusAndPacket: method('ServerWorldEventHandler', 'a', '(Laed;Lqe;Lqg;DDDFF)V'), entityPositionDelivery: method('PlayerList', 'a', '(Laed;DDDDILht;)V'),
  standingEyeHeight: method('Player', 'by', '()F'), listenerPose: method('SoundManager', 'a', '(Laed;F)V'), soundSourceCreation: method('SoundManager', 'c', '(Lcgt;)V'),
  sourceVolumeClamp: method('SoundManager', 'e', '(Lcgt;)F'), categoryOrMaster: method('SoundManager', 'a', '(Lqg;F)V'), masterListenerGain: method('Library', 'setMasterVolume', '(F)V'),
  originalSourceDistance: method('Source', 'calculateDistance', '()V'), originalSourceGain: method('Source', 'calculateGain', '()V'), originalSourceUpdate: method('Source', 'positionChanged', '()V'), originalSourcePlay: method('Channel', 'play', '()V'),
  distinctBlockEventNotification: method('ServerWorld', 'aq', '()V'), worldListenerRegistration: method('IntegratedServer', 'a', '(Ljava/lang/String;Ljava/lang/String;JLamz;Ljava/lang/String;)V'),
  originalDeviceOpen: method('LwjglALC', 'alcOpenDevice', '(Ljava/lang/String;)Lorg/lwjgl/openal/ALCdevice;'), originalContextCreate: method('LwjglALC', 'alcCreateContext', '(Lorg/lwjgl/openal/ALCdevice;Ljava/nio/IntBuffer;)Lorg/lwjgl/openal/ALCcontext;'),
};
assert(methods.noteBlockEvent.bytecode.includes('float 3.0f') && methods.noteBlockEvent.bytecode.includes('amu.a:(Laed;Let;Lqe;Lqg;FF)V'));
assert(methods.materialSelectionAndQueuedEvent.bytecode.includes('aox.cB:Laow;') && methods.materialSelectionAndQueuedEvent.bytecode.includes('aox.di:Laow;') && methods.materialSelectionAndQueuedEvent.bytecode.includes('amu.c:(Let;Laow;II)V'));
assert((methods.sourceBlockCenter.bytecode.match(/double 0\.5d/g) ?? []).length === 3);
assert(methods.soundRadiusAndPacket.bytecode.includes('float 16.0f') && methods.soundRadiusAndPacket.bytecode.includes('fmul') && methods.soundRadiusAndPacket.bytecode.includes('pl.a:(Laed;DDDDILht;)V'));
assert(methods.entityPositionDelivery.bytecode.includes('Field oq.p:D') && methods.entityPositionDelivery.bytecode.includes('Field oq.q:D') && methods.entityPositionDelivery.bytecode.includes('Field oq.r:D') && methods.entityPositionDelivery.bytecode.includes('dcmpg'));
assert(/dcmpg\s*\n\s*107: ifge/.test(methods.entityPositionDelivery.bytecode) && methods.entityPositionDelivery.bytecode.includes('Field oq.am:I'), 'Recheck the strict delivery/dimension branch');
assert(methods.standingEyeHeight.bytecode.includes('float 1.62f') && methods.listenerPose.bytecode.includes('aed.by:()F'));
assert(methods.sourceVolumeClamp.bytecode.includes('rk.a:(FFF)F') && methods.soundSourceCreation.bytecode.includes('float 16.0f') && methods.soundSourceCreation.bytecode.includes('newSource:'));
assert(methods.masterListenerGain.bytecode.includes('org/lwjgl/openal/AL10.alListenerf:(IF)V'));
assert(methods.originalSourceDistance.bytecode.includes('fsub') && methods.originalSourceDistance.bytecode.includes('f2d') && methods.originalSourceDistance.bytecode.includes('java/lang/Math.sqrt:(D)D'));
assert(methods.originalSourceGain.bytecode.includes('fdiv') && methods.originalSourceGain.bytecode.includes('fsub') && methods.originalSourceUpdate.bytecode.includes('org/lwjgl/openal/AL10.alSourcef:(IIF)V'));
assert(methods.originalSourcePlay.bytecode.includes('org/lwjgl/openal/AL10.alSourcePlay:(I)V'));
assert(methods.originalCodecRegistration.bytecode.includes('class paulscode/sound/codecs/CodecJOrbis') && methods.originalCodecRegistration.bytecode.includes('SoundSystemConfig.setCodec:'));
assert(methods.libraryConstructor.bytecode.includes('iconst_1') && methods.libraryConstructor.bytecode.includes('Field reverseByteOrder:Z') && classes.CodecJOrbis.text.includes('com/jcraft/jorbis/'));
assert(methods.distinctBlockEventNotification.bytecode.includes('double 64.0d') && methods.worldListenerRegistration.bytecode.includes('class op'));
const artifact = metadata.libraries.find(item => item.name === 'org.lwjgl.lwjgl:lwjgl-platform:2.9.4-nightly-20150209').downloads.classifiers['natives-windows'];
const archive = await readFile(path.join(fixture.root, 'libraries', artifact.path)); assert.equal(digest(archive), artifact.sha1);
const dll = await readFile(path.join(fixture.nativeDir, 'OpenAL64.dll')); assert(Object.entries(unzipSync(archive)).some(([name, bytes]) => path.basename(name) === 'OpenAL64.dll' && digest(bytes) === digest(dll)));
const jna = verifiedLibraries.find(item => item.artifact.path === 'net/java/dev/jna/jna/4.4.0/jna-4.4.0.jar'); assert(jna);
const probeSource = 'scripts/java/Lwjgl2NativeProbe.java', probeClasses = path.join(rawRoot, 'native-probe-classes'); await mkdir(probeClasses, { recursive: true });
const compiled = spawnSync('javac', ['--release', '8', '-cp', jna.filename, '-d', probeClasses, probeSource], { windowsHide: true, encoding: 'utf8' }); assert.equal(compiled.status, 0, compiled.stderr);
const probe = spawnSync('java', ['-cp', [probeClasses, jna.filename].join(path.delimiter), 'studio.nbsx.research.Lwjgl2NativeProbe', path.join(fixture.nativeDir, 'OpenAL64.dll')], { windowsHide: true, encoding: 'utf8' }); assert.equal(probe.status, 0, probe.stderr);
const capabilities = JSON.parse(probe.stdout); assert.equal(capabilities.backend, '1.1 ALSOFT 1.15.1'); assert.equal(capabilities.loopback, true); assert.equal(capabilities.hrtf, false); assert.equal(capabilities.outputLimiter, false);
const materials = [ ['dirt','harp',0], ['planks','bass',4], ['stone','basedrum',1], ['sand','snare',2], ['glass','hat',3], ['wool','guitar',7], ['clay','flute',5], ['gold_block','bell',6], ['packed_ice','chime',8], ['bone_block','xylophone',9] ].map(([block,instrument,eventId]) => ({ block, instrument, eventId }));
const report = { schema: 1, id: 'java-1.12.2', version, checkedAt: new Date().toISOString(), officialSources: { manifestUrl, metadataUrl: release.url, metadataSha1: release.sha1, clientUrl: metadata.downloads.client.url, clientSha1: digest(clientBytes) }, mappings: { officialClientMappingsAvailable: false, kind: 'manual-labels-over-original-bytecode' },
  facts: { noteBlockVolume: 3, baseBroadcastRadius: 16, broadcastRange: 48, sourceBlockOffset: [.5,.5,.5], standingEyeHeight: 1.62, standingEyeHeightJavaFloat: Math.fround(1.62), broadcastOrigin: 'player-entity-position', comparison: 'strict-distance-squared-less-than-range-squared', sameDimensionRequired: true, masterVolumePlacement: 'listener', volumeRule: 'category-before-clamp', decoder: 'original-paulscode-codecjorbis', attenuationModel: 'paulscode-linear', originalHrtfSupported: false, originalOutputLimiterSupported: false, originalLoopbackSupported: true, nativeBackend: '1.1 ALSOFT 1.15.1', materials },
  native: { artifact, filename: 'OpenAL64.dll', sha256: digest(dll, 'sha256'), capabilities, probeSource, probeSourceSha256: digest(await readFile(probeSource), 'sha256'), probeDependency: jna.artifact, measurement: 'Original DLL JNA probe and original LWJGL2 AL.create report version1.15.1, ALC_SOFT_loopback=true and ALC_SOFT_HRTF=false; no replacement DLL.' },
  interpretation: ['The original TileEntityNote reads its note byte, selects one of ten event IDs from actual support material/block identity, and queues ServerWorld.c; the capture invokes that original path.', 'The original NoteBlock event emits pitch pow(2,(note-12)/12) and volume3. World adds half-block offsets. Server event listener uses radius16*3=48, then PlayerList tests same-dimension player entity position with a strict squared-distance comparison.', 'SoundManager clamps instance volume times category to [0,1], uses unclamped instance volume3 to set range48, and retains master volume on the OpenAL listener.', 'Original SourceLWJGLOpenAL subtracts Java floats before widening each distance component to double, casts sqrt back to float, then computes float1-distance/range. Original AL source receives that gain times sourceVolume; rolloff0 leaves Java attenuation responsible.', 'The bridge substitutes only ALC10 native-device-open and recording format/rate pairs, preserving original LWJGL2 object registration and all Paulscode/JOrbis/AL source calls. Native OpenAL1.15.1 loopback provides mixer output; hardware playback is outside scope.', 'The original library has no HRTF extension. No HRTF-on recording is represented by this evidence.'],
  classes: Object.fromEntries(Object.entries(classes).map(([label,{text,...entry}])=>[label,entry])), methods, scopeLimitations: ['Windows x64, original Java1.12.2 client and official referenced dependency artifacts', 'Manual semantic bindings, not official mappings', 'Native extension availability corroborated by isolated original-DLL probe and world capture', 'Product version-specific broadcast fact integration is separate from this independent source evidence'] };
const rawBytes = Buffer.from(JSON.stringify(report,null,2)); await writeFile(path.join(rawRoot,'evidence.json'),rawBytes);
const sanitized = { ...report, methods: Object.fromEntries(Object.entries(methods).map(([label,{bytecode,...entry}])=>[label,{...entry,bytecodeSha256:digest(Buffer.from(bytecode),'sha256')}])), rawEvidence: { path: '.research/lwjgl2-world-source/1.12.2/evidence.json', sha256: digest(rawBytes,'sha256'), status: 'ignored local original disassembly, not redistributed' } };
await mkdir('docs/evidence',{recursive:true}); await writeFile('docs/evidence/java-1.12.2-world-source.json',JSON.stringify(sanitized,null,2));
console.log(JSON.stringify({ version, classes: Object.keys(classes).length, methods: Object.keys(methods).length, output: 'docs/evidence/java-1.12.2-world-source.json' }));
