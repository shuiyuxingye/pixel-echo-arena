import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ASSET_PATHS, PLAYER } from '../src/game/config';
import { ENEMY_ART, ITEM_ART } from '../src/game/art-manifest';
import { PLAYER_DIRECTIONS, PLAYER_CAST_DIRECTIONS, PLAYER_SPRITE_IDS, playerArtFor, playerFrameIndex, playerCastFrameIndex, playerAnimationKey } from '../src/game/player-art';
import { MUELSYSE_FORM_RADIUS, MUELSYSE_COPY_RADIUS, MUELSYSE_FORM_ALPHA, MUELSYSE_COPY_ALPHA } from '../src/game/muelsyse';
const ROOT = process.cwd();
const PNG_SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);
interface DecodedPng {width:number; height:number; pixels:Uint8Array;}
function decodePng(urlPath: string): DecodedPng {
  const buffer = readFileSync(resolve(ROOT, `public${urlPath}`));
  expect(buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }

  expect(bitDepth).toBe(8);
  expect(colorType).toBe(6);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const rowStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x += 1) {
      const byte = raw[rowStart + x] ?? 0;
      const left = x >= 4 ? (pixels[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upperLeft = y > 0 && x >= 4 ? (pixels[(y - 1) * stride + x - 4] ?? 0) : 0;
      let value = byte;
      if (filter === 1) value = byte + left;
      else if (filter === 2) value = byte + up;
      else if (filter === 3) value = byte + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const estimate = left + up - upperLeft;
        const distanceLeft = Math.abs(estimate - left);
        const distanceUp = Math.abs(estimate - up);
        const distanceUpperLeft = Math.abs(estimate - upperLeft);
        const predictor =
          distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft
            ? left
            : distanceUp <= distanceUpperLeft
              ? up
              : upperLeft;
        value = byte + predictor;
      } else if (filter !== 0) {
        throw new Error(`不支持的 PNG 行过滤器：${filter}`);
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }

  return { width, height, pixels };
}


function frame(png:DecodedPng,col:number,row:number):Uint8Array {
 const result=new Uint8Array(96*96*4);
 for(let y=0;y<96;y++)result.set(png.pixels.subarray(((row*96+y)*png.width+col*96)*4,((row*96+y)*png.width+col*96+96)*4),y*96*4);
 return result;
}
const sheets=[['vishdal',ASSET_PATHS.playerVishdal],['amiya',ASSET_PATHS.playerAmiya],['saria',ASSET_PATHS.playerSaria],['muelsyse',ASSET_PATHS.playerMuelsyse]] as const;
for(const [id,path] of sheets) describe(`${id} V0.3 production atlas`,()=>{
 const png=decodePng(path); const art=playerArtFor(id);
 it('keeps the 96px/9x5 runtime and shared-preview contract',()=>{
  expect([png.width,png.height]).toEqual([864,480]);expect([art.frameWidth,art.frameHeight,art.sheetColumns,art.sheetRows]).toEqual([96,96,9,5]);
  expect(path).toBe(`/assets/art/hero-${id}.png`);expect(art.displayScale*96).toBeGreaterThanOrEqual(64);expect(art.displayScale*96).toBeLessThanOrEqual(72);
 });
 it('all directional action and eight cast slots contain visible content with clear borders',()=>{
  for(let row=0;row<5;row++)for(let col=0;col<(row===4?8:9);col++){
   const f=frame(png,col,row);let count=0,edge=0;
   for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(f[(y*96+x)*4+3]){count++;if(!x||!y||x===95||y===95)edge++;}
   expect(count,`${id} ${row}:${col}`).toBeGreaterThan(600);expect(edge).toBe(0);
  }
 });
 it('preserves feet and gameplay collision size in every action',()=>{
  expect(PLAYER.radius).toBe(12);expect(PLAYER.bodyCenterOffsetY).toBe(-12);expect(art.collisionRadius).toBe(12);expect(art.bodyRadius*art.displayScale).toBeCloseTo(12,8);
  expect(art.bodyOffsetX+art.bodyRadius).toBeCloseTo(48,8);expect(art.bodyOffsetY+2*art.bodyRadius).toBeCloseTo(92,8);expect(art.originY*96).toBe(92);
  for(let r=0;r<4;r++)for(let c=0;c<9;c++){
   const f=frame(png,c,r);let bottom=-1;for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(f[(y*96+x)*4+3])bottom=y;
   expect(bottom,`${id} ${r}:${c}`).toBe(92);
  }
 });
 it('keeps left/right art exactly mirrored and front/back distinct without digest checks',()=>{
  for(let c=0;c<9;c++){
   const r=frame(png,c,1),l=frame(png,c,3);
   for(let y=0;y<96;y++)for(let x=0;x<96;x++)for(let k=0;k<4;k++)expect(l[(y*96+(95-x))*4+k]).toBe(r[(y*96+x)*4+k]);
  }
  expect(Buffer.from(frame(png,0,0)).equals(Buffer.from(frame(png,0,2)))).toBe(false);
 });
 it('walking, attacking and hurt have real distinct poses',()=>{
  const idle=Buffer.from(frame(png,0,0));
  for(const col of [2,6,8])expect(idle.equals(Buffer.from(frame(png,col,0)))).toBe(false);
 });
 it('animation/cast indices remain in range with no direction overlap',()=>{
  const used=new Set<number>();
  for(const dir of PLAYER_DIRECTIONS)for(const action of ['idle','walk','attack','hurt'] as const)for(let i=0;i<art.actionColumns[action].length;i++){
   const idx=playerFrameIndex(dir,action,i,art);expect(idx).toBe(PLAYER_DIRECTIONS.indexOf(dir)*9+art.actionColumns[action][i]!);used.add(idx);
  }
  expect(used.size).toBe(36);const cast=PLAYER_CAST_DIRECTIONS.map(dir=>playerCastFrameIndex(dir,art));expect(new Set(cast).size).toBe(8);for(const idx of cast)expect(Math.floor(idx/9)).toBe(4);
  expect(playerAnimationKey('right','walk',id)).toBe(`${id}-right-walk`);
 });
});
describe('complete production art coverage',()=>{
 it('four character atlases are distinct and summons retain their gameplay distinction',()=>{
  expect(PLAYER_SPRITE_IDS).toHaveLength(4);
  for(let i=0;i<sheets.length;i++)for(let j=0;j<i;j++)expect(Buffer.from(decodePng(sheets[i]![1]).pixels).equals(Buffer.from(decodePng(sheets[j]![1]).pixels))).toBe(false);
  expect(MUELSYSE_FORM_RADIUS).toBe(12);expect(MUELSYSE_COPY_RADIUS).toBeLessThan(12);expect(MUELSYSE_FORM_ALPHA).toBeLessThan(1);expect(MUELSYSE_COPY_ALPHA).toBeLessThan(MUELSYSE_FORM_ALPHA);
 });
 it('every ordinary monster, larva and boss has its own production texture',()=>{
  expect(Object.keys(ENEMY_ART)).toHaveLength(10);
  for(const [id,path] of Object.entries(ENEMY_ART)){
   const png=decodePng(path);expect(png.width).toBe(id==='boss'?192:id==='larva'?48:80);let alpha=0;for(let i=3;i<png.pixels.length;i+=4)if(png.pixels[i])alpha++;
   expect(alpha).toBeGreaterThan(100);expect(alpha).toBeLessThan(png.width*png.height);
  }
 });
 it('all 106 catalog entries have a reachable illustrated icon',()=>{
  const catalog=JSON.parse(readFileSync('docs/design/v0.2/data/catalog.json','utf8')) as Record<string,unknown>;
  for(const group of Object.values(catalog))if(Array.isArray(group))for(const value of group){const entry=value as {id:string};expect(ITEM_ART[entry.id],entry.id).toBeTruthy();const png=decodePng(ITEM_ART[entry.id]!);expect([png.width,png.height]).toEqual([64,64]);}
 });
});
