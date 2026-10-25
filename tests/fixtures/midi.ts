// Hand-encoded SMFs; no production MIDI parser or writer builds these fixtures.
export const midiEnd = [0,255,47,0];
export function smf(tracks: number[][], format = 1): Uint8Array {
  const result = new Uint8Array(14 + tracks.reduce((size, track) => size + 8 + track.length, 0));
  result.set([77,84,104,100,0,0,0,6,0,format,tracks.length >> 8,tracks.length & 255,1,224]);
  let at = 14;
  for (const track of tracks) { result.set([77,84,114,107,(track.length >>> 24)&255,(track.length >>> 16)&255,(track.length >>> 8)&255,track.length & 255],at); result.set(track,at+8); at += 8 + track.length; }
  return result;
}
export const programChangeFixture = () => smf([[0,192,73,0,144,72,100,129,112,192,24,129,112,128,72,35,0,144,64,80,120,128,64,45,...midiEnd]], 0);
export const expressionFixture = () => smf([[
  0,255,3,6,230,151,139,229,190,139,
  0,255,33,1,2,
  0,240,5,126,127,9,1,247,
  0,194,73, 0,178,0,1, 0,178,32,2,
  0,255,126,3,0,255,128,
  0,255,127,4,0,32,51,68,
  0,255,6,5,86,101,114,115,101,
  0,255,88,4,7,3,36,8,
  0,255,81,3,7,161,32,
  0,255,89,2,255,1,
  0,146,72,100,
  60,162,72,69, 0,210,85, 0,226,0,80,
  0,178,11,96, 0,255,5,2,108,97,
  0,247,3,1,2,247,
  60,130,72,35,
  0,255,1,2,111,107,
  120,...midiEnd.slice(1),
]], 0);
