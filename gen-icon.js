// 의존성 없이 트레이/앱 아이콘(PNG)을 생성한다.
// 어두운 배경 + 상승 막대그래프 모양. assets/icon.png 로 저장.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 256;

// CRC32 (PNG 청크용)
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function setPx(raw, x, y, r, g, b, a) {
  const idx = y * (SIZE * 4 + 1) + 1 + x * 4;
  raw[idx] = r;
  raw[idx + 1] = g;
  raw[idx + 2] = b;
  raw[idx + 3] = a;
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
// 각 행의 필터 바이트(0)는 alloc 기본값 0 이라 그대로 둠.

// 배경 (둥근 사각형 느낌의 짙은 남색)
const radius = 48;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // 모서리 둥글게: 코너 영역 밖이면 투명
    let inside = true;
    const corners = [
      [radius, radius],
      [SIZE - radius, radius],
      [radius, SIZE - radius],
      [SIZE - radius, SIZE - radius],
    ];
    if (x < radius && y < radius) inside = (x - radius) ** 2 + (y - radius) ** 2 <= radius ** 2;
    else if (x > SIZE - radius && y < radius) inside = (x - (SIZE - radius)) ** 2 + (y - radius) ** 2 <= radius ** 2;
    else if (x < radius && y > SIZE - radius) inside = (x - radius) ** 2 + (y - (SIZE - radius)) ** 2 <= radius ** 2;
    else if (x > SIZE - radius && y > SIZE - radius)
      inside = (x - (SIZE - radius)) ** 2 + (y - (SIZE - radius)) ** 2 <= radius ** 2;

    if (inside) setPx(raw, x, y, 0x1b, 0x1e, 0x27, 0xff);
    else setPx(raw, x, y, 0, 0, 0, 0);
  }
}

// 상승 막대 3개 (초록)
const bars = [
  { x: 56, h: 70 },
  { x: 110, h: 120 },
  { x: 164, h: 170 },
];
const barW = 36;
const baseY = 200;
for (const bar of bars) {
  for (let y = baseY - bar.h; y < baseY; y++) {
    for (let x = bar.x; x < bar.x + barW; x++) {
      setPx(raw, x, y, 0x22, 0xc5, 0x5e, 0xff);
    }
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, "assets");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon.png"), png);
console.log("assets/icon.png 생성 완료");
