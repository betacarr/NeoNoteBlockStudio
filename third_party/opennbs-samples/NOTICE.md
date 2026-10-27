# Note block preview samples

The default preview bank contains 20 Ogg sound files copied without modification from OpenNBS / NoteBlockStudio, revision `7dd79ecb313d981c12bc4b69ad13201c4995a3ae`, under `datafiles/Data/Sounds/`.

Source: https://github.com/OpenNBS/NoteBlockStudio/tree/7dd79ecb313d981c12bc4b69ad13201c4995a3ae/datafiles/Data/Sounds

`manifest.json` records the instrument mapping, byte sizes and SHA-256 hashes. The build downloads these pinned files and verifies them before packaging. Playback reads the packaged files locally and does not download Minecraft at runtime.

The upstream project's MIT license is reproduced in `LICENSE`. Minecraft-derived sound recordings retain the rights of their respective rightsholders, including Mojang / Microsoft; neither OpenNBS's MIT license nor NeoNBS's source license is represented as a separate permission from those rightsholders. The files are not original NeoNBS artwork or public-domain audio. This inclusion does not grant users additional rights to redistribute or sell the audio separately.

The bank is for editor preview. It does not establish a Minecraft version, provide native game audio libraries, or certify game-equivalent output. Loading a local Minecraft version remains necessary for native comparison.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
