const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const piexif = (() => { try { return require("piexifjs"); } catch { return null; } })();

const OUT = path.join(__dirname, "..", ".test-photos");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const COUNT = parseInt(process.argv[2] || "500", 10);

function randomColor() {
  return [Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)];
}

async function makeBaseImage(seed) {
  const [r, g, b] = randomColor();
  const w = 800 + (seed % 5) * 100;
  const h = 600 + (seed % 3) * 100;
  const svg = `<svg width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="rgb(${r},${g},${b})"/>
    <circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="rgb(${255 - r},${255 - g},${255 - b})"/>
    <text x="20" y="40" font-size="28" fill="white">photo-${seed}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  let n = 0;
  const manifest = [];

  async function write(buf, name) {
    fs.writeFileSync(path.join(OUT, name), buf);
    manifest.push(name);
    n++;
  }

  const baseCount = Math.floor(COUNT * 0.55);
  const bases = [];
  for (let i = 0; i < baseCount; i++) {
    const buf = await makeBaseImage(i);
    bases.push(buf);
    const ext = i % 3 === 0 ? "png" : "jpg";
    const out = ext === "png" ? buf : await sharp(buf).jpeg({ quality: 85 }).toBuffer();
    await write(out, `base_${i}.${ext}`);
  }

  // Exact duplicates
  const dupCount = Math.floor(COUNT * 0.15);
  for (let i = 0; i < dupCount; i++) {
    const src = bases[i % bases.length];
    const out = await sharp(src).jpeg({ quality: 85 }).toBuffer();
    await write(out, `dup_${i}.jpg`);
  }

  // Near-duplicates (slight crop/resize/quality change)
  const nearDupCount = Math.floor(COUNT * 0.1);
  for (let i = 0; i < nearDupCount; i++) {
    const src = bases[i % bases.length];
    const meta = await sharp(src).metadata();
    const out = await sharp(src)
      .resize(Math.max(50, meta.width - 10), Math.max(50, meta.height - 10))
      .jpeg({ quality: 60 })
      .toBuffer();
    await write(out, `neardup_${i}.jpg`);
  }

  // EXIF-rotated files (orientations 3, 6, 8) - jpeg only, requires piexifjs
  const exifCount = Math.floor(COUNT * 0.08);
  const orientations = [3, 6, 8];
  for (let i = 0; i < exifCount; i++) {
    const src = bases[i % bases.length];
    const jpegBuf = await sharp(src).jpeg({ quality: 85 }).toBuffer();
    const orientation = orientations[i % orientations.length];
    if (piexif) {
      try {
        const jpegStr = jpegBuf.toString("binary");
        const exifObj = { "0th": { [piexif.ImageIFD.Orientation]: orientation } };
        const exifBytes = piexif.dump(exifObj);
        const newJpegStr = piexif.insert(exifBytes, jpegStr);
        await write(Buffer.from(newJpegStr, "binary"), `exif_o${orientation}_${i}.jpg`);
        continue;
      } catch (e) {
        // fall through to plain write
      }
    }
    await write(jpegBuf, `exif_o${orientation}_${i}.jpg`);
  }

  // Glare photos - bright overlay
  const glareCount = Math.floor(COUNT * 0.04);
  for (let i = 0; i < glareCount; i++) {
    const src = bases[i % bases.length];
    const meta = await sharp(src).metadata();
    const overlay = Buffer.from(
      `<svg width="${meta.width}" height="${meta.height}">
        <circle cx="${meta.width * 0.7}" cy="${meta.height * 0.3}" r="${meta.width * 0.25}" fill="white" opacity="0.85"/>
      </svg>`
    );
    const out = await sharp(src).composite([{ input: overlay, blend: "over" }]).jpeg({ quality: 85 }).toBuffer();
    await write(out, `glare_${i}.jpg`);
  }

  // Frame photos - black border simulating photo-of-photo with frame
  const frameCount = Math.floor(COUNT * 0.04);
  for (let i = 0; i < frameCount; i++) {
    const src = bases[i % bases.length];
    const meta = await sharp(src).metadata();
    const border = Math.floor(Math.min(meta.width, meta.height) * 0.08);
    const out = await sharp(src)
      .extend({ top: border, bottom: border, left: border, right: border, background: "black" })
      .jpeg({ quality: 85 })
      .toBuffer();
    await write(out, `frame_${i}.jpg`);
  }

  // WebP variants
  const webpCount = Math.floor(COUNT * 0.02);
  for (let i = 0; i < webpCount; i++) {
    const src = bases[i % bases.length];
    const out = await sharp(src).webp({ quality: 80 }).toBuffer();
    await write(out, `variant_${i}.webp`);
  }

  // Broken/corrupt files - truncated or garbage bytes with image-like extensions
  const brokenCount = Math.max(5, Math.floor(COUNT * 0.02));
  for (let i = 0; i < brokenCount; i++) {
    if (i % 2 === 0) {
      const src = bases[i % bases.length];
      const out = await sharp(src).jpeg({ quality: 85 }).toBuffer();
      const truncated = out.slice(0, Math.floor(out.length * 0.3));
      await write(truncated, `broken_truncated_${i}.jpg`);
    } else {
      const garbage = Buffer.from(Array.from({ length: 2048 }, () => Math.floor(Math.random() * 256)));
      await write(garbage, `broken_garbage_${i}.jpg`);
    }
  }

  // Fake/invalid HEIC (since sharp can't easily produce real HEIC, write a renamed JPEG to
  // exercise the HEIC-detection/conversion code path's failure handling)
  const heicCount = Math.max(3, Math.floor(COUNT * 0.02));
  for (let i = 0; i < heicCount; i++) {
    const src = bases[i % bases.length];
    const out = await sharp(src).jpeg({ quality: 85 }).toBuffer();
    await write(out, `photo_${i}.heic`);
  }

  // Fill remainder with fresh unique base images to hit exact COUNT
  while (n < COUNT) {
    const buf = await makeBaseImage(1000 + n);
    const out = await sharp(buf).jpeg({ quality: 85 }).toBuffer();
    await write(out, `extra_${n}.jpg`);
  }

  fs.writeFileSync(path.join(OUT, "_manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Generated ${n} files in ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
