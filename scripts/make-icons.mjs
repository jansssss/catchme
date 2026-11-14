// 앱 아이콘 PNG 생성: node scripts/make-icons.mjs
import { deflateSync } from "zlib";
import { writeFileSync } from "fs";
import sharp from "sharp";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
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

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const SS = 3; // 슈퍼샘플링
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const p = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const n = SS * SS;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0;
      raw[o + 3] = (a / n) * 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 알림 표시줄용 단색 배지 (과녁 모양)
const badge = (u, v) => {
  const d = Math.hypot(u - 0.5, v - 0.5);
  const on = d < 0.14 || (d > 0.26 && d < 0.36) || (d > 0.44 && d < 0.5);
  return [255, 255, 255, on ? 1 : 0];
};
writeFileSync("public/badge.png", png(96, badge));

// 앱 아이콘: catchme.png 원본(1254px)에서 바깥 여백·그림자를 잘라내고 크기별로 만든다
const SRC = "catchme.png";
const tile = () => sharp(SRC).extract({ left: 115, top: 108, width: 1024, height: 1024 });
await tile().resize(192, 192).png().toFile("public/icon-192.png");
await tile().resize(512, 512).png().toFile("public/icon-512.png");
await tile().resize(180, 180).png().toFile("public/apple-touch-icon.png");
// maskable 은 가장자리가 잘리므로 여백이 있는 원본 전체를 쓴다
await sharp(SRC).resize(512, 512).png().toFile("public/icon-maskable.png");
console.log("icons written");
