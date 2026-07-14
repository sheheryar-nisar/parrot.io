const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const iconsDir = path.join(__dirname, '..', 'icons');
const svgPath = path.join(iconsDir, 'icon.svg');
const sizes = [16, 48, 128];

async function main() {
  const svg = fs.readFileSync(svgPath);

  for (const size of sizes) {
    const out = path.join(iconsDir, `icon-${size}.png`);
    await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
    console.log(`Wrote ${out}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
