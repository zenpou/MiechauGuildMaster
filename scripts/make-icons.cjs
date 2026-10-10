// 仮のアイコン(角丸の地に菱形1つ)を public/icons に書き出す。意匠は後で画像に差し替える。
// 画像ライブラリを依存に足さないため、PNG は node 標準の zlib だけで組み立てる。
// 使い方: node scripts/make-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.resolve(__dirname, '..', 'public', 'icons');
const GROUND = [0x20, 0x2c, 0x2e];
const GEM = [0xf0, 0xc2, 0x5a];
const CORNER = 0.1875;
// maskable の安全域(中心から一辺の 0.4)に頂点が収まる大きさ
const GEM_RADIUS = 0.3;
const SAMPLES = 4;

const ICONS = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  // maskable と apple-touch-icon は OS が角を切り抜くので、四隅まで地で塗る(iOS は透明な角を黒くする)
  { file: 'maskable-512.png', size: 512, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, rounded: false },
];

function insideGround(x, y, size, rounded) {
  if (!rounded) return true;
  const r = size * CORNER;
  const dx = Math.max(r - x, 0, x - (size - r));
  const dy = Math.max(r - y, 0, y - (size - r));
  return dx * dx + dy * dy <= r * r;
}

function insideGem(x, y, size) {
  const c = size / 2;
  return Math.abs(x - c) + Math.abs(y - c) <= size * GEM_RADIUS;
}

/** 1 画素を SAMPLES×SAMPLES に分けて塗り、縁のギザギザを抑えた RGBA を返す */
function render(size, rounded) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) / SAMPLES;
          const y = py + (sy + 0.5) / SAMPLES;
          const color = insideGem(x, y, size) ? GEM : insideGround(x, y, size, rounded) ? GROUND : null;
          if (!color) continue;
          covered++;
          for (let i = 0; i < 3; i++) sum[i] += color[i];
        }
      }
      const at = (py * size + px) * 4;
      for (let i = 0; i < 3; i++) pixels[at + i] = covered ? Math.round(sum[i] / covered) : 0;
      pixels[at + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return pixels;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 1 色あたり 8 ビット
  header[9] = 6; // RGBA
  const stride = size * 4;
  // 各行の先頭 1 バイトはフィルタの種類。0(なし)のままにする
  const rows = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg() {
  const size = 512;
  const c = size / 2;
  const g = size * GEM_RADIUS;
  const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" rx="${size * CORNER}" fill="${hex(GROUND)}"/>`
    + `<path d="M${c} ${c - g} ${c + g} ${c} ${c} ${c + g} ${c - g} ${c}Z" fill="${hex(GEM)}"/></svg>\n`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const { file, size, rounded } of ICONS) fs.writeFileSync(path.join(OUT, file), encodePng(size, render(size, rounded)));
fs.writeFileSync(path.join(OUT, 'guild.svg'), svg());
console.log(`${ICONS.length} 枚の PNG と guild.svg を ${path.relative(process.cwd(), OUT)} に書き出しました`);
