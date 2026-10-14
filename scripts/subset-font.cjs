// 見出し用の明朝を、font-glyphs.txt の文字だけに絞って woff2 にする。
// 元の TTF(Google Fonts の ShipporiMincho-Regular.ttf、OFL)は artifacts/fonts/ に手元で置く(git は無視)。出力の woff2 は git に入れる。
const fs = require('node:fs');
const path = require('node:path');
const subsetFont = require('subset-font');

const SRC = path.resolve(__dirname, '../artifacts/fonts/ShipporiMincho-Regular.ttf');
const GLYPHS = path.resolve(__dirname, 'font-glyphs.txt');
const OUT = path.resolve(__dirname, '../public/fonts/shippori-mincho-subset.woff2');

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`元のフォントが無い: ${SRC}\nGoogle Fonts の ShipporiMincho-Regular.ttf を置いてから実行する`);
    process.exit(1);
  }
  const text = fs.readFileSync(GLYPHS, 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('');
  const chars = [...new Set([...text])].filter((c) => c.trim()).join('');
  const out = await subsetFont(fs.readFileSync(SRC), chars, { targetFormat: 'woff2' });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  console.log(`${chars.length}文字 → ${path.relative(process.cwd(), OUT)} (${(out.length / 1024).toFixed(1)}KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
