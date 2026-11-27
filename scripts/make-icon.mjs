// Writes a 256×256 PNG icon (rounded square with a speech bubble) without dependencies.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const N = 256;
const px = Buffer.alloc(N * (N * 4 + 1));
const inRounded = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
};
for (let y = 0; y < N; y++) {
  px[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    const o = y * (N * 4 + 1) + 1 + x * 4;
    let c = [0, 0, 0, 0];
    if (inRounded(x + 0.5, y + 0.5, 8, 8, 248, 248, 56)) {
      const t = y / N;
      c = [Math.round(58 + 40 * t), Math.round(109 - 30 * t), 240, 255];
      const bubble = inRounded(x + 0.5, y + 0.5, 56, 64, 200, 168, 32);
      const tail = x >= 80 && x <= 120 && y >= 160 && y <= 200 && x - 80 <= 200 - y;
      if (bubble || tail) c = [255, 255, 255, 255];
      const dot = [92, 128, 164].some((dx) => (x - dx) ** 2 + (y - 116) ** 2 <= 100);
      if (dot) c = [58, 109, 240, 255];
    }
    px.set(c, o);
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(px, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? "icon.png", png);
