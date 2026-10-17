// Draws the PWA icons (public/icons/icon-192.png, icon-512.png) without any image library: dark rounded square, white mortar board, blue cap.
import fs from "node:fs";
import zlib from "node:zlib";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const inRound = (x, y, r) => { // rounded square mask
    const m = size; const dx = Math.max(r - x, 0, x - (m - 1 - r)), dy = Math.max(r - y, 0, y - (m - 1 - r));
    return dx * dx + dy * dy <= r * r;
  };
  const tri = (px, py, a, b, c) => {
    const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
    const p = [px, py], d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size; // 0..1
      let rgba = [0, 0, 0, 0];
      if (inRound(x, y, size * 0.22)) rgba = [11, 27, 51, 255];
      // mortar board (diamond) and cap, from the 64×64 icon.svg
      if (tri(u, v, [0.22, 0.4], [0.5, 0.265], [0.78, 0.4]) || tri(u, v, [0.22, 0.4], [0.5, 0.535], [0.78, 0.4])) rgba = [255, 255, 255, 255];
      else if (u > 0.33 && u < 0.67 && v > 0.48 && v < 0.72 && (v < 0.5 + Math.abs(0.5 - u) * 0.0 + 0.2)) rgba = [122, 162, 255, 255];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = rgba[0]; raw[o + 1] = rgba[1]; raw[o + 2] = rgba[2]; raw[o + 3] = rgba[3];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
fs.mkdirSync("public/icons", { recursive: true });
for (const s of [192, 512]) fs.writeFileSync(`public/icons/icon-${s}.png`, png(s));
console.log("icons written");
