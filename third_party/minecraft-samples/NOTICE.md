# Minecraft Java note block samples

The default preview bank contains 20 original Ogg files served by Mojang's official Minecraft resource service, pinned to Minecraft Java Edition **26.3**. The files are copied byte for byte: no normalization, gain adjustment, resampling, trimming or re-encoding is applied. They are not obtained from Note Block Studio.

`manifest.json` records the official version metadata, asset-index and sound-definition hashes, event-to-file mappings, original SHA-1 hashes, byte sizes and additional SHA-256 hashes. The build verifies the complete metadata chain before packaging the files. In particular, harp maps to `note/harp2.ogg` and bass to `note/bassattack.ogg`, as specified by the game's sound events. This bank's event volume and pitch scalars are unity; individual relative amplitudes remain those of the original files.

Sources:

- [Official Java version manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json)
- [Pinned 26.3 asset index](https://piston-meta.mojang.com/v1/packages/0c8f43b28f837869c1e54a6aeb22c396a1548946/34.json)
- [Minecraft EULA](https://www.minecraft.net/en-us/eula)
- [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)

The sounds retain the rights of their respective rightsholders, including Mojang / Microsoft. They are not covered by NeoNBS's source license, an OpenNBS license, or a public-domain dedication. Their inclusion is not represented as an endorsement or separate permission from the rightsholders and does not grant additional rights to redistribute or sell the audio separately.

Playback reads packaged files locally, without downloading resources at runtime or requiring a Minecraft installation. This fixed preview bank does not replace a target version's native audio engine, prove game-equivalent output, or certify sounds in all historical versions. Local matching game resources are still required for native comparison. User mixer settings and preview spatial attenuation remain effective.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
