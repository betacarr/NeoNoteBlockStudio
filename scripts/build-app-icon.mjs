// Original geometric monogram. No game artwork, fonts or external image tools.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const points = [[132,376],[132,136],[184,136],[329,300],[329,136],[380,136],[380,376],[330,376],[184,209],[184,376]];
const colors = { background: [23,29,36], foreground: [139,213,176] };
const polygon = points.map(point => point.join(',')).join(' ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="title"><title id="title">NeoNBS application icon</title><rect x="16" y="16" width="480" height="480" rx="96" fill="#171d24"/><polygon points="${polygon}" fill="#8bd5b0"/></svg>\n`;
await mkdir('docs/assets', { recursive: true });
await writeFile('docs/assets/app-icon.svg', svg);
const table = Array.from({ length: 256 }, (_, n) => { let value = n; for (let i=0;i<8;i++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
const crc32 = bytes => { let value = 0xffffffff; for (const byte of bytes) value = table[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; };
const chunk = (type, value) => { const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(value.length); crc.writeUInt32BE(crc32(Buffer.concat([name,value]))); return Buffer.concat([size,name,value,crc]); };
function inside(x,y) { let result=false; for(let i=0,j=points.length-1;i<points.length;j=i++){const [a,b]=points[i],[u,v]=points[j];if((b>y)!==(v>y)&&x<(u-a)*(y-b)/(v-b)+a)result=!result;} return result; }
function png(size) {
  const raw = Buffer.alloc(size * (size*4+1)), sample=4;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let alpha=0; const rgb=[0,0,0];
    for(let sy=0;sy<sample;sy++)for(let sx=0;sx<sample;sx++){
      const px=(x+(sx+.5)/sample)*512/size,py=(y+(sy+.5)/sample)*512/size;
      const dx=Math.max(Math.abs(px-256)-144,0),dy=Math.max(Math.abs(py-256)-144,0);
      if(Math.abs(px-256)>240||Math.abs(py-256)>240||dx*dx+dy*dy>96*96)continue;
      const color=inside(px,py)?colors.foreground:colors.background; alpha++;
      for(let i=0;i<3;i++)rgb[i]+=color[i];
    }
    const offset=y*(size*4+1)+1+x*4;
    for(let i=0;i<3;i++)raw[offset+i]=alpha?Math.round(rgb[i]/alpha):0;
    raw[offset+3]=Math.round(alpha/(sample*sample)*255);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const sizes=[16,24,32,48,64,128,256],images=sizes.map(png),header=Buffer.alloc(6);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=6+sizes.length*16;
const entries=sizes.map((size,index)=>{const entry=Buffer.alloc(16);entry[0]=size===256?0:size;entry[1]=entry[0];entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(images[index].length,8);entry.writeUInt32LE(offset,12);offset+=images[index].length;return entry;});
await mkdir('.local/release-assets',{recursive:true});
await writeFile('.local/release-assets/NeoNBS.ico',Buffer.concat([header,...entries,...images]));
// ICNS stores PNG representations directly; no platform-specific image tool is
// needed. Include standard and Retina sizes through 1024 pixels.
const representations = [['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024],['ic11',32],['ic12',64],['ic13',256],['ic14',512]];
const cache = new Map(sizes.map((size, index) => [size, images[index]]));
const icnsChunks = representations.map(([type, size]) => {
  if (!cache.has(size)) cache.set(size, png(size));
  const data = cache.get(size), head = Buffer.alloc(8);
  head.write(type, 0, 'ascii'); head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
});
const icnsHeader = Buffer.alloc(8); icnsHeader.write('icns', 0, 'ascii');
icnsHeader.writeUInt32BE(8 + icnsChunks.reduce((total, data) => total + data.length, 0), 4);
await writeFile('.local/release-assets/NeoNBS.icns', Buffer.concat([icnsHeader, ...icnsChunks]));
