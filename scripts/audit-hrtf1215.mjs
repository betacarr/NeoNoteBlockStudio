import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { digest } from './research-utils.mjs';

// Read the actual two boundary clients. Decompiled source stays in ignored research.
const root = path.resolve('.research/hrtf1215-source');
const catalog = JSON.parse(await readFile('src/data/java-releases.json')).versions;
const sourceComparison = JSON.parse(await readFile('.research/audio-source-comparison.json')).results;
const cfr = path.resolve('.research/tools/cfr-0.152.jar');
assert.equal(digest(await readFile(cfr), 'md5'), '8a85ada8cec494121246805a5562b82b');
const observations = [];
for (const version of ['1.21.4', '1.21.5']) {
  const metadata = JSON.parse(await readFile(`.research/metadata/${version}.json`));
  const release = catalog.find(item => item.id === version);
  const client = path.resolve(`.research/clients/${version}.jar`), clientBytes = await readFile(client);
  assert.equal(digest(clientBytes), metadata.downloads.client.sha1);
  assert.equal(digest(clientBytes), release.clientSha1);
  const mapFile = path.resolve(`.research/source-comparison/${version}/mappings.txt`), mapBytes = await readFile(mapFile);
  assert.equal(digest(mapBytes), metadata.downloads.client_mappings.sha1);
  const mappings = mapBytes.toString('utf8');
  const block = name => { const start = mappings.indexOf(`${name} -> `); assert(start >= 0, name); return mappings.slice(start).split(/\n(?=\S[^\n]* -> )/)[0]; };
  const classes = [], sources = {};
  const names = ['com.mojang.blaze3d.audio.Library', 'net.minecraft.client.sounds.SoundEngine'];
  if (version === '1.21.5') names.push('net.minecraft.client.Options', 'net.minecraft.world.level.LevelSettings', 'net.minecraft.client.gui.screens.worldselection.WorldOpenFlows', 'net.minecraft.world.entity.Entity');
  for (const name of names) {
    const mapped = block(name), obfuscated = mapped.split('\n')[0].split(' -> ')[1].slice(0, -1);
    const entry = `${obfuscated.replaceAll('.', '/')}.class`, bytes = unzipSync(clientBytes, { filter: item => item.name === entry })[entry]; assert(bytes);
    const target = path.join(root, version), classFile = path.join(target, 'classes', entry), sourceRoot = path.join(target, 'named');
    await mkdir(path.dirname(classFile), { recursive: true }); await writeFile(classFile, bytes);
    const existing = path.resolve(`.research/source-comparison/${version}/named/${obfuscated}.java`);
    let source = await readFile(existing, 'utf8').catch(() => undefined);
    if (source === undefined) {
      const result = spawnSync('java', ['-jar', cfr, classFile, '--extraclasspath', client, '--obfuscationpath', mapFile, '--outputdir', sourceRoot, '--silent', 'true'], { windowsHide: true, encoding: 'utf8', timeout: 90000, maxBuffer: 2e6 });
      assert.equal(result.status, 0, result.stderr);
      source = await readFile(path.join(sourceRoot, entry.replace('.class', '.java')), 'utf8');
    } else {
      const checked = sourceComparison.find(item => item.id === version)?.classes.find(item => item.name === name);
      assert(checked, `Missing original source provenance: ${version} ${name}`);
      assert.equal(digest(bytes), checked.bytecodeSha1);
      const normalized = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();
      assert.equal(digest(Buffer.from(normalized), 'sha256'), checked.namedSourceSha256);
      await mkdir(sourceRoot, { recursive: true }); await writeFile(path.join(sourceRoot, `${obfuscated}.java`), source);
    }
    const short = name.split('.').at(-1); sources[short] = source;
    classes.push({ name, obfuscated, bytecodeSha1: digest(bytes), namedSourceSha256: digest(Buffer.from(source), 'sha256') });
  }
  assert.match(sources.SoundEngine, /this\.library\.init\([^\n]*this\.options\.directionalAudio\(\)\.get\(\)/);
  if (version === '1.21.4') {
    assert.match(sources.Library, /this\.setHrtf\(\$\$2\.ALC_SOFT_HRTF && \$\$1\)/);
    assert.match(sources.Library, /put\(6546\)\.put\(\$\$0 \? 1 : 0\)\.put\(6550\)\.put\(0\)/);
    assert.match(sources.Library, /SOFTHRTF\.alcResetDeviceSOFT/);
    assert.match(sources.Library, /callocInt\(3\)\.put\(6554\)\.put\(1\)\.put\(0\)/);
  } else {
    assert(!sources.Library.includes('alcResetDeviceSOFT'));
    assert.match(sources.Library, /this\.createAttributes\(\$\$3, \$\$2\.ALC_SOFT_HRTF && \$\$1\)/);
    assert.match(sources.Library, /alcGetInteger\([^\n]*6548\)/);
    assert.match(sources.Library, /put\(6546\)\.put\(\$\$1 \? 1 : 0\)/);
    assert.match(sources.Library, /put\(6550\)\.put\(0\)/);
    assert.match(sources.Library, /put\(6554\)\.put\(1\)/);
    assert(sources.Options.includes('directionalAudio'));
    assert(block('net.minecraft.world.entity.Entity').includes('void absSnapTo(double,double,double,float,float)'));
    assert(!block('net.minecraft.world.entity.Entity').includes('void moveTo(double,double,double,float,float)'));
    assert(block('net.minecraft.client.gui.screens.worldselection.WorldOpenFlows').includes('void createFreshLevel(java.lang.String,net.minecraft.world.level.LevelSettings,net.minecraft.world.level.levelgen.WorldOptions,java.util.function.Function,net.minecraft.client.gui.screens.Screen)'));
  }
  observations.push({ version, clientSha1: digest(clientBytes), clientUrl: metadata.downloads.client.url, metadataUrl: release.metadataUrl, mappings: { url: metadata.downloads.client_mappings.url, sha1: digest(mapBytes) }, classes,
    originalOption: 'SoundEngine passes Options.directionalAudio().get() to Library.init',
    hrtfControl: version === '1.21.4' ? 'reset-device-before-context' : 'create-context-attributes',
    availableProfileQuery: 6548, whenAvailableProfilesPositive: { hrtfAttribute: 6546, value: 'ALC_SOFT_HRTF capability && original directionalAudio option ? 1 : 0', profileAttribute: 6550, profileId: 0 },
    limiter: { attribute: 6554, value: 1, stage: 'context-creation' },
    scope: 'Specific source/bytecode boundary review, not a codec or integrated-world PCM acceptance.' });
}
const worldRoot = path.resolve('.research/world-source/1.21.5');
const world = JSON.parse(await readFile(path.join(worldRoot, 'provenance.json')));
assert.equal(world.clientSha1, observations[1].clientSha1); assert.equal(world.mappingsSha1, observations[1].mappings.sha1);
const worldSources = {};
for (const role of ['ServerLevel', 'PlayerList', 'SoundEvent']) {
  const entry = world.classes.find(item => item.name.endsWith(`.${role}`)); assert(entry);
  const source = await readFile(path.join(worldRoot, 'source', `${entry.obfuscated}.java`), 'utf8');
  assert.equal(digest(await readFile(path.join(worldRoot, 'classes', `${entry.obfuscated}.class`))), entry.bytecodeSha1);
  assert.equal(digest(Buffer.from(source), 'sha256'), entry.namedSourceSha256); worldSources[role] = source;
}
assert(worldSources.ServerLevel.includes('.getRange($$6)') && worldSources.ServerLevel.includes('new ClientboundSoundPacket'));
assert(worldSources.PlayerList.includes('< $$4 * $$4') && ['getX()', 'getY()', 'getZ()'].every(text => worldSources.PlayerList.includes(text)));
assert(worldSources.SoundEvent.includes('16.0f * $$0 : 16.0f'));
const report = { schema: 1, version: '1.21.5', tool: 'CFR 0.152; original official client and mappings hashes checked',
  scriptSha256: digest(await readFile('scripts/audit-hrtf1215.mjs'), 'sha256'),
  specification: 'https://openal-soft.org/openal-extensions/SOFT_HRTF.txt',
  observations, sharedAdapterRequirements: [
    'Preserve an explicit original profile ID 0 along with the HRTF request; enabling HRTF alone does not preserve profile choice.',
    'For 1.21.5 capture, retain original 6546/6550/6554 attributes; only add controlled loopback format/rate. Select on/off through original Options, not an overwritten capture request.',
    'Query actual enabled status and current ALC_HRTF_SPECIFIER_SOFT string, and record available profile zero with alcGetStringiSOFT; ALC_HRTF_ID_SOFT is an attribute, not an integer state query.',
    'World adapter uses Entity.absSnapTo(dddff), seven-argument LevelSettings and five-argument WorldOpenFlows.createFreshLevel. GameRules requires the default WorldDataConfiguration enabled FeatureFlagSet; WorldPresets normal dimensions accepts HolderLookup.Provider, and NoteBlock.setInstrument accepts LevelReader.',
  ], worldDelivery: { originalSourcePath: '.research/world-source/1.21.5', classes: world.classes.filter(item => ['ServerLevel', 'PlayerList', 'SoundEvent'].some(role => item.name.endsWith(`.${role}`))),
    facts: { broadcastRange: 48, originalNoteVolume: 3, broadcastOrigin: 'player-entity-position', comparison: 'strict-distance-squared-less-than-range-squared' },
    sourceRelationship: 'ServerLevel passes the SoundEvent range and original volume to PlayerList.broadcast; SoundEvent range is 16 * volume when volume exceeds one; PlayerList compares entity-position squared distance strictly below range squared.' }, integratedWorldScenesAdded: 0 };
await mkdir(root, { recursive: true }); await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
if (process.argv.includes('--write-evidence')) await writeFile('docs/evidence/java-1.21.5-hrtf-source.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ versions: observations.length, originalClasses: observations.reduce((sum, item) => sum + item.classes.length, 0), integratedWorldScenesAdded: 0, report: path.join(root, 'report.json') }));
