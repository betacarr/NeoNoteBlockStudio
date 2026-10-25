import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const report = JSON.parse(await readFile('.research/audio-source-comparison.json', 'utf8'));
const profiles = [];
for (const release of report.results) {
  const sources = {};
  for (const entry of release.classes) sources[entry.name.split('.').at(-1)] = await readFile(path.join('.research/source-comparison', release.id, 'named', entry.obfuscated.replaceAll('.', '/') + '.java'), 'utf8');
  const channel = sources.Channel, engine = sources.SoundEngine, buffer = sources.SoundBufferLibrary;
  const quantizer = sources.OggAudioStream ?? sources.ChunkedSampleByteBuf ?? '';
  const invariants = {
    linearDistance: /53251/.test(channel) && /4131/.test(channel) && /4129[^\n]*1\.0f/.test(channel) && /4128[^\n]*0\.0f/.test(channel),
    pitchClamp: /clamp\([^\n]*getPitch\(\), 0\.5f, 2\.0f\)/.test(engine),
    blockVolume: /3\.0f/.test(sources.NoteBlock) && /pow\(2\.0/.test(sources.NoteBlock),
    pcm16: /32767\.5f - 0\.5f/.test(quantizer),
  };
  if (Object.values(invariants).some(v => !v)) throw new Error(`${release.id}: missing source evidence ${JSON.stringify(invariants)}`);
  const perSourceMaster = /clamp\([^\n]*getFinalSoundSourceVolume/.test(engine);
  const explicitLimiter = /\.put\(6554\)\.put\(1\)/.test(sources.Library);
  if (/6554/.test(sources.Library) !== explicitLimiter) throw new Error(`${release.id}: unreviewed output limiter request`);
  const library = sources.Library, hrtfControl = /ALC_SOFT_HRTF/.test(library);
  let hrtfControlMode = 'device-default';
  if (hrtfControl) {
    if (/private void enableHrtf\(/.test(library) && /\.put\(6546\)\.put\(1\)\.put\(6550\)\.put\(0\)/.test(library)
      && /if \([^\n]*ALC_SOFT_HRTF &&[^\n]*\) \{\s*this\.enableHrtf\(\);/.test(library)) hrtfControlMode = 'enable-only-reset';
    else if (/private void setHrtf\(boolean/.test(library) && /\.put\(6546\)\.put\([^\n]*\? 1 : 0\)\.put\(6550\)\.put\(0\)/.test(library)
      && /this\.setHrtf\([^\n]*ALC_SOFT_HRTF &&/.test(library)) hrtfControlMode = 'explicit-reset';
    else if (/private IntBuffer createAttributes\(/.test(library) && /\.put\(6546\)\.put\([^\n]*\? 1 : 0\)/.test(library)
      && /\.put\(6550\)\.put\(0\)/.test(library) && /this\.createAttributes\([^\n]*ALC_SOFT_HRTF &&/.test(library)
      && !/alcResetDeviceSOFT/.test(library)) hrtfControlMode = 'context-attributes';
    else throw new Error(`${release.id}: unreviewed HRTF request path`);
    if (!/alcGetInteger\([^\n]*6548\)/.test(library) || !/if \([^\n]*> 0\)/.test(library)) throw new Error(`${release.id}: missing HRTF profile enumeration`);
    if (hrtfControlMode.endsWith('reset') && !/alcResetDeviceSOFT/.test(library)) throw new Error(`${release.id}: missing original HRTF reset`);
  } else if (/6546|6550|alcResetDeviceSOFT/.test(library)) throw new Error(`${release.id}: unexpected HRTF attributes without a reviewed control`);
  if (perSourceMaster ? /void setGain\(/.test(sources.Listener) || /\.setGain\(/.test(engine) : !/void setGain\(/.test(sources.Listener) || !/\.setGain\(/.test(engine)) throw new Error(`${release.id}: master gain source/listener evidence conflicts`);
  profiles.push({ id: `java-${release.id}`, version: release.id, decoder: /JOrbisAudioStream/.test(buffer) ? 'jorbis' : 'stb',
    distanceModel: 'linear', referenceDistance: 0, rolloff: 1, attenuationDistance: 16, blockVolume: 3, minPitch: .5, maxPitch: 2,
    hrtfControl, hrtfControlMode, ...(hrtfControl ? { hrtfProfile: 0 } : {}), volumeRule: perSourceMaster ? 'category-after-clamp' : 'category-before-clamp', masterVolumePlacement: perSourceMaster ? 'source' : 'listener',
    outputLimiter: explicitLimiter ? 'enabled' : 'device-default',
    clientSha1: release.clientSha1, mappingsSha1: release.mappingsSha1,
    sourceHashes: Object.fromEntries(release.classes.filter(c => ['Channel', 'SoundEngine', 'Listener', 'Library', 'SoundBufferLibrary', 'OggAudioStream', 'ChunkedSampleByteBuf', 'NoteBlock'].includes(c.name.split('.').at(-1))).map(c => [c.name, c.namedSourceSha256])),
    evidence: 'selected-core-parameters-source-checked', gameRecording: 'pending',
  });
}
await writeFile('src/data/audio-facts.json', JSON.stringify({ schema: 1, profiles }, null, 2));
console.log(JSON.stringify({ profiles: profiles.length, gameMeasured: 0 }));
