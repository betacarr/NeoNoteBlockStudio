# Instrument support-block icons

The library and track icons depict representative blocks placed **below** a note block. Each image is original SVG artwork composed from simple shapes. No Minecraft texture, game model, resource-pack image, or other binary asset is included. Material cues are deliberately readable at 24–32 px: plank joints, wool fibres, bone rings, hay bindings, glass reflections, ice fractures, glowstone cells, and different copper patinas.

`src/core/instrument-blocks.ts` owns the instrument-to-block identity map. `src/ui/InstrumentBlock.tsx` owns the palette and material drawing. Instrument colours remain independent from block colours. The existing text labels remain available beside each icon; the SVG also provides its material name as an accessible label and title unless explicitly marked decorative. Unknown and custom instruments use an original note-block image.

The map selects one representative material per instrument. It does not claim that this material is the only block that produces the instrument, and it does not change instrument availability for the selected game version.

| Instrument | Representative block |
| --- | --- |
| harp | dirt |
| bass | oak_planks |
| basedrum | stone |
| snare | sand |
| hat | glass |
| guitar | white_wool |
| flute | clay |
| bell | gold_block |
| chime | packed_ice |
| xylophone | bone_block |
| iron_xylophone | iron_block |
| cow_bell | soul_sand |
| didgeridoo | pumpkin |
| bit | emerald_block |
| banjo | hay_block |
| pling | glowstone |
| trumpet | copper_block |
| trumpet_exposed | exposed_copper |
| trumpet_weathered | weathered_copper |
| trumpet_oxidized | oxidized_copper |

## Evidence

- The first sixteen mappings match the placed support blocks in `scripts/capture-game-world.mjs`, which are exercised by the original-game world-capture fixtures for Java 1.16.5 and 1.20.5. These are identity checks; icon drawings are interpretive, rather than reproductions of the resource-pack texture.
- The Java 26.3 `Blocks` class was extracted from the [official client archive](https://piston-data.mojang.com/v1/objects/e877b6a07acd633fb3bb475002175cec036e7b87/client.jar), after comparing its SHA-1 with the downloaded Mojang version metadata: `e877b6a07acd633fb3bb475002175cec036e7b87`. Local research is retained under the ignored `.research/icon-research/` directory.
- `Blocks` assigns each representative material to the corresponding instrument. For the copper-block collection, the original oxidation-state switch assigns unaffected, exposed, weathered, and oxidized copper to `TRUMPET`, `TRUMPET_EXPOSED`, `TRUMPET_WEATHERED`, and `TRUMPET_OXIDIZED`, respectively. `NoteBlock.setInstrument` reads the instrument from the block below.
- The [official Java 26.1 release notes](https://feedback.minecraft.net/hc/en-us/articles/44551668333837-Minecraft-Java-Edition-26-1) introduce copper-block trumpet instruments and list their four sound events. The [official Tiny Takeover overview](https://www.minecraft.net/en-us/updates/tiny-takeover-drop) confirms that the sound depends on oxidation level.

These checks establish the icon-to-material mapping. They do not establish audio-rendering equivalence for the new copper instruments, extend the existing audio-acceptance scope, or prove a complete compatibility matrix for every historical version.
